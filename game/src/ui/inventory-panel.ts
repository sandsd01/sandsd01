import { getItem } from "../data/items";
import type { GameState } from "../state/game-state";
import { events } from "../utils/events";
import { el } from "./dom";

export class InventoryPanel {
  private readonly panel: HTMLDivElement;
  private readonly list: HTMLDivElement;
  private visible = false;

  constructor(
    root: HTMLElement,
    private readonly state: GameState,
    private readonly onSelectSeed: (itemId: string) => void,
    private getSelectedSeed: () => string | null,
  ) {
    this.panel = el("div", "panel");
    this.panel.appendChild(el("h2", undefined, "Inventory"));
    this.list = el("div");
    this.panel.appendChild(this.list);
    const hint = el(
      "p",
      "panel-hint",
      "Click a seed to select it for planting. Press I to close.",
    );
    this.panel.appendChild(hint);
    root.appendChild(this.panel);

    events.on("inventory-changed", () => {
      if (this.visible) this.render();
    });
  }

  toggle(): void {
    this.visible = !this.visible;
    this.panel.classList.toggle("visible", this.visible);
    if (this.visible) this.render();
  }

  private render(): void {
    const selected = this.getSelectedSeed();
    this.list.replaceChildren(
      ...this.state.inventory.map((slot) => {
        const def = getItem(slot.itemId);
        const row = el("div", "panel-row");
        const info = el("div", "panel-row-info");
        info.appendChild(el("span", "panel-row-title", def.name));
        info.appendChild(el("span", "panel-row-sub", `x${slot.qty}`));
        row.appendChild(info);

        if (def.category === "seed") {
          const button = el("button", undefined, selected === def.id ? "Selected" : "Select");
          if (selected === def.id) button.classList.add("selected");
          button.addEventListener("click", () => {
            this.onSelectSeed(def.id);
            this.render();
          });
          row.appendChild(button);
        }
        return row;
      }),
    );
  }
}
