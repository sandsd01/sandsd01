import { chromium, LAUNCH, BASE_URL } from "./harness.mjs";
import { editSaveOffline } from "./legacysave.mjs";
import { selectBuilding } from "./buildselect.mjs";

// Crafting: discovery, station tiers, filters, batch crafting, tool speed and
// the legacy-save path.
//
// Software rendering runs this scene at a few FPS, so every assertion polls
// rather than sleeping — a fixed sleep is routinely shorter than one frame.
const URL = BASE_URL;
const browser = await chromium.launch({
  ...LAUNCH,
  args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });

const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(String(e)));

const results = [];
function ok(name, pass, detail = "") {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}

async function waitFor(fn, arg, timeoutMs = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await page.evaluate(fn, arg)) return true;
    await page.waitForTimeout(150);
  }
  return false;
}

async function boot() {
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForFunction(() => !!window.__gameDebug, null, { timeout: 30000 });
  await page.waitForTimeout(800);
}

async function freshWorld() {
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForFunction(() => !!window.__gameDebug, null, { timeout: 30000 });
  await page.evaluate(() => localStorage.clear());
  await boot();
}

// Rows currently rendered in the crafting panel, by title.
const visibleRows = () =>
  page.evaluate(() => {
    const panel = [...document.querySelectorAll(".panel")].find(
      (p) => p.classList.contains("visible") && p.querySelector("h2")?.textContent === "Crafting",
    );
    if (!panel) return null;
    return [...panel.querySelectorAll(".panel-row-title")].map((n) => n.textContent);
  });

async function openCrafting() {
  if (await page.evaluate(() => !!document.querySelector(".panel.visible"))) return;
  await page.keyboard.press("KeyC");
  await waitFor(
    () => document.querySelector(".panel.visible h2")?.textContent === "Crafting",
  );
}

async function closeCrafting() {
  if (await page.evaluate(() => !!document.querySelector(".panel.visible"))) {
    await page.keyboard.press("Escape");
    await waitFor(() => document.querySelectorAll(".panel.visible").length === 0);
  }
}

await freshWorld();

// --- 1. a new player does not face a wall of recipes --------------------
const known0 = await page.evaluate(() => window.__gameDebug.getKnownRecipes());
// Derived from the game's own recipe book rather than hardcoded: a literal
// here goes stale the moment a recipe is added, and reports a content change
// as a test failure.
const total = (await page.evaluate(() => window.__gameDebug.getAllRecipes())).length;
ok(
  "a fresh world starts with only the recipes its kit implies",
  known0.length > 0 && known0.length < total,
  `${known0.length} of ${total}: ${known0.join(", ")}`,
);
ok("brick is not known before any clay is held", !known0.includes("brick"), known0.join(", "));

// --- 2. picking an ingredient up teaches its recipe ---------------------
// Record the toast rather than sample for it afterwards. It hides itself two
// seconds after it appears, on the *wall* clock, and the poll below plus a
// round trip can outlast that on a heavy frame — which reported "no toast" for
// a toast that had been shown and had gone again. What is being checked is
// that one was raised, so watch for it being raised.
await page.evaluate(() => {
  window.__toastLog = [];
  const el = document.querySelector(".hud-toast");
  if (!el) return;
  if (el.classList.contains("visible")) window.__toastLog.push(el.textContent);
  new MutationObserver(() => {
    if (el.classList.contains("visible")) window.__toastLog.push(el.textContent);
  }).observe(el, { attributes: true, attributeFilter: ["class"] });
});
await page.evaluate(() => window.__gameDebug.grantItems({ clay: 4 }));
const learned = await waitFor(() =>
  window.__gameDebug.getKnownRecipes().includes("brick"),
);
const unseen = await page.evaluate(() => window.__gameDebug.getUnseenRecipes());
ok("holding clay teaches the Brick recipe", learned);
ok("the newly learned recipe is marked unseen", unseen.includes("brick"), unseen.join(", "));

const toast = await page.evaluate(() => {
  const t = document.querySelector(".hud-toast");
  const log = window.__toastLog ?? [];
  return {
    raised: log.some((text) => /recipe/i.test(text ?? "")),
    log,
    live: t?.classList.contains("visible"),
    text: t?.textContent,
  };
});
ok("one toast announces it", toast.raised,
  `${JSON.stringify(toast.log)} (live=${toast.live}, text=${toast.text})`);

