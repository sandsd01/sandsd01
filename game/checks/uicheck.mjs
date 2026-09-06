import { selectBuilding } from "./buildselect.mjs";
import { chromium, LAUNCH, BASE_URL } from "./harness.mjs";

const URL = BASE_URL;
const results = [];
const ok = (n, p, d = "") => results.push([p, n, d]);

const browser = await chromium.launch({
  ...LAUNCH,
  args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

await page.goto(URL, { waitUntil: "load" });
// The scene renders ~2fps under swiftshader, so poll for readiness.
await page.waitForFunction(() => !!window.__gameDebug, null, { timeout: 60000 });
await page.evaluate(() => document.fonts.ready);

// 1. Fonts actually loaded — not silently fallen back to system-ui.
// Cinzel only appears on panel headings, and browsers fetch a face lazily on
// first use, so open a panel before asking whether it loaded.
await page.keyboard.press("KeyC");
await page.waitForFunction(() => document.querySelector(".panel.visible"), null, { timeout: 20000 });
await page.evaluate(() => document.fonts.ready);
await page
  .waitForFunction(() => document.fonts.check('700 16px "Cinzel"'), null, { timeout: 20000 })
  .catch(() => {});
const fonts = await page.evaluate(() => ({
  cinzel: document.fonts.check('700 16px "Cinzel"'),
  rubik: document.fonts.check('400 16px "Rubik"'),
  bodyFamily: getComputedStyle(document.body).fontFamily,
  headingFamily: getComputedStyle(document.querySelector(".panel.visible h2")).fontFamily,
}));
await page.keyboard.press("KeyC");
await page.waitForFunction(() => !document.querySelector(".panel.visible"), null, { timeout: 20000 });
ok("Cinzel loaded", fonts.cinzel, fonts.cinzel ? "" : "fell back");
ok("Rubik loaded", fonts.rubik, fonts.rubik ? "" : "fell back");
ok("body uses Rubik", /Rubik/.test(fonts.bodyFamily), fonts.bodyFamily);
ok("headings use Cinzel", /Cinzel/.test(fonts.headingFamily), fonts.headingFamily);

// 2. Icons rendered as real SVG, not leftover swatches/emoji.
const icons = await page.evaluate(() => ({
  chipSvgs: document.querySelectorAll(".hud-resource-chip svg").length,
  chips: document.querySelectorAll(".hud-resource-chip").length,
  swatches: document.querySelectorAll(".hud-resource-swatch").length,
  clockSvg: !!document.querySelector(".hud-time-icon svg"),
  chipColor: getComputedStyle(document.querySelector(".hud-resource-chip .icon")).color,
}));
ok("every chip has an icon", icons.chipSvgs === icons.chips, `${icons.chipSvgs}/${icons.chips}`);
ok("old swatches gone", icons.swatches === 0);
ok("clock icon is svg", icons.clockSvg);
ok("chip icon keeps its tint", icons.chipColor !== "rgb(244, 238, 226)", icons.chipColor);

// No two chips in the row may wear the same glyph. They sit side by side, so a
// shared icon means the tint is the only thing telling them apart — and the
// pairs that collided in practice (clay and hide; ancient stone and iron ore)
// were both brown-on-brown and grey-on-grey. This has now been got wrong twice
// by hand, which is what a check is for.
const glyphs = await page.evaluate(() =>
  [...document.querySelectorAll(".hud-resource-chip")].map((chip) => {
    const svg = chip.querySelector("svg");
    // lucide draws everything from <path>/<circle>/… geometry, so the shape
    // data is the identity — there is no name attribute to read.
    return svg ? [...svg.children].map((n) => n.getAttribute("d") ?? n.outerHTML).join("|") : "";
  }));
const seen = new Map();
const collisions = [];
glyphs.forEach((g, i) => {
  if (seen.has(g)) collisions.push([seen.get(g), i]);
  else seen.set(g, i);
});
ok("no two resource chips share an icon", collisions.length === 0,
  `${glyphs.length} chips, collisions at indices ${JSON.stringify(collisions)}`);

// 3. Hotbar exists, is big enough to hit, and doesn't collide with other HUD.
const bar = await page.evaluate(() => {
  const slots = [...document.querySelectorAll(".hud-hotbar-slot")];
  const r = (el) => el.getBoundingClientRect();
  const keybinds = r(document.querySelector(".hud-keybinds"));
  const hot = r(document.querySelector(".hud-hotbar"));
  return {
    count: slots.length,
    minW: Math.min(...slots.map((s) => r(s).width)),
    minH: Math.min(...slots.map((s) => r(s).height)),
    // Both axes: the keybind card sits above the hotbar now, so an x-only
    // test reports an overlap that isn't there.
    overlapsKeybinds: !(
      hot.right <= keybinds.left ||
      hot.left >= keybinds.right ||
      hot.bottom <= keybinds.top ||
      hot.top >= keybinds.bottom
    ),
    withinViewport: hot.left >= 0 && hot.right <= window.innerWidth && hot.bottom <= window.innerHeight,
    labels: slots.map((s) => s.querySelector(".hud-hotbar-name").textContent),
    disabled: slots.map((s) => s.disabled),
  };
});
ok("hotbar has 8 slots", bar.count === 8, bar.labels.join(", "));
ok("slots >= 44px tall", bar.minH >= 44, `${bar.minH}px`);
ok("slots >= 44px wide", bar.minW >= 44, `${bar.minW}px`);
ok("hotbar clears the keybind card", !bar.overlapsKeybinds);
ok("hotbar inside viewport", bar.withinViewport);
// The bar holds items now, not build pieces: an empty slot stays pressable
// because selecting one is how you put your hands down.
ok("the starting kit fills the first slots", bar.labels[0] === "Axe" && bar.labels[1] === "Pickaxe",
  bar.labels.slice(0, 3).join(", "));

// 4. Number key selects once affordable. Grant materials, then press 1.
await page.evaluate(() => {
  const inv = window.__gameDebug.getInventory();
  void inv;
});
await page.evaluate(() => {
  // Chop enough wood for a farm plot by teleporting onto a tree and gathering.
  const node = window.__gameDebug.getResourceNodes().find((n) => n.kind === "tree" && !n.depleted);
  window.__gameDebug.teleportPlayer(node.x + 1, node.z);
});
for (let i = 0; i < 6; i++) {
  await page.keyboard.press("KeyE");
  await page.waitForTimeout(120);
}
const wood = await page.evaluate(
  () => (window.__gameDebug.getInventory().find((s) => s.itemId === "wood") || { qty: 0 }).qty,
);
ok("gathered wood for a plot", wood >= 3, `wood=${wood}`);

// The number keys hold items now: pressing one puts a tool in hand, and the
// slot is marked selected.
await page.keyboard.press("Digit2");
await page.waitForFunction(
  () => window.__gameDebug.getEquippedItem() === "pickaxe",
  null,
  { timeout: 20000 },
);
const held = await page.evaluate(() => ({
  item: window.__gameDebug.getEquippedItem(),
  slot: window.__gameDebug.getEquippedSlot(),
  marked: document.querySelectorAll(".hud-hotbar-slot.selected").length,
  name: document.querySelector(".hud-hotbar-slot.selected .hud-hotbar-name")?.textContent ?? "",
}));
ok("a number key puts that item in hand", held.item === "pickaxe" && held.slot === 1,
  JSON.stringify(held));
ok("exactly one slot reads as selected", held.marked === 1 && held.name === "Pickaxe",
  JSON.stringify(held));

// Building moved to the B panel; the prompt still explains placement.
const waitForFn = async (fn, arg, timeoutMs = 20000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await page.evaluate(fn, arg)) return true;
    await page.waitForTimeout(200);
  }
  return false;
};
const picked = await selectBuilding(page, waitForFn, "Farm Plot", "farm_plot");
await page.waitForTimeout(600);
const prompt = await page.evaluate(() => document.querySelector(".hud-prompt")?.textContent ?? "");
ok("the Build panel selects a Farm Plot", picked);
ok("prompt explains placing", /place|build/i.test(prompt), prompt);

await page.keyboard.press("KeyQ");
await page.waitForFunction(() => window.__gameDebug.getSelectedBuilding() === null, null, { timeout: 20000 });
ok("Q cancels placement", true);

ok("no console/page errors", errors.length === 0, errors.slice(0, 2).join(" | "));

await page.screenshot({ path: "/tmp/claude-0/-home-user-sandsd01/408edaa1-3a98-5fd8-a1af-5e70efacb130/scratchpad/ui-after.png" });
await browser.close();

let pass = 0;
for (const [p, n, d] of results) {
  console.log(`${p ? "PASS" : "FAIL"}  ${n}${d ? "  — " + d : ""}`);
  if (p) pass++;
}
console.log(`\n${pass}/${results.length}`);
process.exit(pass === results.length ? 0 : 1);
