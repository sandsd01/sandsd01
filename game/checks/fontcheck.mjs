import { chromium, LAUNCH, BASE_URL } from "./harness.mjs";
const browser = await chromium.launch({
  ...LAUNCH,
  args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const woff = [];
page.on("response", (r) => /\.woff2?(\?|$)/.test(r.url()) && woff.push([r.status(), r.url().split("/").pop()]));
await page.goto(BASE_URL, { waitUntil: "load" });
await page.waitForFunction(() => !!window.__gameDebug, null, { timeout: 60000 });
await page.evaluate(() => document.fonts.ready);
console.log("before opening a panel:", await page.evaluate(() => document.fonts.check('700 16px "Cinzel"')));

await page.keyboard.press("KeyC");
await page.waitForFunction(() => document.querySelector(".panel.visible"), null, { timeout: 20000 });
await page.evaluate(() => document.fonts.ready);
await page.waitForFunction(() => document.fonts.check('700 16px "Cinzel"'), null, { timeout: 20000 }).catch(() => {});

const after = await page.evaluate(() => {
  const h = document.querySelector(".panel.visible h2");
  return {
    check: document.fonts.check('700 16px "Cinzel"'),
    family: getComputedStyle(h).fontFamily,
    width: h.getBoundingClientRect().width,
    text: h.textContent,
  };
});
console.log("after opening a panel:", JSON.stringify(after));
console.log("woff responses:", JSON.stringify(woff));
await page.screenshot({ path: "panel-open.png" });
await browser.close();