// --- 3. the NEW badge shows in the panel, and clears on close -----------
await openCrafting();
const badged = await page.evaluate(() =>
  [...document.querySelectorAll(".panel.visible .panel-row")]
    .filter((r) => r.querySelector(".panel-badge"))
    .map((r) => r.querySelector(".panel-row-title")?.textContent),
);
ok("the panel shows a NEW badge on it", badged.includes("Brick"), badged.join(", "));

// A shortfall must be readable without relying on the red tint. Checked here,
// on a fresh world, because this is the only point where the player is short
// of something — later on they have been granted everything and the assertion
// would pass by having nothing to look at.
const markCheck = await page.evaluate(() => {
  const shorts = [...document.querySelectorAll(".panel.visible .cost-short")];
  return {
    count: shorts.length,
    marked: shorts.filter((s) => s.querySelector(".cost-mark")).length,
    sample: shorts[0]?.textContent ?? "",
  };
});
ok(
  "every shortfall carries a glyph, not only a colour",
  markCheck.count > 0 && markCheck.marked === markCheck.count,
  `short=${markCheck.count} marked=${markCheck.marked} e.g. "${markCheck.sample}"`,
);

await closeCrafting();
const unseenAfter = await page.evaluate(() => window.__gameDebug.getUnseenRecipes());
await openCrafting();
const badgedAfter = await page.evaluate(
  () => document.querySelectorAll(".panel.visible .panel-badge").length,
);
ok("closing the panel clears the badge", unseenAfter.length === 0 && badgedAfter === 0,
  `unseen=${unseenAfter.length} badges=${badgedAfter}`);

// --- 4. filters ---------------------------------------------------------
await page.evaluate(() =>
  window.__gameDebug.grantItems({
    wood: 40, stone: 40, plank: 20, clay: 20, iron_ore: 20, iron_ingot: 8, wheat: 9,
  }),
);
await page.waitForTimeout(400);

const clickChip = (label) =>
  page.evaluate((text) => {
    const chip = [...document.querySelectorAll(".panel.visible .panel-chip")].find(
      (c) => c.textContent === text,
    );
    if (!chip) return false;
    chip.click();
    return true;
  }, label);

ok("category chips exist", await clickChip("Weapons"));
await page.waitForTimeout(300);
const weapons = await visibleRows();
// Checked against the recipe book's own categories. Matching /Sword/ on the
// name looked equivalent while every weapon happened to be a sword, and broke
// the moment one was not.
const weaponNames = await page.evaluate(() =>
  window.__gameDebug
    .getAllRecipes()
    .filter((r) => r.category === "weapons")
    .map((r) => r.name),
);
ok(
  "the Weapons filter shows only weapons",
  weapons !== null &&
    weapons.length > 0 &&
    weapons.every((n) => weaponNames.includes(n)) &&
    weaponNames.every((n) => weapons.includes(n)),
  `shown=${(weapons ?? []).join(", ")} | weapons=${weaponNames.join(", ")}`,
);

await clickChip("All");
await page.waitForTimeout(300);
const all = await visibleRows();

await page.evaluate(() => {
  document.querySelector(".panel.visible .panel-toggle")?.click();
});
await page.waitForTimeout(300);
const craftableRows = await visibleRows();
const craftableIds = await page.evaluate(() => window.__gameDebug.getCraftableRecipes());
ok(
  "the craftable-now filter narrows the list to what can be made",
  craftableRows !== null &&
    all !== null &&
    craftableRows.length < all.length &&
    craftableRows.length === craftableIds.length,
  `all=${all?.length} craftable=${craftableRows?.length} ids=${craftableIds.length}`,
);
await page.evaluate(() => {
  document.querySelector(".panel.visible .panel-toggle")?.click();
});
await page.waitForTimeout(300);

// --- 6. batch crafting --------------------------------------------------
const wood0 = await page.evaluate(
  () => (window.__gameDebug.getInventory().find((s) => s.itemId === "wood") || { qty: 0 }).qty);
const plank0 = await page.evaluate(
  () => (window.__gameDebug.getInventory().find((s) => s.itemId === "plank") || { qty: 0 }).qty);
