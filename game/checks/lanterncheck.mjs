import { chromium, LAUNCH, BASE_URL } from "./harness.mjs";

// The Crystal Lantern: what the cave finally buys you for yourself.
//
// The cave was measured before this was built. One trip down yields 198 glow
// crystals; the brazier, its only other use, costs two. Ninety-nine braziers
// from one visit, for a base that wants a handful — and nothing you could
// wear. Meanwhile every trinket in the game was a rare drop, so a player the
// loot table never favoured had an empty trinket slot for the whole run.
//
// The claim under test is not "a field changed". It is "you can see". So the
// centre of this suite is a screenshot at midnight with the lamp on and the
// same screenshot with it off, and every other case is paired with its
// opposite — because "the lamp is lit" passes on a build that lights it
// always, and "no light without it" passes on a build with no lamp at all.
const browser = await chromium.launch({ ...LAUNCH });
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });

const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

const results = [];
const ok = (name, pass, detail = "") => {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};

/**
 * Runs an in-page probe, turning a throw into a value the case can fail on.
 *
 * Without this the very first red-proof stopped at the third case: on a build
 * with no lantern, `craftRecipe` throws "Unknown recipe id" and takes the
 * whole suite down, so the remaining cases reported nothing at all. A suite
 * that cannot survive the absence of the thing it tests cannot prove it goes
 * red.
 */
async function probe(fn, arg) {
  try {
    return await page.evaluate(fn, arg);
  } catch (e) {
    return { __threw: String(e).split("\n")[0] };
  }
}

async function boot() {
  await page.goto(BASE_URL, { waitUntil: "load" });
  await page.waitForFunction(() => !!window.__gameDebug, null, { timeout: 120000 });
  await page.evaluate(() => localStorage.clear());
  await page.goto(BASE_URL, { waitUntil: "load" });
  await page.waitForFunction(() => !!window.__gameDebug, null, { timeout: 120000 });
  await page.waitForTimeout(1500);
}

/**
 * Mean luminance of the ground in front of the player.
 *
 * Screenshotted rather than read out of the canvas: a WebGL context does not
 * keep its drawing buffer between frames, so `drawImage` from the live canvas
 * comes back uniformly black — the first attempt at this check scored noon and
 * midnight as identically zero and would have "passed" any build at all. The
 * PNG goes back into the page and through the browser's own image decoder,
 * which is the one path that reliably has pixels in it.
 */
async function groundLuma() {
  const buf = await page.screenshot({ clip: { x: 300, y: 355, width: 300, height: 180 } });
  return page.evaluate(async (data) => {
    const img = new Image();
    await new Promise((res, rej) => {
      img.onload = res;
      img.onerror = rej;
      img.src = "data:image/png;base64," + data;
    });
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let r = 0, g = 0, b = 0;
    const n = d.length / 4;
    for (let i = 0; i < d.length; i += 4) {
      r += d[i];
      g += d[i + 1];
      b += d[i + 2];
    }
    return { r: r / n, g: g / n, b: b / n, luma: (0.2126 * r + 0.7152 * g + 0.0722 * b) / n };
  }, buf.toString("base64"));
}

/** Just the brightness, for the cases that only care how much light there is. */
async function groundLumaOnly() {
  return (await groundLuma()).luma;
}

await boot();

// ---------------------------------------------------------------- discovery
{
  const before = await page.evaluate(() => window.__gameDebug.getKnownRecipes());
  ok(
    "the lantern is not known before any crystal is held",
    !before.includes("crystal_lantern"),
    `${before.length} recipes known`,
  );

  const after = await page.evaluate(() => {
    const d = window.__gameDebug;
    d.grantItems({ glow_crystal: 1 });
    return d.getKnownRecipes();
  });
  ok(
    "picking up a crystal teaches it",
    after.includes("crystal_lantern"),
    "learned on first crystal",
  );
}

// ------------------------------------------------------------------ station
{
  // Far from any forge, with the materials in hand: the recipe must refuse.
  const noForge = await page.evaluate(() => {
    const d = window.__gameDebug;
    d.grantItems({ glow_crystal: 12, iron_ingot: 3 });
    d.teleportPlayer(120, 120);
    return { craftable: d.getCraftableRecipes().includes("crystal_lantern") };
  });
  ok(
    "it cannot be made away from a forge",
    !noForge.craftable,
    "not craftable at (120, 120)",
  );

  const built = await probe(() => {
    const d = window.__gameDebug;
    d.teleportPlayer(0, 8);
    d.grantItems({ stone: 40, wood: 40, plank: 20, clay: 20, iron_ingot: 6 });
    // A forge next to the player, then craft against it.
    const cells = [
      [2, 8], [3, 8], [2, 9], [3, 9], [4, 8],
    ];
    let placed = null;
    for (const [x, z] of cells) {
      if (d.placeBuildingAt("forge", x, z, 0)) { placed = `${x},${z}`; break; }
    }
    const made = d.craftRecipe("crystal_lantern", 1);
    return {
      placed,
      made,
      have: d.getInventory().find((s) => s.itemId === "crystal_lantern")?.qty ?? 0,
    };
  });
  ok(
    "with a forge standing it can be made",
    built.made === 1 && built.have >= 1,
    built.__threw ?? `forge at ${built.placed}, crafted ${built.made}`,
  );
}

