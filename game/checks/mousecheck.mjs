import { chromium, LAUNCH, BASE_URL, lookBy } from "./harness.mjs";
import { selectBuilding } from "./buildselect.mjs";

// Mouse-driven interaction: crosshair targeting, hold-to-gather, right-click
// placement, wheel routing and the first-person toggle.
//
// Software rendering runs this scene at a few FPS, so every assertion polls
// rather than sleeping — a fixed sleep is routinely shorter than one frame.
const URL = BASE_URL;
const browser = await chromium.launch({
  ...LAUNCH,
  args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 800, height: 500 } });

const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(String(e)));

const results = [];
function ok(name, pass, detail = "") {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}

async function waitFor(fn, arg, timeoutMs = 40000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await page.evaluate(fn, arg)) return true;
    await page.waitForTimeout(200);
  }
  return false;
}

/**
 * Turns the camera and reports where the crosshair now points.
 *
 * The aim point is recomputed on the animation frame, so setting the yaw and
 * then reading after a fixed wait can return the aim from *before* the turn —
 * and the right-click that follows places at the real, current aim instead.
 * That is what the two placement cases used to fail on, and the numbers said
 * so plainly: the check reported `aim=(0,-3)` while the piece landed at
 * `cell=(-3,-2)`, which is not a placement bug but two reads of two different
 * frames. Under software rendering a frame can outlast the 600ms wait on its
 * own, so this waits for the value to stop moving instead of guessing.
 */
async function turnAndSettleAim(yaw) {
  await page.evaluate((y) => window.__gameDebug.setCameraYaw(y), yaw);
  let last = null;
  for (let i = 0; i < 60; i++) {
    const now = await page.evaluate(() => window.__gameDebug.getAimPoint());
    if (last && Math.abs(now.x - last.x) < 1e-3 && Math.abs(now.z - last.z) < 1e-3) return now;
    last = now;
    await page.waitForTimeout(150);
  }
  return last;
}

// Turn the camera until the crosshair is on the given kind of thing, by
// stepping the yaw with relative mouse movement the way a player would.
async function aimUntil(kind, steps = 40) {
  for (let i = 0; i < steps; i++) {
    if (await page.evaluate((k) => window.__gameDebug.getTarget().kind === k, kind)) return true;
    await lookBy(page, 18, 0, 3);
    await page.waitForTimeout(120);
  }
  return await page.evaluate((k) => window.__gameDebug.getTarget().kind === k, kind);
}

await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForFunction(() => !!window.__gameDebug, null, { timeout: 30000 });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: "networkidle" });
await page.waitForFunction(() => !!window.__gameDebug, null, { timeout: 30000 });
await page.waitForTimeout(1500);

const canvas = await page.locator("#game-canvas").boundingBox();
const cx = canvas.x + canvas.width / 2;
const cy = canvas.y + canvas.height / 2;
await page.mouse.click(cx, cy);
await waitFor(() => window.__gameDebug.isPointerLocked());

// --- 1. facing a tree: hold to gather ---------------------------------
// Stand a little back from a tree and turn until it's actually under the
// crosshair, rather than assuming proximity is enough.
const tree = await page.evaluate(() =>
  window.__gameDebug.getResourceNodes().filter((n) => n.kind === "tree" && !n.depleted)[0],
);
await page.evaluate((t) => window.__gameDebug.teleportPlayer(t.x, t.z + 2.2), tree);
await page.waitForTimeout(800);

const aimedTree = await aimUntil("node");
ok("crosshair acquires a tree", aimedTree,
  JSON.stringify(await page.evaluate(() => window.__gameDebug.getTarget())));

const crosshairOnNode = await page.evaluate(() => ({
  state: window.__gameDebug.getCrosshairState(),
  cls: document.querySelector(".hud-crosshair").className,
}));
ok("crosshair shows the node state", crosshairOnNode.state === "node" &&
  /on-node/.test(crosshairOnNode.cls), JSON.stringify(crosshairOnNode));

const outline = await page.evaluate(() => window.__gameDebug.getOutline());
ok("target outline is drawn around it", outline.visible && outline.size[1] > 0.5,
  JSON.stringify(outline));

const wood0 = await page.evaluate(
  () => (window.__gameDebug.getInventory().find((s) => s.itemId === "wood") || { qty: 0 }).qty);
