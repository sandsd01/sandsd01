import { chromium, LAUNCH, BASE_URL } from "./harness.mjs";

// Can you walk off the end of the world?
//
// You could. `Terrain.heightAt` is a noise function that answers for any
// coordinate, mesh or no mesh, so a body past ±200 stands on ground that was
// never drawn and nothing in the game notices — no fall, no death, no error.
// It was found by teleporting to z=225 for a screenshot and seeing the ground
// simply stop.
//
// Every check below is written to fail against the build before the clamp.
const URL = BASE_URL;
const HALF = 200; // WORLD_SIZE / 2

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

const boot = async () => {
  await page.waitForFunction(() => !!window.__gameDebug, null, { timeout: 180000 });
  await page.waitForTimeout(1500);
};
await page.goto(URL, { waitUntil: "load" });
await boot();
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: "load" });
await boot();

const inside = (p) => Math.abs(p.x) <= HALF && Math.abs(p.z) <= HALF;

// --- 1. walking into each edge stops you inside ---------------------------
// Through probeMoveTo, which steps and resolves collision each time, so this
// is the real movement path rather than a single jump that would prove nothing.
const walks = await page.evaluate((half) => {
  const out = [];
  const targets = [
    ["+x", half + 60, 0],
    ["-x", -half - 60, 0],
    ["+z", 0, half + 60],
    ["-z", 0, -half - 60],
  ];
  for (const [label, tx, tz] of targets) {
    window.__gameDebug.teleportPlayer(0, 0);
    const end = window.__gameDebug.probeMoveTo(tx, tz, 260);
    const actual = window.__gameDebug.getPlayerPosition();
    out.push({ label, end, actual: { x: actual.x, z: actual.z } });
  }
  return out;
}, HALF);
for (const w of walks) {
  ok(`walking at the ${w.label} edge stops inside the world`, inside(w.actual),
    `ended at (${w.actual.x.toFixed(1)}, ${w.actual.z.toFixed(1)})`);
}
// The reported position and the real one must agree — a probe that hands back
// its own running total would report an overshoot the body never made, or hide
// one it did.
ok("the walk probe reports where the body actually is",
  walks.every((w) => Math.abs(w.end.x - w.actual.x) < 0.01 && Math.abs(w.end.z - w.actual.z) < 0.01),
  JSON.stringify(walks.map((w) => [w.label, w.end.x.toFixed(1), w.actual.x.toFixed(1)])));

// --- 2. the world is not secretly smaller now -----------------------------
// The check above passes just as well if the clamp pens the player into a tiny
// box in the middle. This is the other half of the claim, and the one a clamp
// that is too aggressive would fail.
const reach = walks.map((w) => Math.max(Math.abs(w.actual.x), Math.abs(w.actual.z)));
ok("and you can still walk right up to the edge",
  Math.min(...reach) > HALF - 4,
  `closest approach ${Math.min(...reach).toFixed(1)} of ${HALF}`);

// --- 3. teleport cannot put you outside either ----------------------------
const ports = await page.evaluate((half) => {
  const spots = [[half + 40, half + 40], [-half - 40, 0], [0, half + 90], [900, -900]];
  return spots.map(([x, z]) => {
    window.__gameDebug.teleportPlayer(x, z);
    const p = window.__gameDebug.getPlayerPosition();
    return { asked: [x, z], got: { x: p.x, z: p.z } };
  });
}, HALF);
ok("teleporting past the edge lands you inside it",
  ports.every((p) => inside(p.got)),
  JSON.stringify(ports.map((p) => `${p.asked} -> ${p.got.x.toFixed(0)},${p.got.z.toFixed(0)}`)));

// --- 4. the corner does not trap you --------------------------------------
// Clamping the move as a whole rather than per axis would pin a body to the
// point where it first touched the boundary; per-axis lets it slide along.
const corner = await page.evaluate((half) => {
  window.__gameDebug.teleportPlayer(half - 6, half - 6);
  const start = window.__gameDebug.getPlayerPosition();
  // Push hard into the corner, then try to run back along the +x edge.
  window.__gameDebug.probeMoveTo(half + 50, half + 50, 120);
  const pinned = window.__gameDebug.getPlayerPosition();
  window.__gameDebug.probeMoveTo(half + 50, -half + 40, 200);
  const slid = window.__gameDebug.getPlayerPosition();
  return {
    start: { x: start.x, z: start.z },
    pinned: { x: pinned.x, z: pinned.z },
    slid: { x: slid.x, z: slid.z },
  };
}, HALF);
ok("you can still slide along the boundary out of a corner",
  inside(corner.slid) && corner.pinned.z - corner.slid.z > 100,
  `corner ${corner.pinned.z.toFixed(1)} -> slid to ${corner.slid.z.toFixed(1)}`);

// --- 5. enemies stay on the map too ---------------------------------------
// Spawn placement was already clamped, so simply watching wanderers appear
// near a player at the edge proves nothing — checked, and it passed against a
// build with no movement clamp at all. `spawnEnemyAt` is the debug hook that
// places one at an exact spot with no clamp of its own, so it can put a body
// outside the way a collision push at the boundary would, and the question is
// whether the game pulls it back.
const enemies = await page.evaluate(async (half) => {
  window.__gameDebug.clearEnemies();
  if (window.__gameDebug.getRaidState().active) window.__gameDebug.endRaid();
  window.__gameDebug.teleportPlayer(half - 12, 0);
  const placed = [
    window.__gameDebug.spawnEnemyAt("zombie", half + 8, 0),
    window.__gameDebug.spawnEnemyAt("brute", half + 25, 10),
    window.__gameDebug.spawnEnemyAt("zombie", -half - 15, -half - 15),
  ];
  const at = () =>
    window.__gameDebug
      .getEnemyPositions()
      .filter((e) => placed.includes(e.id))
      .map((e) => ({ id: e.id, x: e.x, z: e.z }));
  const spawnedOutside = at().filter((e) => Math.abs(e.x) > half || Math.abs(e.z) > half).length;
  // A few frames is all it takes: the clamp runs in the per-frame step, not
  // only when an enemy happens to be walking.
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  }
  const after = at();
  return {
    spawnedOutside,
    total: after.length,
    off: after.filter((e) => Math.abs(e.x) > half || Math.abs(e.z) > half).length,
    worst: after.reduce((m, e) => Math.max(m, Math.abs(e.x), Math.abs(e.z)), 0),
    positions: after.map((e) => [Math.round(e.x), Math.round(e.z)]),
  };
}, HALF);
ok("the probe really did drop enemies outside the map to begin with",
  enemies.spawnedOutside === 3, `${enemies.spawnedOutside} of 3 placed outside`);
ok("an enemy that ends up off the map is pulled back onto it",
  enemies.total === 3 && enemies.off === 0,
  `${enemies.off} of ${enemies.total} still off-map, furthest ${enemies.worst.toFixed(1)}, at ${JSON.stringify(enemies.positions)}`);

ok("no console/page errors", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length}`);
process.exit(failed.length ? 1 : 0);
