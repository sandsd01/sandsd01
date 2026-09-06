import { chromium, LAUNCH, BASE_URL } from "./harness.mjs";
const results = [];
const ok = (n, p, d = "") => results.push([p, n, d]);

const browser = await chromium.launch({
  ...LAUNCH,
  args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
const failedAssets = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("response", (r) => {
  if (/\.(glb|png)$/.test(r.url()) && r.status() >= 400) failedAssets.push(`${r.status()} ${r.url()}`);
});

await page.goto(BASE_URL, { waitUntil: "load" });
await page.waitForFunction(() => !!window.__gameDebug, null, { timeout: 90000 });

ok("no failed model/texture requests", failedAssets.length === 0, failedAssets.join(", "));

// The splash must actually go away once the world is up.
await page.waitForFunction(() => !document.getElementById("loading"), null, { timeout: 20000 }).catch(() => {});
ok("loading splash is removed", await page.evaluate(() => !document.getElementById("loading")));

// Props should be real models now, not the procedural meshes. A loaded Kenney
// prop carries a material named after the shared colormap atlas.
const scene = await page.evaluate(() => {
  const stats = window.__gameDebug.getRenderStats();
  return { casters: stats.casters, triangles: stats.triangles, drawCalls: stats.drawCalls };
});
ok("world still renders", scene.casters > 50, JSON.stringify(scene));

// Player: the rigged character replaces the box figure, so the player subtree
// should contain a SkinnedMesh.
const player = await page.evaluate(() => window.__gameDebug.getPlayerRig());
ok("player uses the rigged character", player.skinned > 0, JSON.stringify(player));
ok("character animations are loaded", player.clips >= 8, `${player.clips} clips`);

// Walking should switch the clip away from idle.
await page.click("#game-canvas");
await page.waitForFunction(() => window.__gameDebug.isPointerLocked(), null, { timeout: 20000 });
await page.keyboard.down("KeyW");
await page.waitForFunction(() => window.__gameDebug.getPlayerRig().clip === "walk", null, { timeout: 20000 }).catch(() => {});
const walking = await page.evaluate(() => window.__gameDebug.getPlayerRig().clip);
ok("walking plays the walk clip", walking === "walk", walking);

// The clip name only says what the controller intended. Prove the skeleton is
// actually being driven — a mis-bound clone animates nothing and looks
// identical from the state machine's point of view.
const rigStart = await page.evaluate(() => window.__gameDebug.getRigFingerprint());
await page
  .waitForFunction((v) => Math.abs(window.__gameDebug.getRigFingerprint() - v) > 0.01, rigStart, { timeout: 20000 })
  .catch(() => {});
const rigNow = await page.evaluate(() => window.__gameDebug.getRigFingerprint());
ok("the skeleton actually animates", Math.abs(rigNow - rigStart) > 0.01, `${rigStart.toFixed(3)} -> ${rigNow.toFixed(3)}`);

// The character must be visible in front of the camera, not sunk into the
// terrain or scaled to nothing.
const bounds = await page.evaluate(() => window.__gameDebug.getPlayerBounds());
ok("character stands at a sensible height", bounds.height > 1.2 && bounds.height < 2.4, `${bounds.height.toFixed(2)} units`);
ok("character sits on the ground", Math.abs(bounds.minY - bounds.feetY) < 0.25, `base ${bounds.minY.toFixed(2)} vs feet ${bounds.feetY.toFixed(2)}`);

await page.keyboard.down("ShiftLeft");
await page.waitForFunction(() => window.__gameDebug.getPlayerRig().clip === "sprint", null, { timeout: 20000 }).catch(() => {});
const sprinting = await page.evaluate(() => window.__gameDebug.getPlayerRig().clip);
ok("sprinting plays the sprint clip", sprinting === "sprint", sprinting);

// Sprinting must actually cost stamina.
await page.waitForFunction(() => window.__gameDebug.getStamina().current < 95, null, { timeout: 20000 }).catch(() => {});
const drained = await page.evaluate(() => window.__gameDebug.getStamina());
ok("sprinting drains stamina", drained.current < 95, JSON.stringify(drained));

await page.keyboard.up("ShiftLeft");
await page.keyboard.up("KeyW");
await page.waitForFunction(() => window.__gameDebug.getPlayerRig().clip === "idle", null, { timeout: 20000 }).catch(() => {});
ok("standing still returns to idle", (await page.evaluate(() => window.__gameDebug.getPlayerRig().clip)) === "idle");

// Stamina regenerates once you stop.
const low = (await page.evaluate(() => window.__gameDebug.getStamina())).current;
await page.waitForFunction((v) => window.__gameDebug.getStamina().current > v + 2, low, { timeout: 25000 }).catch(() => {});
const regen = (await page.evaluate(() => window.__gameDebug.getStamina())).current;
ok("stamina regenerates when idle", regen > low, `${low.toFixed(1)} -> ${regen.toFixed(1)}`);

ok("no console/page errors", errors.length === 0, errors.slice(0, 3).join(" | "));

await page.screenshot({ path: "/tmp/claude-0/-home-user-sandsd01/408edaa1-3a98-5fd8-a1af-5e70efacb130/scratchpad/models.png" });
await browser.close();

let pass = 0;
for (const [p, n, d] of results) {
  console.log(`${p ? "PASS" : "FAIL"}  ${n}${d ? "  — " + d : ""}`);
  if (p) pass++;
}
console.log(`\n${pass}/${results.length}`);
process.exit(pass === results.length ? 0 : 1);
