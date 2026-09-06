import { chromium, LAUNCH, BASE_URL } from "./harness.mjs";

// Does the sky island pay for anything now?
const browser = await chromium.launch({ ...LAUNCH });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

const results = [];
const ok = (name, pass, detail = "") => {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};

await page.goto(BASE_URL, { waitUntil: "load" });
await page.waitForFunction(() => !!window.__gameDebug, null, { timeout: 120000 });
await page.evaluate(() => localStorage.clear());
await page.goto(BASE_URL, { waitUntil: "load" });
await page.waitForFunction(() => !!window.__gameDebug, null, { timeout: 120000 });
await page.waitForTimeout(1500);

// --- 1. picking cloud iron up tells you what it is for --------------------
// The whole complaint in one check: before this, the first cloud iron a player
// found taught them nothing, because nothing was made from it.
const before = await page.evaluate(() => window.__gameDebug.getKnownRecipes().length);
const after = await page.evaluate(() => {
  const d = window.__gameDebug;
  d.grantItems({ cloud_iron: 40 });
  return { known: d.getKnownRecipes(), all: d.getAllRecipes().map((r) => r.id) };
});
ok("cloud iron is an ingredient in something", after.all.includes("skysteel_ingot"));
ok("and picking it up teaches that recipe",
  after.known.includes("skysteel_ingot") && after.known.length > before,
  `${before} -> ${after.known.length} known`);

// --- 2. the chain actually runs at the stations it names ------------------
const built = await page.evaluate(() => {
  const d = window.__gameDebug;
  d.grantItems({ cloud_iron: 200, plank: 4, hide: 8, wood: 400, stone: 400 });
  const p = d.getPlayerPosition();
  // The forge and the anvil have to be standing, or the recipes refuse.
  for (const [id, dx] of [["forge", 2], ["anvil", -2]]) {
    d.placeBuildingAt(id, Math.round(p.x) + dx, Math.round(p.z) + 2, 0);
  }
  return { placed: d.getPlacedBuildings().length };
});
await page.waitForTimeout(800);
const chain = await page.evaluate(() => {
  const d = window.__gameDebug;
  const made = [];
  for (let i = 0; i < 16; i++) if (d.craftRecipe("skysteel_ingot")) made.push("ingot");
  const ingots = (d.getInventory().find((s) => s.itemId === "skysteel_ingot") ?? { qty: 0 }).qty;
  const sword = d.craftRecipe("skysteel_sword");
  const armour = d.craftRecipe("skysteel_armour");
  const cloud = (d.getInventory().find((s) => s.itemId === "cloud_iron") ?? { qty: 0 }).qty;
  return { ingots, sword, armour, cloudLeft: cloud };
});
ok("cloud iron smelts into ingots at the forge", chain.ingots > 0, `${chain.ingots} ingots`);
ok("and the ingots become a sword and armour at the anvil",
  chain.sword && chain.armour, `sword=${chain.sword} armour=${chain.armour}`);
ok("and it cost cloud iron to do it", chain.cloudLeft < 200, `${chain.cloudLeft} of 200 left`);

// --- 3. the tier sits where the design says it must -----------------------
// Paired against the rule `WEAPON_DAMAGE` states outright: a found weapon has
// to beat one you can simply decide to build.
const dmg = await page.evaluate(() => {
  const d = window.__gameDebug;
  const read = (id) => { d.grantItems({ [id]: 1 }); d.holdItem(id); return d.getHeldDamage(); };
  return { iron: read("iron_sword"), sky: read("skysteel_sword"), storm: read("stormcleave") };
});
ok("skysteel beats iron", dmg.sky > dmg.iron, `${dmg.iron} -> ${dmg.sky}`);
ok("and still loses to what cannot be crafted", dmg.sky < dmg.storm,
  `skysteel ${dmg.sky} vs stormcleave ${dmg.storm}`);

// --- 4. the armour is a real step, measured through damagePlayer ----------
const soak = await page.evaluate(() => {
  const d = window.__gameDebug;
  const hit = (id) => {
    d.grantItems({ [id]: 1 });
    d.wearItem(id);
    d.healPlayer(99999);
    const before = d.getHealth().current;
    d.hurtPlayer(60);
    return before - d.getHealth().current;
  };
  return { iron: hit("iron_armour"), sky: hit("skysteel_armour") };
});
ok("skysteel armour takes less than iron does", soak.sky < soak.iron,
  `from the same 60: iron let through ${soak.iron}, skysteel ${soak.sky}`);

ok("no console/page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed`);
await browser.close();
process.exit(results.every((r) => r.pass) ? 0 : 1);
