import { chromium, LAUNCH, BASE_URL } from "./harness.mjs";
import { editSaveOffline } from "./legacysave.mjs";

// Can a base be lived in as well as hidden behind?
//
// Before this there was no door in the game at all, so a ring of wall was a
// cell: seal it and you are inside for good, leave a gap and the gap is where
// the raiders walk in. And with only melee, standing behind a wall meant not
// fighting — the walls bought time and nothing else.
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

async function waitFor(fn, arg, timeoutMs = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await page.evaluate(fn, arg)) return true;
    await page.waitForTimeout(150);
  }
  return false;
}

async function boot({ clear = false } = {}) {
  await page.goto(URL, { waitUntil: "load" });
  await page.waitForFunction(() => !!window.__gameDebug, null, { timeout: 120000 });
  if (clear) {
    await page.evaluate(() => localStorage.clear());
    await page.goto(URL, { waitUntil: "load" });
    await page.waitForFunction(() => !!window.__gameDebug, null, { timeout: 120000 });
  }
  await page.waitForTimeout(1400);
}

const qty = (itemId) =>
  page.evaluate(
    (id) =>
      window.__gameDebug.getInventory().reduce((sum, s) => (s.itemId === id ? sum + s.qty : sum), 0),
    itemId,
  );
const place = (buildingId, cellX, cellZ) =>
  page.evaluate(
    ([id, x, z]) => window.__gameDebug.placeBuildingAt(id, x, z, 0),
    [buildingId, cellX, cellZ],
  );
const gateId = () =>
  page.evaluate(() => window.__gameDebug.getPlacedBuildings().find((b) => b.buildingId === "gate").id);

/** A wall from z=-14 to 14 at x=4, with a gate in the middle of it. */
async function buildBarrier() {
  await page.evaluate(() => {
    const d = window.__gameDebug;
    d.teleportPlayer(0, 0);
    for (let z = -14; z <= 14; z++) {
      if (z === 0) d.placeBuildingAt("gate", 4, 0, 0);
      else d.placeBuildingAt("wall", 4, z, 0);
    }
  });
  await page.waitForTimeout(500);
}

await boot({ clear: true });
await buildBarrier();

// --- 1. a shut gate is a wall -------------------------------------------
const shutStop = await page.evaluate(() => {
  window.__gameDebug.teleportPlayer(0, 0);
  return window.__gameDebug.probeMoveTo(9, 0);
});
ok(
  "a shut gate stops the player like the wall it sits in",
  shutStop.x < 4,
  `walked to x=${shutStop.x.toFixed(2)} of a target at 9`,
);

// --- 2. an open one is a doorway ----------------------------------------
const gate = await gateId();
await page.evaluate((id) => window.__gameDebug.toggleDoor(id), gate);
await page.waitForTimeout(400);
const openWalk = await page.evaluate(() => {
  window.__gameDebug.teleportPlayer(0, 0);
  return window.__gameDebug.probeMoveTo(9, 0);
});
ok(
  "opening it lets the player through",
  openWalk.x > 8,
  `walked to x=${openWalk.x.toFixed(2)} of a target at 9`,
);

// --- 3. and only through the gate ---------------------------------------
// The walls either side of a propped-open gate must still be solid: `blocksAt`
// feeds every neighbour's `openFaces`, so getting the two out of step reopens
// the diagonal seam that was closed once already.
const besideGate = await page.evaluate(() => {
  window.__gameDebug.teleportPlayer(0, 2);
  return window.__gameDebug.probeMoveTo(9, 2);
});
ok(
  "the wall beside an open gate is still solid",
  besideGate.x < 4,
  `walked to x=${besideGate.x.toFixed(2)} one cell over from the open gate`,
);

// --- 4. a shut gate stops raiders, an open one does not ------------------
await page.evaluate((id) => window.__gameDebug.toggleDoor(id), gate);
await page.evaluate(() => window.__gameDebug.teleportPlayer(0, 0));
const chaser = await page.evaluate(() => window.__gameDebug.spawnEnemyAt("zombie", 9, 0));
const enemyAt = async () =>
  page.evaluate((id) => window.__gameDebug.getEnemyPositions().find((e) => e.id === id) ?? null, chaser);
