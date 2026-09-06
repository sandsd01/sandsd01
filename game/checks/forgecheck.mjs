import { selectBuilding } from "./buildselect.mjs";
import { chromium, LAUNCH, BASE_URL } from "./harness.mjs";
const results = [];
const ok = (n, p, d = "") => results.push([p, n, d]);

const browser = await chromium.launch({
  ...LAUNCH,
  args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
const failed = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("response", (r) => {
  if (/\.(glb|obj|mtl|png)$/.test(r.url()) && r.status() >= 400) failed.push(`${r.status()} ${r.url()}`);
});

await page.goto(BASE_URL, { waitUntil: "load" });
await page.waitForFunction(() => !!window.__gameDebug, null, { timeout: 120000 });
ok("no failed asset requests", failed.length === 0, failed.join(", "));

// --- Hotbar grew to eight and still fits ------------------------------
const layout = await page.evaluate(() => {
  const r = (sel) => document.querySelector(sel).getBoundingClientRect();
  const hot = r(".hud-hotbar");
  const keys = r(".hud-keybinds");
  const map = r(".hud-minimap");
  const slots = [...document.querySelectorAll(".hud-hotbar-slot")];
  const overlaps = (a, b) =>
    !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
  return {
    count: slots.length,
    names: slots.map((s) => s.querySelector(".hud-hotbar-name").textContent),
    minW: Math.min(...slots.map((s) => s.getBoundingClientRect().width)),
    minH: Math.min(...slots.map((s) => s.getBoundingClientRect().height)),
    inViewport: hot.left >= 0 && hot.right <= window.innerWidth,
    clearsKeybinds: !overlaps(hot, keys),
    clearsMinimap: !overlaps(hot, map),
  };
});
ok("hotbar has eight slots", layout.count === 8, String(layout.count));
ok("slots still >= 44px", layout.minW >= 44 && layout.minH >= 44, `${layout.minW}x${layout.minH}`);
ok("hotbar fits on screen", layout.inViewport);
ok("hotbar clears the keybind card", layout.clearsKeybinds);
ok("hotbar clears the mini-map", layout.clearsMinimap);

// --- Forge parts actually became meshes -------------------------------
// Give the player the materials, place a Forge, and confirm a mesh appears.
await page.evaluate(() => {
  window.__gameDebug.grantItems({ stone: 20, clay: 10, iron_ore: 5, plank: 10, wood: 10 });
});
await page.click("#game-canvas");
await page.waitForFunction(() => window.__gameDebug.isPointerLocked(), null, { timeout: 20000 });
// Building moved to the B panel when the number keys became item slots.
const waitForFn = async (fn, arg, timeoutMs = 20000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await page.evaluate(fn, arg)) return true;
    await page.waitForTimeout(200);
  }
  return false;
};
ok("the Build panel selects the Forge",
  await selectBuilding(page, waitForFn, "Forge", "forge"));

// Right button places now: left is gather/attack, right is place/use.
await page.mouse.down({ button: "right" });
await page.mouse.up({ button: "right" });
await page.waitForFunction(
  () => window.__gameDebug.getPlacedBuildings().some((b) => b.buildingId === "forge"),
  null,
  { timeout: 20000 },
);
const forge = await page.evaluate(() => window.__gameDebug.getBuildingBounds("forge"));
ok("the forge model has real geometry", forge && forge.height > 0.8, JSON.stringify(forge));
ok("the forge sits on the ground", forge && Math.abs(forge.minY - forge.terrainY) < 0.3, JSON.stringify(forge));

// --- The forge gates smelting ----------------------------------------
await page.evaluate(() => window.__gameDebug.grantItems({ iron_ore: 6, wood: 4 }));
await page.keyboard.press("KeyC");
await page.waitForFunction(() => document.querySelector(".panel.visible h2")?.textContent === "Crafting", null, { timeout: 20000 });
const near = await page.evaluate(() => {
  const row = [...document.querySelectorAll(".panel.visible .panel-row")].find(
    (r) => r.querySelector(".panel-row-title")?.textContent === "Iron Ingot",
  );
  return { warn: !!row.querySelector(".panel-row-warn"), disabled: row.querySelector("button").disabled };
});
ok("smelting is available beside the forge", !near.warn && !near.disabled, JSON.stringify(near));

// Walk far away; the same recipe must now explain itself.
await page.keyboard.press("Escape");
await page.waitForFunction(() => document.querySelectorAll(".panel.visible").length === 0, null, { timeout: 20000 });
await page.evaluate(() => window.__gameDebug.teleportPlayer(0, 40));
await page.keyboard.press("KeyC");
await page.waitForFunction(() => document.querySelector(".panel.visible h2")?.textContent === "Crafting", null, { timeout: 20000 });
const far = await page.evaluate(() => {
  const row = [...document.querySelectorAll(".panel.visible .panel-row")].find(
    (r) => r.querySelector(".panel-row-title")?.textContent === "Iron Ingot",
  );
  return {
    warn: row.querySelector(".panel-row-warn")?.textContent ?? "",
    disabled: row.querySelector("button").disabled,
  };
});
ok("smelting is blocked away from the forge", far.disabled, JSON.stringify(far));
ok("and says why in words", /Forge/.test(far.warn), far.warn);

// A recipe with no station requirement is unaffected.
const plank = await page.evaluate(() => {
  const row = [...document.querySelectorAll(".panel.visible .panel-row")].find(
    (r) => r.querySelector(".panel-row-title")?.textContent === "Plank",
  );
  return { warn: !!row.querySelector(".panel-row-warn"), disabled: row.querySelector("button").disabled };
});
ok("field recipes are unaffected", !plank.warn && !plank.disabled, JSON.stringify(plank));

ok("no console/page errors", errors.length === 0, errors.slice(0, 3).join(" | "));

await page.keyboard.press("Escape");
await page.evaluate(() => window.__gameDebug.teleportPlayer(2, 4));
await page.waitForTimeout(1500);
await page.screenshot({ path: "forge-ingame.png" });
await browser.close();

let pass = 0;
for (const [p, n, d] of results) {
  console.log(`${p ? "PASS" : "FAIL"}  ${n}${d ? "  — " + d : ""}`);
  if (p) pass++;
}
console.log(`\n${pass}/${results.length}`);
process.exit(pass === results.length ? 0 : 1);
