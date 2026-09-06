import { chromium, LAUNCH, BASE_URL } from "./harness.mjs";

// Can you fly, and does the rest of the game notice?
//
// Everything here is driven with **real keys**. `probeMoveTo` teleports, which
// means a flight check written on it would pass with no gravity, no ceiling and
// no flight involved at all — the lesson the floating island taught.
//
// And every "it does X" is paired with "and not otherwise": a portal check that
// only proves flying over one is safe would pass on a build where portals had
// stopped working entirely.
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

const height = () => page.evaluate(() => window.__gameDebug.getHeightAboveGround());
const flying = () => page.evaluate(() => window.__gameDebug.isFlying());

/** Two taps inside the window. Real keys — the whole point of the gesture. */
async function doubleTapJump() {
  for (let i = 0; i < 2; i++) {
    await page.keyboard.down("Space");
    await page.waitForTimeout(60);
    await page.keyboard.up("Space");
    if (i === 0) await page.waitForTimeout(110);
  }
  await page.waitForTimeout(500);
}

/** Holds a key until `done` or the budget runs out. Returns whether it got there. */
async function holdUntil(key, done, budgetMs = 40000) {
  await page.keyboard.down(key);
  const t0 = Date.now();
  try {
    while (Date.now() - t0 < budgetMs) {
      await page.waitForTimeout(400);
      if (await done()) return true;
    }
    return false;
  } finally {
    await page.keyboard.up(key);
    await page.waitForTimeout(300);
  }
}

await boot({ clear: true });
await page.click("#game-canvas");
await page.waitForTimeout(400);

// --- 1. no wings, no flight ----------------------------------------------
// The paired negative half, taken first so it cannot be contaminated by the
// wings being put on later.
await page.evaluate(() => window.__gameDebug.teleportPlayer(0, 8));
await page.waitForTimeout(400);
await doubleTapJump();
const bareFly = await flying();
const bareCeiling = await page.evaluate(() => window.__gameDebug.getFlightCeiling());
ok("with no wings, double-tapping jump does not fly", bareFly === false, String(bareFly));
ok("and nothing reports a ceiling", bareCeiling === 0, String(bareCeiling));
// Let the jump land before the next section.
await page.waitForTimeout(2500);

// --- 2. wings, and the gesture -------------------------------------------
await page.evaluate(() => {
  window.__gameDebug.grantItems({ divine_wings: 1 });
  window.__gameDebug.wearItem("divine_wings");
});
await page.waitForTimeout(400);
const ceiling = await page.evaluate(() => window.__gameDebug.getFlightCeiling());
ok("the wings report a ceiling", ceiling > 0, String(ceiling));

await doubleTapJump();
ok("double-tapping jump with wings starts flight", (await flying()) === true);

// --- 3. it climbs, and it stops ------------------------------------------
const climbed = await holdUntil("Space", async () => (await height()) >= ceiling - 0.5, 90000);
const atTop = await height();
ok("holding jump climbs to the ceiling", climbed, `reached ${atTop.toFixed(2)} of ${ceiling}`);
// The half that makes the climb mean something: it has to STOP.
await page.keyboard.down("Space");
await page.waitForTimeout(4000);
await page.keyboard.up("Space");
const pressed = await height();
ok("and does not go through it", pressed <= ceiling + 0.01,
  `held against the ceiling: ${pressed.toFixed(2)} vs ${ceiling}`);
ok("still flying up there", (await flying()) === true);

// --- 4. sprint descends, and costs nothing -------------------------------
const staminaBefore = await page.evaluate(() => window.__gameDebug.getStamina?.().current ?? null);
const sank = await holdUntil("ShiftLeft", async () => (await height()) < pressed - 3, 40000);
const staminaAfter = await page.evaluate(() => window.__gameDebug.getStamina?.().current ?? null);
ok("sprint sinks you while flying", sank, `${pressed.toFixed(2)} -> ${(await height()).toFixed(2)}`);
// The regression the sprint/descend split exists to prevent.
ok("and descending costs no stamina",
  staminaBefore === null || staminaAfter === null || staminaAfter >= staminaBefore - 0.01,
  `${staminaBefore} -> ${staminaAfter}`);

// --- 5. landing ends it ---------------------------------------------------
const landed = await holdUntil("ShiftLeft", async () => (await height()) < 0.1, 90000);
ok("holding sprint brings you all the way down", landed, `${(await height()).toFixed(2)}`);
ok("touching down ends flight by itself", (await flying()) === false);

// --- 6. taking the wings off mid-air drops you ---------------------------
await doubleTapJump();
await holdUntil("Space", async () => (await height()) > 4, 90000);
const airborne = await height();
ok("back in the air for the next check", airborne > 4 && (await flying()), airborne.toFixed(2));
await page.evaluate(() => window.__gameDebug.takeOffSlot("back"));
await page.waitForTimeout(2500);
const dropped = await height();
ok("taking the wings off in mid-air stops the flight",
  (await flying()) === false, `flying=${await flying()}`);
ok("and you start falling", dropped < airborne, `${airborne.toFixed(2)} -> ${dropped.toFixed(2)}`);

// --- 7. portals are doorways, not columns of sky -------------------------
await boot({ clear: true });
await page.click("#game-canvas");
await page.waitForTimeout(400);
const mouth = await page.evaluate(() =>
  window.__gameDebug.getPortalSites().filter((s) => s.target === "cave")[0]);