const closed = await waitFor(
  (id) => {
    const e = window.__gameDebug.getEnemyPositions().find((x) => x.id === id);
    return !!e && e.x < 6;
  },
  chaser,
  40000,
);
await page.waitForTimeout(10000);
const heldOff = await enemyAt();
ok(
  "a shut gate holds a raider out",
  closed && !!heldOff && heldOff.x > 4.4,
  `${closed ? "closed on it" : "never approached"}, stuck at x=${heldOff ? heldOff.x.toFixed(2) : "gone"}`,
);

const gateHealth = await page.evaluate((id) => window.__gameDebug.getBuildingHealth(id), gate);
ok(
  "and gets beaten on for it, exactly as a wall does",
  gateHealth.damage > 0,
  JSON.stringify(gateHealth),
);

await page.evaluate((id) => window.__gameDebug.toggleDoor(id), gate);
const cameThrough = await waitFor(
  (id) => {
    const e = window.__gameDebug.getEnemyPositions().find((x) => x.id === id);
    return !!e && e.x < 3;
  },
  chaser,
  40000,
);
ok(
  "opening it lets the raider walk straight in",
  cameThrough,
  `ended at x=${(await enemyAt())?.x.toFixed(2) ?? "gone"}`,
);

// --- 5. the door remembers which way it was left -------------------------
await page.evaluate(() => window.__gameDebug.saveNow());
await boot();
const afterReload = await page.evaluate(
  (id) => window.__gameDebug.getDoorState(id),
  gate,
);
ok(
  "a gate left open is still open after a reload",
  afterReload?.open === true,
  JSON.stringify(afterReload),
);

// A save from before gates existed holds no doors at all, so "no field" and
// "shut" say the same thing about it — and a door that loaded open would be a
// base that unlocked itself overnight.
await editSaveOffline(page, URL, (save) => {
  for (const b of save.placedBuildings) delete b.open;
});
await boot();
const legacyDoor = await page.evaluate((id) => window.__gameDebug.getDoorState(id), gate);
ok(
  "a save written before gates existed loads them shut",
  legacyDoor?.open === false,
  JSON.stringify(legacyDoor),
);

// --- 6. the bow reaches past the end of a sword --------------------------
await boot({ clear: true });
await page.evaluate(() => {
  const d = window.__gameDebug;
  d.teleportPlayer(0, 0);
  d.grantItems({ bow: 1, arrow: 12, sword: 1 });
  d.holdItem("bow");
});
await page.waitForTimeout(500);

const damageComparison = await page.evaluate(() => {
  const d = window.__gameDebug;
  d.holdItem("bow");
  const bow = d.getHeldDamage();
  d.holdItem("sword");
  const sword = d.getHeldDamage();
  d.selectHotbarSlot(7);
  const empty = d.getHeldDamage();
  d.holdItem("bow");
  return { bow, sword, empty };
});
ok(
  "a bow swung as a club is worth no more than a fist",
  damageComparison.bow === damageComparison.empty && damageComparison.bow < damageComparison.sword,
  JSON.stringify(damageComparison),
);

const arrowsBefore = await qty("arrow");
const fired = await page.evaluate(() => window.__gameDebug.shootArrow());
const flying = await waitFor(() => window.__gameDebug.getArrowsInFlight() > 0, null, 4000);
const arrowsAfter = await qty("arrow");
ok(
  "firing spends an arrow and puts one in the air",
  fired && flying && arrowsAfter === arrowsBefore - 1,
  `arrows ${arrowsBefore} -> ${arrowsAfter}, in flight ${await page.evaluate(() => window.__gameDebug.getArrowsInFlight())}`,
);