await page.mouse.down();
// Condition-based already, but the budgets were the fixed part: 8s and 15s
// are only a handful of frames when the renderer is managing two a second,
// and a chop that needs several swings ran out of them. Generous now — a
// timeout here costs wall-clock only when the case is genuinely failing.
const ringGrew = await waitFor(() => window.__gameDebug.getActionProgress() > 0, null, 30000);
const gotWood = await waitFor(
  (w0) => (window.__gameDebug.getInventory().find((s) => s.itemId === "wood") || { qty: 0 }).qty > w0,
  wood0, 60000);
await page.mouse.up();
ok("holding left click gathers", gotWood);
ok("a progress ring fills while gathering", ringGrew);

const ringCleared = await waitFor(() => window.__gameDebug.getActionProgress() === 0);
ok("releasing clears the progress", ringCleared);

// --- 2. THE point of all this: facing away must not gather -------------
// Stand right beside a fresh tree — the old radius search would have chopped
// it — but look the other way.
const tree2 = await page.evaluate((id) =>
  window.__gameDebug.getResourceNodes().find((n) => n.kind === "tree" && !n.depleted && n.id !== id),
  tree.id);
await page.evaluate((t) => window.__gameDebug.teleportPlayer(t.x, t.z + 1.3), tree2);
await page.waitForTimeout(800);
// Turn until the crosshair is off every tree, not merely off this one: the
// forest is dense enough that a half-turn often just faces another trunk, and
// chopping *that* would be correct behaviour, not the bug under test.
let facedAway = false;
for (let i = 1; i <= 16 && !facedAway; i++) {
  await page.evaluate((yaw) => window.__gameDebug.setCameraYaw(yaw), (i * Math.PI) / 8);
  await page.waitForTimeout(400);
  // Stable across several frames, so a one-frame gap between two trunks
  // doesn't get mistaken for clear air.
  facedAway = true;
  for (let s = 0; s < 3 && facedAway; s++) {
    facedAway = await page.evaluate(() => window.__gameDebug.getTarget().kind !== "node");
    await page.waitForTimeout(250);
  }
}
const woodBefore = await page.evaluate(
  () => (window.__gameDebug.getInventory().find((s) => s.itemId === "wood") || { qty: 0 }).qty);
const distanceToTree = await page.evaluate((t) => {
  const p = window.__gameDebug.getPlayerPosition();
  return Math.hypot(p.x - t.x, p.z - t.z);
}, tree2);
await page.mouse.down();
// Sample throughout: the assertion is that no node is ever targeted while the
// button is held, not just at the moment it went down.
let stayedClear = true;
for (let i = 0; i < 12; i++) {
  await page.waitForTimeout(250);
  if (await page.evaluate(() => window.__gameDebug.getTarget().kind === "node")) stayedClear = false;
}
await page.mouse.up();
const woodAfter = await page.evaluate(
  () => (window.__gameDebug.getInventory().find((s) => s.itemId === "wood") || { qty: 0 }).qty);
ok("standing next to a tree but facing away gathers nothing",
  facedAway && stayedClear && woodAfter === woodBefore,
  `distance=${distanceToTree.toFixed(2)} before=${woodBefore} after=${woodAfter} stayedClear=${stayedClear}`);
ok("the tree really was within the old radius search's range", distanceToTree < 2.5,
  distanceToTree.toFixed(2));

// --- 3. reach --------------------------------------------------------
// Far enough away, the same tree can be looked at but not acted on.
await page.evaluate((t) => window.__gameDebug.teleportPlayer(t.x, t.z + 14), tree2);
await page.waitForTimeout(1000);
const farTarget = await page.evaluate(() => window.__gameDebug.getTarget());
ok("a tree beyond reach is not a target", farTarget.kind !== "node", JSON.stringify(farTarget));

// --- 4. right click places at the crosshair, not a fixed distance ------
await page.evaluate(() => {
  window.__gameDebug.grantItems({ wood: 40, stone: 40, plank: 20, clay: 20 });
  window.__gameDebug.teleportPlayer(0, 0);
});
await page.waitForTimeout(800);
await selectBuilding(page, waitFor, "Farm Plot", "farm_plot");

