/**
 * Runs the check suites against a built game.
 *
 * `node run.mjs` runs all of them; `node run.mjs flightcheck gearcheck` runs
 * just those. Either way it serves `game/dist` itself and tears the server
 * down afterwards, because the single most wasteful mistake available here is
 * running a suite against a stale bundle and believing the result.
 *
 * Exits non-zero if any suite does, so it can gate a commit.
 *
 * `CHECK_BAIL=1` stops at the first failure. A bundle that fails to boot at
 * all fails `smoke-check` in about three seconds, but leaves the suites after
 * it waiting out their full timeouts for a game that is never going to appear
 * — seven minutes to learn what the first three seconds already said. CI sets
 * it; running by hand does not, because there the whole picture is worth more
 * than the time.
 */
import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const gameDir = join(here, "..");
const PORT = Number(process.env.CHECK_PORT ?? 4173);
const URL = `http://localhost:${PORT}/`;

/** Suites named on the command line, or every *check.mjs if none were. */
async function chooseSuites() {
  const asked = process.argv.slice(2).map((n) => (n.endsWith(".mjs") ? n : `${n}.mjs`));
  const all = (await readdir(here)).filter((f) => f.endsWith("check.mjs")).sort();
  if (!asked.length) return all;
  const missing = asked.filter((n) => !all.includes(n));
  if (missing.length) {
    console.error(`no such suite: ${missing.join(", ")}`);
    process.exit(2);
  }
  return asked;
}

function run(cmd, args, opts = {}) {
  return spawn(cmd, args, { stdio: opts.quiet ? "ignore" : "inherit", ...opts });
}

/** Polls rather than sleeping: the preview server is ready when it answers. */
async function waitForServer(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(URL);
      if (res.ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

const suites = await chooseSuites();

const server = run("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], {
  cwd: gameDir,
  quiet: true,
});
const stopServer = () => {
  try {
    server.kill("SIGTERM");
  } catch {
    // already gone
  }
};
process.on("exit", stopServer);
process.on("SIGINT", () => {
  stopServer();
  process.exit(130);
});

if (!(await waitForServer())) {
  stopServer();
  console.error(`nothing answered on ${URL} — has \`npm run build\` been run in game/?`);
  process.exit(1);
}

const results = [];
for (const suite of suites) {
  const started = Date.now();
  console.log(`\n─── ${suite} ${"─".repeat(Math.max(0, 60 - suite.length))}`);
  const code = await new Promise((resolve) => {
    const child = run("node", [join(here, suite), URL], { cwd: here });
    child.on("close", resolve);
  });
  const seconds = Math.round((Date.now() - started) / 1000);
  results.push({ suite, code, seconds });
  if (code !== 0 && process.env.CHECK_BAIL) {
    console.log(`\n${suite} failed and CHECK_BAIL is set — skipping the rest.`);
    break;
  }
}

stopServer();

console.log("\n═══ summary ═══");
for (const { suite, code, seconds } of results) {
  console.log(`${code === 0 ? "pass" : "FAIL"}  ${suite.padEnd(20)} ${seconds}s`);
}
const failed = results.filter((r) => r.code !== 0);
const skipped = suites.length - results.length;
console.log(
  `\n${results.length - failed.length}/${suites.length} suites passed` +
    (skipped ? ` (${skipped} not run — bailed after the first failure)` : ""),
);
process.exit(failed.length ? 1 : 0);
