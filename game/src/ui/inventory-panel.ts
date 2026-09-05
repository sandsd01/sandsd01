import { getItem } from "../data/items";
import { consumeItem } from "../systems/inventory";
import { assignToSlot, takeOffArmour, wearArmour } from "../systems/equipment";
import { ARMOUR, isArmour } from "../data/armour";
import type { GameState } from "../state/game-state";
import { events } from "../utils/events";
import { el } from "./dom";

export class InventoryPanel {
  private readonly panel: HTMLDivElement;
  private readonly list: HTMLDivElement;
  private readonly hint: HTMLParagraphElement;
  private visible = false;

  constructor(
    root: HTMLElement,
    private readonly state: GameState,
    private readonly onSelectSeed: (itemId: string) => void,
    private getSelectedSeed: () => string | null,
    private readonly closeKeyLabel: () => string = () => "Tab",
  ) {
    this.panel = el("div", "panel");
    this.panel.appendChild(el("h2", undefined, "Inventory"));
    this.list = el("div");
    this.panel.appendChild(this.list);
    // Read from the live binding rather than written into the string: this
    // line said "Press I to close" while the key on screen and in the Options
    // list was Tab, and a rebind would have made it wrong all over again.
    this.hint = el("p", "panel-hint", "");
    this.panel.appendChild(this.hint);
    root.appendChild(this.panel);

    events.on("inventory-changed", () => {
      if (this.visible) this.render();
    });
    events.on("armour-changed", () => {
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

  /**
   * The piece being worn, as its own row.
   *
   * Worn armour is out of `inventory` (see `wearArmour`), so without this
   * there would be no row for it anywhere and no way to take it off again
   * short of reloading.
   */
  private wornRow(): HTMLElement | null {
    const worn = this.state.armour;
    if (!worn) return null;
    const def = getItem(worn);
    const row = el("div", "panel-row");
    const info = el("div", "panel-row-info");
    info.appendChild(el("span", "panel-row-title", def.name));
    const pct = Math.round((ARMOUR[worn]?.reduction ?? 0) * 100);
    info.appendChild(el("span", "panel-row-sub", `worn · -${pct}% damage`));
    row.appendChild(info);
    const off = el("button", undefined, "Take off");
    off.addEventListener("click", () => {
      takeOffArmour(this.state);
      this.render();
    });
    row.appendChild(off);
    return row;
  }

  private render(): void {
    this.hint.textContent = `Click a seed to select it for planting, or eat food to heal. Press ${this.closeKeyLabel()} to close.`;
    const selected = this.getSelectedSeed();
    const worn = this.wornRow();
    this.list.replaceChildren(
      ...(worn ? [worn] : []),
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

        // Armour is worn rather than held, so it gets its own verb next to
        // Hold rather than sharing one.
        if (isArmour(def.id)) {
          const wear = el("button", undefined, "Wear");
          wear.addEventListener("click", () => {
            wearArmour(this.state, def.id);
            this.render();
          });
          row.appendChild(wear);
        }

        // Putting an item in hand. Auto-assignment fills the bar with whatever
        // is picked up first, so by the time a sword is crafted every slot is
        // usually taken — without this the player could never hold it.
        //
        // Armour is the one thing with no Hold: it is worn, and a quick slot
        // holding it would be a slot that does nothing when you press it.
        if (!isArmour(def.id)) {
          const held = this.state.hotbar[this.state.equippedSlot] === def.id;
          const hold = el("button", "panel-hold", held ? "Held" : "Hold");
          if (held) hold.classList.add("selected");
          hold.addEventListener("click", () => {
            assignToSlot(this.state, this.state.equippedSlot, def.id);
            this.render();
          });
          row.appendChild(hold);
        }

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
