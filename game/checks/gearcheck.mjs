import { chromium, LAUNCH, BASE_URL } from "./harness.mjs";
import { editSaveOffline } from "./legacysave.mjs";

// Does found gear actually do anything?
//
// Fortune was added in the last change as "the stat that pays in content", and
// then had no content to pay in — it multiplied a table of bone, hide and iron
// ore. This suite is about the four pieces that give it something to find, and
// about the three slots they go into.
//
// Every check below measures a number the *player* feels, through the same
// function the game reads at its chokepoint. Checking that `worn.back` became
// "ember_cloak" would pass against a build with the whole of the wiring
// deleted. And every claim that something happens is paired with a claim that
// it does not happen otherwise — a cleave check with no "and only one without
// it" half can pass vacuously on a build that hits everything always.
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
  await page.waitForTimeout(1500);
}

const RARES = ["stormcleave", "ember_cloak", "quickdraw_ring", "gatherers_charm"];

await boot({ clear: true });

// --- 1. the table says what the game does --------------------------------
const defs = await page.evaluate(
  (ids) => Object.fromEntries(ids.map((id) => [id, window.__gameDebug.getWornDef(id)])),
  [...RARES, "iron_armour", "hide_armour"],
);
ok("the worn table knows the old armour", defs.iron_armour?.slot === "armour",
  JSON.stringify(defs.iron_armour));
ok("the cloak is a back piece and the ring a trinket",
  defs.ember_cloak?.slot === "back" && defs.quickdraw_ring?.slot === "trinket",
  `${defs.ember_cloak?.slot} / ${defs.quickdraw_ring?.slot}`);
// Stormcleave is a weapon, held not worn — the one piece with no slot.
ok("Stormcleave is held, not worn", defs.stormcleave === null, JSON.stringify(defs.stormcleave));

// --- 2. rare drops, at the rate the table claims -------------------------
// Hundreds of rolls, like lootcheck: a probabilistic table tells you nothing
// from one kill.
const drops = await page.evaluate((rares) => {
  const count = (enemyId, n) => {
    const seen = Object.fromEntries(rares.map((r) => [r, 0]));
    for (let i = 0; i < n; i++) {
      for (const d of window.__gameDebug.rollLootFor(enemyId)) {
        if (d.itemId in seen) seen[d.itemId] += 1;
      }
    }
    return seen;
  };
  return { brute: count("brute", 20000), zombie: count("zombie", 20000) };
}, RARES);
const bruteTotal = Object.values(drops.brute).reduce((a, b) => a + b, 0);
const zombieTotal = Object.values(drops.zombie).reduce((a, b) => a + b, 0);
ok("brutes drop the rare tier", bruteTotal > 0,
  `${bruteTotal} over 20000 rolls: ${JSON.stringify(drops.brute)}`);
// The paired half. Without it the check above would pass on a build that put
// the rare rows on every enemy in the game.
ok("zombies drop none of it", zombieTotal === 0, JSON.stringify(drops.zombie));
// Roughly the advertised rate — a band, not a point, because it is dice.
const rates = await page.evaluate(() => ({
  stormcleave: 0.006, ember_cloak: 0.008, quickdraw_ring: 0.01, gatherers_charm: 0.01,
}));
const offBy = RARES.map((id) => ({
  id, seen: drops.brute[id] / 20000, want: rates[id],
})).filter((r) => r.seen < r.want * 0.5 || r.seen > r.want * 1.8);
ok("each rare row lands near its stated chance", offBy.length === 0,
  RARES.map((id) => `${id} ${(drops.brute[id] / 200).toFixed(2)}% (want ${(rates[id] * 100).toFixed(1)}%)`).join(", "));

// --- 3. Fortune moves that rate ------------------------------------------
const fortune = await page.evaluate((rares) => {
  const rareCount = (n) => {
    let hits = 0;
    for (let i = 0; i < n; i++) {
      for (const d of window.__gameDebug.rollLootFor("brute")) if (rares.includes(d.itemId)) hits++;
    }
    return hits;
  };
  const before = rareCount(30000);
  window.__gameDebug.grantExp(200000);
  for (let i = 0; i < 25; i++) window.__gameDebug.allocateStat("fortune");
  return { before, after: rareCount(30000), points: window.__gameDebug.getLevel().stats.fortune };
}, RARES);
ok("Fortune makes the rare tier drop more often",
  fortune.after > fortune.before * 1.4,
  `${fortune.before} -> ${fortune.after} rares per 30000 brutes at ${fortune.points} points`);

