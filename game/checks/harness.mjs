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
