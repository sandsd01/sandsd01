import { chromium, LAUNCH, BASE_URL } from "./harness.mjs";
import { editSaveOffline } from "./legacysave.mjs";

// Does the world give you a reason to leave the homestead?
//
// Before this work: 200 units across, three landmarks with one cache each that
// was stocked once per save and never again, every material available at the
// edge of the biome nearest the door, and wandering enemies that spawned on a
// ring around the WORLD ORIGIN — so walking away from spawn made you safer.
// Every check below is written to fail against that world.
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

const boot = async () => {
  await page.waitForFunction(() => !!window.__gameDebug, null, { timeout: 180000 });
  await page.waitForTimeout(1500);
};

await page.goto(URL, { waitUntil: "load" });
await boot();
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: "load" });
await boot();

// --- 1. the world really is bigger -------------------------------------
const size = await page.evaluate(() => window.__gameDebug.getWorldSize());
ok("the world is 400 units across", size === 400, String(size));

// Not just a number in a constant: the ground has to actually be there.
const farGround = await page.evaluate(() => {
  const pts = [
    [190, 0], [-190, 0], [0, 190], [0, -190], [130, 130], [-130, -130],
  ];
  return pts.map(([x, z]) => ({ x, z, y: window.__gameDebug.terrainHeightAt(x, z) }));
});
ok("there is ground out at the new edges",
  farGround.every((p) => Number.isFinite(p.y) && Math.abs(p.y) < 40),
  JSON.stringify(farGround.map((p) => p.y.toFixed(1))));

// --- 2. density per area, not a fixed count -----------------------------
// The old scatter was a flat 900 attempts over the whole map. Left alone, four
// times the area would have meant a quarter the trees per acre — the forest by
// the front door thinning out because somewhere far away got bigger.
const density = await page.evaluate(() => {
  const nodes = window.__gameDebug.getResourceNodes();
  const within = (r) => nodes.filter((n) => Math.hypot(n.x, n.z) <= r).length;
  return { total: nodes.length, near: within(100), area: Math.PI * 100 * 100 };
});
// The pre-change world put ~450 nodes inside a 200x200 square; the disc of
// radius 100 inside it is π/4 of that, so ~350 is the figure to hold.
const nearPerKsq = (density.near / density.area) * 1000;
ok("resource density near home is unchanged by the bigger world",
  density.near >= 280, `${density.near} nodes within r=100 (${nearPerKsq.toFixed(1)}/1000u²)`);
ok("and the far half of the map is populated too", density.total >= 1200,
  `${density.total} nodes in all`);

// --- 3. one material exists only out past the frontier ------------------
const stones = await page.evaluate(() =>
  window.__gameDebug
    .getResourceNodes()
    .filter((n) => n.kind === "ancient_stone")
    .map((n) => ({ id: n.id, r: Math.hypot(n.x, n.z), x: n.x, z: n.z })));
ok("ancient stone exists in the world", stones.length > 0, `${stones.length} nodes`);
ok("and NONE of it is within the frontier radius",
  stones.every((s) => s.r >= 120),
  stones.length ? `closest at r=${Math.min(...stones.map((s) => s.r)).toFixed(1)}` : "none");
ok("there is enough of it out there to be worth the trip", stones.length >= 30,
  String(stones.length));

// Adding a frontier material must not have *removed* one. The first cut of
// pickKind spent the biome's own random draw on the ancient-stone test, which
// swallowed whichever branch sat lowest in each table — the far forest quietly
// stopped producing rock at all. Nothing about that is visible in a diff.
const farMix = await page.evaluate(() => {
  const counts = {};
  for (const n of window.__gameDebug.getResourceNodes()) {
    if (Math.hypot(n.x, n.z) < 120) continue;
    const zone = window.__gameDebug.getZoneAt(n.x, n.z);
    counts[zone] ??= {};
    counts[zone][n.kind] = (counts[zone][n.kind] ?? 0) + 1;
  }
  return counts;
});
const missing = Object.entries(farMix)
  .filter(([zone]) => zone !== "open")
  .filter(([, kinds]) => Object.keys(kinds).length < 3)
  .map(([zone, kinds]) => `${zone}:${Object.keys(kinds).join("/")}`);