// --- 4. three slots, independent -----------------------------------------
await boot({ clear: true });
const slots = await page.evaluate(() => {
  window.__gameDebug.grantItems({
    iron_armour: 1, ember_cloak: 1, quickdraw_ring: 1, gatherers_charm: 1,
  });
  const wornAll = ["iron_armour", "ember_cloak", "quickdraw_ring"].map((id) =>
    window.__gameDebug.wearItem(id));
  const all = window.__gameDebug.getWorn();
  // Taking one off must leave the other two alone — the bug the old
  // single-slot `wearArmour` would have reintroduced by stripping everything.
  window.__gameDebug.takeOffSlot("back");
  const afterOff = window.__gameDebug.getWorn();
  // And a second trinket displaces only the trinket.
  window.__gameDebug.wearItem("gatherers_charm");
  const afterSwap = window.__gameDebug.getWorn();
  return { wornAll, all, afterOff, afterSwap };
});
ok("all three slots can be filled at once",
  slots.wornAll.every(Boolean) &&
    slots.all.armour === "iron_armour" &&
    slots.all.back === "ember_cloak" &&
    slots.all.trinket === "quickdraw_ring",
  JSON.stringify(slots.all));
ok("taking one off leaves the others on",
  slots.afterOff.back === null &&
    slots.afterOff.armour === "iron_armour" &&
    slots.afterOff.trinket === "quickdraw_ring",
  JSON.stringify(slots.afterOff));
ok("wearing a second trinket displaces only the trinket",
  slots.afterSwap.trinket === "gatherers_charm" && slots.afterSwap.armour === "iron_armour",
  JSON.stringify(slots.afterSwap));
const backInBag = await page.evaluate(() =>
  (window.__gameDebug.getInventory().find((s) => s.itemId === "quickdraw_ring") ?? { qty: 0 }).qty);
ok("the displaced piece comes back to the bag", backInBag === 1, String(backInBag));

// --- 5. worn gear does not eat a hotbar slot -----------------------------
const hotbar = await page.evaluate(() => {
  window.__gameDebug.grantItems({ hide_armour: 1 });
  return window.__gameDebug.getHotbar();
});
ok("worn gear stays out of the quick bar",
  !hotbar.includes("hide_armour") && !hotbar.includes("ember_cloak"),
  JSON.stringify(hotbar));
// Paired: a *weapon* from the same rare tier does take a slot, because it is
// held. Without this the check above would pass on a build that blocked
// auto-assignment for everything.
const weaponSlot = await page.evaluate(() => {
  window.__gameDebug.grantItems({ stormcleave: 1 });
  return window.__gameDebug.getHotbar();
});
ok("but the rare weapon does take one", weaponSlot.includes("stormcleave"),
  JSON.stringify(weaponSlot));

// --- 6. Stormcleave hits the arc, and only the arc -----------------------
// Facing +x. Three enemies in front, one directly behind.
async function cleaveTrial(weaponId) {
  return page.evaluate((held) => {
    window.__gameDebug.clearEnemies();
    const p = window.__gameDebug.getPlayerPosition();
    // yaw 0 faces -z, and player.yaw is atan2(x, z) — so facing +x is PI/2.
    window.__gameDebug.setPlayerYaw(Math.PI / 2);
    const ids = {
      near: window.__gameDebug.spawnEnemyAt("brute", p.x + 1.6, p.z),
      side: window.__gameDebug.spawnEnemyAt("brute", p.x + 1.5, p.z + 1.2),
      far: window.__gameDebug.spawnEnemyAt("brute", p.x + 2.6, p.z - 0.6),
      behind: window.__gameDebug.spawnEnemyAt("brute", p.x - 2.0, p.z),
    };
    window.__gameDebug.holdItem(held);
    const before = Object.fromEntries(
      window.__gameDebug.getEnemyPositions().map((e) => [e.id, e.health]));
    const swung = window.__gameDebug.attackOnce();
    const after = Object.fromEntries(
      window.__gameDebug.getEnemyPositions().map((e) => [e.id, e.health]));
    const hurt = (id) => {
      if (!(id in before)) return null;
      if (!(id in after)) return before[id];
      return before[id] - after[id];
    };
    return {
      swung,
      near: hurt(ids.near), side: hurt(ids.side), far: hurt(ids.far), behind: hurt(ids.behind),
      gone: Object.keys(before).filter((id) => !(id in after)).length,
    };
  }, weaponId);
}
await page.evaluate(() => window.__gameDebug.grantItems({ iron_sword: 1, stormcleave: 1 }));
const cleave = await cleaveTrial("stormcleave");
const plainSwing = await (async () => {
  await page.evaluate(() => window.__gameDebug.advanceClockMs(3000));
  return cleaveTrial("iron_sword");
})();
ok("the cleave swing happened at all", cleave.swung === true, JSON.stringify(cleave));
const frontHit = [cleave.near, cleave.side, cleave.far].filter((d) => d > 0).length;
ok("Stormcleave hits everything in front of you", frontHit >= 3, JSON.stringify(cleave));
// Each one takes the weapon's full damage, not a share of it — dividing would
// make it worse than a sword against a crowd, which is the one thing it is for.
ok("and each of them takes the whole hit, not a share",
  [cleave.near, cleave.side, cleave.far].every((d) => d >= 52),
  JSON.stringify([cleave.near, cleave.side, cleave.far]));
