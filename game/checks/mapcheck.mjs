import { chromium, LAUNCH, BASE_URL } from "./harness.mjs";

// The minimap, and the HUD it shares a screen with.
//
// The map is a canvas, so "is that enemy shown?" cannot honestly be answered
// by reading pixels and guessing what a red blob means. It counts its own pins
// as it draws them and reports them; these cases assert on that count, which
// is the same question asked of the code that answers it.
const browser = await chromium.launch({ ...LAUNCH });
const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });

const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

const results = [];
const ok = (name, pass, detail = "") => {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};

async function probe(fn, arg) {
  try {
    return await page.evaluate(fn, arg);
  } catch (e) {
    return { __threw: String(e).split("\n")[0] };
  }
}

/**
 * Waits for the map to redraw into a state, rather than reading straight after
 * changing the world.
 *
 * `getMinimapPins` reports what the *last* redraw drew, and the map redraws at
 * most every 120ms — which on this renderer can be less often than once a
 * second. Clearing every enemy and reading immediately therefore returns the
 * previous frame's count, which is what the first version of the case below
 * did: it reported one enemy pin on a world with no enemies in it and looked
 * like a map bug rather than a stale read.
 */
async function waitForPins(predicate, timeoutMs = 30000) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < timeoutMs) {
    last = await probe(() => window.__gameDebug.getMinimapPins());
    if (last?.__threw) return last;
    if (predicate(last)) return last;
    await page.waitForTimeout(250);
  }
  return last;
}

const rect = (sel) =>
  page.evaluate((s) => {
    const n = document.querySelector(s);
    if (!n) return null;
    const b = n.getBoundingClientRect();
    return {
      top: Math.round(b.top),
      left: Math.round(b.left),
      right: Math.round(b.right),
      bottom: Math.round(b.bottom),
      w: Math.round(b.width),
      h: Math.round(b.height),
    };
  }, sel);

await page.goto(BASE_URL, { waitUntil: "load" });
await page.waitForFunction(() => !!window.__gameDebug, null, { timeout: 120000 });
await page.evaluate(() => localStorage.clear());
await page.goto(BASE_URL, { waitUntil: "load" });
await page.waitForFunction(() => !!window.__gameDebug, null, { timeout: 120000 });
await page.waitForTimeout(2500);

// ------------------------------------------------------------ where it sits
{
  const map = await rect(".hud-minimap");
  const vw = await page.evaluate(() => window.innerWidth);
  const vh = await page.evaluate(() => window.innerHeight);
  ok(
    "the map is in the top-right corner",
    !!map && map.top < vh / 3 && map.left > vw / 2,
    JSON.stringify(map),
  );

  const canvas = await rect(".hud-minimap canvas");
  // Equal width and height is not enough to call it square: a circular canvas
  // has a perfectly square bounding box, because `border-radius` does not
  // change an element's box. The first version of this case asserted only the
  // dimensions and passed happily against the old round map, testing nothing.
  // What actually makes it square is the corner radius being small relative to
  // the box rather than half of it.
  const radius = await page.evaluate(() => {
    const n = document.querySelector(".hud-minimap canvas");
    if (!n) return null;
    const r = getComputedStyle(n).borderTopLeftRadius;
    return r.endsWith("%") ? (parseFloat(r) / 100) * n.getBoundingClientRect().width : parseFloat(r);
  });
  ok(
    "and it is square, not a disc",
    !!canvas && canvas.w === canvas.h && radius !== null && radius < canvas.w / 4,
    canvas ? `${canvas.w}x${canvas.h}, corner radius ${radius}px` : "missing",
  );

  // Smaller than it was. 168 was the old edge; anything at or above that has
  // not actually shrunk.
  ok(
    "and smaller than the 168px it used to be",
    !!canvas && canvas.w < 168,
    canvas ? `${canvas.w}px` : "missing",
  );

  // The resource row used to own this corner. Overlapping boxes are exactly
  // what this pass was meant to remove, so it is asserted rather than assumed.
  const res = await rect(".hud-resources");
  const overlaps =
    !!map && !!res && map.left < res.right && res.left < map.right &&
    map.top < res.bottom && res.top < map.bottom;
  ok(
    "and does not overlap the resource row",
    !overlaps,
    `map ${JSON.stringify(map)} vs resources ${JSON.stringify(res)}`,
  );
}

