import { getItem } from "../data/items";
import { CONTAINER_SLOTS, containerOf, deposit, withdraw } from "../systems/containers";
import type { GameState } from "../state/game-state";
import { events } from "../utils/events";
import { el } from "./dom";

// Two lists side by side — your bag and the barrel — and a click moves a stack
// across. Deliberately not drag-and-drop: a click is one gesture that works the
// same with a trackpad, and there is no arrangement to preserve on either side.
export class ContainerPanel {
  private readonly panel: HTMLDivElement;
  private readonly body: HTMLDivElement;
  private readonly title: HTMLHeadingElement;
  private visible = false;
  private openId: string | null = null;

  constructor(root: HTMLElement, private readonly state: GameState) {
    this.panel = el("div", "panel panel-wide");
    this.title = el("h2", undefined, "Barrel");
    this.panel.appendChild(this.title);
    this.body = el("div", "container-columns");
    this.panel.appendChild(this.body);
    this.panel.appendChild(
      el("p", "panel-hint", "Click to move a stack. Press Esc to close."),
    );
    root.appendChild(this.panel);

    events.on("inventory-changed", () => {
      if (this.visible) this.render();
    });
    events.on("container-changed", () => {
      if (this.visible) this.render();
    });
  }

  /** Opens onto a specific barrel. */
  open(buildingId: string): void {
    this.openId = buildingId;
    this.visible = true;
    this.panel.classList.add("visible");
    this.render();
  }

  // The panel list in main.ts calls toggle() blind; without a barrel aimed at
  // there is nothing to show, so this only ever closes.
  toggle(): void {
    if (this.visible) this.close();
  }

  close(): void {
    if (!this.visible) return;
    this.visible = false;
    this.openId = null;
    this.panel.classList.remove("visible");
  }

  isVisible(): boolean {
    return this.visible;
  }

  private render(): void {
    if (this.openId === null) return;
    const stored = containerOf(this.state, this.openId);
    this.title.textContent = `Barrel (${stored.length}/${CONTAINER_SLOTS})`;

    const bag = el("div", "container-column");
    bag.appendChild(el("h3", "panel-subheading", "You carry"));
    for (const slot of this.state.inventory) {
      bag.appendChild(
        this.row(slot.itemId, slot.qty, "Store →", () => {
          deposit(this.state, this.openId!, slot.itemId, slot.qty);
        }),
      );
    }

    const barrel = el("div", "container-column");
    barrel.appendChild(el("h3", "panel-subheading", "In the barrel"));
    if (stored.length === 0) {
      barrel.appendChild(el("p", "panel-empty", "Empty."));
    }
    for (const slot of stored) {
      barrel.appendChild(
        this.row(slot.itemId, slot.qty, "← Take", () => {
          withdraw(this.state, this.openId!, slot.itemId, slot.qty);
        }),
      );
    }

    this.body.replaceChildren(bag, barrel);
  }

  private row(itemId: string, qty: number, label: string, act: () => void): HTMLDivElement {
    const row = el("div", "panel-row");
    const info = el("div", "panel-row-info");
    info.appendChild(el("span", "panel-row-title", getItem(itemId).name));
    info.appendChild(el("span", "panel-row-sub", `x${qty}`));
    row.appendChild(info);
    const button = el("button", undefined, label);
    button.addEventListener("click", act);
    row.appendChild(button);
    return row;
  }
}
