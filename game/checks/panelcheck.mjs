import { chromium, LAUNCH, BASE_URL } from "./harness.mjs";

// The panels: can you find the way out, and does the way in have a name?
//
// Escape and clicking off a panel both closed one already, but neither is
// visible, and the only written instruction was a footer line that hardcoded
// the letter in two of the six — so it lied outright to anyone who had rebound
// the key. Meanwhile the HUD grew a gold "+N" badge pointing at the character
// sheet, whose key the game named nowhere at all: not in the F1 reference, and
// not in the badge's own `title`, which cannot be read because the player is
// in pointer lock whenever the HUD is what they are looking at.
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

async function probe(fn, arg) {
  try {
    return await page.evaluate(fn, arg);
  } catch (e) {
    return { __threw: String(e).split("\n")[0] };
  }
}

/** Waits for exactly one panel to be open, or none. */
async function waitForPanels(count, timeoutMs = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const n = await page.evaluate(() => document.querySelectorAll(".panel.visible").length);
    if (n === count) return true;
    await page.waitForTimeout(200);
  }
  return false;
}

await page.goto(BASE_URL, { waitUntil: "load" });
await page.waitForFunction(() => !!window.__gameDebug, null, { timeout: 120000 });
await page.evaluate(() => localStorage.clear());
await page.goto(BASE_URL, { waitUntil: "load" });
await page.waitForFunction(() => !!window.__gameDebug, null, { timeout: 120000 });
await page.waitForTimeout(2000);
await page.click("#game-canvas");
await page.waitForTimeout(600);

// Every panel that opens on a key. The barrel is not here: it needs a placed
// container to open onto, and it is covered where that already exists.
const PANELS = [
  ["KeyC", "Crafting"],
  ["KeyB", "Build"],
  ["Tab", "Inventory"],
  ["KeyK", "Character"],
  ["Escape", "Options"],
];

// ----------------------------------------------------- a way out, every time
{
  const seen = [];
  for (const [key, title] of PANELS) {
    await page.keyboard.press(key);
    await waitForPanels(1);
    const info = await probe(() => {
      const panel = document.querySelector(".panel.visible");
      if (!panel) return { open: false };
      const close = panel.querySelector(".panel-close");
      const r = close?.getBoundingClientRect();
      return {
        open: true,
        title: panel.querySelector("h2")?.textContent ?? "",
        hasClose: !!close,
        w: r ? Math.round(r.width) : 0,
        h: r ? Math.round(r.height) : 0,
        // The close button must not be painted like the primary action. Every
        // other button in a panel is green; a green X reads as the thing to
        // press, and CLAUDE.md's rule is that the primary action is the
        // largest thing on screen — a close button is the opposite.
        bg: close ? getComputedStyle(close).backgroundColor : "",
      };
    });
    seen.push({ title, info });
    await page.keyboard.press("Escape");
    await waitForPanels(0);
  }

  const opened = seen.filter((s) => s.info.open);
  ok(
    "every panel opens on its key",
    opened.length === PANELS.length,
    opened.map((s) => s.info.title).join(", "),
  );
  ok(
    "every panel has a close button",
    opened.length > 0 && opened.every((s) => s.info.hasClose),
    seen.map((s) => `${s.title}:${s.info.hasClose ? "y" : "n"}`).join(" "),
  );
  // The counter-operated rule: nothing interactive under 44px.
  ok(
    "and it is at least 44px both ways",
    opened.length > 0 && opened.every((s) => s.info.w >= 44 && s.info.h >= 44),
    seen.map((s) => `${s.title}:${s.info.w}x${s.info.h}`).join(" "),
  );
  ok(
    "the close button is not painted as a primary action",
    opened.length > 0 &&
      opened.every((s) => /rgba\(0, 0, 0, 0\)|transparent/.test(s.info.bg)),
    seen.map((s) => `${s.title}:${s.info.bg}`).join(" "),
  );
}

