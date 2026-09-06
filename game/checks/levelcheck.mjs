import { chromium, LAUNCH, BASE_URL } from "./harness.mjs";
import { editSaveOffline } from "./legacysave.mjs";

// Does the character actually grow?
//
// Before this there was nothing between one raid and the next: every fight in
// those eighteen minutes cost health and time and paid in a quieter field.
// Every check below asks whether a number the *player* can feel moved, not
// whether a field on the state object changed — a stat that alters a value
// nothing reads is a menu, not a choice.
const URL = BASE_URL;

const browser = await chromium.launch({
  ...LAUNCH,
  args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

const results = [];
const ok = (name, pass, detail = "") => {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};

async function waitFor(fn, arg, timeoutMs = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await page.evaluate(fn, arg)) return true;
    await page.waitForTimeout(150);
  }
  return false;
}

async function boot({ clear = false } = {}) {
  await page.goto(URL, { waitUntil: "load" });
  await page.waitForFunction(() => !!window.__gameDebug, null, { timeout: 120000 });
  if (clear) {
    await page.evaluate(() => localStorage.clear());
    await page.goto(URL, { waitUntil: "load" });
    await page.waitForFunction(() => !!window.__gameDebug, null, { timeout: 120000 });
  }
  await page.waitForTimeout(1500);
}

const level = () => page.evaluate(() => window.__gameDebug.getLevel());

await boot({ clear: true });

// --- 1. a fresh character starts at the bottom --------------------------
const start = await level();
ok("a new character is level 1 with nothing spent",
  start.level === 1 && start.exp === 0 && start.statPoints === 0 &&
    Object.values(start.stats).every((v) => v === 0),
  JSON.stringify(start));

// --- 2. killing something pays, and pays what the table says ------------
await page.click("#game-canvas");
await waitFor(() => window.__gameDebug.isPointerLocked());
const appeared = await waitFor(() => window.__gameDebug.getEnemyPositions().length > 0, null, 45000);
ok("an enemy shows up to fight", appeared);

const zombieExp = await page.evaluate(() => window.__gameDebug.getEnemyExp("zombie"));
const bruteExp = await page.evaluate(() => window.__gameDebug.getEnemyExp("brute"));
ok("a brute is worth more than a zombie", bruteExp > zombieExp,
  `zombie=${zombieExp} brute=${bruteExp}`);

const beforeKill = await level();
const killed = await page.evaluate(() => window.__gameDebug.killNearestEnemy());
await page.waitForTimeout(400);
const afterKill = await level();
const gained = afterKill.exp - beforeKill.exp;
ok("killing something grants exp", killed !== null && gained > 0,
  `${beforeKill.exp} -> ${afterKill.exp}`);
ok("and grants exactly what that enemy is worth",
  gained === zombieExp || gained === bruteExp,
  `gained=${gained}, table says zombie=${zombieExp} brute=${bruteExp}`);

// --- 3. an enemy that was never killed pays nothing ----------------------
// `clearAll` is what runs on a region change, and it deliberately does not
// emit "enemy-killed" — nobody killed those. If exp ever moved here, walking
// into a cave and back out would be a way to farm it. Walked into on foot
// rather than jumped, so it is the real transition being measured.
const mouth = (await page.evaluate(() => window.__gameDebug.getPortalSites()))
  .filter((s) => s.target === "cave")[0];
await page.evaluate((m) => {
  const len = Math.hypot(m.x, m.z) || 1;
  window.__gameDebug.teleportPlayer(m.x - (m.x / len) * 12, m.z - (m.z / len) * 12);
}, mouth);
await page.waitForTimeout(400);
await page.evaluate(() => {
  const p = window.__gameDebug.getPlayerPosition();
  window.__gameDebug.spawnEnemyAt("zombie", p.x + 4, p.z + 4);
  window.__gameDebug.spawnEnemyAt("brute", p.x + 5, p.z + 5);
});
await page.waitForTimeout(300);
const standing = await page.evaluate(() => window.__gameDebug.getEnemyPositions().length);
const beforeCave = await level();
await page.evaluate((m) => window.__gameDebug.probeMoveTo(m.x, m.z, 220), mouth);
await page.waitForTimeout(600);
const inCave = await page.evaluate(() => window.__gameDebug.getRegion().id);
const afterCave = await level();
ok("the walk into the cave actually happened", inCave === "cave", `region=${inCave}`);
ok("enemies swept away by a region change pay nothing",
  standing >= 2 && afterCave.exp === beforeCave.exp && afterCave.level === beforeCave.level,
  `${standing} standing, exp ${beforeCave.exp} -> ${afterCave.exp}`);
