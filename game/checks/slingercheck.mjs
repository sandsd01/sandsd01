import { chromium, LAUNCH, BASE_URL } from "./harness.mjs";

// The enemy that throws, and the wall that stops it.
//
// Every claim is paired with its opposite. "Stones hurt you" passes on a build
// where they pass through walls too; "walls block stones" passes on a build
// where slingers never throw at all. Only the pair says anything.
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

/** Rings the player with `kind` at `range` and reports the damage taken. */
async function standUnder(kind, range, seconds, build) {
  await page.evaluate(({ kind, range, build }) => {
    const d = window.__gameDebug;
    d.teleportPlayer(0, 8);
    d.clearEnemies();
    const p = d.getPlayerPosition();
    if (build) {
      // A ring of wall just outside arm's reach: cover from every side.
      // `placeBuildingAt` takes *cell* coordinates and a rotation — passing
      // world coordinates and leaving the rotation off placed nothing at all,
      // and the check then read the trees that happened to be standing there
      // as proof that walls stop stones.
      // Clear the standing timber first. A tree is a collidable too, so with
      // one in the way the stone stops there and the wall behind it is never
      // touched — the player is protected either way, which is exactly why
      // the health bar alone cannot say what protected them.
      for (const n of d.getResourceNodes()) {
        if (Math.hypot(n.x - p.x, n.z - p.z) < 14) d.depleteNode(n.id);
      }
      d.grantItems({ wood: 600, stone: 600 });
      let placed = 0;
      for (let a = 0; a < 360; a += 8) {
        const r = (a * Math.PI) / 180;
        const cx = Math.round(p.x + Math.cos(r) * 3);
        const cz = Math.round(p.z + Math.sin(r) * 3);
        if (d.placeBuildingAt("wall", cx, cz, 0)) placed++;
      }
      window.__wallsPlaced = placed;
    }
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      d.spawnEnemyAt(kind, p.x + Math.cos(a) * range, p.z + Math.sin(a) * range);
    }
  }, { kind, range, build });
  await page.waitForTimeout(800);
  const before = await page.evaluate(() => window.__gameDebug.getHealth().current);
  let sawStone = false;
  let lowest = before;
  const t0 = Date.now();
  // The *lowest* health reached, and stop at a respawn. Reading the value at
  // the start and again at the end reports nothing at all here: eight throwers
  // land a volley together, and a player who is killed by the second one comes
  // back on full health, so both ends of the window read 100 and the check
  // concluded the stones did nothing.
  while (Date.now() - t0 < seconds * 1000) {
    await page.waitForTimeout(400);
    const s = await page.evaluate(() => ({
      hp: window.__gameDebug.getHealth().current,
      stones: window.__gameDebug.getStonesInFlight(),
    }));
    if (s.stones > 0) sawStone = true;
    if (s.hp > lowest) break; // respawned — everything after this is a new life
    lowest = Math.min(lowest, s.hp);
  }
  return { lost: before - lowest, sawStone };
}

// --- 1. the composition, read from the real table -------------------------
await boot();
const plan = await page.evaluate(() =>
  [1, 2, 3, 10, 30, 60].map((n) => ({ n, ...window.__gameDebug.getWavePlan(n, 3) })));
const early = plan.filter((p) => p.n <= 3);
ok("the first raids have no throwers at all",
  early.every((p) => p.slingers === 0),
  early.map((p) => `n${p.n}:${p.slingers}`).join(" "));
ok("and later ones do", plan.find((p) => p.n === 30).slingers > 0,
  plan.filter((p) => p.n > 3).map((p) => `n${p.n}:${p.slingers}`).join(" "));
// The point of adding rather than substituting: the melee core must not shrink.
const melee1 = plan.find((p) => p.n === 10);
const melee2 = plan.find((p) => p.n === 60);
ok("throwers are added to a wave, not taken out of it",
  melee2.count - melee2.slingers >= melee1.count - melee1.slingers,
  `melee n10=${melee1.count - melee1.slingers} n60=${melee2.count - melee2.slingers}`);

// --- 2. they throw, and the melee ones do not ------------------------------
const ranged = await standUnder("slinger", 9, 20, false);
ok("slingers throw from out of reach", ranged.sawStone && ranged.lost > 0,
  `lost ${ranged.lost} hp, stones seen: ${ranged.sawStone}`);

await boot();
const melee = await standUnder("zombie", 9, 20, false);
ok("and nothing else throws anything", !melee.sawStone,
  `stones seen from zombies: ${melee.sawStone}`);

// --- 3. walls are cover ----------------------------------------------------
// The half that matters. Without it, "stones hurt you" would pass on a build
// where they sail through every wall in the game.
await boot();
const covered = await standUnder("slinger", 9, 20, true);
const wallsPlaced = await page.evaluate(() => window.__wallsPlaced ?? 0);
ok("the cover under test is actually walls", wallsPlaced > 10, `${wallsPlaced} placed`);
ok("a wall between you and them stops the stones",
  wallsPlaced > 10 && covered.lost < ranged.lost,
  `behind cover ${covered.lost} hp vs in the open ${ranged.lost}`);

// --- 4. and cover is spent, not free --------------------------------------
// Reuses the ring from the check above, which has just been shown to place 19
// real walls. An isolated single wall was tried first and kept failing to
// place — a busy cell, not a game bug, but a check that cannot tell the two
// apart is not worth having.
const wornWalls = await page.evaluate(() => {
  const d = window.__gameDebug;
  const p = d.getPlayerPosition();
  // `cellX`/`cellZ`, not `x`/`z`. Filtering on the wrong field names matched
  // nothing and reported the ring pristine, which read as a broken feature —
  // the stones were damaging walls the whole time.
  return d.getPlacedBuildings()
    .filter((b) => Math.hypot(b.cellX - p.x, b.cellZ - p.z) < 6)
    .map((b) => d.getBuildingHealth(b.id))
    .filter((h) => h && h.damage > 0).length;
});
ok("and the wall wears down for it", wornWalls > 0, `${wornWalls} of the ring damaged`);

// --- 5. killing one pays --------------------------------------------------
await boot();
const paid = await page.evaluate(() => {
  const d = window.__gameDebug;
  d.teleportPlayer(0, 8);
  d.clearEnemies();
  const lv = d.getLevel();
  const p = d.getPlayerPosition();
  d.spawnEnemyAt("slinger", p.x + 2, p.z);
  return { level: lv.level, exp: lv.exp, table: d.getEnemyExp("slinger") };
});
await page.waitForTimeout(600);
await page.evaluate(() => window.__gameDebug.killNearestEnemy());
await page.waitForTimeout(800);
const now = await page.evaluate(() => window.__gameDebug.getLevel());
// Levels can tick over, and `exp` is progress *within* a level — comparing it
// alone read a level-up as the experience going backwards, from 50 to 0.
ok("a dead slinger pays experience",
  paid.table > 0 && (now.level > paid.level || now.exp > paid.exp),
  `lvl ${paid.level} exp ${paid.exp} -> lvl ${now.level} exp ${now.exp}, table says ${paid.table}`);

ok("no console/page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed`);
await browser.close();
process.exit(results.every((r) => r.pass) ? 0 : 1);
