import { chromium, LAUNCH, BASE_URL } from "./harness.mjs";

// Does the world pay you back?
//
// Two things were flatly untrue before. Killing an enemy gave nothing at all —
// `enemy-killed` had one listener and it played a sound — so combat was a pure
// cost. And every resource node yielded exactly 1 per swing, every swing, so a
// better tool only ever meant "sooner", never "more".
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

const qty = (itemId) =>
  page.evaluate(
    (id) => (window.__gameDebug.getInventory().find((s) => s.itemId === id) ?? { qty: 0 }).qty,
    itemId,
  );

await boot({ clear: true });
await page.click("#game-canvas");
await waitFor(() => window.__gameDebug.isPointerLocked());

// --- 1. a kill leaves something on the ground ---------------------------
const spawned = await waitFor(() => window.__gameDebug.getEnemyPositions().length > 0, null, 45000);
ok("an enemy shows up to fight", spawned);

const killed = await page.evaluate(() => window.__gameDebug.killNearestEnemy());
ok("it can be killed", killed !== null, JSON.stringify(killed));
await page.waitForTimeout(600);

const onFloor = await page.evaluate(() => window.__gameDebug.getDroppedItems());
ok("killing it leaves loot on the ground", onFloor.length > 0, JSON.stringify(onFloor));

// At the corpse, not at the player — the point is that the reward is where the
// fight was.
const atCorpse =
  killed !== null &&
  onFloor.every((d) => Math.hypot(d.x - killed.x, d.z - killed.z) < 2.5);
ok("the loot lies where the enemy died", onFloor.length > 0 && atCorpse,
  `corpse=(${killed?.x.toFixed(1)},${killed?.z.toFixed(1)}) drops=${JSON.stringify(
    onFloor.map((d) => [Number(d.x.toFixed(1)), Number(d.z.toFixed(1))]))}`);

// --- 2. walking over it picks it up --------------------------------------
const wanted = onFloor[0];
const before = wanted ? await qty(wanted.itemId) : 0;
const stillThere = await page.evaluate(() => window.__gameDebug.getDroppedItems().length);
ok("it does not leap into the bag by itself", stillThere > 0, String(stillThere));

if (wanted) await page.evaluate((d) => window.__gameDebug.teleportPlayer(d.x, d.z), wanted);
const collected = await waitFor(
  ([id, n]) =>
    (window.__gameDebug.getInventory().find((s) => s.itemId === id) ?? { qty: 0 }).qty > n,
  [wanted?.itemId, before],
  15000,
);
ok("walking onto it picks it up", collected,
  `${wanted?.itemId} ${before} -> ${wanted ? await qty(wanted.itemId) : "?"}`);
const cleared = await waitFor(() => window.__gameDebug.getDroppedItems().length === 0, null, 10000);
ok("and it is gone from the ground", cleared);

// --- 3. the harder enemy is the richer one -------------------------------
// Averaged over many rolls: one kill of each proves nothing about a table
// whose entries are probabilities.
const haul = await page.evaluate(() => {
  const total = (enemyId) => {
    let sum = 0;
    for (let i = 0; i < 400; i++) {
      for (const drop of window.__gameDebug.rollLootFor(enemyId)) sum += drop.qty;
    }
    return sum / 400;
  };
  return { zombie: total("zombie"), brute: total("brute") };
});
ok("a brute pays better than a zombie", haul.brute > haul.zombie * 1.3,
  `zombie=${haul.zombie.toFixed(2)} brute=${haul.brute.toFixed(2)} per kill`);

// --- 4. loot does not lie there forever ---------------------------------
await page.evaluate(() => {
  const p = window.__gameDebug.getPlayerPosition();
  // Well clear of the pickup radius, so despawn is what removes it.
  window.__gameDebug.spawnDropAt("bone", 1, p.x + 25, p.z + 25);
});
const spawnedDrop = await waitFor(() => window.__gameDebug.getDroppedItems().length > 0, null, 8000);
ok("a drop can be placed out of reach", spawnedDrop);
await page.evaluate(() => window.__gameDebug.advanceClockMs(70_000));
const despawned = await waitFor(() => window.__gameDebug.getDroppedItems().length === 0, null, 15000);
ok("loot left alone eventually disappears", despawned);