await page.evaluate(() => window.__gameDebug.teleportPlayer(0, 8));
await page.waitForTimeout(400);

// --- 4. levelling hands over points, and health --------------------------
const beforeLevel = await level();
await page.evaluate(() => window.__gameDebug.grantExp(window.__gameDebug.getLevel().toNext));
await page.waitForTimeout(200);
const afterLevel = await level();
ok("filling the bar levels you up", afterLevel.level === beforeLevel.level + 1,
  `${beforeLevel.level} -> ${afterLevel.level}`);
ok("a level hands over points to spend", afterLevel.statPoints > beforeLevel.statPoints,
  `${beforeLevel.statPoints} -> ${afterLevel.statPoints}`);
ok("a level raises max health on its own", afterLevel.maxHealth > beforeLevel.maxHealth,
  `${beforeLevel.maxHealth} -> ${afterLevel.maxHealth}`);
ok("the bar carries the remainder rather than resetting to zero",
  afterLevel.toNext > beforeLevel.toNext,
  `next level needs ${beforeLevel.toNext} -> ${afterLevel.toNext}`);

// One large grant should not stop at one level.
await page.evaluate(() => window.__gameDebug.grantExp(5000));
await page.waitForTimeout(200);
const afterBig = await level();
ok("a large grant levels as many times as it is worth",
  afterBig.level >= afterLevel.level + 3, `${afterLevel.level} -> ${afterBig.level}`);

// --- 5. a spent point changes a number the player feels -----------------
// Measured before and after, at the same chokepoint the game itself reads.
// Checking that `stats.might` went to 1 would pass against a build with the
// whole of the wiring deleted.
const might = await page.evaluate(() => {
  window.__gameDebug.grantItems({ sword: 1 });
  window.__gameDebug.holdItem("sword");
  const before = { melee: window.__gameDebug.getHeldDamage(), arrow: window.__gameDebug.getArrowDamage() };
  for (let i = 0; i < 5; i++) window.__gameDebug.allocateStat("might");
  return { before, after: { melee: window.__gameDebug.getHeldDamage(), arrow: window.__gameDebug.getArrowDamage() } };
});
ok("Might makes a sword hit harder", might.after.melee > might.before.melee,
  `${might.before.melee} -> ${might.after.melee}`);
ok("Might makes an arrow hit harder too", might.after.arrow > might.before.arrow,
  `${might.before.arrow} -> ${might.after.arrow}`);

const vigour = await page.evaluate(() => {
  const maxBefore = window.__gameDebug.getLevel().maxHealth;
  window.__gameDebug.getHealth();
  // Full health first, so the reduction is measured against a known start.
  const take = () => {
    const before = window.__gameDebug.getHealth().current;
    window.__gameDebug.hurtPlayer(40);
    return before - window.__gameDebug.getHealth().current;
  };
  const hitBefore = take();
  for (let i = 0; i < 12; i++) window.__gameDebug.allocateStat("vigour");
  const maxAfter = window.__gameDebug.getLevel().maxHealth;
  const hitAfter = take();
  return { maxBefore, maxAfter, hitBefore, hitAfter };
});
ok("Vigour raises max health", vigour.maxAfter > vigour.maxBefore,
  `${vigour.maxBefore} -> ${vigour.maxAfter}`);
ok("Vigour makes a hit land for less", vigour.hitAfter < vigour.hitBefore,
  `40 damage landed for ${vigour.hitBefore} -> ${vigour.hitAfter}`);

const swift = await page.evaluate(() => {
  const before = window.__gameDebug.getMoveSpeedScale();
  for (let i = 0; i < 10; i++) window.__gameDebug.allocateStat("swiftness");
  return { before, after: window.__gameDebug.getMoveSpeedScale() };
});
ok("Swiftness makes you faster", swift.after > swift.before,
  `${swift.before.toFixed(3)} -> ${swift.after.toFixed(3)}`);

