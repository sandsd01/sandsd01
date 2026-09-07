import { chromium, LAUNCH, BASE_URL } from "./harness.mjs";
import { editSaveOffline } from "./legacysave.mjs";

// The held item: does what you carry in your hand actually decide anything?
//
// Before this work, combat read `hasQty(state, "iron_sword", 1)` and gathering
// scanned the whole bag for the best tool — so *owning* a thing was the same as
// *using* it, and a crafted sword changed nothing on screen. Every check here
// is written so it would fail against that older behaviour.
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

// Software rendering runs a few frames a second, so everything polls.
async function waitFor(fn, arg, timeoutMs = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await page.evaluate(fn, arg)) return true;
    await page.waitForTimeout(150);
  }
  return false;
}

await page.goto(URL, { waitUntil: "load" });
await page.waitForFunction(() => !!window.__gameDebug, null, { timeout: 120000 });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: "load" });
await page.waitForFunction(() => !!window.__gameDebug, null, { timeout: 120000 });
await page.waitForTimeout(1200);

// --- 1. the bar is reachable from the keyboard and the wheel -------------
await page.click("#game-canvas");
await waitFor(() => window.__gameDebug.isPointerLocked());

const start = await page.evaluate(() => window.__gameDebug.getHotbar());
ok("the starting kit lands in the bar by itself", start.slice(0, 3).join(",") === "axe,pickaxe,wheat_seed",
  JSON.stringify(start));

await page.keyboard.press("Digit2");
const onTwo = await waitFor(() => window.__gameDebug.getEquippedSlot() === 1);
ok("a number key selects that slot", onTwo,
  `slot=${await page.evaluate(() => window.__gameDebug.getEquippedSlot())}`);
ok("and the item in it is what's held",
  (await page.evaluate(() => window.__gameDebug.getEquippedItem())) === "pickaxe");

await page.keyboard.press("Digit8");
const onEight = await waitFor(() => window.__gameDebug.getEquippedSlot() === 7);
ok("all eight slots are reachable", onEight);
ok("an empty slot means empty hands",
  (await page.evaluate(() => window.__gameDebug.getEquippedItem())) === null);

await page.keyboard.press("Digit1");
await waitFor(() => window.__gameDebug.getEquippedSlot() === 0);
await page.mouse.wheel(0, 120);
const scrolled = await waitFor(() => window.__gameDebug.getEquippedSlot() !== 0);
ok("the wheel moves along the bar", scrolled,
  `slot=${await page.evaluate(() => window.__gameDebug.getEquippedSlot())}`);

// --- 2. THE point: the tool in hand decides, not the one in the bag ------
// Give the player a sword as well, hold the sword, and try to chop. The axe
// never leaves the bag — under the old "best tool in inventory" rule this
// would chop happily.
await page.evaluate(() => window.__gameDebug.grantItems({ sword: 1 }));
await page.waitForTimeout(400);

const tree = await page.evaluate(() =>
  window.__gameDebug.getResourceNodes().filter((n) => n.kind === "tree" && !n.depleted)[0]);

async function aimAtTree() {
  await page.evaluate((t) => window.__gameDebug.teleportPlayer(t.x, t.z + 2.2), tree);
  await page.waitForTimeout(500);
  for (let i = 0; i < 24; i++) {
    await page.evaluate((y) => window.__gameDebug.setCameraYaw(y), (i * Math.PI) / 12);
    await page.waitForTimeout(220);
    if (await page.evaluate(() => window.__gameDebug.getTarget().kind === "node")) return true;
  }
  return false;
}

const hold = (id) => page.evaluate((i) => {
  window.__gameDebug.holdItem(i);
  return window.__gameDebug.getEquippedItem() === i;
}, id);

// Sword in hand, axe still in the bag.
ok("the sword can be taken in hand", await hold("sword"));
const bagHasAxe = await page.evaluate(
  () => window.__gameDebug.getInventory().some((s) => s.itemId === "axe" && s.qty > 0));
ok("the axe is still carried, just not held", bagHasAxe);

const aimedWithSword = await aimAtTree();
const woodBefore = await page.evaluate(
  () => (window.__gameDebug.getInventory().find((s) => s.itemId === "wood") ?? { qty: 0 }).qty);
const swordPrompt = await page.evaluate(() => document.querySelector(".hud-prompt")?.textContent ?? "");

await page.mouse.down();
let choppedWithSword = false;
for (let i = 0; i < 16; i++) {
  await page.waitForTimeout(250);
  const now = await page.evaluate(
    () => (window.__gameDebug.getInventory().find((s) => s.itemId === "wood") ?? { qty: 0 }).qty);
  if (now > woodBefore) { choppedWithSword = true; break; }
}
await page.mouse.up();

