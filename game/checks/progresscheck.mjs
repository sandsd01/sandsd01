import { chromium, LAUNCH, BASE_URL } from "./harness.mjs";
import { editSaveOffline } from "./legacysave.mjs";

// Does the game go anywhere?
//
// Before this the raid schedule was a fixed three-wave array — raid 3 and raid
// 30 were the same night — the save had no idea how many the player had lived
// through, and `PlayerState` held health and stamina and nothing else, so the
// ceiling of the whole character was an iron sword.
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

const raidState = () => page.evaluate(() => window.__gameDebug.getRaidState());
const health = () => page.evaluate(() => window.__gameDebug.getHealth().current);
const qty = (itemId) =>
  page.evaluate(
    (id) =>
      window.__gameDebug.getInventory().reduce((sum, s) => (s.itemId === id ? sum + s.qty : sum), 0),
    itemId,
  );

/** Runs one raid at difficulty `n` and reports what actually turned up. */
async function observeRaid(n) {
  await page.evaluate((count) => {
    const d = window.__gameDebug;
    d.setRaidCount(count - 1);
    d.teleportPlayer(200, 200);
    d.startRaid();
  }, n);
  await waitFor(() => window.__gameDebug.getRaidState().raidersAlive > 0, null, 15000);
  const totalWaves = (await raidState()).totalWaves;
  let peak = 0;
  let brutes = 0;
  // Push the clock rather than sleeping: the wave timer is on the game clock,
  // which under software rendering runs about five times slower than the wall.
  for (let w = 0; w < totalWaves + 1; w++) {
    const seen = await page.evaluate(() => {
      const es = window.__gameDebug.getEnemyPositions();
      return { n: es.length, brutes: es.filter((e) => e.enemyId === "brute").length };
    });
    peak = Math.max(peak, seen.n);
    brutes = Math.max(brutes, seen.brutes);
    const wave = (await raidState()).wave;
    await page.evaluate(() => window.__gameDebug.advanceClockMs(45000));
    await waitFor((prev) => {
      const r = window.__gameDebug.getRaidState();
      return !r.active || r.wave > prev;
    }, wave, 15000);
    if (!(await raidState()).active) break;
  }
  const final = await page.evaluate(() => {
    const es = window.__gameDebug.getEnemyPositions();
    return { n: es.length, brutes: es.filter((e) => e.enemyId === "brute").length };
  });
  peak = Math.max(peak, final.n);
  brutes = Math.max(brutes, final.brutes);
  await page.evaluate(() => window.__gameDebug.endRaid());
  return { totalWaves, peak, brutes };
}

await boot({ clear: true });

// --- 1. the counter starts at nothing and moves ---------------------------
const fresh = await raidState();
ok(
  "a fresh world has survived nothing and faces raid 1",
  fresh.count === 0 && fresh.raid === 1,
  JSON.stringify({ count: fresh.count, raid: fresh.raid }),
);

await page.evaluate(() => {
  window.__gameDebug.teleportPlayer(200, 200);
  window.__gameDebug.startRaid();
});
await waitFor(() => window.__gameDebug.getRaidState().active, null, 10000);
await page.evaluate(() => window.__gameDebug.endRaid());
const afterOne = await raidState();
ok(
  "seeing a raid through counts it",
  afterOne.count === 1 && afterOne.raid === 2,
  JSON.stringify({ count: afterOne.count, raid: afterOne.raid }),
);

// --- 2. and is remembered ------------------------------------------------
await page.evaluate(() => window.__gameDebug.saveNow());
await boot();
ok("the count survives a reload", (await raidState()).count === 1, JSON.stringify(await raidState()));

// A save from before raids existed at all.
await editSaveOffline(page, URL, (save) => {
  delete save.raid;
});
await boot();
ok(
  "a save from before raids existed loads at nothing survived",
  (await raidState()).count === 0,
  JSON.stringify(await raidState()),
);

// And the easier one to miss: a save that HAS a raid record but predates the
// counter, which the whole-object guard in backfillDefaults skips over.
await page.evaluate(() => window.__gameDebug.saveNow());
await editSaveOffline(page, URL, (save) => {
  delete save.raid.count;
});
await boot();
const midLegacy = await raidState();
ok(
  "a save with a raid record but no counter is backfilled too",
  midLegacy.count === 0 && midLegacy.raid === 1,
  JSON.stringify(midLegacy),
);