const craft = await page.evaluate(() => {
  window.__gameDebug.holdItem("axe");
  const before = window.__gameDebug.getGatherTimeFor("tree");
  for (let i = 0; i < 8; i++) window.__gameDebug.allocateStat("craft");
  return { before, after: window.__gameDebug.getGatherTimeFor("tree") };
});
ok("Craft makes a swing at a tree quicker", craft.after < craft.before,
  `${craft.before}ms -> ${craft.after}ms`);

// Fortune pays in *content*, so it is measured the way lootcheck measures a
// table: over hundreds of rolls, not one.
const fortune = await page.evaluate(() => {
  const total = () => {
    let sum = 0;
    for (let i = 0; i < 600; i++) for (const d of window.__gameDebug.rollLootFor("brute")) sum += d.qty;
    return sum / 600;
  };
  const before = total();
  for (let i = 0; i < 20; i++) window.__gameDebug.allocateStat("fortune");
  return { before, after: total() };
});
ok("Fortune makes the dead drop more often", fortune.after > fortune.before * 1.05,
  `${fortune.before.toFixed(2)} -> ${fortune.after.toFixed(2)} items per brute over 600 rolls`);

// --- 6. points are finite ------------------------------------------------
const spent = await page.evaluate(() => {
  // Burn whatever is left, then try once more.
  let guard = 0;
  while (window.__gameDebug.getLevel().statPoints > 0 && guard++ < 500) {
    window.__gameDebug.allocateStat("might");
  }
  const at = window.__gameDebug.getLevel();
  return { points: at.statPoints, oneMore: window.__gameDebug.allocateStat("might"), might: at.stats.might };
});
ok("a point cannot be spent twice", spent.points === 0 && spent.oneMore === false,
  JSON.stringify(spent));

// --- 6b. a level gained while dead does not stand you back up -------------
// An arrow already in flight can land after the player has fallen. Healing
// them there would clear the death while the two-second respawn is already
// pending, so they would get up and then be yanked home a moment later.
const posthumous = await page.evaluate(() => {
  window.__gameDebug.hurtPlayer(100000);
  const dead = window.__gameDebug.getHealth().current;
  const before = window.__gameDebug.getLevel().level;
  window.__gameDebug.grantExp(99999);
  return { dead, before, after: window.__gameDebug.getLevel(), health: window.__gameDebug.getHealth() };
});
ok("the player really was down for this check", posthumous.dead === 0, JSON.stringify(posthumous.dead));
ok("a posthumous kill still counts as a level",
  posthumous.after.level > posthumous.before,
  `${posthumous.before} -> ${posthumous.after.level}`);
ok("but it does not heal a dead player back onto their feet",
  posthumous.health.current === 0, JSON.stringify(posthumous.health));
// Back on their feet the ordinary way before the rest of the suite runs.
await waitFor(() => window.__gameDebug.getHealth().current > 0, null, 30000);

// --- 7. the aura plays ----------------------------------------------------
// Settled first, because the levels granted above are still glowing: the
// clock this runs on is the game's, and at swiftshader's frame rate a
// nine-hundred-millisecond effect is several seconds of wall time. Asserting
// "not playing" without waiting was checking the frame rate, not the effect.
const auraSettled = await waitFor(() => window.__gameDebug.isAuraPlaying() === false, null, 40000);
ok("the effect from an earlier level finishes on its own", auraSettled);
await page.evaluate(() => window.__gameDebug.grantExp(window.__gameDebug.getLevel().toNext));
await page.waitForTimeout(120);
const auraOn = await page.evaluate(() => window.__gameDebug.isAuraPlaying());
ok("levelling up starts it", auraOn === true);
// And stops again, or every level after the first leaves a light standing in
// the field.
const auraOff = await waitFor(() => window.__gameDebug.isAuraPlaying() === false, null, 40000);
ok("and it finishes by itself", auraOff);