// It has to *travel*: a hitscan dressed up as a projectile would be gone by
// the next frame, and the arc is the whole reason for shooting over a wall.
// Fired inside the measurement — reusing the arrow from the check above meant
// timing the tail end of a flight that had already finished, which reads as
// "arrows do not fly" when they plainly do.
// The draw cooldown is counted on the *game* clock, and under software
// rendering that clock runs about five times slower than the wall clock — so
// "wait 1.2 seconds" cleared barely a quarter of a 700ms draw and the shot
// was silently swallowed. Push the clock instead of sleeping against it.
await page.evaluate(() => window.__gameDebug.advanceClockMs(2000));
const travelled = await page.evaluate(async () => {
  const d = window.__gameDebug;
  d.holdItem("bow");
  d.shootArrow();
  let frames = 0;
  for (let i = 0; i < 120; i++) {
    if (d.getArrowsInFlight() === 0) break;
    frames++;
    await new Promise((r) => requestAnimationFrame(r));
  }
  return frames;
});
ok("the arrow is in the air for more than a single frame", travelled > 2, `${travelled} frames`);

const landedDrop = await waitFor(
  () => window.__gameDebug.getDroppedItems().some((d) => d.itemId === "arrow"),
  null,
  15000,
);
const spent = await page.evaluate(() =>
  window.__gameDebug.getDroppedItems().filter((d) => d.itemId === "arrow"),
);
ok(
  "a spent arrow lands on the ground where it fell",
  landedDrop && spent.length > 0,
  JSON.stringify(spent),
);

// And can be walked over and picked back up, which is what makes ammunition a
// loop rather than a countdown.
const before = await qty("arrow");
await page.evaluate((d) => window.__gameDebug.teleportPlayer(d.x, d.z), spent[0]);
const recovered = await waitFor((n) => {
  const held = window.__gameDebug
    .getInventory()
    .reduce((sum, s) => (s.itemId === "arrow" ? sum + s.qty : sum), 0);
  return held > n;
}, before, 15000);
ok("and can be picked up again", recovered, `arrows ${before} -> ${await qty("arrow")}`);

// --- 7. shooting something, from further off than a sword reaches --------
await page.evaluate(() => window.__gameDebug.teleportPlayer(0, 0));
await page.waitForTimeout(400);
const shotTarget = await page.evaluate(async () => {
  const d = window.__gameDebug;
  d.holdItem("bow");
  const p = d.getPlayerPosition();
  const aim = d.getAimPoint();
  // Straight down the barrel, six units out — well past the sword's 2.2.
  const len = Math.hypot(aim.x - p.x, aim.z - p.z) || 1;
  const x = p.x + ((aim.x - p.x) / len) * 6;
  const z = p.z + ((aim.z - p.z) / len) * 6;
  const id = d.spawnEnemyAt("zombie", x, z);
  const start = d.getEnemyPositions().find((e) => e.id === id);
  d.advanceClockMs(2000);
  d.shootArrow();
  for (let i = 0; i < 90; i++) {
    const now = d.getEnemyPositions().find((e) => e.id === id);
    if (!now || now.health < start.health) {
      return { hit: true, from: Math.hypot(x - p.x, z - p.z), health: now ? now.health : 0 };
    }
    await new Promise((r) => requestAnimationFrame(r));
  }
  return { hit: false, from: Math.hypot(x - p.x, z - p.z), health: start.health };
});
ok(
  "an arrow wounds an enemy from beyond a sword's reach",
  shotTarget.hit && shotTarget.from > 2.2,
  JSON.stringify(shotTarget),
);

// --- 8. and cannot be fired on an empty quiver --------------------------
await page.evaluate(() => {
  const d = window.__gameDebug;
  d.holdItem("bow");
  const held = d.getInventory().find((s) => s.itemId === "arrow");
  if (held) d.placeBuildingAt("barrel", -8, -8, 0);
});
await page.evaluate(() => {
  const d = window.__gameDebug;
  const barrel = d.getPlacedBuildings().find((b) => b.buildingId === "barrel");
  const held = d.getInventory().find((s) => s.itemId === "arrow");
  if (held && barrel) d.depositToContainer(barrel.id, "arrow", held.qty);
});
await page.evaluate(() => window.__gameDebug.advanceClockMs(2000));
const inFlightBefore = await page.evaluate(() => window.__gameDebug.getArrowsInFlight());
await page.evaluate(() => window.__gameDebug.shootArrow());
await page.waitForTimeout(300);
const emptyShot = await page.evaluate(() => ({
  arrows: window.__gameDebug.getInventory().filter((s) => s.itemId === "arrow"),
  inFlight: window.__gameDebug.getArrowsInFlight(),
  toast: document.querySelector(".hud-toast")?.textContent ?? "",
}));
ok(
  "an empty quiver fires nothing, and says so by name",
  emptyShot.arrows.length === 0 &&
    emptyShot.inFlight <= inFlightBefore &&
    /Arrow/.test(emptyShot.toast),
  JSON.stringify(emptyShot),
);