// The half that stops this being a bomb.
ok("and nothing behind you", cleave.behind === 0, `behind lost ${cleave.behind}`);
// The half that stops "hits several" passing on a build that always does.
const plainFront = [plainSwing.near, plainSwing.side, plainSwing.far].filter((d) => d > 0).length;
ok("an ordinary sword does not sweep", plainFront <= 1, JSON.stringify(plainSwing));

// --- 7. Ember Cloak burns what hits you ----------------------------------
await boot({ clear: true });
const thorns = await page.evaluate(async () => {
  window.__gameDebug.grantItems({ ember_cloak: 1 });
  window.__gameDebug.wearItem("ember_cloak");
  window.__gameDebug.clearEnemies();
  const p = window.__gameDebug.getPlayerPosition();
  // One close enough to reach the player, one well out of its own reach.
  const biter = window.__gameDebug.spawnEnemyAt("zombie", p.x + 0.9, p.z);
  const bystander = window.__gameDebug.spawnEnemyAt("zombie", p.x + 22, p.z + 22);
  return { biter, bystander, health: window.__gameDebug.getHealth().current };
});
// Let the real AI do it — no hook fires the attack, because the point is that
// the attacker's identity survives the callback the game itself uses.
const gotBitten = await waitFor(
  (h) => window.__gameDebug.getHealth().current < h, thorns.health, 60000);
ok("something actually bit the player", gotBitten,
  `health started at ${thorns.health}`);
const reflected = await page.evaluate((ids) => {
  const by = Object.fromEntries(
    window.__gameDebug.getEnemyPositions().map((e) => [e.id, e.health]));
  return { biter: by[ids.biter] ?? null, bystander: by[ids.bystander] ?? null };
}, thorns);
ok("the one that bit you is hurt", reflected.biter !== null && reflected.biter < 30,
  `biter at ${reflected.biter}/30`);
// Paired: without this, "the biter is hurt" would pass on a build that damaged
// every enemy on the field whenever the player was touched.
ok("the one that did not is untouched", reflected.bystander === 30,
  `bystander at ${reflected.bystander}/30`);

// --- 8. falling does not burn anyone -------------------------------------
// The regression the widened callback could introduce: `damagePlayer` is also
// how a fall hurts you, and it has no attacker to reflect onto.
const fallSafe = await page.evaluate(() => {
  window.__gameDebug.clearEnemies();
  const p = window.__gameDebug.getPlayerPosition();
  const id = window.__gameDebug.spawnEnemyAt("brute", p.x + 30, p.z + 30);
  const before = window.__gameDebug.getEnemyPositions().find((e) => e.id === id)?.health;
  window.__gameDebug.hurtPlayer(25);
  const after = window.__gameDebug.getEnemyPositions().find((e) => e.id === id)?.health;
  return { before, after };
});
ok("damage with no attacker reflects onto nobody",
  fallSafe.before === fallSafe.after, JSON.stringify(fallSafe));

// --- 9. Quickdraw ---------------------------------------------------------
await boot({ clear: true });
const draw = await page.evaluate(() => {
  const before = window.__gameDebug.getDrawTime();
  window.__gameDebug.grantItems({ quickdraw_ring: 1 });
  window.__gameDebug.wearItem("quickdraw_ring");
  const after = window.__gameDebug.getDrawTime();
  window.__gameDebug.takeOffSlot("trinket");
  return { before, after, off: window.__gameDebug.getDrawTime() };
});
ok("Quickdraw shortens the bow's draw", draw.after < draw.before * 0.7,
  `${draw.before}ms -> ${draw.after}ms`);
ok("and taking it off puts the draw back", draw.off === draw.before,
  `${draw.off}ms vs ${draw.before}ms`);

