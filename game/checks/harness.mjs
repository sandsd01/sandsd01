/**
 * Shared setup for the check suites.
 *
 * These suites drive the real game in a real browser: they are the reason a
 * change to `game/src` can be trusted, and until now they lived outside the
 * repository entirely. Every one of them used to open with a hardcoded path
 * into one particular sandbox — the Playwright install, the Chromium binary,
 * and in six cases the URL as well, ignoring the argument they were passed.
 * That is what this file exists to remove.
 */

export { chromium } from "playwright";

/**
 * Where the suites point their browser.
 *
 * `npm run checks` serves the built `dist/` and passes this in; run a suite by
 * hand and it falls back to whatever `vite preview` uses by default. Two suites
 * (`costcheck`, `shadowcheck`) used to hardcode port 5174 *and* ignore their
 * argument, so they silently tested whatever happened to be on that port —
 * they go through here now like everything else.
 */
export const BASE_URL =
  process.argv[2] ?? process.env.CHECK_URL ?? "http://localhost:4173/";

/**
 * Launch options every suite spreads into its own `chromium.launch({...})`.
 *
 * `executablePath` is left undefined unless `CHECK_CHROMIUM` is set, so a
 * normal checkout uses the browser `npx playwright install chromium` provides.
 * The software renderer is not optional: these run headless with no GPU, and
 * without it Three.js gets no WebGL context and every suite fails at boot for
 * a reason that has nothing to do with the code under test.
 */
export const LAUNCH = {
  executablePath: process.env.CHECK_CHROMIUM || undefined,
  args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
};

/**
 * Turns the camera by a relative mouse delta, the way the game itself sees it.
 *
 * `page.mouse.move` does not work for mouse-look in this environment, and it
 * fails silently rather than erroring. Measured: under pointer lock, 46
 * synthesised moves reached the page and every one of them carried
 * `movementX === 0 && movementY === 0`, so `input-manager.ts` — which
 * accumulates exactly those two fields — correctly did nothing, and the camera
 * sat at `pitch 0.000` while the suite reported a look bug that did not exist.
 * Chromium is not computing pointer-lock deltas for CDP-injected mouse events
 * here.
 *
 * What this bypasses is only that computation. The event still goes to
 * `document`, still passes the `pointerLocked` gate, and still drives the
 * game's own handler and everything downstream of it — the part the checks
 * exist to cover. What is *not* covered any more is the browser's own delta
 * maths, which is not ours and which we cannot exercise here either way.
 *
 * Several small steps rather than one large one, because the game clamps pitch
 * per event and one big delta would be clipped where the same movement spread
 * over a gesture is not.
 */
export async function lookBy(page, dx, dy, steps = 12) {
  await page.evaluate(
    ({ dx, dy, steps }) => {
      for (let i = 0; i < steps; i++) {
        document.dispatchEvent(
          new MouseEvent("mousemove", {
            movementX: dx / steps,
            movementY: dy / steps,
            bubbles: true,
          }),
        );
      }
    },
    { dx, dy, steps },
  );
}

/**
 * Waits until the player has actually stopped moving.
 *
 * These placement cases assumed a standing player and never checked. They are
 * not vague about it either — the arithmetic gives the whole story. The aim
 * point is `feet + forward * reach`, and the cell is a plain `worldToCell` of
 * that with no snapping and no search, so a piece reported at cell (-3,-2)
 * with the camera facing -z means the feet were near (-3, 3) when the click
 * was handled. The check had read them at (0, 0) a moment earlier: the player
 * was still sliding down from where the teleport dropped them.
 *
 * That gap matters here in a way it would not at full speed, because the click
 * is acted on inside the update loop rather than in the event handler, and a
 * frame is most of a second on this machine. Read, drift, click: three
 * different positions.
 */
export async function settlePlayer(page) {
  let last = null;
  let still = 0;
  for (let i = 0; i < 80; i++) {
    const now = await page.evaluate(() => window.__gameDebug.getPlayerPosition());
    if (last && Math.abs(now.x - last.x) < 1e-3 && Math.abs(now.z - last.z) < 1e-3 &&
        Math.abs(now.y - last.y) < 1e-3) {
      // Three agreeing reads rather than two: at this frame rate two polls can
      // land inside one frame and agree because nothing has been simulated
      // yet, not because the player has come to rest.
      if (++still >= 3) return now;
    } else {
      still = 0;
    }
    last = now;
    await page.waitForTimeout(250);
  }
  return last;
}

