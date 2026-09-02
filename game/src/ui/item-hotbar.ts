import { getItem } from "../data/items";
import { HOTBAR_SIZE, selectSlot } from "../systems/equipment";
import type { GameState } from "../state/game-state";
import { events } from "../utils/events";
import { el } from "./dom";
import { icon, type IconName } from "./icons";
import { keyLabel, type Bindings } from "../state/keybindings";

// Actions bound to the slots. The action names are unchanged from when these
// picked build pieces, on purpose: renaming them would orphan every binding a
// player has already saved under the same storage key.
export const HOTBAR_ACTIONS = [
  "hotbar1",
  "hotbar2",
  "hotbar3",
  "hotbar4",
  "hotbar5",
  "hotbar6",
  "hotbar7",
  "hotbar8",
] as const;

const ITEM_ICONS: Record<string, IconName> = {
  wood: "trees",
  stone: "mountain",
  plank: "layers",
  brick: "brickWall",
  clay: "layers",
  iron_ore: "gem",
  iron_ingot: "gem",
  axe: "axe",
  iron_axe: "axe",
  pickaxe: "pickaxe",
  iron_pickaxe: "pickaxe",
  sword: "sword",
  iron_sword: "sword",
  wheat: "wheat",
  wheat_seed: "sprout",
  berry: "grape",
  bread: "wheat",
  // These four had no entry and fell through to the generic stack glyph, so a
  // bow and a quiver of arrows sat side by side in the bar wearing the same
  // icon — which is the same as having no icon at all.
  bone: "bone",
  hide: "layers",
  bone_club: "hammer",
  broth: "flame",
  bow: "crosshair",
  arrow: "navigation",
};

// The eight quick slots, holding what the player carries rather than what they
// can build. Crafting a sword used to change nothing on screen; now it lands
// in a slot, and pressing that number puts it in the character's hand.
export class ItemHotbar {
  private readonly root: HTMLDivElement;
  private readonly slots: HTMLButtonElement[] = [];

  constructor(
    parent: HTMLElement,
    private readonly state: GameState,
    private readonly canvas: HTMLCanvasElement,
    private bindings: Bindings,
  ) {
    this.root = el("div", "hud-hotbar");
    parent.appendChild(this.root);
    this.build();
    this.refresh();

    events.on("inventory-changed", () => this.refresh());
    events.on("equipped-changed", () => this.refresh());
  }

  private build(): void {
    for (let index = 0; index < HOTBAR_SIZE; index++) {
      const slot = el("button", "hud-hotbar-slot");
      slot.type = "button";
      slot.appendChild(
        el("span", "hud-hotbar-key", keyLabel(this.bindings[HOTBAR_ACTIONS[index]][0] ?? "")),
      );
      // Icon, name and count are filled by refresh(): unlike build pieces, a
      // slot's contents change as the bag does, so nothing here is static.
      slot.appendChild(el("span", "hud-hotbar-icon"));
      slot.appendChild(el("span", "hud-hotbar-name"));
      slot.appendChild(el("span", "hud-hotbar-cost"));

      slot.addEventListener("click", () => {
        selectSlot(this.state, index);
        // The click that reached this button also released pointer lock; take
        // it straight back so play resumes without a second click.
        this.canvas.requestPointerLock();
      });

      this.slots.push(slot);
      this.root.appendChild(slot);
    }
  }

  setBindings(bindings: Bindings): void {
    this.bindings = bindings;
    this.slots.forEach((slot, index) => {
      const badge = slot.querySelector(".hud-hotbar-key");
      if (badge) badge.textContent = keyLabel(this.bindings[HOTBAR_ACTIONS[index]][0] ?? "");
    });
  }

  refresh(): void {
    this.slots.forEach((slot, index) => {
      const itemId = this.state.hotbar[index] ?? null;
      const qty = itemId ? this.count(itemId) : 0;
      const empty = itemId === null || qty <= 0;

      slot.classList.toggle("selected", index === this.state.equippedSlot);
      slot.classList.toggle("empty", empty);
      // An empty slot stays pressable: selecting it is how you put your hands
      // down, which matters when a held tool would otherwise decide the action.
      slot.disabled = false;

      const iconHost = slot.querySelector(".hud-hotbar-icon") as HTMLElement;
      const name = slot.querySelector(".hud-hotbar-name") as HTMLElement;
      const count = slot.querySelector(".hud-hotbar-cost") as HTMLElement;

      iconHost.replaceChildren();
      if (empty || !itemId) {
        name.textContent = "";
        count.textContent = "";
        return;
      }
      const def = getItem(itemId);
      iconHost.appendChild(icon(ITEM_ICONS[itemId] ?? "squareStack"));
      name.textContent = def.name;
      // Tools come one to a stack, so a "1" under every one of them is noise.
      count.textContent = def.stackSize > 1 ? String(qty) : "";
    });
  }

  private count(itemId: string): number {
    return this.state.inventory
      .filter((slot) => slot.itemId === itemId)
      .reduce((sum, slot) => sum + slot.qty, 0);
  }
}
