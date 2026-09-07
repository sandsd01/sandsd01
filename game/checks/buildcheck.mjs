import { chromium, LAUNCH, BASE_URL, settlePlayer } from "./harness.mjs";
import { selectBuilding } from "./buildselect.mjs";

// Can a base be edited, and does it actually stop anything?
//
// Before this: nothing could be taken down at all (occupancy and meshes were
// only ever written to), every piece faced the same way, every piece was one
// cell however its footprint was declared, walls were circles with gaps at the
// corners, and a foundation — a floor — blocked the player like a wall.
const URL = BASE_URL;

const browser = await chromium.launch({
  ...LAUNCH,
  args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

// Budgets here are generous on purpose. Every wait below polls and returns as
// soon as its condition holds, so a large budget costs nothing when the case
// passes — it is spent only when something is genuinely wrong. Tight budgets
// are how this suite came to report failures on a slow day that it had passed
// an hour earlier with no code change in between: with no GPU, the frame rate
// here moves by a factor of two between runs, and a budget short enough to
// fail on the slow end will fail on the fast end sooner or later too.
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
  await page.waitForTimeout(1400);
}

const qty = (itemId) =>
  page.evaluate(
    (id) => window.__gameDebug.getInventory().reduce(
      (sum, s) => (s.itemId === id ? sum + s.qty : sum), 0),
    itemId,
  );

const mine = () =>
  page.evaluate(() =>
    window.__gameDebug.getPlacedBuildings().filter((b) => !b.id.startsWith("poi-")));

async function place(name, id) {
  const before = (await mine()).length;
  if (!(await selectBuilding(page, waitFor, name, id))) return null;
  await page.mouse.down({ button: "right" });
  await page.mouse.up({ button: "right" });
  const landed = await waitFor((n) =>
    window.__gameDebug.getPlacedBuildings().filter((b) => !b.id.startsWith("poi-")).length > n,
    before, 20000);
  await page.keyboard.press("KeyQ");
  await waitFor(() => window.__gameDebug.getSelectedBuilding() === null);
  if (!landed) return null;
  const all = await mine();
  return all[all.length - 1];
}

async function stand() {
  await page.evaluate(() => {
    window.__gameDebug.grantItems({ plank: 90, wood: 90, stone: 90, clay: 40, iron_ore: 20 });
    window.__gameDebug.teleportPlayer(0, 0);
    window.__gameDebug.setCameraYaw(0);
  });
  await page.waitForTimeout(500);
}

await boot({ clear: true });
await page.click("#game-canvas");
await waitFor(() => window.__gameDebug.isPointerLocked());
await stand();

// --- 1. put something down, take it back up -----------------------------
const plankBefore = await qty("plank");
const wall = await place("Wall", "wall");
ok("a wall can be placed", wall !== null, JSON.stringify(wall));
const plankAfterPlace = await qty("plank");
ok("placing it costs materials", plankAfterPlace < plankBefore,
  `${plankBefore} -> ${plankAfterPlace}`);

const cellsWhilePlaced = await page.evaluate(() => window.__gameDebug.getOccupiedCells());
const wallKey = `${wall.cellX},${wall.cellZ}`;
ok("its cell is reserved", cellsWhilePlaced[wallKey] === wall.id,
  `${wallKey} -> ${cellsWhilePlaced[wallKey]}`);

await page.evaluate((id) => window.__gameDebug.demolishBuilding(id), wall.id);
await page.waitForTimeout(400);
const plankAfterDemolish = await qty("plank");
ok("taking it down refunds the full cost", plankAfterDemolish === plankBefore,
  `${plankBefore} -> ${plankAfterPlace} -> ${plankAfterDemolish}`);
ok("and it is gone from the world",
  !(await mine()).some((b) => b.id === wall.id));

const cellsAfter = await page.evaluate(() => window.__gameDebug.getOccupiedCells());
ok("its cell is free again", cellsAfter[wallKey] === undefined,
  JSON.stringify(cellsAfter[wallKey] ?? null));

const rebuilt = await place("Wall", "wall");
ok("so something else can be built there", rebuilt !== null, JSON.stringify(rebuilt));
if (rebuilt) await page.evaluate((id) => window.__gameDebug.demolishBuilding(id), rebuilt.id);

// --- 2. a barrel's contents are not destroyed with it -------------------
await stand();
const barrel = await place("Barrel", "barrel");
ok("a barrel can be placed", barrel !== null);
await page.evaluate((id) => {
  window.__gameDebug.grantItems({ iron_ore: 7 });
  window.__gameDebug.depositToContainer(id, "iron_ore", 7);
}, barrel.id);
const stocked = await page.evaluate((id) => window.__gameDebug.getContainer(id), barrel.id);
ok("and stocked", stocked.some((s) => s.itemId === "iron_ore" && s.qty === 7),
  JSON.stringify(stocked));

// Stand well clear so the drop is not instantly re-collected.
await page.evaluate(() => window.__gameDebug.teleportPlayer(14, 14));
await page.waitForTimeout(400);
await page.evaluate((id) => window.__gameDebug.demolishBuilding(id), barrel.id);
await page.waitForTimeout(500);
const spilled = await page.evaluate(() => window.__gameDebug.getDroppedItems());
ok("demolishing a full barrel tips its contents onto the ground",
  spilled.some((d) => d.itemId === "iron_ore" && d.qty === 7), JSON.stringify(spilled));
const orphaned = await page.evaluate((id) => window.__gameDebug.getContainer(id), barrel.id);
ok("and leaves no container record behind", orphaned.length === 0, JSON.stringify(orphaned));

// --- 3. a plot's record goes with it -------------------------------------
await stand();
const plot = await place("Farm Plot", "farm_plot");
ok("a farm plot can be placed", plot !== null);
const plotsWith = await page.evaluate(() => window.__gameDebug.getPlots().length);
await page.evaluate((id) => window.__gameDebug.demolishBuilding(id), plot.id);
await page.waitForTimeout(400);
const plotsAfter = await page.evaluate(() => window.__gameDebug.getPlots());
ok("removing it drops its plot record too",
  plotsAfter.length === plotsWith - 1 && !plotsAfter.some((p) => p.buildingId === plot.id),
  `${plotsWith} -> ${plotsAfter.length}`);

// --- 4. rotation --------------------------------------------------------
await stand();
await selectBuilding(page, waitFor, "Wall", "wall");
const rot0 = await page.evaluate(() => window.__gameDebug.getBuildRotation());
await page.keyboard.press("KeyR");
await page.waitForTimeout(250);
const rot1 = await page.evaluate(() => window.__gameDebug.getBuildRotation());
ok("R turns the piece being placed", rot0 === 0 && rot1 === 90, `${rot0} -> ${rot1}`);
await page.mouse.down({ button: "right" });
await page.mouse.up({ button: "right" });
await waitFor(() => window.__gameDebug.getPlacedBuildings().some((b) => b.rotation === 90));
await page.keyboard.press("KeyQ");
const turned = (await mine()).find((b) => b.rotation === 90);
ok("the piece remembers how it was turned", turned !== undefined, JSON.stringify(turned));

await page.evaluate(() => window.__gameDebug.saveNow());
await boot();
const afterReload = (await mine()).find((b) => b.id === turned.id);
ok("and still remembers after a reload", afterReload?.rotation === 90,
  JSON.stringify(afterReload));

// --- 5. a piece that covers more than one cell ---------------------------
await page.click("#game-canvas");
await waitFor(() => window.__gameDebug.isPointerLocked());
await stand();
// Clear what earlier sections left standing: a two-cell piece needs two free
// cells, and the rotation test's wall is sitting in one of them.
await page.evaluate(() => {
  for (const b of window.__gameDebug.getPlacedBuildings()) {
    if (!b.id.startsWith("poi-")) window.__gameDebug.demolishBuilding(b.id);
  }
});
await page.waitForTimeout(400);
const long = await place("Long Wall", "long_wall");
ok("a two-cell piece can be placed", long !== null, JSON.stringify(long));
const cells = await page.evaluate(() => window.__gameDebug.getOccupiedCells());
const heldCells = long
  ? Object.entries(cells).filter(([, id]) => id === long.id).map(([k]) => k)
  : [];
ok("it reserves both of its cells", heldCells.length === 2, JSON.stringify(heldCells));

// The second cell must be genuinely defended, not just recorded.
const blocked = heldCells.length === 2
  ? await page.evaluate((info) => {
      const [x, z] = info.second.split(",").map(Number);
      // Anything placed onto the second cell must be refused outright.
      return window.__gameDebug.placeBuildingAt("wall", x, z, 0) === null;
    }, { second: heldCells[1], id: long.id })
  : false;
ok("and nothing else may be built on the second one", blocked);

// --- 6. walls actually stop the player ----------------------------------
await stand();
// A run of walls, then try to squeeze through the join between two of them.
const runIds = await page.evaluate(() => {
  const ids = [];
  for (let i = -1; i <= 1; i++) {
    const id = window.__gameDebug.placeBuildingAt("wall", i, 3, 0);
    if (id) ids.push(id);
  }
  return ids;
});
ok("a run of walls goes up", runIds.length === 3, JSON.stringify(runIds));

const throughCorner = await page.evaluate(() => {
  // Start south of the join between the walls at x=0 and x=1, and push north
  // straight at the corner they share.
  window.__gameDebug.teleportPlayer(0.5, 1.6);
  return window.__gameDebug.probeMoveTo(0.5, 4.4);
});
ok("the player cannot slip through the corner between two walls",
  throughCorner.z < 3, JSON.stringify(throughCorner));

// Arriving fast is the case that used to squeeze through. A deeper overlap
// makes the shallower-axis push pick sideways over backwards, so the body
// slides along the wall and into the seam between two cells instead of
// stopping. Faces with a neighbour behind them are excluded from that choice,
// which keeps the approach straight.
//
// Not asserted: an absurd step (most of a cell in one go) still tunnels
// through. That needs swept collision, which this game does not have and does
// not need at its real frame pacing.
const fastApproach = await page.evaluate(() => {
  window.__gameDebug.teleportPlayer(0.5, 1.6);
  return window.__gameDebug.probeMoveTo(0.5, 4.4, 4);
});
ok("arriving fast at the seam stops rather than sliding into it",
  fastApproach.z < 3 && Math.abs(fastApproach.x - 0.5) < 0.15,
  JSON.stringify(fastApproach));

// --- 7. a floor is a floor ----------------------------------------------
await stand();
const foundationId = await page.evaluate(() =>
  window.__gameDebug.placeBuildingAt("foundation", 0, 6, 0));
ok("a foundation can be placed", foundationId !== null, String(foundationId));
const overFloor = await page.evaluate(() => {
  window.__gameDebug.teleportPlayer(0, 4);
  return window.__gameDebug.probeMoveTo(0, 8);
});
ok("and can be walked across rather than blocking the way",
  Math.abs(overFloor.z - 8) < 0.6, JSON.stringify(overFloor));

// --- 8. a wall is opaque to aiming --------------------------------------
// Walls were not raycast targets at all, so the crosshair reached straight
// through one to whatever stood behind it.
const wallTargeted = await page.evaluate(() => {
  const before = window.__gameDebug.getPlacedBuildings().length;
  const id = window.__gameDebug.placeBuildingAt("brick_wall", 0, -3, 0);
  return { id, placed: window.__gameDebug.getPlacedBuildings().length > before };
});
ok("a brick wall goes up in front of the player", wallTargeted.placed, JSON.stringify(wallTargeted));
await page.evaluate(() => {
  window.__gameDebug.teleportPlayer(0, -1);
  window.__gameDebug.setCameraYaw(Math.PI);
});
// A teleport drops the player where it is told, not where they can stand, so
// they slide for a moment afterwards. Polling the target while that happens
// asks what is under a crosshair that is still on its way somewhere.
await settlePlayer(page);
const sawWall = await waitFor(() => {
  const t = window.__gameDebug.getTarget();
  return t.kind === "building" || t.kind === "container";
}, null, 45000);
ok("aiming at it reports a building, not whatever is behind it", sawWall,
  JSON.stringify(await page.evaluate(() => window.__gameDebug.getTarget())));

// --- 9. the Build panel reads as a catalogue ----------------------------
await page.keyboard.press("KeyB");
await waitFor(() => [...document.querySelectorAll(".panel.visible h2")]
  .some((h) => h.textContent === "Build"));
const panel = await page.evaluate(() => {
  const p = [...document.querySelectorAll(".panel.visible")].find(
    (x) => x.querySelector("h2")?.textContent === "Build");
  const rows = [...p.querySelectorAll(".panel-row")];
  return {
    chips: [...p.querySelectorAll(".panel-chip")].map((c) => c.textContent),
    rows: rows.length,
    icons: rows.filter((r) => r.querySelector(".panel-row-icon")).length,
    disabled: rows.filter((r) => r.querySelector("button")?.disabled).length,
  };
});
ok("it has category chips", panel.chips.length >= 4, JSON.stringify(panel.chips));
ok("every row carries an icon", panel.rows > 0 && panel.icons === panel.rows,
  `${panel.icons}/${panel.rows}`);
ok("nothing is locked behind a dead button", panel.disabled === 0, String(panel.disabled));

// Filtering narrows the list rather than emptying it.
const filtered = await page.evaluate(() => {
  const p = [...document.querySelectorAll(".panel.visible")].find(
    (x) => x.querySelector("h2")?.textContent === "Build");
  const chip = [...p.querySelectorAll(".panel-chip")].find((c) => c.textContent === "Stations");
  chip.click();
  return [...p.querySelectorAll(".panel-row .panel-row-title")].map((t) => t.textContent);
});
ok("a category chip filters the list", filtered.length > 0 && filtered.length < panel.rows,
  JSON.stringify(filtered));

ok("no console/page errors", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length}`);
process.exit(failed.length ? 1 : 0);
