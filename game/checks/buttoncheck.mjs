import { chromium, LAUNCH, BASE_URL } from "./harness.mjs";
const browser = await chromium.launch({
  ...LAUNCH,
  args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(BASE_URL, { waitUntil: "load" });
await page.waitForFunction(() => !!window.__gameDebug, null, { timeout: 90000 });
await page.keyboard.press("Escape");
await page.waitForFunction(() => document.querySelector(".panel.visible h2")?.textContent === "Options", null, { timeout: 20000 });
const colors = await page.evaluate(() => ({
  key: getComputedStyle(document.querySelector(".panel.visible .panel-key")).backgroundColor,
  reset: getComputedStyle(document.querySelector(".panel.visible .panel-reset")).backgroundColor,
}));
console.log(JSON.stringify(colors));
await page.screenshot({ path: "controls2.png" });
await browser.close();