// ------------------------------------------------ and the button really works
{
  await page.keyboard.press("KeyC");
  const openedFirst = await waitForPanels(1);
  ok("the crafting panel is open before the click", openedFirst);
  await probe(() => document.querySelector(".panel.visible .panel-close")?.click());
  const closed = await waitForPanels(0);
  ok("clicking the close button shuts it", closed);
}

// ------------------------------------------------ the header survives a scroll
{
  // Options is the long one — twenty-odd rebindable rows — so it is the panel
  // where an in-flow header would scroll away exactly when the way out is
  // least obvious.
  await page.keyboard.press("Escape");
  await waitForPanels(1);
  const scrolled = await probe(() => {
    const panel = document.querySelector(".panel.visible");
    const scrollable = panel.scrollHeight > panel.clientHeight + 1;
    panel.scrollTop = panel.scrollHeight;
    const pr = panel.getBoundingClientRect();
    const c = panel.querySelector(".panel-close").getBoundingClientRect();
    const cx = Math.round(c.left + c.width / 2);
    const cy = Math.round(c.top + c.height / 2);
    const hit = document.elementFromPoint(cx, cy);
    return {
      scrollable,
      scrollTop: Math.round(panel.scrollTop),
      stillInside: c.top >= pr.top - 1,
      // Proves two things at once: nothing overlays the button, and nothing
      // shows through in front of it — which is what an almost-opaque sticky
      // background would do, invisibly in the CSS and obviously in a
      // screenshot.
      hitIsClose: !!hit?.closest(".panel-close"),
    };
  });
  ok("the options panel is long enough to scroll", scrolled.scrollable, `scrollTop ${scrolled.scrollTop}`);
  ok(
    "the header stays on screen when it does",
    !scrolled.__threw && scrolled.stillInside,
    JSON.stringify(scrolled),
  );
  ok(
    "and the close button is still the thing under its own centre",
    !scrolled.__threw && scrolled.hitIsClose,
    `hitIsClose=${scrolled.hitIsClose}`,
  );
  await page.keyboard.press("Escape");
  await waitForPanels(0);
}

// --------------------------------------------- no panel names a key in prose
{
  // The two that hardcoded a letter said "Press C to close" and "Press B to
  // close" while the key was rebindable. With a button on every panel there is
  // no reason for any of them to name a key at all, and this is what catches
  // one creeping back.
  const prose = [];
  for (const [key, title] of PANELS) {
    await page.keyboard.press(key);
    await waitForPanels(1);
    const text = await probe(() => document.querySelector(".panel.visible")?.textContent ?? "");
    if (typeof text === "string" && /to close/i.test(text)) prose.push(title);
    await page.keyboard.press("Escape");
    await waitForPanels(0);
  }
  ok("no panel tells the player which key closes it", prose.length === 0, prose.join(", "));
}

// ------------------------------------------- the character sheet has a name
{
  await page.keyboard.press("F1");
  await page.waitForTimeout(800);
  const sheet = await probe(() => {
    const full = document.querySelector(".hud-keybinds");
    return { hidden: full?.hidden ?? null, text: full?.textContent ?? "" };
  });
  ok("F1 opens the controls sheet", !sheet.__threw && sheet.hidden === false, `hidden=${sheet.hidden}`);
  ok(
    "and it names the character sheet",
    typeof sheet.text === "string" && /character/i.test(sheet.text),
    sheet.text.slice(-90),
  );

  // Naming it is only worth something if the key it names actually opens it.
  const keyText = await probe(() => {
    const rows = [...document.querySelectorAll(".hud-keybinds div")];
    const row = rows.find((d) => /character/i.test(d.textContent ?? ""));
    const kbd = [...(row?.querySelectorAll("kbd") ?? [])];
    const idx = (row?.textContent ?? "").indexOf("character");
    void idx;
    return kbd.map((k) => k.textContent);
  });
  ok("the row carries a keycap", Array.isArray(keyText) && keyText.length > 0, JSON.stringify(keyText));

  await page.keyboard.press("F1");
  await page.waitForTimeout(500);
  await page.keyboard.press("KeyK");
  const openedChar = await waitForPanels(1);
  const title = await probe(() => document.querySelector(".panel.visible h2")?.textContent ?? "");
  ok(
    "and that key opens the character sheet",
    openedChar && title === "Character",
    JSON.stringify(title),
  );
  await page.keyboard.press("Escape");
  await waitForPanels(0);
}

