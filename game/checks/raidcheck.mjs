import { chromium, LAUNCH, BASE_URL } from "./harness.mjs";
import { editSaveOffline } from "./legacysave.mjs";

// Raid night: is there a night to fear, and does the base answer it?
//
// Before this: enemies were resolved against nothing at all (enemy-ai.ts never
// imported collision.ts), so every wall in the game stopped the player and no
// one else and a base was scenery; the day/night cycle was lighting only; and
// nothing a player built could take a scratch, let alone be repaired.
const URL = BASE_URL;
const DAY_MS = 6 * 60 * 1000;

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

const raidState = () => page.evaluate(() => window.__gameDebug.getRaidState());
const enemies = () => page.evaluate(() => window.__gameDebug.getEnemyPositions());
const qty = (itemId) =>
  page.evaluate(
    (id) =>
      window.__gameDebug.getInventory().reduce((sum, s) => (s.itemId === id ? sum + s.qty : sum), 0),
    itemId,
  );
// Points the camera at a spot by trying the four cardinal yaws and keeping
// whichever actually aims nearest it, rather than assuming which way yaw = pi
// faces. Aiming is what decides the target, so getting it wrong reads as
// "the feature is broken" when it only means the test is looking the wrong way.
async function faceTowards(targetX, targetZ) {
  let best = null;
  for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    // Set, then let a frame go by before reading. The camera only turns on the
    // next update, so setting and reading in one evaluate hands back the
    // PREVIOUS yaw's aim point — which quietly shifts every reading by one and
    // picks the wrong direction while looking entirely reasonable.
    await page.evaluate((y) => window.__gameDebug.setCameraYaw(y), yaw);
    await page.waitForTimeout(500);
    const aim = await page.evaluate(() => window.__gameDebug.getAimPoint());
    const d = Math.hypot(aim.x - targetX, aim.z - targetZ);
    if (!best || d < best.d) best = { yaw, d, aim };
  }
  await page.evaluate((y) => window.__gameDebug.setCameraYaw(y), best.yaw);
  await page.waitForTimeout(500);
  return best;
}

const place = (buildingId, cellX, cellZ) =>
  page.evaluate(
    ([id, x, z]) => window.__gameDebug.placeBuildingAt(id, x, z, 0),
    [buildingId, cellX, cellZ],
  );

await boot({ clear: true });

// --- 1. a fresh world is not raided on its first evening ------------------
const fresh = await raidState();
ok(
  "a fresh world has no raid running and one booked days out",
  fresh.active === false && fresh.msUntilRaid > 2 * DAY_MS,
  `${JSON.stringify(fresh)} (${(fresh.msUntilRaid / DAY_MS).toFixed(2)} days)`,
);

// The banner is a banner, not a permanent gauge: it must be off screen when
// nothing is happening. `hidden` alone does not settle this — the element sets
// `display: flex`, which beats the browser's own `[hidden]` rule, so this asks
// the layout rather than the attribute.
const bannerShown = () =>
  page.evaluate(() => {
    const el = document.querySelector(".hud-raid");
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return getComputedStyle(el).display !== "none" && r.width > 0;
  });
ok("no raid, no banner", (await bannerShown()) === false);

// --- 2. a raid arrives, in waves, and says so ----------------------------
// Somewhere well away from the world origin, which is where the ambient
// spawner puts its wanderers: a wave that ignored the player would land back
// there and never arrive.
await page.evaluate(() => window.__gameDebug.teleportPlayer(140, -140));
await page.waitForTimeout(600);
const before = (await enemies()).length;
await page.evaluate(() => window.__gameDebug.startRaid());
await waitFor(() => window.__gameDebug.getRaidState().raidersAlive >= 4, null, 15000);
const started = await raidState();
ok(
  "starting a raid releases the first wave",
  started.active && started.wave === 1 && started.raidersAlive >= 4,
  JSON.stringify(started),
);

const banner = await page.evaluate(() => {
  const el = document.querySelector(".hud-raid");
  if (!el || getComputedStyle(el).display === "none") return null;
  const r = el.getBoundingClientRect();
  return { text: el.textContent, top: Math.round(r.top), width: Math.round(r.width) };
});
ok(
  "the HUD says a raid is on, in words rather than a colour",
  !!banner && /wave 1\/\d/.test(banner.text ?? ""),
  JSON.stringify(banner),
);

