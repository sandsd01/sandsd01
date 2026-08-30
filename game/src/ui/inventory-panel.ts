import { getItem } from "../data/items";
import { consumeItem } from "../systems/inventory";
import { assignToSlot } from "../systems/equipment";
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
      "Click a seed to select it for planting, or eat food to heal. Press I to close.",
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

  close(): void {
    this.visible = false;
    this.panel.classList.remove("visible");
  }

  isVisible(): boolean {
    return this.visible;
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

        // Anything with `heals` can be eaten from here — the only place the
        // player can spend food, and what finally gives wheat somewhere to go.
        if (def.heals !== undefined) {
          const eat = el("button", undefined, "Eat");
          eat.addEventListener("click", () => {
            consumeItem(this.state, def.id);
            this.render();
          });
          row.appendChild(eat);
        }

        // Putting an item in hand. Auto-assignment fills the bar with whatever
        // is picked up first, so by the time a sword is crafted every slot is
        // usually taken — without this the player could never hold it.
        const held = this.state.hotbar[this.state.equippedSlot] === def.id;
        const hold = el("button", "panel-hold", held ? "Held" : "Hold");
        if (held) hold.classList.add("selected");
        hold.addEventListener("click", () => {
          assignToSlot(this.state, this.state.equippedSlot, def.id);
          this.render();
        });
        row.appendChild(hold);

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