// --- 5. yields vary, and the felling blow pays -------------------------
const tree = await page.evaluate(
  () => window.__gameDebug.getResourceNodes().filter((n) => n.kind === "tree" && !n.depleted)[0]);
await page.evaluate(() => window.__gameDebug.holdItem("axe"));

const swings = await page.evaluate((id) => {
  const out = [];
  for (let i = 0; i < 8; i++) {
    const hit = window.__gameDebug.hitNodeOnce(id);
    if (!hit) break;
    out.push({ qty: hit.qty, finalHit: hit.finalHit });
  }
  return out;
}, tree.id);
const normal = swings.filter((s) => !s.finalHit).map((s) => s.qty);
const felling = swings.find((s) => s.finalHit);
ok("a tree takes several swings", swings.length >= 2, JSON.stringify(swings));
ok("swings do not all yield the same amount", new Set(normal).size > 1 || normal.some((q) => q > 1),
  JSON.stringify(normal));
ok("the felling blow pays more than a normal swing",
  felling !== undefined && felling.qty > Math.max(...normal),
  `normal=${JSON.stringify(normal)} felling=${felling?.qty}`);

// --- 6. the iron tier yields more, not just faster ----------------------
const compare = await page.evaluate(() => {
  const trees = window.__gameDebug
    .getResourceNodes()
    .filter((n) => n.kind === "tree" && !n.depleted)
    .slice(0, 40);
  const runWith = (toolId, nodes) => {
    window.__gameDebug.grantItems({ [toolId]: 1 });
    window.__gameDebug.holdItem(toolId);
    let sum = 0;
    for (const node of nodes) {
      let hit;
      while ((hit = window.__gameDebug.hitNodeOnce(node.id))) sum += hit.qty;
    }
    return sum;
  };
  const half = Math.floor(trees.length / 2);
  const plainNodes = trees.slice(0, half);
  const ironNodes = trees.slice(half, half * 2);
  const plain = runWith("axe", plainNodes);
  // Measured before the iron run, so it says whether those trees were fresh
  // to begin with rather than merely confirming they are gone afterwards.
  const ironFreshBefore = ironNodes.filter(
    (n) => !window.__gameDebug.getNodeState(n.id)?.depleted).length;
  const iron = runWith("iron_axe", ironNodes);
  return {
    plain,
    iron,
    nodes: half,
    ironHeld: window.__gameDebug.getEquippedItem(),
    ironFreshBefore,
  };
});
ok("enough trees to compare on", compare.nodes >= 8, String(compare.nodes));
ok("an iron axe brings back more wood per tree, not just sooner",
  compare.iron > compare.plain,
  `plain=${compare.plain} iron=${compare.iron} over ${compare.nodes} trees each ` +
    `(held=${compare.ironHeld}, iron trees fresh beforehand=${compare.ironFreshBefore})`);

// --- 7. what drops feeds the crafting tree ------------------------------
const newRecipes = await page.evaluate(() =>
  window.__gameDebug.getAllRecipes().filter((r) => ["bone_club", "broth"].includes(r.id)));
ok("the drops have recipes of their own", newRecipes.length === 2,
  JSON.stringify(newRecipes));

const crafted = await page.evaluate(() => {
  window.__gameDebug.grantItems({ bone: 6, hide: 4, wood: 4, berry: 6 });
  return window.__gameDebug.craftRecipe("bone_club", 1);
});
ok("a weapon can be made from what the dead leave", crafted === 1, String(crafted));
const clubDamage = await page.evaluate(() => {
  window.__gameDebug.holdItem("bone_club");
  return window.__gameDebug.getHeldDamage();
});
// Holding something that is not a weapon, rather than hunting for an empty
// slot — the bar is usually full by this point in the run, and an indexOf that
// returns -1 silently leaves the club in hand and compares it with itself.
const barehand = await page.evaluate(() => {
  window.__gameDebug.holdItem("wood");
  return window.__gameDebug.getHeldDamage();
});
ok("and it hits harder than swinging a log", clubDamage > barehand,
  `club=${clubDamage} unarmed=${barehand}`);

ok("no console/page errors", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length}`);
process.exit(failed.length ? 1 : 0);