ok("every biome past the frontier still grows its full mix of nodes",
  missing.length === 0,
  missing.length ? missing.join(", ") : JSON.stringify(farMix));

// --- 4. it is quarryable, and it builds something -----------------------
const nearest = stones.sort((a, b) => a.r - b.r)[0];
const mined = await page.evaluate((id) => {
  const total = () =>
    window.__gameDebug
      .getInventory()
      .reduce((n, s) => (s.itemId === "ancient_stone" ? n + s.qty : n), 0);
  // Through the real gathering path, so the pickaxe requirement counts: an
  // ancient stone that could be quarried bare-handed would not be a frontier
  // material, it would be a differently-shaped rock.
  window.__gameDebug.grantItems({ iron_pickaxe: 1 });
  window.__gameDebug.holdItem("iron_pickaxe");
  const before = total();
  let swings = 0;
  while (swings < 12 && !window.__gameDebug.getNodeState(id).depleted) {
    window.__gameDebug.hitNodeOnce(id);
    swings++;
  }
  return { before, after: total(), swings };
}, nearest.id);
ok("working one yields ancient stone", mined.after > mined.before,
  `${mined.before} -> ${mined.after}`);

const built = await page.evaluate(() => {
  window.__gameDebug.grantItems({ ancient_stone: 40, brick: 40, iron_ingot: 10 });
  const before = window.__gameDebug.getPlacedBuildings().length;
  const wall = window.__gameDebug.placeBuildingAt("reinforced_wall", 6, 6);
  const trap = window.__gameDebug.placeBuildingAt("heavy_trap", 6, 8);
  return { before, after: window.__gameDebug.getPlacedBuildings().length, wall, trap };
});
ok("ancient stone builds a reinforced wall and a heavy trap",
  built.after === built.before + 2 && !!built.wall && !!built.trap,
  JSON.stringify(built));

const health = await page.evaluate(() => ({
  brick: window.__gameDebug.getBuildingDef("brick_wall").maxHealth,
  reinforced: window.__gameDebug.getBuildingDef("reinforced_wall").maxHealth,
}));
ok("the reinforced wall really does hold more than brick",
  health.reinforced > health.brick * 2,
  `brick ${health.brick} vs reinforced ${health.reinforced}`);

// --- 5. two rings of landmarks ------------------------------------------
const landmarks = await page.evaluate(() => window.__gameDebug.getLandmarks());
ok("there are six landmarks, not three", landmarks.length === 6,
  JSON.stringify(landmarks.map((l) => l.name)));
const far = landmarks.filter((l) => l.far);
const near = landmarks.filter((l) => !l.far);
ok("three of them stand out past the frontier",
  far.length === 3 && far.every((l) => Math.hypot(l.x, l.z) >= 130),
  far.map((l) => `${l.name}@${Math.hypot(l.x, l.z).toFixed(0)}`).join(", "));
ok("and the near ring is where it always was",
  near.length === 3 && near.every((l) => Math.hypot(l.x, l.z) < 120),
  near.map((l) => `${l.name}@${Math.hypot(l.x, l.z).toFixed(0)}`).join(", "));
ok("every landmark is tall enough to steer by",
  landmarks.every((l) => l.height > 8),
  landmarks.map((l) => `${l.name}:${l.height}`).join(", "));

// --- 6. the far caches pay better than the near ones --------------------
const pois = await page.evaluate(() => window.__gameDebug.getPois());
ok("every landmark has a cache", pois.length === landmarks.length,
  `${pois.length} caches for ${landmarks.length} landmarks`);

const haul = await page.evaluate((ids) =>
  ids.map(({ id, far }) => ({
    id,
    far,
    total: window.__gameDebug.getContainer(id).reduce((n, s) => n + s.qty, 0),
    hasStone: window.__gameDebug.getContainer(id).some((s) => s.itemId === "ancient_stone"),
  })), pois.map((p) => ({ id: p.id, far: p.far })));