// The banner must not have pushed anything else around. Measured at more than
// one width on purpose: at 1280 there is room for everything, and a check that
// stopped there passed happily while the resource row's wrapped second line
// sat straight across the banner's last two words at 1000.
const readLayout = () =>
  page.evaluate(() => {
    const box = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
    };
    return { time: box(".hud-time"), raid: box(".hud-raid"), res: box(".hud-resources") };
  });
const overlaps = (a, b) =>
  a && b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
for (const width of [1280, 1000, 860]) {
  await page.setViewportSize({ width, height: 720 });
  await page.waitForTimeout(600);
  const layout = await readLayout();
  ok(
    `at ${width}px the banner overlaps neither the clock nor the resource row`,
    !overlaps(layout.raid, layout.time) && !overlaps(layout.raid, layout.res),
    JSON.stringify(layout),
  );
}
await page.setViewportSize({ width: 1280, height: 720 });
await page.waitForTimeout(400);

// --- 3. the wave lands around the player, not around the origin ----------
const near = await page.evaluate(() => {
  const p = window.__gameDebug.getPlayerPosition();
  return window.__gameDebug
    .getEnemyPositions()
    .filter((e) => Math.hypot(e.x - p.x, e.z - p.z) < 45).length;
});
ok(
  "the wave spawns around the player, not around the world origin",
  near >= 4,
  `${near} within 45 units of a player standing at (140, -140); ${before} enemies before`,
);

// --- 4. later waves are bigger and heavier -------------------------------
// The wave timer runs on the world clock, so this skips the wait rather than
// sleeping through two 40-second gaps.
const firstWaveBrutes = (await enemies()).filter((e) => e.enemyId === "brute").length;
for (let i = 0; i < 2; i++) {
  const wave = (await raidState()).wave;
  await page.evaluate(() => window.__gameDebug.advanceClockMs(41000));
  await waitFor((w) => window.__gameDebug.getRaidState().wave > w, wave, 15000);
}
const late = await raidState();
const lateBrutes = (await enemies()).filter((e) => e.enemyId === "brute").length;
ok(
  "a raid fills past the eight-enemy ambient cap",
  late.raidersAlive > 8,
  `${late.raidersAlive} raiders alive on wave ${late.wave}`,
);
ok(
  "later waves bring brutes the first one did not",
  lateBrutes > firstWaveBrutes,
  `${firstWaveBrutes} -> ${lateBrutes} brutes`,
);

// --- 5. dawn ends it, even with raiders left -----------------------------
await page.evaluate(() => window.__gameDebug.advanceClockMs(4 * 60 * 1000));
const ended = await waitFor(() => !window.__gameDebug.getRaidState().active, null, 20000);
const after = await raidState();
ok("the banner goes away when the raid does", (await bannerShown()) === false);
ok(
  "dawn ends the raid even with raiders still standing",
  ended && after.active === false && after.nextRaidAtMs > 0,
  JSON.stringify({ ...after, alive: (await enemies()).length }),
);

// --- 6. enemies no longer walk through walls -----------------------------
await boot({ clear: true });
await page.evaluate(() => window.__gameDebug.teleportPlayer(0, 0));
await page.waitForTimeout(400);
// A long run of walls at x = 4, so a chasing enemy meets it head-on and has
// no end to round inside the time this check allows.
for (let z = -14; z <= 14; z++) await place("wall", 4, z);
const chaser = await page.evaluate(() =>
  window.__gameDebug.spawnEnemyAt("zombie", 9, 0),
);
const chaserAt = async () => {
  const found = (await enemies()).find((e) => e.id === chaser);
  return found ?? null;
};
// First it has to actually come for us — otherwise "never got past the wall"
// would pass for an enemy that simply stood still.
const closed = await waitFor(
  (id) => {
    const e = window.__gameDebug.getEnemyPositions().find((x) => x.id === id);
    return !!e && e.x < 6;
  },
  chaser,
  40000,
);
await page.waitForTimeout(12000);
const stopped = await chaserAt();
ok(
  "an enemy closes on a wall and cannot get past it",
  closed && !!stopped && stopped.x > 4.4,
  `${closed ? "closed" : "never approached"}, ended at x=${stopped ? stopped.x.toFixed(2) : "gone"}`,
);