// --- 10. Gatherer's Charm ------------------------------------------------
const charm = await page.evaluate(() => {
  const reachBefore = window.__gameDebug.getCharmReach();
  window.__gameDebug.grantItems({ gatherers_charm: 1, axe: 1, iron_axe: 1 });
  window.__gameDebug.wearItem("gatherers_charm");
  const reach = window.__gameDebug.getCharmReach();
  window.__gameDebug.holdItem("axe");

  const nodes = window.__gameDebug.getResourceNodes().filter((n) => !n.depleted);
  const trees = nodes.filter((n) => n.kind === "tree");
  // A tree with another tree inside the charm's reach, and — the paired half —
  // some other kind of node just as close, which must NOT be worked.
  // Both halves have to be set up at once: a tree with another tree in reach
  // AND a node of a different kind just as close. Settling for a pair without
  // the second made the "different kinds are left alone" check true of nothing.
  let pick = null;
  for (const t of trees) {
    const mates = trees.filter(
      (o) => o.id !== t.id && Math.hypot(o.x - t.x, o.z - t.z) <= reach);
    const others = nodes.filter(
      (o) => o.kind !== "tree" && Math.hypot(o.x - t.x, o.z - t.z) <= reach);
    if (mates.length > 0 && others.length > 0) {
      pick = { t, mate: mates[0], other: others[0] };
      break;
    }
  }
  if (!pick) return { reachBefore, reach, found: false };

  const hitsOf = (id) => window.__gameDebug.getNodeState(id)?.hits ?? null;
  const before = {
    tree: hitsOf(pick.t.id),
    mate: hitsOf(pick.mate.id),
    other: pick.other ? hitsOf(pick.other.id) : null,
  };
  window.__gameDebug.teleportPlayer(pick.t.x, pick.t.z);
  window.__gameDebug.hitNodeOnce(pick.t.id);
  const after = {
    tree: hitsOf(pick.t.id),
    mate: hitsOf(pick.mate.id),
    other: pick.other ? hitsOf(pick.other.id) : null,
  };
  return { reachBefore, reach, found: true, before, after, hasOther: pick.other !== null };
});
ok("nothing reaches past the aimed node without the charm", charm.reachBefore === 0,
  String(charm.reachBefore));
ok("the charm gives the swing a reach", charm.reach > 0, String(charm.reach));
ok("a clump with two trees and something else in it", charm.found === true,
  JSON.stringify(charm));
if (charm.found) {
  ok("one swing works the neighbouring tree too",
    charm.after.mate !== null && charm.after.mate < charm.before.mate,
    `mate ${charm.before.mate} -> ${charm.after.mate}`);
  // The half that keeps it from being "everything nearby".
  ok("but not a node of a different kind at the same distance",
    charm.hasOther && charm.after.other === charm.before.other,
    `other ${charm.before.other} -> ${charm.after.other} (present=${charm.hasOther})`);
}

// --- 11. an old save keeps its armour ------------------------------------
await boot({ clear: true });
await page.evaluate(() => {
  window.__gameDebug.grantItems({ iron_armour: 1 });
  window.__gameDebug.wearItem("iron_armour");
  window.__gameDebug.saveNow();
});
// Rewritten into the *old* shape from a page where the game cannot boot — the
// obvious version (evaluate, then reload) is silently overwritten by the save
// that `beforeunload` fires on the way out.
await editSaveOffline(page, URL, (save) => {
  save.armour = "iron_armour";
  delete save.worn;
});
await boot();
const migrated = await page.evaluate(() => {
  const worn = window.__gameDebug.getWorn();
  window.__gameDebug.saveNow();
  return {
    worn,
    legacyGone: !("armour" in JSON.parse(localStorage.getItem("romestead-save-v1"))),
  };
});
ok("a save from before the slots keeps its armour",
  migrated.worn.armour === "iron_armour", JSON.stringify(migrated.worn));
ok("and the three slots are all present",
  ["armour", "back", "trinket"].every((k) => k in migrated.worn), JSON.stringify(migrated.worn));
// Two fields describing what is on the body is how they drift apart, so the
// save written after a migration must carry only the new one.
ok("the old field is not written back out", migrated.legacyGone === true);

// --- 12. a partial worn record ------------------------------------------
// The lesson `raid.count` taught: a whole-object guard passes a save that has
// the record but lacks a slot added later, leaving it undefined rather than null.
await editSaveOffline(page, URL, (save) => {
  save.worn = { armour: "iron_armour" };
});
await boot();
const partial = await page.evaluate(() => window.__gameDebug.getWorn());
ok("a save missing a slot loads and gains it",
  partial.armour === "iron_armour" && partial.back === null && partial.trinket === null,
  JSON.stringify(partial));

ok("no console/page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed`);
await browser.close();
process.exit(results.every((r) => r.pass) ? 0 : 1);
