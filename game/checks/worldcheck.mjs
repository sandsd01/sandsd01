import { chromium, LAUNCH, BASE_URL } from "./harness.mjs";

// Level design: does the world give you anywhere to go, and does it still read
// as a place rather than as a diagram?
//
// Before this work every zone border was a straight line through the origin
// (`z < 0 ? wetland : x >= 0 ? forest : rocky`) and there was not a single
// landmark in the world. Each check below is written to fail against that.
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

await page.goto(URL, { waitUntil: "load" });
await page.waitForFunction(() => !!window.__gameDebug, null, { timeout: 120000 });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: "load" });
await page.waitForFunction(() => !!window.__gameDebug, null, { timeout: 120000 });
await page.waitForTimeout(1500);

// --- 1. the borders wander ---------------------------------------------
// Walk south along many different x and note where the ground turns to
// wetland. Under the old rule that crossing was at exactly z = 0 for every
// single x; a warped border has to vary.
const wetlandEdge = await page.evaluate(() => {
  const edges = [];
  for (let x = -90; x <= 90; x += 6) {
    let found = null;
    for (let z = 40; z >= -40; z -= 0.5) {
      if (window.__gameDebug.getZoneAt(x, z) === "wetland") { found = z; break; }
    }
    if (found !== null) edges.push({ x, z: found });
  }
  return edges;
});
const zs = wetlandEdge.map((e) => e.z);
const spread = Math.max(...zs) - Math.min(...zs);
const straight = zs.every((z) => Math.abs(z) < 1);
ok("the wetland border is found along most of the map", wetlandEdge.length >= 20,
  String(wetlandEdge.length));
ok("it is not the straight line z=0 it used to be", !straight && spread > 5,
  `spread=${spread.toFixed(1)} min=${Math.min(...zs)} max=${Math.max(...zs)}`);

// Same for the forest/rocky split, which used to be exactly x = 0.
const rockyEdge = await page.evaluate(() => {
  const edges = [];
  for (let z = 20; z <= 90; z += 6) {
    let found = null;
    for (let x = 90; x >= -90; x -= 0.5) {
      if (window.__gameDebug.getZoneAt(x, z) === "rocky") { found = x; break; }
    }
    if (found !== null) edges.push({ z, x: found });
  }
  return edges;
});
const xs = rockyEdge.map((e) => e.x);
const xSpread = xs.length ? Math.max(...xs) - Math.min(...xs) : 0;
ok("the forest/rocky border is not the straight line x=0 either",
  xs.length >= 6 && xSpread > 5,
  `n=${xs.length} spread=${xSpread.toFixed(1)}`);

// The buildable clearing is deliberately still a true circle — gameplay leans
// on it, so it must not have been warped along with the rest.
const openRing = await page.evaluate(() => {
  const out = [];
  for (let a = 0; a < 360; a += 30) {
    const r = (a * Math.PI) / 180;
    out.push(window.__gameDebug.getZoneAt(Math.cos(r) * 3, Math.sin(r) * 3));
  }
  return out;
});
ok("the spawn clearing is still open all the way round",
  openRing.every((z) => z === "open"), openRing.join(","));

// --- 2. landmarks you can navigate by -----------------------------------
const landmarks = await page.evaluate(() => window.__gameDebug.getLandmarks());
ok("the world has landmarks at all", landmarks.length >= 3,
  JSON.stringify(landmarks.map((l) => l.name)));
ok("one for each biome", new Set(landmarks.map((l) => l.zone)).size >= 3,
  JSON.stringify(landmarks.map((l) => `${l.name}:${l.zone}`)));

// Tall enough to see over the treeline — a landmark you cannot see from a
// distance is not a landmark.
const tallest = Math.min(...landmarks.map((l) => l.height));
ok("all of them stand well above the trees", tallest > 8,
  JSON.stringify(landmarks.map((l) => `${l.name}:${l.height}`)));

// Far enough out to be worth walking to. The near ring stays inside the fog's
// far plane (250) so it reads as distant rather than vanishing; the far ring
// is deliberately past what can be seen from home — see explorecheck, which
// owns the frontier's own rules.
const nearRing = landmarks.filter((l) => !l.far).map((l) => Math.hypot(l.x, l.z));
const farRing = landmarks.filter((l) => l.far).map((l) => Math.hypot(l.x, l.z));
ok("the near ring sits out in the world, not on top of spawn",
  nearRing.length >= 3 && Math.min(...nearRing) > 40 && Math.max(...nearRing) < 120,
  nearRing.map((d) => d.toFixed(0)).join(","));