// --- 7. and takes it out on the wall instead -----------------------------
const wallHit = await page.evaluate((id) => {
  const enemy = window.__gameDebug.getEnemyPositions().find((e) => e.id === id);
  const damaged = window.__gameDebug
    .getPlacedBuildings()
    .filter((b) => b.buildingId === "wall")
    .map((b) => ({ id: b.id, cellZ: b.cellZ, ...window.__gameDebug.getBuildingHealth(b.id) }))
    .filter((b) => b.damage > 0);
  return { enemy, damaged };
}, chaser);
ok(
  "a blocked enemy damages what is in its way",
  wallHit.damaged.length > 0,
  JSON.stringify(wallHit),
);

// --- 8. a wall broken down by raiders pays nothing back ------------------
await boot({ clear: true });
await page.evaluate(() => window.__gameDebug.teleportPlayer(0, 0));
await page.evaluate(() => window.__gameDebug.grantItems({ plank: 40 }));
const victim = await place("wall", 6, 6);
const planksBefore = await qty("plank");
const smashed = await page.evaluate(() => window.__gameDebug.enemyAttackAt(6, 6, 999));
const gone = await page.evaluate(
  (id) => !window.__gameDebug.getPlacedBuildings().some((b) => b.id === id),
  victim,
);
const planksAfter = await qty("plank");
ok(
  "a wall beaten down by raiders is gone and refunds nothing",
  smashed && gone && planksAfter === planksBefore,
  `planks ${planksBefore} -> ${planksAfter}`,
);

// Taking the same wall down yourself still pays, so the two paths really are
// different rather than both being broken.
const mine2 = await place("wall", 6, 8);
const beforeDemolish = await qty("plank");
await page.evaluate((id) => window.__gameDebug.demolishBuilding(id), mine2);
const afterDemolish = await qty("plank");
ok(
  "taking one down yourself still refunds it in full",
  afterDemolish === beforeDemolish + 4,
  `planks ${beforeDemolish} -> ${afterDemolish}`,
);

// --- 9. a smashed barrel spills rather than swallowing its contents ------
const barrel = await place("barrel", -6, 6);
await page.evaluate(
  (id) => window.__gameDebug.depositToContainer(id, "plank", 5),
  barrel,
);
await page.evaluate(() => window.__gameDebug.enemyAttackAt(-6, 6, 999));
const spilled = await page.evaluate(() =>
  window.__gameDebug.getDroppedItems().filter((d) => d.itemId === "plank"),
);
ok(
  "a barrel smashed in a raid spills what was inside it",
  spilled.some((d) => d.qty === 5),
  JSON.stringify(spilled),
);

// --- 10. repair costs what the damage was worth --------------------------
await boot({ clear: true });
await page.evaluate(() => window.__gameDebug.teleportPlayer(0, 0));
await page.evaluate(() => window.__gameDebug.grantItems({ plank: 40 }));
const patchme = await place("wall", 10, 0);
// Half the wall's 120 health, so half of its 4-plank cost is the answer.
await page.evaluate(() => window.__gameDebug.enemyAttackAt(10, 0, 60));
const cost = await page.evaluate((id) => window.__gameDebug.getRepairCost(id), patchme);
const planksBeforeRepair = await qty("plank");
const repaired = await page.evaluate((id) => window.__gameDebug.repairBuilding(id), patchme);
const healthAfter = await page.evaluate((id) => window.__gameDebug.getBuildingHealth(id), patchme);
const planksAfterRepair = await qty("plank");
ok(
  "repair is priced by the damage, not by the whole build cost",
  JSON.stringify(cost) === JSON.stringify([{ itemId: "plank", qty: 2 }]),
  JSON.stringify(cost),
);
ok(
  "repairing spends exactly that and makes the piece whole",
  repaired && healthAfter.damage === 0 && planksAfterRepair === planksBeforeRepair - 2,
  `planks ${planksBeforeRepair} -> ${planksAfterRepair}, damage ${healthAfter.damage}`,
);