const nearHaul = haul.filter((h) => !h.far);
const farHaul = haul.filter((h) => h.far);
ok("a far cache is worth more than any near one",
  Math.min(...farHaul.map((h) => h.total)) > Math.max(...nearHaul.map((h) => h.total)),
  `near ${nearHaul.map((h) => h.total)} vs far ${farHaul.map((h) => h.total)}`);
ok("and only the far ones hold ancient stone",
  farHaul.every((h) => h.hasStone) && nearHaul.every((h) => !h.hasStone),
  JSON.stringify(haul.map((h) => [h.far, h.hasStone])));

// --- 7. an emptied cache comes back ------------------------------------
const target = pois.find((p) => !p.far) ?? pois[0];
await page.evaluate((id) => {
  for (const s of window.__gameDebug.getContainer(id)) {
    window.__gameDebug.withdrawFromContainer(id, s.itemId, s.qty);
  }
}, target.id);
// Stand well away — a cache does not refill under the player's nose.
await page.evaluate(() => window.__gameDebug.teleportPlayer(0, 0));
await page.waitForTimeout(400);

const booked = await page.evaluate((id) =>
  window.__gameDebug.getPois().find((p) => p.id === id), target.id);
ok("emptying a cache books a restock", typeof booked.restockAtMs === "number",
  JSON.stringify(booked));

// A day short of the timer: it must NOT have refilled.
await page.evaluate(() => window.__gameDebug.advanceClockMs(6 * 60 * 1000));
await page.waitForTimeout(400);
const early = await page.evaluate((id) => window.__gameDebug.getContainer(id), target.id);
ok("and it is still empty before the timer is up", early.length === 0,
  JSON.stringify(early));

// Past it: it must have.
await page.evaluate(() => window.__gameDebug.advanceClockMs(8 * 60 * 1000));
await page.waitForTimeout(600);
const refilled = await page.evaluate((id) => window.__gameDebug.getContainer(id), target.id);
ok("once the timer passes, the cache is stocked again", refilled.length > 0,
  JSON.stringify(refilled));

// --- 8. the timer survives a reload ------------------------------------
const second = pois.find((p) => p.id !== target.id);
const bookedAt = await page.evaluate((id) => {
  for (const s of window.__gameDebug.getContainer(id)) {
    window.__gameDebug.withdrawFromContainer(id, s.itemId, s.qty);
  }
  return null;
}, second.id);
void bookedAt;
await page.waitForTimeout(400);
const before = await page.evaluate((id) =>
  window.__gameDebug.getPois().find((p) => p.id === id).restockAtMs, second.id);
await page.evaluate(() => window.__gameDebug.saveNow());
await page.reload({ waitUntil: "load" });
await boot();
const after = await page.evaluate((id) =>
  window.__gameDebug.getPois().find((p) => p.id === id)?.restockAtMs ?? null, second.id);
ok("a pending restock survives a reload", after !== null && Math.abs(after - before) < 1000,
  `${before} -> ${after}`);

