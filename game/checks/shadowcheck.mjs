import { chromium, LAUNCH, BASE_URL } from "./harness.mjs";
const b = await chromium.launch({ ...LAUNCH, args: ["--use-gl=swiftshader","--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport: { width: 1100, height: 640 } });
p.on("pageerror", e => console.log("[pageerror]", e.message));
await p.goto(BASE_URL, { waitUntil: "networkidle" });
await p.waitForFunction(() => !!window.__gameDebug, null, {timeout:15000});
await p.evaluate(() => localStorage.clear());
await p.reload({ waitUntil: "networkidle" });
await p.waitForFunction(() => !!window.__gameDebug, null, {timeout:15000});
await p.waitForTimeout(1200);
// Low morning sun => long shadows.
await p.evaluate(() => window.__gameDebug.setTimeOfDayFraction(0.31));
// Stand right beside the nearest tree to spawn.
const t = await p.evaluate(() => {
  const n = window.__gameDebug.getResourceNodes()
    .filter(n => n.kind === "tree" && !n.depleted)
    .sort((a,b)=>Math.hypot(a.x,a.z)-Math.hypot(b.x,b.z))[0];
  window.__gameDebug.teleportPlayer(n.x + 3, n.z + 3);
  return n;
});
console.log("tree at", t.x.toFixed(1), t.z.toFixed(1));
await p.waitForTimeout(900);
await p.screenshot({ path: "shadowcheck.png" });
console.log("wrote shadowcheck.png");
await b.close();
