import { chromium, LAUNCH, BASE_URL, pressButton } from "./harness.mjs";
import { selectBuilding } from "./buildselect.mjs";

// The chat box, and the /godmode command it exists to carry.
//
// The case that matters most here is not that the box opens — it is that the
// game goes deaf while it has the keyboard. A chat field in a game that moves
// on WASD is a trap: typing "wall" walks you into one, and every keystroke of
// a message is also a command to the character. So every claim about the box
// is paired with the opposite, and the movement case is checked in both
// directions rather than once.
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

async function boot() {
  await page.goto(BASE_URL, { waitUntil: "load" });
  await page.waitForFunction(() => !!window.__gameDebug, null, { timeout: 120000 });
  await page.evaluate(() => localStorage.clear());
  await page.goto(BASE_URL, { waitUntil: "load" });
  await page.waitForFunction(() => !!window.__gameDebug, null, { timeout: 120000 });
  await page.waitForTimeout(1500);
}

const pos = () => page.evaluate(() => window.__gameDebug.getPlayerPosition());
const moved = (a, b) => Math.hypot(b.x - a.x, b.z - a.z);

/**
 * Shuts anything that is open, and says whether it managed to.
 *
 * The paired positive below — "with the box closed, W still moves you" — is
 * about movement, and an open panel freezes the player for reasons that have
 * nothing to do with chat. On a build with no chat box, the Escape that was
 * meant to close it opens the Options screen instead, and the positive then
 * fails for the wrong reason.
 */
async function closeAllPanels() {
  for (let i = 0; i < 5; i++) {
    const open = await page.evaluate(() => document.querySelectorAll(".panel.visible").length);
    if (open === 0) return true;
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
  }
  return (await page.evaluate(() => document.querySelectorAll(".panel.visible").length)) === 0;
}

/** Holds a key long enough for this frame rate to actually act on it. */
async function holdKey(code, ms = 4000) {
  await page.keyboard.down(code);
  await page.waitForTimeout(ms);
  await page.keyboard.up(code);
  await page.waitForTimeout(400);
}

await boot();
await page.click("#game-canvas");
await page.waitForTimeout(600);

// ------------------------------------------------------------- opening it
{
  const shut = await probe(() => ({
    open: window.__gameDebug.isChatOpen(),
    deaf: window.__gameDebug.isTextEntry(),
  }));
  ok(
    "the box starts closed and the game has the keyboard",
    !shut.__threw && shut.open === false && shut.deaf === false,
    shut.__threw ?? JSON.stringify(shut),
  );

  await page.keyboard.press("KeyT");
  await page.waitForTimeout(600);
  const opened = await probe(() => ({
    open: window.__gameDebug.isChatOpen(),
    deaf: window.__gameDebug.isTextEntry(),
    focused: document.activeElement?.className ?? "",
  }));
  ok(
    "T opens it and takes the keyboard",
    !opened.__threw && opened.open && opened.deaf && opened.focused.includes("chat-field"),
    opened.__threw ?? JSON.stringify(opened),
  );
}

// -------------------------------------------- THE case: typing must not walk
{
  // Held, not typed. The first version of this used `keyboard.type`, which
  // presses each key for about 40ms — shorter than a frame on this renderer,
  // so the game never samples it as held and the player stays put whether or
  // not the chat box exists. It passed on a build with no chat in it at all,
  // which is the definition of a case that proves nothing. Holding W is the
  // same gesture the paired positive below uses, so the two are comparable.
  const before = await pos();
  await holdKey("KeyW");
  const after = await pos();
  ok(
    "holding W while the chat box is open does not move the player",
    moved(before, after) < 0.05,
    `moved ${moved(before, after).toFixed(3)} holding W for 4s`,
  );

  // And the keystrokes still reach the field — including the space, which the
  // game's own keydown handler preventDefaults because it is bound to jump.
  //
  // Cleared first: holding W above put a "w" in the field, which is correct —
  // the field has focus and that is what a held letter key does — and left the
  // value reading "wwasd wasd".
  await page.evaluate(() => {
    const field = document.querySelector(".chat-field");
    if (field) field.value = "";
  });
  await page.keyboard.type("wasd wasd", { delay: 30 });
  await page.waitForTimeout(600);
  const typed = await probe(() => document.querySelector(".chat-field")?.value ?? "");
  ok(
    "and typed letters reach the field, including the space",
    typed === "wasd wasd",
    JSON.stringify(typed),
  );
}