const made = await page.evaluate(() => window.__gameDebug.craftRecipe("plank", 4));
await page.waitForTimeout(300);
const wood1 = await page.evaluate(
  () => (window.__gameDebug.getInventory().find((s) => s.itemId === "wood") || { qty: 0 }).qty);
const plank1 = await page.evaluate(
  () => (window.__gameDebug.getInventory().find((s) => s.itemId === "plank") || { qty: 0 }).qty);
ok(
  "crafting a batch of 4 spends 4x the inputs and yields 4x the output",
  made === 4 && wood0 - wood1 === 8 && plank1 - plank0 === 4,
  `made=${made} wood ${wood0}->${wood1} plank ${plank0}->${plank1}`,
);

const batchButton = await page.evaluate(() => {
  const row = [...document.querySelectorAll(".panel.visible .panel-row")].find(
    (r) => r.querySelector(".panel-row-title")?.textContent === "Plank",
  );
  return row?.querySelector(".panel-batch")?.textContent ?? null;
});
ok("the batch button names the real number", /^Craft x\d+$/.test(batchButton ?? ""), String(batchButton));

// --- 7 & 8. the two dead stations now gate something --------------------
await closeCrafting();

// `at` gives each station its own patch of ground: both used to be placed at
// the same crosshair cell, so the second one silently failed as "occupied"
// and took three later assertions down with it.
async function stationGate(recipeName, buildingId, buildingName, at) {
  await page.evaluate((p) => window.__gameDebug.teleportPlayer(p.x, p.z), at);
  await page.waitForTimeout(500);
  await openCrafting();
  const before = await page.evaluate((name) => {
    const row = [...document.querySelectorAll(".panel.visible .panel-row")].find(
      (r) => r.querySelector(".panel-row-title")?.textContent === name,
    );
    if (!row) return null;
    return {
      disabled: row.querySelector("button").disabled,
      warn: row.querySelector(".panel-row-warn")?.textContent ?? "",
    };
  }, recipeName);
  await closeCrafting();

  // Place the station, then check the same row again. Face a fixed direction
  // so the ghost lands on the clear ground we teleported to.
  await page.click("#game-canvas");
  await page.evaluate(() => window.__gameDebug.setCameraYaw(0));
  await page.waitForTimeout(400);
  await waitFor(() => window.__gameDebug.isPointerLocked());
  await selectBuilding(page, waitFor, buildingName, buildingId);
  await page.mouse.down({ button: "right" });
  await page.mouse.up({ button: "right" });
  const placed = await waitFor(
    (id) => window.__gameDebug.getPlacedBuildings().some((b) => b.buildingId === id),
    buildingId,
  );
  await page.keyboard.press("KeyQ");
  await page.waitForTimeout(300);
  await openCrafting();
  const after = await page.evaluate((name) => {
    const row = [...document.querySelectorAll(".panel.visible .panel-row")].find(
      (r) => r.querySelector(".panel-row-title")?.textContent === name,
    );
    if (!row) return null;
    return {
      disabled: row.querySelector("button").disabled,
      warn: row.querySelector(".panel-row-warn")?.textContent ?? "",
    };
  }, recipeName);
  await closeCrafting();
  return { before, after, placed };
}

const anvil = await stationGate("Iron Sword", "anvil", "Anvil", { x: 0, z: 0 });
ok(
  "the Anvil now gates the Iron Sword (it used to gate nothing)",
  anvil.placed && anvil.before?.disabled === true && /Anvil/.test(anvil.before.warn) &&
    anvil.after?.disabled === false,
  JSON.stringify(anvil),
);

const bench = await stationGate("Iron Axe", "workbench", "Workbench", { x: 18, z: 0 });
ok(
  "the Workbench now gates the Iron Axe (it used to gate nothing)",
  bench.placed && bench.before?.disabled === true && /Workbench/.test(bench.before.warn) &&
    bench.after?.disabled === false,
  JSON.stringify(bench),
);

// --- 9. an iron tool actually swings faster -----------------------------
// The workbench from the last check is still standing where we left it, and
// both remaining recipes need it: crafting them anywhere else is *supposed* to
// fail, so the test has to walk back rather than expect the rule to bend.
const bench_pos = await page.evaluate(() => {
  const b = window.__gameDebug.getPlacedBuildings().find((p) => p.buildingId === "workbench");
  return b ? { x: b.cellX, z: b.cellZ } : null;
});