// --- 3. later raids are bigger nights ------------------------------------
await boot({ clear: true });
const early = await observeRaid(1);
const late = await observeRaid(10);
ok(
  "raid 10 sends more waves than raid 1",
  late.totalWaves > early.totalWaves,
  `${early.totalWaves} -> ${late.totalWaves} waves`,
);
ok(
  "and puts more brutes on the field",
  late.brutes > early.brutes,
  `${early.brutes} -> ${late.brutes} brutes at once`,
);

// The concurrency cap is there to keep the frame rate honest and must hold
// however far the schedule has escalated.
const veryLate = await observeRaid(20);
ok(
  "the eighteen-enemy cap still holds at raid 20",
  veryLate.peak <= 18,
  `peak ${veryLate.peak} on the field (raid 1 peaked at ${early.peak})`,
);
ok(
  "and raid 20 is still a heavier night than raid 1",
  veryLate.totalWaves > early.totalWaves && veryLate.peak > early.peak,
  `waves ${early.totalWaves} -> ${veryLate.totalWaves}, peak ${early.peak} -> ${veryLate.peak}`,
);

// --- 4. armour --------------------------------------------------------------
await boot({ clear: true });
await page.evaluate(() => {
  window.__gameDebug.teleportPlayer(200, 200);
  window.__gameDebug.grantItems({ hide_armour: 1, iron_armour: 1 });
});
await page.waitForTimeout(400);

const bare = await page.evaluate(() => {
  const d = window.__gameDebug;
  const before = d.getHealth().current;
  d.hurtPlayer(20);
  return before - d.getHealth().current;
});
const inHide = await page.evaluate(() => {
  const d = window.__gameDebug;
  d.wearItem("hide_armour");
  const before = d.getHealth().current;
  d.hurtPlayer(20);
  return before - d.getHealth().current;
});
const inIron = await page.evaluate(() => {
  const d = window.__gameDebug;
  d.wearItem("iron_armour");
  const before = d.getHealth().current;
  d.hurtPlayer(20);
  return before - d.getHealth().current;
});
ok(
  "hide armour takes the edge off a hit",
  inHide < bare,
  `bare ${bare} -> hide ${inHide} from the same 20`,
);
ok("iron takes more off than hide", inIron < inHide, `hide ${inHide} -> iron ${inIron}`);

const floored = await page.evaluate(() => {
  const d = window.__gameDebug;
  const before = d.getHealth().current;
  d.hurtPlayer(1);
  return before - d.getHealth().current;
});
ok(
  "but nothing makes you untouchable",
  floored >= 1,
  `a 1-damage hit in iron cost ${floored}`,
);

// --- 5. it does not wear out and does not duplicate ----------------------
const beforeHits = await page.evaluate(() => window.__gameDebug.getWorn().armour);
await page.evaluate(() => {
  for (let i = 0; i < 40; i++) window.__gameDebug.hurtPlayer(1);
});
const afterHits = await page.evaluate(() => window.__gameDebug.getWorn().armour);
ok(
  "armour never wears out",
  beforeHits === "iron_armour" && afterHits === "iron_armour",
  `${beforeHits} -> ${afterHits} after 40 hits`,
);

const inBagWhileWorn = await qty("iron_armour");
await page.evaluate(() => window.__gameDebug.takeOffSlot("armour"));
const inBagAfter = await qty("iron_armour");
ok(
  "worn armour is out of the bag, and comes back when taken off",
  inBagWhileWorn === 0 && inBagAfter === 1,
  `in bag while worn ${inBagWhileWorn}, after taking off ${inBagAfter}`,
);

// --- 6. and is remembered ------------------------------------------------
await page.evaluate(() => {
  window.__gameDebug.wearItem("hide_armour");
  window.__gameDebug.saveNow();
});
await boot();
ok(
  "what you were wearing is still on after a reload",
  (await page.evaluate(() => window.__gameDebug.getWorn().armour)) === "hide_armour",
  String(await page.evaluate(() => window.__gameDebug.getWorn().armour)),
);