ok("aimed at a tree while holding the sword", aimedWithSword);
ok("holding a sword does NOT chop, even with an axe in the bag", !choppedWithSword,
  `wood stayed ${woodBefore}`);
ok("and the prompt says to hold an axe, not that you need one",
  /hold/i.test(swordPrompt) && /axe/i.test(swordPrompt), swordPrompt);

// Same tree, same spot, axe in hand: it must chop.
ok("the axe can be taken back in hand", await hold("axe"));
const aimedWithAxe = await aimAtTree();
const woodPre = await page.evaluate(
  () => (window.__gameDebug.getInventory().find((s) => s.itemId === "wood") ?? { qty: 0 }).qty);
await page.mouse.down();
const choppedWithAxe = await waitFor(
  (w) => (window.__gameDebug.getInventory().find((s) => s.itemId === "wood") ?? { qty: 0 }).qty > w,
  woodPre, 60000);
await page.mouse.up();
ok("aimed at a tree while holding the axe", aimedWithAxe);
ok("holding the axe chops the very same tree", choppedWithAxe);

// --- 3. damage follows the weapon in hand -------------------------------
await page.evaluate(() => window.__gameDebug.grantItems({ iron_sword: 1 }));
await page.waitForTimeout(300);
const damage = await page.evaluate(() => {
  const out = {};
  for (const id of ["axe", "sword", "iron_sword"]) {
    window.__gameDebug.holdItem(id);
    out[id] = window.__gameDebug.getHeldDamage();
  }
  window.__gameDebug.selectHotbarSlot(7);
  out.empty = window.__gameDebug.getHeldDamage();
  return out;
});
ok("a better weapon in hand hits harder", damage.iron_sword > damage.sword,
  JSON.stringify(damage));
ok("bare hands hit for least of all", damage.empty < damage.sword, JSON.stringify(damage));

// --- 4. the item is really on the character, and really changes ---------
await hold("axe");
await page.waitForTimeout(700);
const axeMesh = await page.evaluate(() => window.__gameDebug.getHeldItemMesh());
ok("an axe mesh is attached to the character",
  axeMesh.attached && axeMesh.hasMesh && axeMesh.itemId === "axe", JSON.stringify(axeMesh));
ok("it sits at hand height, not at the feet or over the head",
  axeMesh.aboveFeet > 0.2 && axeMesh.aboveFeet < 1.8, String(axeMesh.aboveFeet));

// Whether the item is inside the frame and in front of the camera. Occlusion
// is deliberately not asserted here: raycasting a SkinnedMesh uses its
// bind-pose bounds and reports misses for items that are plainly on screen.
// That it reads as an axe in the hand was confirmed by looking at renders from
// four camera angles, which is the only trustworthy check for that.
const seen = await page.evaluate(() => window.__gameDebug.isHeldItemVisible());
ok("the held item is on screen, in front of the camera", seen.onScreen,
  JSON.stringify(seen));

await hold("pickaxe");
await page.waitForTimeout(700);
const pickMesh = await page.evaluate(() => window.__gameDebug.getHeldItemMesh());
ok("swapping the held item swaps the mesh",
  pickMesh.itemId === "pickaxe" && pickMesh.hasMesh, JSON.stringify(pickMesh));

// Taking items in hand above moved them between slots, so find a slot that is
// genuinely empty now rather than assuming slot 8 still is.
const freeSlot = await page.evaluate(() => {
  const i = window.__gameDebug.getHotbar().indexOf(null);
  if (i >= 0) window.__gameDebug.selectHotbarSlot(i);
  return i;
});
await page.waitForTimeout(700);
const emptyMesh = await page.evaluate(() => window.__gameDebug.getHeldItemMesh());
ok("there is an empty slot to select", freeSlot >= 0, String(freeSlot));
// The grip node stays mounted for the whole session and simply empties, so
// the honest question is whether a mesh is in it — not whether a grip exists.
ok("an empty slot leaves the hand empty",
  emptyMesh.itemId === null && emptyMesh.hasMesh === false, JSON.stringify(emptyMesh));

// The swing has to move it: a mesh welded rigidly to the body would pass every
// check above and still look dead.
await hold("axe");
await page.waitForTimeout(600);
const restAxis = await page.evaluate(() => window.__gameDebug.getHeldItemMesh().axis);
await page.mouse.down();
let swungAxis = restAxis;
for (let i = 0; i < 12; i++) {
  await page.waitForTimeout(60);
  const a = await page.evaluate(() => window.__gameDebug.getHeldItemMesh().axis);
  const moved = Math.hypot(a[0] - restAxis[0], a[1] - restAxis[1], a[2] - restAxis[2]);
  if (moved > 0.15) { swungAxis = a; break; }
}
await page.mouse.up();
const swingDelta = Math.hypot(
  swungAxis[0] - restAxis[0], swungAxis[1] - restAxis[1], swungAxis[2] - restAxis[2]);