// Face a known direction so the expected cell is unambiguous.
const aimPoint = await turnAndSettleAim(0);
// The world now seeds POI barrels of its own, so "any placed building" is no
// longer proof this click placed one — count only the pieces under test.
await page.mouse.down({ button: "right" });
await page.mouse.up({ button: "right" });
const didPlace = await waitFor(
  () => window.__gameDebug.getPlacedBuildings().filter((b) => b.buildingId === "farm_plot").length > 0);
const placedAt = await page.evaluate(
  () => window.__gameDebug.getPlacedBuildings().filter((b) => b.buildingId === "farm_plot")[0]);
// GRID_CELL_SIZE is 1, so the cell is just the rounded aim point.
const cellOk = didPlace &&
  Math.abs(placedAt.cellX - Math.round(aimPoint.x)) <= 1 &&
  Math.abs(placedAt.cellZ - Math.round(aimPoint.z)) <= 1;
ok("right click places a piece", didPlace);
ok("it lands in the cell under the crosshair", cellOk,
  `aim=(${aimPoint.x},${aimPoint.z}) cell=(${placedAt?.cellX},${placedAt?.cellZ})`);

// And aiming elsewhere puts the next piece somewhere else — the whole point,
// versus the old fixed distance straight ahead.
const aim2 = await turnAndSettleAim(Math.PI / 2);
await page.mouse.down({ button: "right" });
await page.mouse.up({ button: "right" });
const placedTwo = await waitFor(
  () => window.__gameDebug.getPlacedBuildings().filter((b) => b.buildingId === "farm_plot").length > 1);
const second = await page.evaluate(
  () => window.__gameDebug.getPlacedBuildings().filter((b) => b.buildingId === "farm_plot")[1]);
ok("turning moves where the piece lands",
  placedTwo && (second.cellX !== placedAt.cellX || second.cellZ !== placedAt.cellZ) &&
  Math.abs(second.cellX - Math.round(aim2.x)) <= 1 &&
  Math.abs(second.cellZ - Math.round(aim2.z)) <= 1,
  `aim=(${aim2.x},${aim2.z}) cell=(${second?.cellX},${second?.cellZ}) first=(${placedAt?.cellX},${placedAt?.cellZ})`);

const placeState = await page.evaluate(() => window.__gameDebug.getCrosshairState());
ok("crosshair shows the placement state", placeState === "place", placeState);

await page.keyboard.press("KeyQ");
await waitFor(() => window.__gameDebug.getSelectedBuilding() === null);

// --- 5. wheel routing -------------------------------------------------
// The bare scroll now changes what is *held*, not what is being built: the
// hotbar carries items since the equipment work.
const beforeSlot = await page.evaluate(() => window.__gameDebug.getEquippedSlot());
await page.mouse.wheel(0, 120);
const cycled = await waitFor(
  (b) => window.__gameDebug.getEquippedSlot() !== b, beforeSlot, 10000);
ok("a bare scroll changes the held slot", cycled,
  `${beforeSlot} -> ${await page.evaluate(() => window.__gameDebug.getEquippedSlot())}`);

const dist0 = await page.evaluate(() => window.__gameDebug.getCameraDistance());
await page.keyboard.down("Control");
await page.mouse.wheel(0, -400);
const zoomed = await waitFor((d) => window.__gameDebug.getCameraDistance() < d, dist0, 10000);
await page.keyboard.up("Control");
ok("ctrl+scroll still zooms", zoomed);

await page.keyboard.press("KeyQ");
await waitFor(() => window.__gameDebug.getSelectedBuilding() === null);

// --- 6. first person --------------------------------------------------
await page.keyboard.press("KeyV");
const fp = await waitFor(() => window.__gameDebug.isFirstPerson());
const hidden = await waitFor(() => !window.__gameDebug.isPlayerVisible());
ok("V enters first person", fp);
ok("the character is hidden in first person", hidden);

await page.keyboard.press("KeyV");
const back = await waitFor(() =>
  !window.__gameDebug.isFirstPerson() && window.__gameDebug.isPlayerVisible());
ok("V returns to third person and the character comes back", back);

ok("no console/page errors", errors.length === 0, errors.slice(0, 3).join(" | "));

await page.screenshot({
  path: "/tmp/claude-0/-home-user-sandsd01/408edaa1-3a98-5fd8-a1af-5e70efacb130/scratchpad/mouse-after.png",
});
await browser.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length}`);
process.exit(failed.length ? 1 : 0);