// ------------------------------------------------------------ closing it
{
  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);
  const closed = await probe(() => ({
    open: window.__gameDebug.isChatOpen(),
    deaf: window.__gameDebug.isTextEntry(),
  }));
  ok(
    "Escape closes it and hands the keyboard back",
    !closed.__threw && closed.open === false && closed.deaf === false,
    closed.__threw ?? JSON.stringify(closed),
  );

  // The paired positive. Without this, the movement case above passes on a
  // build where the player simply cannot move at all.
  await closeAllPanels();
  await page.click("#game-canvas");
  await page.waitForTimeout(500);
  const before = await pos();
  await holdKey("KeyW");
  const after = await pos();
  ok(
    "with the box closed, holding W does move the player",
    moved(before, after) > 0.5,
    `moved ${moved(before, after).toFixed(2)}`,
  );
}

// ------------------------------------------------------------- slash opens
{
  await page.keyboard.press("Slash");
  await page.waitForTimeout(600);
  const slash = await probe(() => ({
    open: window.__gameDebug.isChatOpen(),
    value: document.querySelector(".chat-field")?.value ?? "",
  }));
  ok(
    "slash opens it already prefilled with a slash",
    !slash.__threw && slash.open && slash.value === "/",
    slash.__threw ?? JSON.stringify(slash),
  );
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
}

// ---------------------------------------------------------------- /godmode
{
  const off = await probe(() => window.__gameDebug.isGodMode());
  ok("godmode is off to begin with", off === false, String(off));

  await probe(() => window.__gameDebug.sendChat("/godmode"));
  await page.waitForTimeout(600);
  const on = await probe(() => window.__gameDebug.isGodMode());
  ok("/godmode turns it on", on === true, String(on));

  const lines = await probe(() => window.__gameDebug.getChatLines());
  ok(
    "and the log says so",
    Array.isArray(lines) && lines.some((l) => l.kind === "system" && /Godmode ON/i.test(l.text)),
    JSON.stringify(lines?.slice?.(-2) ?? lines),
  );

  const chip = await probe(() => {
    const node = document.querySelector(".hud-godmode");
    return { present: !!node, hidden: node?.hidden ?? null };
  });
  ok(
    "the HUD shows a standing badge",
    !chip.__threw && chip.present && chip.hidden === false,
    JSON.stringify(chip),
  );

  // Toggling: the half that stops "/godmode turns it on" passing on a build
  // that simply sets the flag and never clears it.
  await probe(() => window.__gameDebug.sendChat("/godmode"));
  await page.waitForTimeout(600);
  const backOff = await probe(() => ({
    on: window.__gameDebug.isGodMode(),
    hidden: document.querySelector(".hud-godmode")?.hidden ?? null,
  }));
  ok(
    "typing it again turns it back off, badge and all",
    !backOff.__threw && backOff.on === false && backOff.hidden === true,
    JSON.stringify(backOff),
  );
}

