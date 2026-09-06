// Building is no longer on the number keys — those hold items now — so every
// suite that used to press a digit selects through the B panel instead. This
// is the flow regression.mjs already used, lifted out so the four suites that
// needed changing all do it the same way.
//
// Note the argument passing: page.evaluate serialises the callback and runs it
// inside the browser, so a name captured from this module's scope is simply
// not defined there. Everything the page needs has to travel as the argument.
export async function selectBuilding(page, waitFor, buildingName, buildingId) {
  await page.keyboard.press("KeyB");
  const clicked = await waitFor((name) => {
    const panel = [...document.querySelectorAll(".panel")].find(
      (p) => p.classList.contains("visible") && p.querySelector("h2")?.textContent === "Build",
    );
    if (!panel) return false;
    for (const row of panel.querySelectorAll(".panel-row")) {
      if (row.querySelector(".panel-row-title")?.textContent === name) {
        const button = row.querySelector("button");
        if (!button || button.disabled) return false;
        button.click();
        return true;
      }
    }
    return false;
  }, buildingName);
  if (!clicked) return false;
  if (!(await waitFor((id) => window.__gameDebug.getSelectedBuilding() === id, buildingId))) {
    return false;
  }
  // The panel re-acquires pointer lock on select, and a right-click sent
  // before that lands while the panel still has the pointer — the piece never
  // gets placed. Wait for the lock rather than guessing at a sleep.
  return waitFor(() => window.__gameDebug.isPointerLocked());
}