// --- 11. and cannot be had for free --------------------------------------
await page.evaluate(() => window.__gameDebug.enemyAttackAt(10, 0, 60));
// Empty the pockets by putting the planks in a barrel — `grantItems` only
// ever adds, and the point here is to have none in hand.
const vault = await place("barrel", 12, 6);
await page.evaluate((id) => {
  const held = window.__gameDebug.getInventory().find((s) => s.itemId === "plank");
  if (held) window.__gameDebug.depositToContainer(id, "plank", held.qty);
}, vault);
const brokeRepair = await page.evaluate((id) => window.__gameDebug.repairBuilding(id), patchme);
const stillDamaged = await page.evaluate(
  (id) => window.__gameDebug.getBuildingHealth(id),
  patchme,
);
const toast = await page.evaluate(() => document.querySelector(".hud-toast")?.textContent ?? "");
ok(
  "a repair you cannot pay for does nothing, and names the item by name",
  brokeRepair === false && stillDamaged.damage > 0 && /Plank/.test(toast),
  `${JSON.stringify(stillDamaged)} toast="${toast}"`,
);

// --- 12. the repair key does it, not just the debug hook -----------------
// On a brick wall rather than the timber one above: the timber wall stands in
// as a 0.35-unit fence model, and the crosshair ray passes clean over the top
// of it from any sensible standing distance. That is a real (if minor) aiming
// problem with low pieces, not a repair problem — testing the key on something
// the ray can actually meet is what keeps this check about the key.
await page.evaluate(() => window.__gameDebug.grantItems({ brick: 20 }));
const keyWall = await place("brick_wall", 14, 0);
await page.evaluate(() => window.__gameDebug.enemyAttackAt(14, 0, 150));
await page.evaluate(() => window.__gameDebug.teleportPlayer(14, -2));
await page.waitForTimeout(500);
const facing = await faceTowards(14, 0);
const aimed = await waitFor(() => {
  const t = window.__gameDebug.getTarget();
  return t.kind === "building" || t.kind === "container";
}, null, 20000);
await page.keyboard.down("KeyG");
const keyRepaired = await waitFor(
  (id) => window.__gameDebug.getBuildingHealth(id)?.damage === 0,
  keyWall,
  30000,
);
await page.keyboard.up("KeyG");
ok(
  "holding the repair key on a damaged wall repairs it",
  aimed && keyRepaired,
  `${aimed ? "aimed" : `never aimed at it (${JSON.stringify(facing)})`}, ${JSON.stringify(
    await page.evaluate((id) => window.__gameDebug.getBuildingHealth(id), keyWall),
  )}`,
);

// --- 13. a raid survives a reload ----------------------------------------
await boot({ clear: true });
await page.evaluate(() => {
  window.__gameDebug.teleportPlayer(0, 0);
  window.__gameDebug.startRaid();
});
await waitFor(() => window.__gameDebug.getRaidState().raidersAlive >= 4, null, 15000);
await page.evaluate(() => window.__gameDebug.saveNow());
await boot();
const resumed = await waitFor(
  () => window.__gameDebug.getRaidState().active && window.__gameDebug.getRaidState().raidersAlive >= 4,
  null,
  20000,
);
const resumedState = await raidState();
ok(
  "reloading mid-raid drops you back into it with a fresh wave",
  resumed && resumedState.active && resumedState.raidersAlive >= 4,
  JSON.stringify(resumedState),
);

// --- 14. an old save is not raided the second it loads -------------------
// Edited offline: the game persists on `beforeunload`, so editing the save and
// then navigating back writes the live state straight over the edit.
await page.evaluate(() => window.__gameDebug.endRaid());
await page.evaluate(() => window.__gameDebug.saveNow());
await editSaveOffline(page, URL, (save) => {
  delete save.raid;
  save.elapsedMs = 12 * 60 * 1000;
  save.placedBuildings = [];
});
await boot();
const legacy = await raidState();
// Read it back off disk, not out of memory: the backfill has to survive being
// written down, and the game only writes on its 10s timer or on unload.
await page.evaluate(() => window.__gameDebug.saveNow());
const legacyKept = await page.evaluate(() => {
  const raw = JSON.parse(localStorage.getItem("romestead-save-v1"));
  return raw.raid;
});
ok(
  "a save written before raids existed is not raided on load",
  legacy.active === false && legacy.msUntilRaid > 2 * DAY_MS,
  `${JSON.stringify(legacy)} (${(legacy.msUntilRaid / DAY_MS).toFixed(2)} days out)`,
);
ok(
  "and is given a schedule of its own that persists",
  !!legacyKept && legacyKept.nextRaidAtMs > 12 * 60 * 1000,
  JSON.stringify(legacyKept),
);

ok("no console/page errors", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length}`);
process.exit(failed.length ? 1 : 0);
