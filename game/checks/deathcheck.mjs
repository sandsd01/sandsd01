import { chromium, LAUNCH, BASE_URL } from "./harness.mjs";

// What does dying cost?
//
// It used to cost nothing: a full heal, a trip home, two seconds. Every claim
// here is paired with its opposite, because "exp went down" passes on a build
// that drains the bar every frame, and "the level held" passes on a build
// where nothing happens at all.
const browser = await chromium.launch({ ...LAUNCH });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

const results = [];
const ok = (name, pass, detail = "") => {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};

async function boot() {
  await page.goto(BASE_URL, { waitUntil: "load" });
  await page.waitForFunction(() => !!window.__gameDebug, null, { timeout: 120000 });
  await page.evaluate(() => localStorage.clear());
  await page.goto(BASE_URL, { waitUntil: "load" });
  await page.waitForFunction(() => !!window.__gameDebug, null, { timeout: 120000 });
  await page.waitForTimeout(1500);
}

/** Levels to `target` and leaves a known amount of progress on the bar. */
async function levelTo(target, spendPoints = false) {
  return page.evaluate(({ target, spendPoints }) => {
    const d = window.__gameDebug;
    let guard = 0;
    while (d.getLevel().level < target && guard++ < 20000) d.grantExp(20);
    if (spendPoints) {
      const pts = d.getLevel().statPoints;
      for (let i = 0; i < pts; i++) d.allocateStat("vigour");
    }
    // A little progress on the bar so there is something to lose.
    d.grantExp(20);
    return d.getLevel();
  }, { target, spendPoints });
}

/**
 * Fills the bar to just under the next level, using the threshold the game
 * reports rather than guessing at it.
 *
 * Two earlier versions of this were wrong in opposite directions. The first
 * granted a flat 5000 and quietly levelled the player several times, so a case
 * labelled "level 5" was measured at seventeen. The second stepped upward and
 * stopped once the level changed — which is one grant too late, so it returned
 * a bar that had just reset to nearly empty and the check read a full charge
 * as having drained everything.
 */
async function fillBarTo(fraction) {
  return page.evaluate((fraction) => {
    const d = window.__gameDebug;
    const target = Math.floor(d.getLevel().toNext * fraction);
    let guard = 0;
    while (d.getLevel().exp < target && guard++ < 10000) {
      const room = target - d.getLevel().exp;
      d.grantExp(Math.max(1, Math.min(50, room)));
    }
    return d.getLevel();
  }, fraction);
}

/** Kills the player outright and waits out the respawn. */
async function die() {
  await page.evaluate(() => window.__gameDebug.hurtPlayer(999999));
  await page.waitForTimeout(3000);
}

// --- 1. dying costs progress, being hurt does not -------------------------
await boot();
const start = await levelTo(8);
await page.evaluate(() => window.__gameDebug.hurtPlayer(5));
await page.waitForTimeout(600);
const hurt = await page.evaluate(() => window.__gameDebug.getLevel());
ok("taking a hit costs no progress", hurt.exp === start.exp, `${start.exp} -> ${hurt.exp}`);

await die();
const dead = await page.evaluate(() => window.__gameDebug.getLevel());
ok("but dying does", dead.exp < hurt.exp, `${hurt.exp} -> ${dead.exp}`);

// --- 2. the level itself never moves --------------------------------------
// The constraint the whole design is built around: levels go up, and the bar
// underneath them is the only thing at risk.
ok("and the level does not drop", dead.level === hurt.level, `level ${hurt.level}`);
ok("and spent stat points are not clawed back",
  dead.statPoints === hurt.statPoints, `${hurt.statPoints} points`);

// --- 3. the floor holds ---------------------------------------------------
// Dying twice in a row with an empty bar must not go negative or eat a level.
await die();
const twice = await page.evaluate(() => window.__gameDebug.getLevel());
ok("a second death on an empty bar leaves it at zero",
  twice.exp === 0 && twice.level === dead.level,
  `exp ${twice.exp}, level ${twice.level}`);

// --- 4. one death, one charge ---------------------------------------------
// `scheduleRespawnIfDead` runs every frame. Charged outside its guard it would
// drain the bar sixty times a second, and every check above would still pass.
await boot();
await levelTo(20);
// Nearly a full level of progress, so one charge is visibly a fraction of it.
const before4 = await fillBarTo(0.9);
await die();
const after4 = await page.evaluate(() => window.__gameDebug.getLevel());
const oneLoss = before4.exp - after4.exp;
// A single charge is a fifth of the level. Many charges would have emptied it.
// Bounded on both sides, and the lower bound is not optional: with only the
// upper one this passed on a build that charged nothing at all — "729 left of
// 729" satisfies "more than half survived" perfectly well. One charge is a
// fifth of the level, so something must go, and most must stay.
ok("dying once charges once",
  oneLoss > 0 && after4.exp > before4.exp / 2,
  `lost ${oneLoss} of ${before4.exp} (level ${before4.level}, needs ${before4.toNext}), ${after4.exp} left`);

// --- 5. the bite scales with the level ------------------------------------
// A flat number would be brutal early and invisible late; this is the check
// that tells the two designs apart.
await boot();
await levelTo(5);
const lo0 = await fillBarTo(0.9);
await die();
const lo1 = await page.evaluate(() => window.__gameDebug.getLevel());
const lowLoss = lo0.exp - lo1.exp;

await boot();
await levelTo(30);
const hi0 = await fillBarTo(0.9);
await die();
const hi1 = await page.evaluate(() => window.__gameDebug.getLevel());
const highLoss = hi0.exp - hi1.exp;
ok("a death costs more at a higher level",
  highLoss > lowLoss && hi1.level > lo1.level,
  `level ${lo0.level} lost ${lowLoss}, level ${hi0.level} lost ${highLoss}`);

ok("no console/page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed`);
await browser.close();
process.exit(results.every((r) => r.pass) ? 0 : 1);
