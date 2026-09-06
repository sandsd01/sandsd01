// Editing the save between two loads of the game.
//
// The obvious way — evaluate a delete, then navigate back to the game — does
// not work, and quietly does the wrong thing rather than failing. The game
// persists on `beforeunload`, so navigating away writes the LIVE state back
// over whatever the test just edited, and the reload then loads a perfectly
// modern save. Every "an old save still loads" check written that way was
// really checking that the current session round-trips, which it always does.
//
// So: park on the same origin with the game's own scripts blocked, so nothing
// can boot and nothing can re-save, edit there, then unblock and go back.
// Blocking is done by route interception rather than by picking a URL the
// server won't serve, because this app answers every path with index.html —
// a "wrong" path still boots the game (and 404s its textures on the way).

export async function editSaveOffline(page, baseUrl, mutate, key = "romestead-save-v1") {
  const base = baseUrl.replace(/\/$/, "");
  // Fulfilled empty rather than aborted: an aborted request shows up in the
  // page's console as net::ERR_FAILED, and these suites treat any console
  // error as a failure — the scaffolding would fail the test it enables.
  const blockScripts = (route) =>
    route.fulfill({ status: 200, contentType: "application/javascript", body: "" });
  await page.route("**/*.js", blockScripts);
  try {
    await page.goto(`${base}/?save-edit`, { waitUntil: "domcontentloaded" });
    const booted = await page.evaluate(() => typeof window.__gameDebug !== "undefined");
    if (booted) throw new Error("game booted on the park page — the edit would be overwritten");

    const applied = await page.evaluate(
      ([storageKey, source]) => {
        const raw = localStorage.getItem(storageKey);
        if (!raw) return { ok: false, reason: "no save present" };
        const save = JSON.parse(raw);
        new Function("save", source)(save);
        localStorage.setItem(storageKey, JSON.stringify(save));
        return { ok: true };
      },
      [key, `(${mutate.toString()})(save);`],
    );
    if (!applied.ok) throw new Error(`could not edit save: ${applied.reason}`);
  } finally {
    await page.unroute("**/*.js", blockScripts);
  }
}