// Speed follows what is *held* now, not what is owned, so each measurement has
// to put the right axe in hand first — that is the whole point of the change.
async function equip(itemId) {
  return page.evaluate((id) => {
    const slot = window.__gameDebug.getHotbar().indexOf(id);
    if (slot >= 0) window.__gameDebug.selectHotbarSlot(slot);
    // Auto-assignment fills the bar with raw materials long before a tier-2
    // tool exists, so take the item in hand the way the inventory panel's
    // Hold button does.
    else window.__gameDebug.holdItem(id);
    return window.__gameDebug.getEquippedItem() === id;
  }, itemId);
}

async function aimAtTree(tree) {
  await page.evaluate((t) => window.__gameDebug.teleportPlayer(t.x, t.z + 2.2), tree);
  for (let i = 0; i < 24; i++) {
    await page.evaluate((y) => window.__gameDebug.setCameraYaw(y), (i * Math.PI) / 12);
    await page.waitForTimeout(250);
    if (await page.evaluate(() => window.__gameDebug.getTarget().kind === "node")) return true;
  }
  return false;
}

const tree = await page.evaluate(() =>
  window.__gameDebug.getResourceNodes().filter((n) => n.kind === "tree" && !n.depleted)[0]);
const heldPlain = await equip("axe");
const aimedPlain = await aimAtTree(tree);
const stoneTime = await page.evaluate(() => window.__gameDebug.getGatherTime());

// Back to the bench to actually make the thing.
await page.evaluate((b) => {
  window.__gameDebug.teleportPlayer(b.x, b.z);
  window.__gameDebug.grantItems({ iron_ingot: 8, plank: 8, wheat: 6 });
}, bench_pos);
await page.waitForTimeout(500);
const gotIron = await page.evaluate(() => window.__gameDebug.craftRecipe("iron_axe", 1));
const baked = await page.evaluate(() => window.__gameDebug.craftRecipe("bread", 1));

const heldIron = await equip("iron_axe");
const aimedIron = await aimAtTree(tree);
const ironTime = await page.evaluate(() => window.__gameDebug.getGatherTime());
ok(
  "an iron axe chops faster than a plain one",
  heldPlain && heldIron && aimedPlain && aimedIron && gotIron === 1 && ironTime < stoneTime,
  `crafted=${gotIron} held=${heldPlain}/${heldIron} ${stoneTime}ms -> ${ironTime}ms`,
);

// --- 10. food closes the farming loop -----------------------------------
await page.evaluate(() => window.__gameDebug.damagePlayer(50));
await page.waitForTimeout(300);
const hurt = await page.evaluate(() => window.__gameDebug.getHealth().current);
await page.keyboard.press("KeyI");
await waitFor(() => document.querySelector(".panel.visible h2")?.textContent === "Inventory");
const ate = await page.evaluate(() => {
  const row = [...document.querySelectorAll(".panel.visible .panel-row")].find(
    (r) => r.querySelector(".panel-row-title")?.textContent === "Bread",
  );
  if (!row) return false;
  const button = [...row.querySelectorAll("button")].find((b) => b.textContent === "Eat");
  if (!button) return false;
  button.click();
  return true;
});
await page.waitForTimeout(400);
const healed = await page.evaluate(() => window.__gameDebug.getHealth().current);
ok(
  "wheat becomes bread and bread heals",
  baked === 1 && ate && healed > hurt,
  `baked=${baked} ate=${ate} health ${hurt} -> ${healed}`,
);
await page.keyboard.press("Escape");
await page.waitForTimeout(300);

// --- 11. a save written before discovery existed must not lose recipes ---
await page.evaluate(() => window.__gameDebug.saveNow());
await editSaveOffline(page, URL, (save) => {
  delete save.knownRecipes;
  delete save.unseenRecipes;
});
await boot();
const legacyKnown = await page.evaluate(() => window.__gameDebug.getKnownRecipes());
ok(
  "a save from before recipes were discoverable keeps every recipe",
  legacyKnown.length === total,
  `${legacyKnown.length} of ${total}`,
);

ok("no console/page errors", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length}`);
process.exit(failed.length ? 1 : 0);
