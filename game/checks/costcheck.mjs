import { chromium, LAUNCH, BASE_URL } from "./harness.mjs";
const b = await chromium.launch({ ...LAUNCH, args: ["--use-gl=swiftshader","--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport: { width: 700, height: 460 } });
await p.goto(BASE_URL, { waitUntil: "networkidle" });
await p.waitForFunction(() => !!window.__gameDebug, null, {timeout:30000});
await p.evaluate(() => localStorage.clear());
await p.reload({ waitUntil: "networkidle" });
await p.waitForFunction(() => !!window.__gameDebug, null, {timeout:30000});
await p.waitForTimeout(1500);
await p.keyboard.press("KeyC");
await p.waitForTimeout(1500);
const colors = await p.evaluate(() => {
  const out = [];
  for (const s of document.querySelectorAll(".cost-ok, .cost-short")) {
    out.push({ cls: s.className, text: s.textContent, color: getComputedStyle(s).color });
  }
  return out.slice(0, 4);
});
console.log(colors);
const distinct = new Set(colors.map(c => c.color)).size;
console.log("styled distinctly:", distinct > 1 || (colors.length && colors[0].color !== "rgb(244, 238, 226)"));
await b.close();