// -------------------------------------------------------------- coordinates
{
  const before = await probe(() => window.__gameDebug.getMinimapCoords());
  ok(
    "the map shows a coordinate readout",
    typeof before === "string" && /-?\d+,\s*-?\d+/.test(before),
    JSON.stringify(before),
  );

  // And it follows the player, rather than being a label that was printed once.
  await probe(() => window.__gameDebug.teleportPlayer(-42, 77));
  await page.waitForTimeout(1200);
  const after = await probe(() => window.__gameDebug.getMinimapCoords());
  ok(
    "and it tracks where the player actually is",
    typeof after === "string" && after.replace(/\s/g, "") === "-42,77",
    `${JSON.stringify(before)} -> ${JSON.stringify(after)}`,
  );
}

// ------------------------------------------------------- only nearby enemies
{
  const geo = await probe(() => window.__gameDebug.getMinimapGeometry());
  ok(
    "the map reports how far it shows enemies",
    !geo.__threw && geo.enemyRange > 0 && geo.enemyRange < geo.range,
    JSON.stringify(geo),
  );

  await probe(() => window.__gameDebug.clearEnemies());
  const none = await waitForPins((p) => p.enemy === 0);
  ok("with no enemies alive the map draws none", none?.enemy === 0, JSON.stringify(none));

  // One close, one far but still well inside the map's own range. Both are
  // alive and both are on the map's ground — only the near one may be drawn.
  const near = Math.round(geo.enemyRange * 0.4);
  const far = Math.round(geo.enemyRange + (geo.range - geo.enemyRange) / 2);
  await probe(
    ({ near, far }) => {
      const d = window.__gameDebug;
      const p = d.getPlayerPosition();
      d.spawnEnemyAt("zombie", p.x + near, p.z);
      d.spawnEnemyAt("zombie", p.x + far, p.z);
    },
    { near, far },
  );
  const alive = await probe(() => window.__gameDebug.getEnemyPositions().length);
  const pins = await waitForPins((p) => p.enemy > 0);
  ok(
    "both enemies exist and are inside the map's range",
    alive === 2 && far < geo.range,
    `alive ${alive}, near ${near}, far ${far}, range ${geo.range}`,
  );
  ok(
    "but only the near one is drawn",
    pins.enemy === 1,
    `${pins.enemy} drawn of ${alive} alive (cut at ${geo.enemyRange})`,
  );
}

// -------------------------------------------------------- what else it draws
{
  // A wall the player placed shows up; the world's own POI props do not, since
  // the landmark markers already cover those spots.
  await probe(() => {
    const d = window.__gameDebug;
    d.teleportPlayer(0, 0);
    d.grantItems({ wood: 90, stone: 90, plank: 60 });
  });
  await page.waitForTimeout(1000);
  const before = await probe(() => window.__gameDebug.getMinimapPins());
  await probe(() => window.__gameDebug.placeBuildingAt("wall", 3, 1, 0));
  const after = await waitForPins((p) => p.building > before.building);
  ok(
    "a wall the player placed appears on the map",
    after.building === before.building + 1,
    `${before.building} -> ${after.building}`,
  );

  ok(
    "portals are drawn too",
    after.portal > 0,
    `${after.portal} portal pins`,
  );
}

ok("no console/page errors", errors.length === 0, errors.slice(0, 3).join(" | "));

const passed = results.filter((r) => r.pass).length;
console.log(`\n${passed}/${results.length}`);
await browser.close();
process.exit(passed === results.length ? 0 : 1);
