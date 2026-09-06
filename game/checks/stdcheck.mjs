import { chromium, LAUNCH, BASE_URL } from "./harness.mjs";

const results = [];
const ok = (n, p, d = "") => results.push([p, n, d]);
const visible = () => document.querySelectorAll(".panel.visible").length;

const browser = await chromium.launch({
  ...LAUNCH,
  args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

await page.goto(BASE_URL, { waitUntil: "load" });
await page.waitForFunction(() => !!window.__gameDebug, null, { timeout: 60000 });

const countVisible = () => page.evaluate(visible);

// --- Menu conventions -------------------------------------------------
await page.keyboard.press("Escape");
await page.waitForFunction(() => document.querySelector(".panel.visible h2")?.textContent === "Options", null, { timeout: 20000 });
ok("Escape opens Options when nothing is open", true);

await page.keyboard.press("Escape");
await page.waitForFunction(() => document.querySelectorAll(".panel.visible").length === 0, null, { timeout: 20000 });
ok("Escape closes the open panel", true);

await page.keyboard.press("Tab");
await page.waitForFunction(() => document.querySelector(".panel.visible h2")?.textContent === "Inventory", null, { timeout: 20000 });
ok("Tab opens the inventory", true);

// Opening another menu must replace it, not stack on top.
await page.keyboard.press("KeyC");
await page.waitForFunction(() => document.querySelector(".panel.visible h2")?.textContent === "Crafting", null, { timeout: 20000 });
ok("menus are mutually exclusive", (await countVisible()) === 1, `${await countVisible()} visible`);

// --- Movement pauses behind a menu ------------------------------------
const before = await page.evaluate(() => window.__gameDebug.getPlayerPosition());
await page.keyboard.down("KeyW");
await page.waitForTimeout(1500);
await page.keyboard.up("KeyW");
const during = await page.evaluate(() => window.__gameDebug.getPlayerPosition());
const movedWithMenu = Math.hypot(during.x - before.x, during.z - before.z);
ok("W does not walk while a menu is open", movedWithMenu < 0.05, `moved ${movedWithMenu.toFixed(3)}`);

await page.keyboard.press("Escape");
await page.waitForFunction(() => document.querySelectorAll(".panel.visible").length === 0, null, { timeout: 20000 });

// --- Jump --------------------------------------------------------------
await page.evaluate(() => window.__gameDebug.teleportPlayer(0, 6));
const groundY = await page.evaluate(() => window.__gameDebug.terrainHeightAt(0, 6));
await page.keyboard.press("Space");
let peak = -Infinity;
const deadline = Date.now() + 15000;
while (Date.now() < deadline) {
  const p = await page.evaluate(() => window.__gameDebug.getPlayerPosition());
  peak = Math.max(peak, p.y);
  if (peak > groundY + 0.3) break;
}
ok("Space jumps", peak > groundY + 0.3, `peak ${(peak - groundY).toFixed(2)} above ground`);

await page.waitForFunction(
  (g) => Math.abs(window.__gameDebug.getPlayerPosition().y - g) < 0.05,
  groundY,
  { timeout: 20000 },
);
ok("gravity returns the player to the ground", true);

// --- Look options -------------------------------------------------------
await page.click("#game-canvas");
await page.waitForFunction(() => window.__gameDebug.isPointerLocked(), null, { timeout: 20000 });

async function pitchDeltaForMouseDown() {
  const start = await page.evaluate(() => window.__gameDebug.getCameraPitch());
  for (let i = 0; i < 12; i++) await page.mouse.move(640, 360 + i * 8);
  await page.waitForTimeout(400);
  const end = await page.evaluate(() => window.__gameDebug.getCameraPitch());
  return end - start;
}

const normal = await pitchDeltaForMouseDown();
ok("default look is not inverted", normal > 0, `pitch ${normal.toFixed(3)}`);

await page.keyboard.press("Escape");
await page.waitForFunction(() => document.querySelector(".panel.visible h2")?.textContent === "Options", null, { timeout: 20000 });
await page.click(".panel.visible .panel-row button");
const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("romestead-settings-v1")));
ok("invert setting persists", stored.invertY === true, JSON.stringify(stored));

await page.keyboard.press("Escape");
await page.waitForFunction(() => document.querySelectorAll(".panel.visible").length === 0, null, { timeout: 20000 });
await page.click("#game-canvas");
await page.waitForFunction(() => window.__gameDebug.isPointerLocked(), null, { timeout: 20000 });
const inverted = await pitchDeltaForMouseDown();
ok("invert Y flips the vertical axis", inverted < 0, `pitch ${inverted.toFixed(3)}`);

// Sensitivity is stored and clamped.
await page.evaluate(() => {
  localStorage.setItem("romestead-settings-v1", JSON.stringify({ mouseSensitivity: 99, invertY: false }));
});
await page.reload({ waitUntil: "load" });
await page.waitForFunction(() => !!window.__gameDebug, null, { timeout: 60000 });
await page.keyboard.press("Escape");
await page.waitForFunction(() => document.querySelector(".panel.visible h2")?.textContent === "Options", null, { timeout: 20000 });
const slider = await page.evaluate(() => Number(document.querySelector(".panel-slider").value));
ok("absurd stored sensitivity is clamped", slider === 3, `slider=${slider}`);

ok("no console/page errors", errors.length === 0, errors.slice(0, 2).join(" | "));

await page.screenshot({ path: "/tmp/claude-0/-home-user-sandsd01/408edaa1-3a98-5fd8-a1af-5e70efacb130/scratchpad/options.png" });
await browser.close();

let pass = 0;
for (const [p, n, d] of results) {
  console.log(`${p ? "PASS" : "FAIL"}  ${n}${d ? "  — " + d : ""}`);
  if (p) pass++;
}
console.log(`\n${pass}/${results.length}`);
process.exit(pass === results.length ? 0 : 1);
