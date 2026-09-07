import { chromium, LAUNCH, BASE_URL, lookBy } from "./harness.mjs";

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

/**
 * Moves the mouse down and reports how far the camera pitched.
 *
 * Waits for the pitch to actually *move* rather than for a fixed 400ms. The
 * fixed wait is what this helper used to do, and it made the two look cases
 * the most fragile in the whole battery: the game applies mouse deltas on its
 * animation frame, and under software rendering with no GPU a frame can take
 * longer than 400ms on its own — so the second read happened before the first
 * frame that would have moved anything, and both cases reported a flat
 * `pitch 0.000`. Nothing was wrong with the game; the check was reading too
 * early. Measured on this sandbox, `mousecheck` and `stdcheck` scored
 * identically on `main` and on a feature branch (10/12, `pitch 0.000` both
 * times) while the same suite had passed an hour earlier at roughly half the
 * wall-clock time.
 *
 * A timeout here still fails the case rather than throwing: `null` says the
 * camera never moved at all, which is a genuine failure and is what the
 * caller reports.
 */
/**
 * Puts the pitch somewhere it can move in both directions before measuring.
 *
 * Third person clamps pitch to [-0.65, 1.1], and by the time this section
 * runs the camera is sitting at the top of that range — so a downward gesture
 * had nowhere to go and reported "the camera never moved", while the very same
 * gesture with invert on moved freely and passed. One case failing and its
 * mirror passing is what gave this away; it looked like a look bug and was a
 * starting position.
 *
 * Pins to the bottom of the range first (any large upward movement will do,
 * the clamp does the rest), then steps back down until there is room on both
 * sides. Stepping rather than computing, because the conversion from mouse
 * movement to radians runs through the player's sensitivity setting and this
 * should not have to know it.
 */
async function centrePitch() {
  await lookBy(page, 0, -600);
  for (let i = 0; i < 25; i++) {
    const pitch = await page.evaluate(() => window.__gameDebug.getCameraPitch());
    if (pitch > -0.2) return pitch;
    await lookBy(page, 0, 60, 4);
    await page.waitForTimeout(120);
  }
  return page.evaluate(() => window.__gameDebug.getCameraPitch());
}

async function pitchDeltaForMouseDown() {
  await centrePitch();
  const start = await page.evaluate(() => window.__gameDebug.getCameraPitch());
  await lookBy(page, 0, 96);
  try {
    await page.waitForFunction(
      (from) => Math.abs(window.__gameDebug.getCameraPitch() - from) > 1e-4,
      start,
      { timeout: 20000 },
    );
  } catch {
    return null;
  }
  // Waiting only proves it started moving. Let the rest of the gesture land
  // before reading, so the number is the whole movement rather than the first
  // frame of it — settled by watching the value stop changing.
  let last = null;
  for (let i = 0; i < 40; i++) {
    const now = await page.evaluate(() => window.__gameDebug.getCameraPitch());
    if (last !== null && Math.abs(now - last) < 1e-4) break;
    last = now;
    await page.waitForTimeout(100);
  }
  return last - start;
}

const normal = await pitchDeltaForMouseDown();
ok(
  "default look is not inverted",
  normal !== null && normal > 0,
  normal === null ? "the camera never moved" : `pitch ${normal.toFixed(3)}`,
);

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
ok(
  "invert Y flips the vertical axis",
  inverted !== null && inverted < 0,
  inverted === null ? "the camera never moved" : `pitch ${inverted.toFixed(3)}`,
);

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