// Take off clear of the mouth, climb, and only then cross it. Teleporting on
// top of it first — which the first version of this did — fires the portal at
// ground level before any flying happens, and then reports the height guard
// broken for something that was never tested.
await page.evaluate((m) => {
  window.__gameDebug.grantItems({ divine_wings: 1 });
  window.__gameDebug.wearItem("divine_wings");
  const len = Math.hypot(m.x, m.z) || 1;
  window.__gameDebug.teleportPlayer(m.x - (m.x / len) * 16, m.z - (m.z / len) * 16);
  // Yaw 0 faces -z, so looking from P at T is atan2(-(dx), -(dz)).
  const p = window.__gameDebug.getPlayerPosition();
  window.__gameDebug.setCameraYaw(Math.atan2(-(m.x - p.x), -(m.z - p.z)));
}, mouth);
await page.waitForTimeout(700);
await doubleTapJump();
const climbedOver = await holdUntil("Space", async () => (await height()) > 5, 90000);
ok("airborne well clear of the portal", climbedOver && (await flying()),
  `height=${(await height()).toFixed(2)}`);

// Fly across it. The distance is what says we actually got there — arriving is
// the precondition, not the claim.
const crossed = await holdUntil("KeyW", async () =>
  page.evaluate((m) => {
    const p = window.__gameDebug.getPlayerPosition();
    return Math.hypot(p.x - m.x, p.z - m.z) < 1.5;
  }, mouth), 90000);
const overhead = await page.evaluate((m) => {
  const p = window.__gameDebug.getPlayerPosition();
  return {
    region: window.__gameDebug.getRegion().id,
    distance: Number(Math.hypot(p.x - m.x, p.z - m.z).toFixed(2)),
    height: Number(window.__gameDebug.getHeightAboveGround().toFixed(2)),
  };
}, mouth);
ok("the flight actually passed over the mouth", crossed && overhead.distance < 1.5,
  JSON.stringify(overhead));
ok("flying over a portal does not take you through it", overhead.region === "surface",
  JSON.stringify(overhead));

// And the paired half: on foot it still works. Without this the check above
// would pass on a build where portals had stopped working altogether.
await page.evaluate(() => window.__gameDebug.takeOffSlot("back"));
await holdUntil("ShiftLeft", async () => (await height()) < 0.2, 90000).catch(() => {});
await page.waitForTimeout(3000);
await page.evaluate((m) => {
  const len = Math.hypot(m.x, m.z) || 1;
  window.__gameDebug.teleportPlayer(m.x - (m.x / len) * 12, m.z - (m.z / len) * 12);
}, mouth);
await page.waitForTimeout(500);
await page.evaluate((m) => window.__gameDebug.probeMoveTo(m.x, m.z, 220), mouth);
await page.waitForTimeout(800);
ok("but walking into it still does",
  (await page.evaluate(() => window.__gameDebug.getRegion().id)) === "cave",
  `region=${await page.evaluate(() => window.__gameDebug.getRegion().id)}`);

// --- 8. drops are picked up from the ground, not from the air ------------
await boot({ clear: true });
await page.click("#game-canvas");
await page.waitForTimeout(400);
const pickup = await page.evaluate(() => {
  const d = window.__gameDebug;
  d.teleportPlayer(0, 8);
  d.grantItems({ divine_wings: 1 });
  d.wearItem("divine_wings");
  return { before: (d.getInventory().find((s) => s.itemId === "bone") ?? { qty: 0 }).qty };
});
await doubleTapJump();
await holdUntil("Space", async () => (await height()) > 4, 90000);
// Only now, with the player already up: a drop spawned under their feet while
// they were still standing there is collected on the next frame, and the check
// would be measuring nothing.
await page.evaluate(() => {
  const p = window.__gameDebug.getPlayerPosition();
  window.__gameDebug.spawnDropAt("bone", 1, p.x, p.z);
});
await page.waitForTimeout(2500);
const inAir = await page.evaluate(() => ({
  onFloor: window.__gameDebug.getDroppedItems().length,
  bone: (window.__gameDebug.getInventory().find((s) => s.itemId === "bone") ?? { qty: 0 }).qty,
  height: window.__gameDebug.getHeightAboveGround(),
}));
ok("hovering over a drop does not hoover it up",
  inAir.onFloor > 0 && inAir.bone === pickup.before,
  `${inAir.onFloor} on the floor at height ${inAir.height.toFixed(2)}, bone=${inAir.bone}`);

// Paired: back on the ground it is picked up as it always was.
await holdUntil("ShiftLeft", async () => (await height()) < 0.2, 90000);
await page.waitForTimeout(2500);
const onGround = await page.evaluate(() => ({
  onFloor: window.__gameDebug.getDroppedItems().length,
  bone: (window.__gameDebug.getInventory().find((s) => s.itemId === "bone") ?? { qty: 0 }).qty,
}));
ok("but landing on it picks it up", onGround.bone > pickup.before && onGround.onFloor === 0,
  JSON.stringify(onGround));

// --- 9. the wings show, and only when worn -------------------------------
const wingsVisible = await page.evaluate(() => {
  const d = window.__gameDebug;
  const worn = d.getWingsVisible();
  d.takeOffSlot("back");
  const bare = d.getWingsVisible();
  d.wearItem("divine_wings");
  return { worn, bare, back: d.getWingsVisible() };
});
ok("the wings are on the character while worn", wingsVisible.worn === true);
ok("and gone when taken off", wingsVisible.bare === false, JSON.stringify(wingsVisible));

ok("no console/page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed`);
await browser.close();
process.exit(results.every((r) => r.pass) ? 0 : 1);