// --------------------------------------------------------------- the ability
{
  const off = await probe(() => ({
    lit: window.__gameDebug.isLanternLit(),
    radius: window.__gameDebug.getLanternRadius(),
  }));
  ok(
    "nothing is lit before it is worn",
    !off.__threw && !off.lit && off.radius === 0,
    off.__threw ?? `radius ${off.radius}`,
  );

  const on = await probe(() => {
    const d = window.__gameDebug;
    const worn = d.wearItem("crystal_lantern");
    return { worn, lit: d.isLanternLit(), radius: d.getLanternRadius() };
  });
  ok(
    "wearing it puts a real light on the character",
    !on.__threw && on.worn && on.lit && on.radius > 0,
    on.__threw ?? `radius ${on.radius}`,
  );

  const back = await probe(() => {
    const d = window.__gameDebug;
    const taken = d.takeOffSlot("trinket");
    return { taken, lit: d.isLanternLit(), radius: d.getLanternRadius() };
  });
  ok(
    "taking it off puts the light out",
    !back.__threw && back.taken === "crystal_lantern" && !back.lit && back.radius === 0,
    back.__threw ?? `took off ${back.taken}, radius ${back.radius}`,
  );
}

// ------------------------------------------------------------ the slot trade
{
  // The lantern is a trinket, so it costs whatever trinket was there. If it
  // did not, it would be a free ability rather than a choice.
  const trade = await probe(() => {
    const d = window.__gameDebug;
    d.grantItems({ gatherers_charm: 1 });
    d.wearItem("gatherers_charm");
    const withCharm = d.getCharmReach();
    d.wearItem("crystal_lantern");
    return {
      withCharm,
      withLantern: d.getCharmReach(),
      slot: d.getWorn().trinket,
      lit: d.isLanternLit(),
    };
  });
  ok(
    "the charm reaches while it is worn",
    !trade.__threw && trade.withCharm > 0,
    trade.__threw ?? `reach ${trade.withCharm}`,
  );
  ok(
    "putting the lantern on costs you the charm",
    !trade.__threw && trade.slot === "crystal_lantern" && trade.withLantern === 0 && trade.lit,
    trade.__threw ?? `trinket=${trade.slot}, reach ${trade.withCharm} -> ${trade.withLantern}`,
  );
}

// ------------------------------------------------------- what it looks like
{
  // The claim. Same place, same midnight, lamp off and lamp on.
  await probe(() => {
    const d = window.__gameDebug;
    d.takeOffSlot("trinket");
    d.teleportPlayer(0, 20);
    d.setTimeOfDayFraction(0.0);
  });
  await page.waitForTimeout(2500);
  const dark = await groundLumaOnly();

  await probe(() => window.__gameDebug.wearItem("crystal_lantern"));
  await page.waitForTimeout(2500);
  const litPixels = await groundLuma();
  const lit = litPixels.luma;

  ok(
    "the ground at midnight is brighter with the lamp than without",
    lit > dark * 1.25,
    `luma ${dark.toFixed(1)} -> ${lit.toFixed(1)} (${(lit / dark).toFixed(2)}x)`,
  );

  // What the lamp *throws*, not just how much.
  //
  // The first build of this used the crystal's own cyan for the `PointLight`
  // as well as for the stone, which is the exact mistake the brazier had
  // already made and written a comment about: cyan light on grass comes back
  // green. It passed every brightness case above — luma cannot see a colour
  // cast — and the screenshot came back lit like a radioactive spill, green
  // measuring 2.24x red. With the light split off to near-white it measures
  // 1.46x, which is the grass being green rather than the lamp being green.
  // The bound sits between those two measurements.
  const greenBias = litPixels.g / litPixels.r;
  ok(
    "the pool is lamplight on grass, not a green spill",
    greenBias < 1.8,
    `G/R ${greenBias.toFixed(2)} (spill was 2.24, near-white is 1.46)`,
  );

  // The paired negative: taking it off has to give the darkness back. Without
  // this, a build that permanently brightened the scene on first wear would
  // pass the case above.
  await probe(() => window.__gameDebug.takeOffSlot("trinket"));
  await page.waitForTimeout(2500);
  const darkAgain = await groundLumaOnly();
  ok(
    "and dark again when it comes off",
    darkAgain < lit * 0.85,
    `luma ${lit.toFixed(1)} -> ${darkAgain.toFixed(1)}`,
  );

  // It is a lamp, not a sunrise: it must not out-light the day, or night
  // stops being a thing the player plans around at all.
  await probe(() => {
    window.__gameDebug.wearItem("crystal_lantern");
    window.__gameDebug.setTimeOfDayFraction(0.5);
  });
  await page.waitForTimeout(2500);
  const noon = await groundLumaOnly();
  ok(
    "night with the lamp is still darker than noon",
    lit < noon,
    `lit night ${lit.toFixed(1)} < noon ${noon.toFixed(1)}`,
  );
}

// -------------------------------------------------------------- persistence
{
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => !!window.__gameDebug, null, { timeout: 120000 });
  await page.waitForTimeout(2000);
  const after = await probe(() => ({
    slot: window.__gameDebug.getWorn().trinket,
    lit: window.__gameDebug.isLanternLit(),
    radius: window.__gameDebug.getLanternRadius(),
  }));
  ok(
    "it is still worn and still lit after a reload",
    !after.__threw && after.slot === "crystal_lantern" && after.lit && after.radius > 0,
    after.__threw ?? `trinket=${after.slot}, radius ${after.radius}`,
  );
}

ok("no console/page errors", errors.length === 0, errors.slice(0, 3).join(" | "));

const passed = results.filter((r) => r.pass).length;
console.log(`\n${passed}/${results.length}`);
await browser.close();
process.exit(passed === results.length ? 0 : 1);
