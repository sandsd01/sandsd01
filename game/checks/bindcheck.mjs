import { chromium, LAUNCH, BASE_URL } from "./harness.mjs";
const results = [];
const ok = (n, p, d = "") => results.push([p, n, d]);

const browser = await chromium.launch({
  ...LAUNCH,
  args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

await page.goto(BASE_URL, { waitUntil: "load" });
await page.waitForFunction(() => !!window.__gameDebug, null, { timeout: 90000 });

// --- Mini-map ---------------------------------------------------------
const map = await page.evaluate(() => {
  const c = document.querySelector(".hud-minimap canvas");
  if (!c) return null;
  const r = c.getBoundingClientRect();
  const keys = document.querySelector(".hud-keybinds").getBoundingClientRect();
  const ctx = c.getContext("2d");
  const px = ctx.getImageData(0, 0, c.width, c.height).data;
  let painted = 0;
  for (let i = 3; i < px.length; i += 4) if (px[i] > 0) painted++;
  return {
    w: r.width,
    inViewport: r.right <= window.innerWidth && r.bottom <= window.innerHeight,
    clearsKeybinds: r.left > keys.right,
    paintedFraction: painted / (px.length / 4),
  };
});
ok("mini-map is on screen", !!map && map.inViewport, JSON.stringify(map));
ok("mini-map has drawn something", map.paintedFraction > 0.5, `${(map.paintedFraction * 100).toFixed(0)}% painted`);
ok("mini-map clears the keybind card", map.clearsKeybinds);

// The player marker must track heading. Turn, and the drawn map must change.
const before = await page.evaluate(() => {
  const c = document.querySelector(".hud-minimap canvas");
  return c.toDataURL().length;
});
await page.evaluate(() => window.__gameDebug.teleportPlayer(60, -60));
// Poll rather than sleeping: the scene runs at a couple of frames a second
// under software rendering, and the map redraw is throttled on top of that.
await page
  .waitForFunction(
    (len) => document.querySelector(".hud-minimap canvas").toDataURL().length !== len,
    before,
    { timeout: 25000 },
  )
  .catch(() => {});
const after = await page.evaluate(() => {
  const c = document.querySelector(".hud-minimap canvas");
  return c.toDataURL().length;
});
ok("mini-map redraws as the player moves", before !== after, `${before} -> ${after}`);

// --- Rebinding --------------------------------------------------------
await page.keyboard.press("Escape");
await page.waitForFunction(() => document.querySelector(".panel.visible h2")?.textContent === "Options", null, { timeout: 20000 });
// Derived rather than a fixed count, so adding an action doesn't fail this.
const slots = await page.evaluate(() => {
  const rows = [...document.querySelectorAll(".panel.visible .panel-row")].filter((r) =>
    r.querySelector(".panel-key"),
  );
  return {
    rows: rows.length,
    allTwo: rows.every((r) => r.querySelectorAll(".panel-key").length === 2),
  };
});
ok(
  "every action row has two key slots",
  slots.allTwo && slots.rows > 10,
  `${slots.rows} actions`,
);

// Rebind "Move forward" from W to T, then prove W stops working and T works.
await page.evaluate(() => {
  const row = [...document.querySelectorAll(".panel.visible .panel-row")].find(
    (r) => r.querySelector(".panel-row-title")?.textContent === "Move forward",
  );
  row.querySelector(".panel-key").click();
});
const listening = await page.evaluate(() =>
  !!document.querySelector(".panel.visible .panel-key.listening"),
);
ok("clicking a key listens for the next press", listening);

await page.keyboard.press("KeyT");
await page.waitForFunction(
  () => !document.querySelector(".panel.visible .panel-key.listening"),
  null,
  { timeout: 20000 },
);
const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("romestead-keybindings-v1")));
ok("rebinding persists", stored.moveForward[0] === "KeyT", JSON.stringify(stored.moveForward));

// The on-screen help must not still advertise W.
const help = await page.evaluate(() => document.querySelector(".hud-keybinds").textContent);
ok("keybind help reflects the new key", help.includes("T") && !/\bW\b/.test(help), help.slice(0, 60));

await page.keyboard.press("Escape");
await page.waitForFunction(() => document.querySelectorAll(".panel.visible").length === 0, null, { timeout: 20000 });

async function walkedWith(key) {
  const start = await page.evaluate(() => window.__gameDebug.getPlayerPosition());
  await page.keyboard.down(key);
  await page.waitForTimeout(1200);
  await page.keyboard.up(key);
  const end = await page.evaluate(() => window.__gameDebug.getPlayerPosition());
  return Math.hypot(end.x - start.x, end.z - start.z);
}
const withOld = await walkedWith("KeyW");
ok("the old key no longer moves the player", withOld < 0.05, `moved ${withOld.toFixed(3)}`);
const withNew = await walkedWith("KeyT");
ok("the new key moves the player", withNew > 0.5, `moved ${withNew.toFixed(3)}`);

// Reset restores the defaults.
await page.keyboard.press("Escape");
await page.waitForFunction(() => document.querySelector(".panel.visible h2")?.textContent === "Options", null, { timeout: 20000 });
await page.click(".panel.visible .panel-reset");
const afterReset = await page.evaluate(() => JSON.parse(localStorage.getItem("romestead-keybindings-v1")));
ok("reset restores defaults", afterReset.moveForward[0] === "KeyW", JSON.stringify(afterReset.moveForward));

ok("no console/page errors", errors.length === 0, errors.slice(0, 3).join(" | "));

await page.screenshot({ path: "/tmp/claude-0/-home-user-sandsd01/408edaa1-3a98-5fd8-a1af-5e70efacb130/scratchpad/controls.png" });
await browser.close();

let pass = 0;
for (const [p, n, d] of results) {
  console.log(`${p ? "PASS" : "FAIL"}  ${n}${d ? "  — " + d : ""}`);
  if (p) pass++;
}
console.log(`\n${pass}/${results.length}`);
process.exit(pass === results.length ? 0 : 1);
