import { chromium, LAUNCH, BASE_URL } from "./harness.mjs";

// The four small things that had been true for a long time and were each a
// line to fix: a raid warning that computed how far away the raid was and
// threw the number away, a clearSave() nothing had ever called, a planting
// prompt that showed a raw item id, and an Inventory panel advertising a key
// that was not the one bound to it.
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

await boot({ clear: true });

// --- 1. the raid warning says something -----------------------------------
// No hook fires the warning directly, on purpose: the point is that the raid
// system's own emit reaches the screen. So wind the clock to just inside the
// warning window and let it arrive by itself.
const warned = await page.evaluate(() => {
  const target = window.__gameDebug.getRaidState().nextRaidAtMs;
  const jump = target - window.__gameDebug.getElapsedMs() - 55_000;
  window.__gameDebug.advanceClockMs(jump);
  return { jump: Math.round(jump), target: Math.round(target) };
});
await page.waitForTimeout(2500);
const warnText = await page.evaluate(() => document.querySelector(".hud-toast")?.textContent ?? "");
ok("the raid warning puts words on screen, not just a horn",
  /raid/i.test(warnText), `toast=${JSON.stringify(warnText)} after ${JSON.stringify(warned)}`);
ok("and it says how far away it is", /minute|incoming/i.test(warnText), JSON.stringify(warnText));

// --- 2. the planting prompt names the seed, not its id --------------------
// A fresh world has no farm plot, and the prompt is for the nearest one — so
// one has to be laid before there is anything to prompt about. (This is what
// the first version of this check got wrong: it read null and reported the
// fix broken, when there was simply nothing to stand at.)
const prompt = await page.evaluate(() => {
  window.__gameDebug.grantItems({ wheat_seed: 4, plank: 20, wood: 20, stone: 20 });
  const p = window.__gameDebug.getPlayerPosition();
  // GRID_CELL_SIZE is 1, so a cell index is a world unit. Dividing by 2 put
  // the plot four units away — outside farming's 2.5-unit interact range, so
  // nearestPlot found nothing and the prompt was legitimately null.
  const cellX = Math.round(p.x);
  const cellZ = Math.round(p.z);
  const placed = window.__gameDebug.placeBuildingAt("farm_plot", cellX, cellZ, 0);
  return { placed, plots: window.__gameDebug.getPlots().length, text: window.__gameDebug.getPlantPrompt("wheat_seed") };
});
ok("a farm plot to stand at", prompt.plots > 0, JSON.stringify(prompt));
ok("the planting prompt exists to check", prompt.text !== null, JSON.stringify(prompt));
ok("it names the seed rather than printing its id",
  typeof prompt.text === "string" && !prompt.text.includes("wheat_seed") && /Wheat Seed/i.test(prompt.text),
  JSON.stringify(prompt.text));

// --- 3. the Inventory panel advertises the key that opens it --------------
await page.keyboard.press("Tab");
await page.waitForTimeout(500);
const invHint = await page.evaluate(() =>
  [...document.querySelectorAll(".panel.visible .panel-hint")].map((e) => e.textContent)[0] ?? "");
ok("the Inventory hint names Tab, the key actually bound to it",
  /Press Tab to close/.test(invHint), JSON.stringify(invHint));
await page.keyboard.press("Tab");
await page.waitForTimeout(300);

// --- 4. a new game really starts a new game -------------------------------
await page.evaluate(() => {
  window.__gameDebug.grantItems({ iron_ore: 42 });
  window.__gameDebug.grantExp(400);
  window.__gameDebug.saveNow();
});
const rich = await page.evaluate(() => ({
  level: window.__gameDebug.getLevel().level,
  iron: (window.__gameDebug.getInventory().find((s) => s.itemId === "iron_ore") ?? { qty: 0 }).qty,
}));
ok("there is something to erase", rich.level > 1 && rich.iron >= 42, JSON.stringify(rich));

await page.keyboard.press("Escape");
await page.waitForTimeout(600);
const armed = await page.evaluate(() => {
  const btn = [...document.querySelectorAll(".panel.visible .panel-danger")][0];
  if (!btn) return { found: false };
  const first = btn.textContent;
  btn.click();
  return { found: true, first, second: btn.textContent };
});
ok("Options carries a new-game button", armed.found, JSON.stringify(armed));
ok("one click arms it rather than wiping straight away",
  armed.second !== armed.first && /again/i.test(armed.second ?? ""), JSON.stringify(armed));

// The world must still be there after only one click.
const stillRich = await page.evaluate(() => window.__gameDebug.getLevel().level);
ok("and the world is still there after one click", stillRich === rich.level, String(stillRich));

await Promise.all([
  page.waitForNavigation({ waitUntil: "load", timeout: 60000 }).catch(() => {}),
  page.evaluate(() => [...document.querySelectorAll(".panel.visible .panel-danger")][0]?.click()),
]);
await page.waitForFunction(() => !!window.__gameDebug, null, { timeout: 120000 });
await page.waitForTimeout(1500);
const fresh = await page.evaluate(() => ({
  level: window.__gameDebug.getLevel().level,
  iron: (window.__gameDebug.getInventory().find((s) => s.itemId === "iron_ore") ?? { qty: 0 }).qty,
}));
ok("the second click starts over", fresh.level === 1 && fresh.iron === 0, JSON.stringify(fresh));
// The trap this had: the reload fires beforeunload, which saves — so without
// suspending the save first the erased world is written straight back.
await boot();
const afterReload = await page.evaluate(() => window.__gameDebug.getLevel().level);
ok("and the old world does not come back on the next load", afterReload === 1, String(afterReload));

ok("no console/page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed`);
await browser.close();
process.exit(results.every((r) => r.pass) ? 0 : 1);