// --- 9. wandering enemies come to where the PLAYER is -------------------
// This is the check the old world fails outright: spawnOne used a ring around
// the world origin, so a player at (150, 150) was in the safest place in the
// game. Nothing about the ceiling or the timing tells you that from the diff.
//
// The ambient spawner fires off the *game* clock, which under software
// rendering runs perhaps five times slower than the wall clock, and it
// releases at most one wanderer per tick — so the clock is wound forward in
// small steps rather than one jump. A single big jump would hide the interval
// entirely: twelve seconds and ninety seconds both produce exactly one.
const STEP_MS = 2000;
const ROUNDS = 70;
const collect = async (x, z, clearWhenFull = true) => {
  await page.evaluate(({ x, z }) => {
    if (window.__gameDebug.getRaidState().active) window.__gameDebug.endRaid();
    window.__gameDebug.clearEnemies();
    window.__gameDebug.teleportPlayer(x, z);
  }, { x, z });
  const seen = new Map();
  let peak = 0;
  let offMap = 0;
  let counted = 0;
  let raidRounds = 0;
  for (let i = 0; i < ROUNDS; i++) {
    const round = await page.evaluate(async (step) => {
      window.__gameDebug.advanceClockMs(step);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      // Winding the clock forward by minutes at a time walks straight into a
      // raid — and a raid suspends the ambient trickle and fills the field to
      // its own, much higher ceiling. Every number here is about *wanderers*,
      // so a raid round is ended and thrown away rather than averaged in. The
      // first cut of this did not do that and reported the raid ceiling of 18
      // as the wanderer ceiling of 8.
      const raiding = window.__gameDebug.getRaidState().active;
      if (raiding) {
        window.__gameDebug.endRaid();
        window.__gameDebug.clearEnemies();
        return { raiding: true, enemies: [] };
      }
      return { raiding: false, enemies: window.__gameDebug.getEnemyPositions() };
    }, STEP_MS);
    if (round.raiding) {
      raidRounds++;
      continue;
    }
    counted++;
    peak = Math.max(peak, round.enemies.length);
    for (const e of round.enemies) {
      if (!seen.has(e.id)) {
        seen.set(e.id, e);
        if (Math.abs(e.x) > 200 || Math.abs(e.z) > 200) offMap++;
      }
    }
    if (clearWhenFull && round.enemies.length >= 6) {
      await page.evaluate(() => window.__gameDebug.clearEnemies());
    }
  }
  const all = [...seen.values()];
  return {
    total: all.length,
    brutes: all.filter((e) => e.enemyId === "brute").length,
    near: all.filter((e) => Math.hypot(e.x - x, e.z - z) < 100).length,
    gameSeconds: (counted * STEP_MS) / 1000,
    raidRounds,
    offMap,
    peak,
  };
};

const frontier = await collect(150, 150);
ok("wanderers turn up around the player, not around spawn",
  frontier.near >= 5 && frontier.near === frontier.total,
  `${frontier.near} of ${frontier.total} within 100 units of the player at (150,150)`);
ok("and none of them are dropped off the edge of the map", frontier.offMap === 0,
  `${frontier.offMap} of ${frontier.total} outside ±200`);

// --- 10. the frontier is both busier and heavier ------------------------
// Sampled over dozens of spawns rather than judged from one, because both of
// these are rates and a single draw says nothing about either.
const home = await collect(0, 0);
const homeRate = home.total / home.gameSeconds;
const farRate = frontier.total / frontier.gameSeconds;
ok("the frontier sends them more often than home does",
  home.total >= 8 && farRate > homeRate * 1.6,
  `home ${home.total} in ${home.gameSeconds}s (${home.raidRounds} raid rounds dropped), frontier ${frontier.total} in ${frontier.gameSeconds}s (${frontier.raidRounds} dropped)`);

const homeShare = home.total ? home.brutes / home.total : 0;
const farShare = frontier.total ? frontier.brutes / frontier.total : 0;
ok("and a heavier mix when it does",
  home.total >= 8 && frontier.total >= 8 && farShare > homeShare + 0.25,
  `home ${(homeShare * 100).toFixed(0)}% brutes of ${home.total}, frontier ${(farShare * 100).toFixed(0)}% of ${frontier.total}`);

// --- 11. the ceiling still holds out there ------------------------------
// No clearing this time: the point is what the field is allowed to reach.
const held = await collect(160, 160, false);
ok("the eight-wanderer ceiling holds on the frontier too",
  held.peak > 0 && held.peak <= 8,
  `peak ${held.peak} over ${held.gameSeconds}s (${held.raidRounds} raid rounds dropped)`);

// --- 12. a landmark you found stays findable ----------------------------
const frame = () =>
  new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
const pinned = await page.evaluate(async () => {
  const frames = () =>
    new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const lm = window.__gameDebug.getLandmarks().find((l) => l.far);
  window.__gameDebug.clearEnemies();
  window.__gameDebug.teleportPlayer(lm.x, lm.z);
  await frames();
  const discovered = window.__gameDebug.getDiscovered().includes(lm.id);
  // Walk away, well past the minimap's 70-unit range.
  window.__gameDebug.teleportPlayer(0, 0);
  await frames();
  const stillKnown = window.__gameDebug.getDiscovered().includes(lm.id);
  const distance = Math.hypot(lm.x, lm.z);
  return { id: lm.id, discovered, stillKnown, distance };
});
void frame;
ok("standing at a far landmark records it as found", pinned.discovered,
  JSON.stringify(pinned));