ok("swinging actually moves the item", swingDelta > 0.15,
  `rest=${restAxis.map((v) => v.toFixed(2))} swing=${swungAxis.map((v) => v.toFixed(2))}`);

// --- 5. the barrel is real storage --------------------------------------
const poi = await page.evaluate(() =>
  window.__gameDebug.getPlacedBuildings().find((b) => b.id.startsWith("poi-")) ?? null);
ok("the world seeded a stocked cache", poi !== null, JSON.stringify(poi));
const poiStock = poi
  ? await page.evaluate((id) => window.__gameDebug.getContainer(id), poi.id)
  : [];
ok("and there is something in it", poiStock.length > 0 && poiStock.every((s) => s.qty > 0),
  JSON.stringify(poiStock));

// Put something in a barrel, take part of it back, and make sure both sides
// of the ledger move.
const ledger = await page.evaluate((id) => {
  const bagOf = (item) =>
    (window.__gameDebug.getInventory().find((s) => s.itemId === item) ?? { qty: 0 }).qty;
  window.__gameDebug.grantItems({ stone: 10 });
  const before = { bag: bagOf("stone"), box: window.__gameDebug.getContainer(id) };
  window.__gameDebug.depositToContainer(id, "stone", 6);
  const mid = { bag: bagOf("stone"), box: window.__gameDebug.getContainer(id) };
  window.__gameDebug.withdrawFromContainer(id, "stone", 2);
  const after = { bag: bagOf("stone"), box: window.__gameDebug.getContainer(id) };
  const stoneIn = (b) => (b.find((s) => s.itemId === "stone") ?? { qty: 0 }).qty;
  return {
    bag: [before.bag, mid.bag, after.bag],
    box: [stoneIn(before.box), stoneIn(mid.box), stoneIn(after.box)],
  };
}, poi.id);
ok("depositing moves stone out of the bag and into the barrel",
  ledger.bag[1] === ledger.bag[0] - 6 && ledger.box[1] === ledger.box[0] + 6,
  JSON.stringify(ledger));
ok("withdrawing brings part of it back",
  ledger.bag[2] === ledger.bag[1] + 2 && ledger.box[2] === ledger.box[1] - 2,
  JSON.stringify(ledger));

// Survives a reload: contents live in the save, not in the panel.
await page.evaluate(() => window.__gameDebug.saveNow());
await page.reload({ waitUntil: "load" });
await page.waitForFunction(() => !!window.__gameDebug, null, { timeout: 120000 });
await page.waitForTimeout(1200);
const afterReload = await page.evaluate(
  (id) => window.__gameDebug.getContainer(id), poi.id);
const stoneAfter = (afterReload.find((s) => s.itemId === "stone") ?? { qty: 0 }).qty;
ok("barrel contents survive a save and reload", stoneAfter === ledger.box[2],
  `${stoneAfter} vs ${ledger.box[2]}`);

const hotbarAfter = await page.evaluate(() => window.__gameDebug.getHotbar());
ok("the bar itself survives too", hotbarAfter.filter(Boolean).length > 0,
  JSON.stringify(hotbarAfter));

// --- 6. a save written before any of this existed still loads ----------
await page.evaluate(() => window.__gameDebug.saveNow());
await editSaveOffline(page, URL, (save) => {
  delete save.hotbar;
  delete save.equippedSlot;
  delete save.containers;
});
await page.reload({ waitUntil: "load" });
await page.waitForFunction(() => !!window.__gameDebug, null, { timeout: 120000 });
await page.waitForTimeout(1200);
const backfilled = await page.evaluate(() => ({
  hotbar: window.__gameDebug.getHotbar(),
  slot: window.__gameDebug.getEquippedSlot(),
  inv: window.__gameDebug.getInventory().length,
}));
ok("a save with no hotbar loads without crashing",
  Array.isArray(backfilled.hotbar) && backfilled.hotbar.length === 8,
  JSON.stringify(backfilled));
ok("and its bag is auto-assigned into the bar",
  backfilled.inv > 0 && backfilled.hotbar.filter(Boolean).length > 0,
  JSON.stringify(backfilled.hotbar));

ok("no console/page errors", errors.length === 0, errors.slice(0, 3).join(" | "));

await page.screenshot({
  path: "/tmp/claude-0/-home-user-sandsd01/408edaa1-3a98-5fd8-a1af-5e70efacb130/scratchpad/equip-after.png",
});
await browser.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length}`);
process.exit(failed.length ? 1 : 0);