ok("and the far ring is out past it", farRing.length >= 3 && Math.min(...farRing) > 120,
  farRing.map((d) => d.toFixed(0)).join(","));

// And apart from each other *within a ring*, so they disambiguate direction
// instead of clustering into one blob on the horizon. Across rings there is no
// such rule: a far landmark standing beyond a near one on the same bearing is
// a road, not a collision.
const closestPair = (group) => {
  let min = Infinity;
  for (let i = 0; i < group.length; i++) {
    for (let j = i + 1; j < group.length; j++) {
      min = Math.min(min, Math.hypot(group[i].x - group[j].x, group[i].z - group[j].z));
    }
  }
  return min;
};
const nearSpread = closestPair(landmarks.filter((l) => !l.far));
const farSpread = closestPair(landmarks.filter((l) => l.far));
ok("and each ring's landmarks stand well apart from one another",
  nearSpread > 40 && farSpread > 40,
  `near ${nearSpread.toFixed(1)}, far ${farSpread.toFixed(1)}`);

// Each one really is in the biome it claims — placement is rejection-sampled
// against the warped zones, so this would break if the two disagreed.
const zoneAgrees = await page.evaluate((ls) =>
  ls.map((l) => ({ name: l.name, claims: l.zone, actual: window.__gameDebug.getZoneAt(l.x, l.z) })),
  landmarks);
ok("each landmark really stands in the biome it belongs to",
  zoneAgrees.every((z) => z.claims === z.actual), JSON.stringify(zoneAgrees));

// --- 3. a reason to walk there ------------------------------------------
const pois = await page.evaluate(() =>
  window.__gameDebug.getPlacedBuildings().filter((b) => b.id.startsWith("poi-")));
ok("every landmark has a cache at its foot", pois.length === landmarks.length,
  `${pois.length} caches for ${landmarks.length} landmarks`);

const stocked = await page.evaluate((ids) =>
  ids.map((id) => ({ id, contents: window.__gameDebug.getContainer(id) })), pois.map((p) => p.id));
ok("and each cache actually has something in it",
  stocked.length > 0 && stocked.every((s) => s.contents.length > 0 && s.contents.every((c) => c.qty > 0)),
  JSON.stringify(stocked));

const nearLandmark = pois.every((p) =>
  landmarks.some((l) => Math.hypot(l.x - p.cellX, l.z - p.cellZ) < 12));
ok("each cache sits at its landmark, not somewhere random", nearLandmark,
  JSON.stringify(pois.map((p) => [p.cellX, p.cellZ])));

// The caches must not refill themselves on reload — an infinite chest would
// undo the whole economy. They *do* refill on a two-day timer now (see
// explorecheck), which is a different claim: a reload is not two days.
const firstId = pois[0].id;
await page.evaluate((id) => {
  const c = window.__gameDebug.getContainer(id);
  for (const s of c) window.__gameDebug.withdrawFromContainer(id, s.itemId, s.qty);
  window.__gameDebug.saveNow();
}, firstId);
await page.reload({ waitUntil: "load" });
await page.waitForFunction(() => !!window.__gameDebug, null, { timeout: 120000 });
await page.waitForTimeout(1500);
const afterLoot = await page.evaluate((id) => window.__gameDebug.getContainer(id), firstId);
ok("a looted cache stays empty across a reload", afterLoot.length === 0,
  JSON.stringify(afterLoot));

// --- 4. none of this blew the frame budget ------------------------------
// Both budgets were raised when the world went from 200 units to 400 with its
// resource density held constant — measured, not waved through. Standing at
// spawn the frame went 373 -> 931 draw calls and 124k -> 231k triangles, and
// the swiftshader frame rate did not move (1.6 fps before, 1.6 after): under a
// software rasteriser the cost is fill, and the visible screen area did not
// change. The ceilings below are set just above what was measured, so a future
// change that doubles either still has to come and argue for it here.
const stats = await page.evaluate(() => window.__gameDebug.getRenderStats());
ok("draw calls stay within budget", stats.drawCalls > 0 && stats.drawCalls <= 1100,
  String(stats.drawCalls));
ok("triangle count stays within budget", stats.triangles > 0 && stats.triangles <= 280000,
  String(stats.triangles));
console.log(`      (draw calls ${stats.drawCalls}, triangles ${stats.triangles})`);

ok("no console/page errors", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length}`);
process.exit(failed.length ? 1 : 0);