ok("and it stays known once you are far out of range",
  pinned.stillKnown && pinned.distance > 70, JSON.stringify(pinned));

const survives = await page.evaluate(async () => {
  window.__gameDebug.saveNow();
  return window.__gameDebug.getDiscovered();
});
await page.reload({ waitUntil: "load" });
await boot();
const afterReload = await page.evaluate(() => window.__gameDebug.getDiscovered());
ok("what you have found survives a reload",
  survives.length > 0 && survives.every((id) => afterReload.includes(id)),
  JSON.stringify(afterReload));

// --- 13. an old save loads, and gains the far ring ----------------------
// A save written before any of this has no `pois` record, no `discovered`
// list, and caches only at the three landmarks that existed then. It has to
// load without throwing *and* come back with the outer ring stocked — the old
// guard was "any poi- building exists, so leave the world alone", which would
// have left half the landmarks in a returning player's world bare forever.
//
// The legacy barrels are planted **at the near ring's actual landmarks**, under
// the ids the old counter produced. That matters: an old save's caches really
// were placed a few paces from their landmark, and matching is by position, so
// dropping the barrel at some arbitrary spot would only prove the load does not
// throw. It has to prove *reuse* — a returning player must not end up with
// their half-looted barrel plus a brand-new full one beside it.
const nearRingSites = await page.evaluate(() =>
  window.__gameDebug
    .getLandmarks()
    .filter((l) => !l.far)
    .map((l) => ({ x: Math.round(l.x + 5), z: Math.round(l.z) })));
// The mutate is serialised with toString() and run in a page that has no
// access to this scope, so the positions are baked into its source rather than
// closed over.
const legacyMutate = new Function(
  "save",
  `
  delete save.pois;
  delete save.discovered;
  save.placedBuildings = save.placedBuildings.filter((b) => !b.id.startsWith("poi-"));
  const sites = ${JSON.stringify(nearRingSites)};
  sites.forEach((site, i) => {
    save.placedBuildings.push({
      id: "poi-" + i,
      buildingId: "barrel",
      cellX: site.x,
      cellZ: site.z,
    });
    // Half-looted, so a silent refill shows up as a changed count.
    save.containers["poi-" + i] = [{ itemId: "plank", qty: 2 }];
  });
`,
);
await editSaveOffline(page, URL, legacyMutate);
await page.goto(URL, { waitUntil: "load" });
await boot();
const legacy = await page.evaluate(() => ({
  pois: window.__gameDebug.getPois(),
  discovered: window.__gameDebug.getDiscovered(),
  buildings: window.__gameDebug.getPlacedBuildings().filter((b) => b.id.startsWith("poi-")),
  contents: Object.fromEntries(
    window.__gameDebug
      .getPlacedBuildings()
      .filter((b) => b.id.startsWith("poi-"))
      .map((b) => [b.id, window.__gameDebug.getContainer(b.id)]),
  ),
}));
ok("a save with no pois/discovered record loads without throwing",
  Array.isArray(legacy.discovered) && legacy.discovered.length === 0,
  JSON.stringify(legacy.discovered));
ok("it gains a cache at every landmark, six in all",
  legacy.pois.length === 6 && legacy.buildings.length === 6,
  `${legacy.pois.length} sites, ${legacy.buildings.length} barrels`);
// The three old barrels are *reused*, not duplicated: their original ids are
// still the sites, and nothing was topped up on top of what the player left.
const reused = ["poi-0", "poi-1", "poi-2"].filter((id) =>
  legacy.pois.some((p) => p.id === id));
ok("the old barrels are reused rather than doubled up",
  reused.length === 3,
  `${JSON.stringify(reused)} of ${JSON.stringify(legacy.pois.map((p) => p.id))}`);
ok("and what the player left in them is untouched",
  reused.every((id) => {
    const c = legacy.contents[id] ?? [];
    return c.length === 1 && c[0].itemId === "plank" && c[0].qty === 2;
  }),
  JSON.stringify(Object.fromEntries(reused.map((id) => [id, legacy.contents[id]]))));

ok("no console/page errors", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length}`);
process.exit(failed.length ? 1 : 0);
