import { chromium, LAUNCH, BASE_URL } from "./harness.mjs";
import { selectBuilding } from "./buildselect.mjs";
import { editSaveOffline } from "./legacysave.mjs";

// Does a save survive a reload without corrupting itself?
//
// Three separate bugs, all in the same family — state that lives outside the
// save, or a code path that only a live session can reach:
//   1. `nextBuildingInstanceId` is module scope and restarts at 0, so the first
//      piece placed after a reload reuses an existing id — and containers are
//      keyed by that id, so a new barrel inherits an old barrel's contents.
//   2. scheduleRespawnIfDead() is only reachable from the enemy damage callback,
//      which is itself skipped while the player is dead: a save written at 0 HP
//      loads with nothing able to revive it.
//   3. Node depletion isn't persisted at all, so reloading restocks the world —
//      faster than waiting out the 20-35s respawn.
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
  await page.waitForTimeout(1200);
}

// Place a piece the way a player does: pick it in the B panel, aim, right-click.
async function place(name, id) {
  if (!(await selectBuilding(page, waitFor, name, id))) return null;
  const before = await page.evaluate(
    (b) => window.__gameDebug.getPlacedBuildings().filter((p) => p.buildingId === b).length, id);
  await page.mouse.down({ button: "right" });
  await page.mouse.up({ button: "right" });
  const landed = await waitFor(
    ([b, n]) => window.__gameDebug.getPlacedBuildings().filter((p) => p.buildingId === b).length > n,
    [id, before], 20000);
  if (!landed) return null;
  await page.keyboard.press("KeyQ");
  await waitFor(() => window.__gameDebug.getSelectedBuilding() === null);
  const all = await page.evaluate(
    (b) => window.__gameDebug.getPlacedBuildings().filter((p) => p.buildingId === b), id);
  return all[all.length - 1];
}

await boot({ clear: true });
await page.click("#game-canvas");
await waitFor(() => window.__gameDebug.isPointerLocked());
await page.evaluate(() => {
  window.__gameDebug.grantItems({ wood: 80, stone: 80, plank: 40, clay: 40 });
  window.__gameDebug.teleportPlayer(0, 0);
});
await page.waitForTimeout(600);

// --- 1. a barrel placed after a reload must not inherit an old one's contents
await page.evaluate(() => window.__gameDebug.setCameraYaw(0));
await page.waitForTimeout(500);
const barrelA = await place("Barrel", "barrel");
ok("a barrel can be placed", barrelA !== null, JSON.stringify(barrelA));

await page.evaluate((id) => {
  window.__gameDebug.grantItems({ iron_ore: 9 });
  window.__gameDebug.depositToContainer(id, "iron_ore", 9);
  window.__gameDebug.saveNow();
}, barrelA.id);
const storedA = await page.evaluate((id) => window.__gameDebug.getContainer(id), barrelA.id);
ok("and stocked with 9 iron ore",
  storedA.some((s) => s.itemId === "iron_ore" && s.qty === 9), JSON.stringify(storedA));

await boot();
await page.click("#game-canvas");
await waitFor(() => window.__gameDebug.isPointerLocked());
await page.evaluate(() => {
  window.__gameDebug.grantItems({ wood: 80, stone: 80, plank: 40, clay: 40 });
  window.__gameDebug.teleportPlayer(0, 0);
  window.__gameDebug.setCameraYaw(Math.PI / 2);
});
await page.waitForTimeout(700);

const survived = await page.evaluate((id) => window.__gameDebug.getContainer(id), barrelA.id);
ok("the first barrel's contents survive the reload",
  survived.some((s) => s.itemId === "iron_ore" && s.qty === 9), JSON.stringify(survived));

const idsBefore = await page.evaluate(() =>
  window.__gameDebug.getPlacedBuildings().map((b) => b.id));
const barrelB = await place("Barrel", "barrel");
ok("a second barrel can be placed after the reload", barrelB !== null, JSON.stringify(barrelB));

// THE bug: the new barrel gets `building-0` again, which is barrelA's id, so
// state.containers hands it barrelA's iron ore.
ok("the new barrel gets a fresh id, not one already in use",
  barrelB !== null && !idsBefore.includes(barrelB.id),
  `new=${barrelB?.id} existing=${JSON.stringify(idsBefore)}`);

const contentsB = barrelB
  ? await page.evaluate((id) => window.__gameDebug.getContainer(id), barrelB.id)
  : [];
ok("and the new barrel is empty", contentsB.length === 0, JSON.stringify(contentsB));

const allIds = await page.evaluate(() =>
  window.__gameDebug.getPlacedBuildings().map((b) => b.id));
ok("no two placed buildings share an id",
  new Set(allIds).size === allIds.length, JSON.stringify(allIds));