// ------------------------------------------------- what godmode actually does
{
  // Damage, both ways round. The negative half is what stops "godmode blocks
  // damage" passing on a build where damage never lands on anyone.
  const normal = await probe(() => {
    const d = window.__gameDebug;
    d.healPlayer(9999);
    const before = d.getHealth().current;
    d.damagePlayer(30);
    return { before, after: d.getHealth().current };
  });
  ok(
    "with godmode off, damage lands",
    !normal.__threw && normal.after < normal.before,
    normal.__threw ?? `${normal.before} -> ${normal.after}`,
  );

  const godly = await probe(() => {
    const d = window.__gameDebug;
    d.sendChat("/godmode");
    d.healPlayer(9999);
    const before = d.getHealth().current;
    d.damagePlayer(30);
    return { before, after: d.getHealth().current, on: d.isGodMode() };
  });
  ok(
    "with godmode on, the same hit takes nothing",
    !godly.__threw && godly.on && godly.after === godly.before,
    godly.__threw ?? `${godly.before} -> ${godly.after}`,
  );

  // Flight without the wings. Paired against the same reading with it off,
  // since a ceiling that was always non-zero would pass either way.
  const ceilingOn = await probe(() => ({
    ceiling: window.__gameDebug.getFlightCeiling(),
    wings: window.__gameDebug.getWorn().back,
  }));
  ok(
    "godmode flies with nothing on its back",
    !ceilingOn.__threw && ceilingOn.wings === null && ceilingOn.ceiling > 0,
    ceilingOn.__threw ?? JSON.stringify(ceilingOn),
  );

  // Free building, both ways round, through the real path.
  //
  // Not through `placeBuildingAt`: that debug hook calls `placeAt`, which
  // never checks or charges materials at all, so it cannot tell godmode from
  // a normal player and a case built on it proves nothing about cost. The
  // right-click below is the path a player actually uses, and `tryPlace` is
  // where the bill is waived.
  const wallCount = () =>
    page.evaluate(() =>
      window.__gameDebug.getPlacedBuildings().filter((b) => b.buildingId === "wall").length);

  await probe(() => {
    const d = window.__gameDebug;
    if (!d.isGodMode()) d.sendChat("/godmode");
    d.teleportPlayer(0, 0);
    d.setCameraYaw(0);
  });
  await page.waitForTimeout(1200);
  await selectBuilding(page, (fn, arg) => page.evaluate(fn, arg), "Wall", "wall");
  const beforeFree = await wallCount();
  await pressButton(page, 2);
  await page.waitForTimeout(2500);
  const afterFree = await wallCount();
  const plank = await probe(() =>
    (window.__gameDebug.getInventory().find((s) => s.itemId === "plank") ?? { qty: 0 }).qty);
  ok(
    "godmode builds with no materials at all",
    afterFree === beforeFree + 1 && plank === 0,
    `walls ${beforeFree} -> ${afterFree}, planks held ${plank}`,
  );

  await probe(() => {
    const d = window.__gameDebug;
    if (d.isGodMode()) d.sendChat("/godmode");
  });
  await page.waitForTimeout(800);
  await selectBuilding(page, (fn, arg) => page.evaluate(fn, arg), "Wall", "wall");
  await probe(() => window.__gameDebug.setCameraYaw(Math.PI / 2));
  await page.waitForTimeout(1200);
  const beforePaid = await wallCount();
  await pressButton(page, 2);
  await page.waitForTimeout(2500);
  const afterPaid = await wallCount();
  ok(
    "and with godmode off the same empty inventory cannot",
    afterPaid === beforePaid,
    `walls ${beforePaid} -> ${afterPaid} with 0 planks`,
  );
}

// -------------------------------------------------------------- unknown/say
{
  await probe(() => window.__gameDebug.sendChat("/nosuchthing"));
  await page.waitForTimeout(400);
  const lines = await probe(() => window.__gameDebug.getChatLines());
  ok(
    "an unknown command says so rather than doing nothing",
    Array.isArray(lines) && lines.some((l) => l.kind === "error" && /Unknown command/i.test(l.text)),
    JSON.stringify(lines?.slice?.(-1) ?? lines),
  );

  await probe(() => window.__gameDebug.sendChat("hello there"));
  await page.waitForTimeout(400);
  const said = await probe(() => window.__gameDebug.getChatLines());
  const last = said?.[said.length - 1];
  ok(
    "a line without a slash is just said",
    last?.kind === "say" && last.text === "hello there",
    JSON.stringify(last),
  );
}

// -------------------------------------------------------------- persistence
{
  await probe(() => window.__gameDebug.sendChat("/godmode"));
  await page.waitForTimeout(800);
  const before = await probe(() => window.__gameDebug.isGodMode());
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => !!window.__gameDebug, null, { timeout: 120000 });
  await page.waitForTimeout(2000);
  const after = await probe(() => ({
    on: window.__gameDebug.isGodMode(),
    hidden: document.querySelector(".hud-godmode")?.hidden ?? null,
  }));
  ok(
    "godmode survives a reload, badge and all",
    before === true && !after.__threw && after.on === true && after.hidden === false,
    `${before} -> ${JSON.stringify(after)}`,
  );
}

ok("no console/page errors", errors.length === 0, errors.slice(0, 3).join(" | "));

const passed = results.filter((r) => r.pass).length;
console.log(`\n${passed}/${results.length}`);
await browser.close();
process.exit(passed === results.length ? 0 : 1);
