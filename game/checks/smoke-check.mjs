import { chromium, LAUNCH, BASE_URL } from "./harness.mjs";

const url = BASE_URL;

const browser = await chromium.launch({ ...LAUNCH });
const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });

const consoleErrors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});
page.on("pageerror", (err) => consoleErrors.push(String(err)));

console.log("Navigating to", url);
await page.goto(url, { waitUntil: "networkidle" });
await page.waitForSelector("#game-canvas");
await page.waitForTimeout(1500);

const canvasSize = await page.evaluate(() => {
  const c = document.getElementById("game-canvas");
  return { width: c.width, height: c.height };
});
console.log("Canvas size:", canvasSize);

const beforePos = await page.evaluate(() => window.__gameDebug.getPlayerPosition());
console.log("Player position before movement:", beforePos);

await page.screenshot({ path: "/tmp/claude-0/-home-user-sandsd01/408edaa1-3a98-5fd8-a1af-5e70efacb130/scratchpad/screenshot-initial.png" });

// Click canvas to acquire pointer lock, then hold W to move forward.
await page.click("#game-canvas");
await page.waitForTimeout(300);
await page.keyboard.down("KeyW");
await page.waitForTimeout(1200);
await page.keyboard.up("KeyW");
await page.waitForTimeout(200);

const afterPos = await page.evaluate(() => window.__gameDebug.getPlayerPosition());
console.log("Player position after W held 1.2s:", afterPos);

const moved = Math.hypot(afterPos.x - beforePos.x, afterPos.z - beforePos.z) > 0.5;
console.log("Player moved meaningfully:", moved);

await page.screenshot({ path: "/tmp/claude-0/-home-user-sandsd01/408edaa1-3a98-5fd8-a1af-5e70efacb130/scratchpad/screenshot-after-move.png" });

console.log("Console errors:", consoleErrors.length ? consoleErrors : "none");

await browser.close();

if (consoleErrors.length > 0) {
  console.error("FAIL: console errors present");
  process.exit(1);
}
if (!moved) {
  console.error("FAIL: player did not move");
  process.exit(1);
}
console.log("PASS");