// --------------------------------------------------- rows do not overflow
{
  // A row can carry Eat + Wear · Trinket + Hold at once. A button that wraps
  // to two lines does not throw and does not look obviously wrong in a diff.
  //
  // Every item in the game, not a chosen handful: the bag is the one screen
  // that shows them all at once, so it is where a missing glyph or a row that
  // has grown too wide for its buttons is actually visible. The list comes
  // from the game rather than from here, so the next item added is covered
  // without anyone remembering to add it.
  const granted = await probe(() => {
    const ids = window.__gameDebug.getAllItemIds();
    const grant = {};
    for (const id of ids) grant[id] = 2;
    window.__gameDebug.grantItems(grant);
    return ids.length;
  });
  await page.waitForTimeout(800);
  await page.keyboard.press("Tab");
  await waitForPanels(1);
  const rows = await probe(() => {
    const panel = document.querySelector(".panel.visible");
    const list = [...panel.querySelectorAll(".panel-row")];
    return {
      count: list.length,
      overflowing: list.filter((r) => r.scrollWidth > r.clientWidth + 1).length,
      tallButtons: list.flatMap((r) =>
        [...r.querySelectorAll("button")].filter((b) => b.offsetHeight >= 40).map((b) => b.textContent),
      ),
      withoutIcon: list
        .filter((r) => !r.querySelector(".panel-row-icon"))
        .map((r) => r.querySelector(".panel-row-title")?.textContent ?? "?"),
      // An icon appended straight onto `.panel-row` rather than into the
      // `panel-row-main` wrapper still counts as present, but the row is
      // `space-between` and would fling it to the far edge — so the check is
      // that it sits inside the wrapper, not merely that it exists.
      iconsOutsideMain: list
        .filter((r) => r.querySelector(":scope > .panel-row-icon"))
        .map((r) => r.querySelector(".panel-row-title")?.textContent ?? "?"),
    };
  });
  const noIcon = await probe(() => window.__gameDebug.getItemsWithoutIcon());
  ok("the inventory has rows to measure", !rows.__threw && rows.count > 0, `${rows.count} rows`);
  ok("no inventory row overflows its width", rows.overflowing === 0, `${rows.overflowing} of ${rows.count}`);
  ok(
    "and no button has wrapped to a second line",
    Array.isArray(rows.tallButtons) && rows.tallButtons.length === 0,
    JSON.stringify(rows.tallButtons),
  );
  ok("the bag was filled with every item in the game", granted > 30, `${granted} ids`);
  ok(
    "every inventory row draws an icon",
    Array.isArray(rows.withoutIcon) && rows.withoutIcon.length === 0,
    JSON.stringify(rows.withoutIcon),
  );
  ok(
    "and each one sits inside panel-row-main, not loose in the row",
    Array.isArray(rows.iconsOutsideMain) && rows.iconsOutsideMain.length === 0,
    JSON.stringify(rows.iconsOutsideMain),
  );
  // The eight worn items had no glyph in either of the two old tables and fell
  // through to a crate, which looked like a deliberate choice — which is how it
  // survived. The fallback is a question mark now so it cannot, and this is the
  // case that says so.
  ok(
    "no item falls through to the fallback glyph",
    Array.isArray(noIcon) && noIcon.length === 0,
    JSON.stringify(noIcon),
  );
  await page.keyboard.press("Escape");
  await waitForPanels(0);
}

ok("no console/page errors", errors.length === 0, errors.slice(0, 3).join(" | "));

const passed = results.filter((r) => r.pass).length;
console.log(`\n${passed}/${results.length}`);
await browser.close();
process.exit(passed === results.length ? 0 : 1);
