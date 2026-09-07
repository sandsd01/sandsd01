import { el } from "./dom";
import { icon } from "./icons";

/**
 * The bar across the top of every panel: its name, and the way out.
 *
 * Escape and clicking off a panel both close it, but neither is visible. A
 * player who has not tried either has no way to know they exist, and the only
 * written instruction — a "Press C to close" line in the footer — was a
 * hardcoded letter in two of the six panels, so it lied outright to anyone who
 * had rebound the key. A button says the same thing without being able to go
 * out of date.
 *
 * Returns the `h2` as well as the header, because `container-panel.ts` keeps a
 * reference to rewrite its own title as the barrel fills up.
 */
export function panelHeader(
  title: string,
  onClose: () => void,
): { header: HTMLDivElement; title: HTMLHeadingElement; close: HTMLButtonElement } {
  const header = el("div", "panel-header");
  const heading = el("h2", undefined, title);

  const close = document.createElement("button");
  close.type = "button";
  close.className = "panel-close";
  // The label is for screen readers and the tooltip for everyone else. Unlike
  // the HUD's stat-point pip — whose `title` can never be read, because the
  // player is in pointer lock whenever the HUD is what they are looking at —
  // this one is reachable: opening any panel releases the pointer.
  close.setAttribute("aria-label", "Close");
  close.title = "Close (Esc)";
  close.appendChild(icon("x", "icon"));
  close.addEventListener("click", onClose);

  header.append(heading, close);
  return { header, title: heading, close };
}