// --- 9. spike traps ------------------------------------------------------
await boot({ clear: true });
// The world scatters trees and boulders around spawn, and they are collidable.
// Walking a lane that happens to contain one and calling the result "the trap
// blocked me" is how this check first went red against a trap that blocks
// nothing — so pick a lane with nothing else standing in it.
const lane = await page.evaluate(() => {
  const d = window.__gameDebug;
  // Everything `getCollidables` is built from: scattered nodes AND placed
  // buildings, which includes the world's own POI barrels. Scanning only the
  // nodes is what let this pick a lane with a barrel sitting in it and then
  // report the trap as the thing that had blocked the way.
  const blockers = [
    ...d.getResourceNodes().filter((n) => !n.depleted).map((n) => ({ x: n.x, z: n.z })),
    ...d.getPlacedBuildings().map((b) => ({ x: b.cellX, z: b.cellZ })),
  ];
  for (let z = 0; Math.abs(z) <= 40; z = z > 0 ? -z : -z + 2) {
    const clear = blockers.every(
      (b) => b.x < -3 || b.x > 9 || Math.abs(b.z - z) > 2.5,
    );
    if (clear) return z;
  }
  return null;
});
await page.evaluate((z) => {
  const d = window.__gameDebug;
  d.teleportPlayer(0, z);
  d.grantItems({ wood: 40, stone: 40 });
  d.placeBuildingAt("spike_trap", 3, z, 0);
}, lane);
await page.waitForTimeout(400);
const trapId = await page.evaluate(
  () => window.__gameDebug.getPlacedBuildings().find((b) => b.buildingId === "spike_trap").id,
);

// Underfoot, not in the way: a trap that blocked would just be a short wall.
const overTrap = await page.evaluate((z) => {
  window.__gameDebug.teleportPlayer(0, z);
  return window.__gameDebug.probeMoveTo(7, z);
}, lane);
ok(
  "a trap is walked over, not walked around",
  lane !== null && overTrap.x > 6,
  `lane z=${lane}, walked to x=${overTrap.x.toFixed(2)} across a trap at x=3`,
);

// Standing on your own spikes must cost nothing: at night, on the way back
// through your own gate, you cannot see which tile is which.
await page.evaluate((z) => window.__gameDebug.teleportPlayer(3, z), lane);
await page.waitForTimeout(6000);
const playerOnTrap = await page.evaluate(() => window.__gameDebug.getPlayerPosition() && {
  health: window.__gameDebug.getInventory() && document.querySelector(".hud-health-bar-fill").style.width,
});
const playerHealth = await page.evaluate(() =>
  Number(document.querySelector(".hud-health-bar-fill").style.width.replace("%", "")),
);
ok(
  "standing on your own spikes costs the player nothing",
  playerHealth === 100,
  `health bar at ${JSON.stringify(playerOnTrap)}`,
);

// A raider crossing one does pay.
await page.evaluate((z) => window.__gameDebug.teleportPlayer(-6, z), lane);
await page.waitForTimeout(400);
const victim = await page.evaluate((z) => window.__gameDebug.spawnEnemyAt("zombie", 3, z), lane);
const hurt = await waitFor(
  (id) => {
    const e = window.__gameDebug.getEnemyPositions().find((x) => x.id === id);
    return !e || e.health < 30;
  },
  victim,
  25000,
);
ok(
  "a raider standing on one bleeds for it",
  hurt,
  JSON.stringify(await page.evaluate((id) => window.__gameDebug.getEnemyPositions().find((e) => e.id === id) ?? "dead", victim)),
);

const trapWear = await page.evaluate((id) => window.__gameDebug.getBuildingHealth(id), trapId);
ok(
  "and the trap itself never wears out",
  trapWear.damage === 0,
  JSON.stringify(trapWear),
);

ok("no console/page errors", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length}`);
process.exit(failed.length ? 1 : 0);