// --- 7. and the player can see all of it ---------------------------------
const chip = await page.evaluate(() => {
  const el = document.querySelector(".hud-armour");
  if (!el || getComputedStyle(el).display === "none") return null;
  return el.textContent;
});
ok(
  "the HUD says what is being worn, in words",
  !!chip && /Hide Armour/.test(chip) && /%/.test(chip),
  JSON.stringify(chip),
);

// The Wear button in the bag, not just the debug hook.
await page.evaluate(() => window.__gameDebug.takeOffSlot("armour"));
await page.keyboard.press("Tab");
await waitFor(() => [...document.querySelectorAll(".panel.visible h2")]
  .some((h) => h.textContent === "Inventory"));
const wore = await page.evaluate(() => {
  const panel = [...document.querySelectorAll(".panel.visible")].find(
    (p) => p.querySelector("h2")?.textContent === "Inventory");
  const row = [...panel.querySelectorAll(".panel-row")].find(
    (r) => r.querySelector(".panel-row-title")?.textContent === "Hide Armour");
  const button = [...(row?.querySelectorAll("button") ?? [])].find((b) =>
    /^Wear/.test(b.textContent ?? ""));
  button?.click();
  return window.__gameDebug.getWorn().armour;
});
ok("the Wear button in the bag works", wore === "hide_armour", String(wore));

await page.keyboard.press("Tab");
await page.waitForTimeout(300);
await page.keyboard.press("KeyK");
await waitFor(() => [...document.querySelectorAll(".panel.visible h2")]
  .some((h) => h.textContent === "Character"));
const wornRow = await page.evaluate(() => {
  const rows = [...document.querySelectorAll(".character-worn-slot")];
  const row = rows.find(
    (r) => r.querySelector(".character-worn-name")?.textContent === "Hide Armour");
  return row
    ? { text: row.textContent, canTakeOff: !!row.querySelector(".character-worn-off") }
    : null;
});
ok(
  "the worn piece has a row on the character sheet, with a way to take it off",
  !!wornRow && /Hide Armour/.test(wornRow.text) && wornRow.canTakeOff === true,
  JSON.stringify(wornRow),
);
// And the empty slots are legible as empty rather than simply absent.
const emptySlots = await page.evaluate(() =>
  [...document.querySelectorAll(".character-worn-slot.empty")].map(
    (r) => r.querySelector(".character-worn-name")?.textContent));
ok("the slots you have nothing for say so", emptySlots.length === 2 &&
  emptySlots.every((t) => t === "Empty"), JSON.stringify(emptySlots));
await page.keyboard.press("KeyK");

// --- 8. the clock says how far you have got ------------------------------
const clock = await page.evaluate(() => document.querySelector(".hud-time-label")?.textContent ?? "");
ok("the clock pill counts the days", /^Day \d+ · \d\d:\d\d$/.test(clock), JSON.stringify(clock));

await page.evaluate(() => {
  window.__gameDebug.setRaidCount(6);
  window.__gameDebug.teleportPlayer(200, 200);
  window.__gameDebug.startRaid();
});
await waitFor(() => window.__gameDebug.getRaidState().raidersAlive > 0, null, 15000);
const banner = await page.evaluate(() => {
  const el = document.querySelector(".hud-raid");
  if (!el || getComputedStyle(el).display === "none") return null;
  return el.textContent;
});
ok(
  "the raid banner names which raid this is",
  !!banner && /Raid 7 — wave \d+\/\d+/.test(banner),
  JSON.stringify(banner),
);

// The clock pill got wider, and its width is what the whole top row is laid
// out around — twice before, that has quietly put the resource row on top of
// something.
for (const width of [1280, 1000, 860]) {
  await page.setViewportSize({ width, height: 720 });
  await page.waitForTimeout(600);
  const layout = await page.evaluate(() => {
    const box = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
    };
    return { time: box(".hud-time"), raid: box(".hud-raid"), res: box(".hud-resources") };
  });
  const hits = (a, b) =>
    a && b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  ok(
    `at ${width}px the clock, the banner and the resource row keep apart`,
    !hits(layout.raid, layout.time) && !hits(layout.raid, layout.res) && !hits(layout.time, layout.res),
    JSON.stringify(layout),
  );
}

ok("no console/page errors", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length}`);
process.exit(failed.length ? 1 : 0);