// A farm plot placed after a reload must be its own plot, not an alias of the
// first one — plotWorldPos resolves by .find(), so a duplicate id makes the new
// plot render and harvest at the old plot's cell.
await page.evaluate(() => window.__gameDebug.setCameraYaw(Math.PI));
await page.waitForTimeout(500);
const plotB = await place("Farm Plot", "farm_plot");
const plotIds = await page.evaluate(() =>
  window.__gameDebug.getPlacedBuildings().filter((b) => b.buildingId === "farm_plot").map((b) => b.id));
ok("a farm plot placed after the reload has its own id",
  plotB !== null && new Set(plotIds).size === plotIds.length, JSON.stringify(plotIds));

// --- 2. a save written at 0 HP must not be a dead end ------------------
await page.evaluate(() => {
  window.__gameDebug.damagePlayer(9999);
  window.__gameDebug.saveNow();
});
const diedAndSaved = await page.evaluate(() => window.__gameDebug.getHealth().current);
ok("the player can be killed and that state saved", diedAndSaved <= 0, String(diedAndSaved));

await boot();
const loadedDead = await page.evaluate(() => window.__gameDebug.getHealth().current);
const revived = await waitFor(() => window.__gameDebug.getHealth().current > 0, null, 15000);
const afterRevive = await page.evaluate(() => window.__gameDebug.getHealth());
ok("a save loaded at 0 HP revives itself instead of locking the game", revived,
  `loaded=${loadedDead} after=${JSON.stringify(afterRevive)}`);

// --- 3. depleting a node must survive a reload -------------------------
await page.evaluate(() => localStorage.clear());
await boot();
await page.click("#game-canvas");
await waitFor(() => window.__gameDebug.isPointerLocked());

const target = await page.evaluate(() =>
  window.__gameDebug.getResourceNodes().filter((n) => n.kind === "tree" && !n.depleted)[0]);
const depleted = await page.evaluate((id) => window.__gameDebug.depleteNode(id), target.id);
ok("a tree can be chopped out", depleted !== null && depleted.depleted === true,
  JSON.stringify(depleted));
await page.evaluate(() => window.__gameDebug.saveNow());

await boot();
const afterReload = await page.evaluate((id) => window.__gameDebug.getNodeState(id), target.id);
ok("a chopped tree is still gone after a reload",
  afterReload !== null && afterReload.depleted === true,
  `${target.id} -> ${JSON.stringify(afterReload)}`);

// And the respawn timer must carry on from where it was, not restart — the
// clock it runs on (state.elapsedMs) is already saved.
// Read the state immediately before advancing, so this asserts a real
// depleted -> respawned transition. Without that guard it passes trivially
// whenever the reload has already restocked the node — which is the very bug
// above, and would make this check argue for the broken behaviour.
const beforeAdvance = await page.evaluate((id) => window.__gameDebug.getNodeState(id), target.id);
await page.evaluate((id) => {
  window.__gameDebug.advanceClockMs(40000); // tree respawn is 20s
  return id;
}, target.id);
const cameBack = await waitFor(
  (id) => window.__gameDebug.getNodeState(id)?.depleted === false, target.id, 15000);
ok("and it comes back once its respawn time has actually elapsed",
  beforeAdvance?.depleted === true && cameBack,
  `before=${JSON.stringify(beforeAdvance)} after=${JSON.stringify(
    await page.evaluate((id) => window.__gameDebug.getNodeState(id), target.id))}`);

// The record has to stay sparse: one worked node out of hundreds must write
// one entry, not a default row per node. This is the claim the comment in
// game-state.ts makes, so it gets an assertion rather than trust.
const sparsity = await page.evaluate(() => {
  const raw = JSON.parse(localStorage.getItem("romestead-save-v1"));
  return {
    recorded: Object.keys(raw.nodes ?? {}).length,
    total: window.__gameDebug.getResourceNodes().length,
    saveKb: Math.round(localStorage.getItem("romestead-save-v1").length / 1024),
  };
});
ok("only worked nodes are written to the save",
  sparsity.recorded > 0 && sparsity.recorded <= 3 && sparsity.total > 100,
  JSON.stringify(sparsity));

// --- 4. a save written before any of this existed still loads ----------
await page.evaluate(() => window.__gameDebug.saveNow());
await editSaveOffline(page, URL, (save) => {
  delete save.nodes;
});
await boot();
// Deliberately not asserting on health here: enemies roam during the run, so
// the player's HP is not this check's business. What matters is that the world
// rebuilt and the save's own fields survived the missing key.
const legacy = await page.evaluate(() => ({
  nodes: window.__gameDebug.getResourceNodes().length,
  hotbar: window.__gameDebug.getHotbar().length,
  inventory: window.__gameDebug.getInventory().length,
}));
ok("a save with no node record loads without crashing",
  legacy.nodes > 0 && legacy.hotbar === 8 && legacy.inventory > 0, JSON.stringify(legacy));

ok("no console/page errors", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length}`);
process.exit(failed.length ? 1 : 0);