// --- 7b. the character sheet, and five glyphs a player can tell apart ------
// Read from the rendered geometry, not from the names in the source: this
// project has picked a duplicate icon three separate times, and the names
// looked fine every one of those times.
await page.keyboard.press("KeyK");
await page.waitForTimeout(700);
const panel = await page.evaluate(() => {
  const rows = [...document.querySelectorAll(".character-stat")];
  const shapeOf = (row) => {
    const svg = row.querySelector(".character-stat-icon svg");
    return svg ? [...svg.children].map((n) => n.getAttribute("d") ?? n.outerHTML).join("|") : "";
  };
  const box = document.querySelector(".panel.visible")?.getBoundingClientRect();
  const last = rows.length ? rows[rows.length - 1].getBoundingClientRect() : null;
  return {
    open: !!document.querySelector(".panel.visible"),
    rowCount: rows.length,
    shapes: rows.map(shapeOf),
    // Also against the HUD resource chips, which are the other icons on screen.
    chipShapes: [...document.querySelectorAll(".hud-resources .icon svg")].map((svg) =>
      [...svg.children].map((n) => n.getAttribute("d") ?? n.outerHTML).join("|")),
    buttons: rows.map((r) => {
      const b = r.querySelector(".character-stat-add")?.getBoundingClientRect();
      return b ? [Math.round(b.width), Math.round(b.height)] : null;
    }),
    lastRowInside: box && last ? last.bottom <= box.bottom : null,
    effects: rows.map((r) => r.querySelector(".character-stat-effect")?.textContent ?? ""),
  };
});
ok("the character sheet opens on its key", panel.open && panel.rowCount === 5,
  `open=${panel.open} rows=${panel.rowCount}`);
ok("no two stats wear the same glyph",
  new Set(panel.shapes).size === 5 && !panel.shapes.some((g) => !g),
  `${new Set(panel.shapes).size} distinct of ${panel.shapes.length}`);
ok("and none of them collides with a resource chip",
  !panel.shapes.some((g) => panel.chipShapes.includes(g)),
  `${panel.chipShapes.length} chips on screen`);
ok("every + button is a counter-sized target",
  panel.buttons.every((b) => b && b[0] >= 44 && b[1] >= 44), JSON.stringify(panel.buttons));
// Fortune is the fifth row, and it was below the fold on the first attempt. A
// stat a player never scrolls to is a stat that does not exist.
ok("all five rows fit inside the panel without scrolling", panel.lastRowInside === true);
ok("each row says what the point actually buys, in units",
  panel.effects.every((e) => /%|\+\d/.test(e)), JSON.stringify(panel.effects));
await page.keyboard.press("KeyK");
await page.waitForTimeout(400);

// --- 8. it survives a reload ---------------------------------------------
const saved = await level();
await page.evaluate(() => window.__gameDebug.saveNow());
await boot();
const loaded = await level();
ok("level, exp and spent points all come back after a reload",
  loaded.level === saved.level && loaded.exp === saved.exp &&
    JSON.stringify(loaded.stats) === JSON.stringify(saved.stats) &&
    loaded.maxHealth === saved.maxHealth,
  `saved ${JSON.stringify(saved)} loaded ${JSON.stringify(loaded)}`);

// --- 9. a save written before any of this existed still loads ------------
// Edited from a page where the game cannot boot. The obvious version of this
// — evaluate the delete, then reload — silently checks nothing at all: the
// game saves on `beforeunload`, so navigating away writes the live state back
// over the edit and the reload reads a perfectly modern save.
await editSaveOffline(page, URL, (save) => {
  delete save.player.level;
  delete save.player.exp;
  delete save.statPoints;
  // The harder case the `raid.count` bug taught: the record is there, but a
  // field inside it is not. A guard on the whole object skips this.
  save.stats = { might: 3 };
});
await boot();
const legacy = await level();
ok("a save from before levelling loads rather than throwing",
  errors.length === 0, errors.slice(0, 2).join(" | "));
ok("the edit really landed — the old save is not the one just written",
  legacy.level === 1 && legacy.statPoints === 0,
  `level=${legacy.level} points=${legacy.statPoints}`);
ok("it starts at level 1 with a whole stat record",
  legacy.level === 1 && legacy.exp === 0 &&
    Object.keys(legacy.stats).length === 5 &&
    Object.values(legacy.stats).every((v) => typeof v === "number"),
  JSON.stringify(legacy));
// The one field that *was* in the partial record has to survive, or the guard
// is throwing away spent points rather than filling in missing ones.
ok("and keeps the points the partial record did carry", legacy.stats.might === 3,
  JSON.stringify(legacy.stats));

console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed`);
if (errors.length) console.log("page errors:", errors.slice(0, 5));
await browser.close();
process.exit(results.every((r) => r.pass) ? 0 : 1);
