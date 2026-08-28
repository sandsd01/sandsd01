import { BUILDINGS } from "../data/buildings";
import { getItem } from "../data/items";
import type { BuildingSystem } from "../systems/building";
import type { GameState } from "../state/game-state";
import { events } from "../utils/events";
import { canAfford } from "./cost-line";
import { el } from "./dom";
import { icon, type IconName } from "./icons";

// Number keys bound to the slots, in the order BUILDINGS declares them.
export const HOTBAR_KEYS = ["Digit1", "Digit2", "Digit3", "Digit4"] as const;

const BUILDING_ICONS: Record<string, IconName> = {
  wall: "fence",
  foundation: "squareStack",
  farm_plot: "sprout",
  brick_wall: "brickWall",
};

// An always-visible row of build pieces. Building previously meant a round
// trip through a panel — open it, read the list, click a row, watch it close,
// then click the world — which is a lot of ceremony for something you do
// dozens of times a session. There are only a handful of pieces, so they live
// on screen permanently and a number key goes straight to placing.
//
// The Build panel still exists (it has room for costs and explanation); this
// just means you rarely need it.
export class BuildHotbar {
  private readonly root: HTMLDivElement;
  private readonly slots: HTMLButtonElement[] = [];
  private readonly ids = Object.keys(BUILDINGS);

  constructor(
    parent: HTMLElement,
    private readonly buildingSystem: BuildingSystem,
    private readonly canvas: HTMLCanvasElement,
    private readonly state: GameState,
  ) {
    this.root = el("div", "hud-hotbar");
    parent.appendChild(this.root);
    this.build();
    this.refresh();

    events.on("inventory-changed", () => this.refresh());
    events.on("building-selection-changed", () => this.refresh());
  }

  private build(): void {
    this.ids.forEach((id, index) => {
      const def = BUILDINGS[id];
      const slot = el("button", "hud-hotbar-slot");
      slot.type = "button";

      slot.appendChild(el("span", "hud-hotbar-key", String(index + 1)));
      slot.appendChild(icon(BUILDING_ICONS[id] ?? "squareStack"));
      slot.appendChild(el("span", "hud-hotbar-name", def.name));
      slot.appendChild(
        el(
          "span",
          "hud-hotbar-cost",
          def.cost.map((c) => `${c.qty} ${getItem(c.itemId).name}`).join(" · "),
        ),
      );

      slot.addEventListener("click", () => {
        this.selectSlot(index);
        // The click that reached this button also released pointer lock; take
        // it straight back so the next click places instead of just re-locking.
        this.canvas.requestPointerLock();
      });

      this.slots.push(slot);
      this.root.appendChild(slot);
    });
  }

  // Selecting the piece that's already active clears it, so the same key both
  // arms and cancels — one less thing to remember than reaching for Q.
  selectSlot(index: number): void {
    const id = this.ids[index];
    if (id === undefined) return;
    if (!canAfford(BUILDINGS[id].cost, this.state)) return;
    this.buildingSystem.selectBuilding(
      this.buildingSystem.getSelectedBuildingId() === id ? null : id,
    );
  }

  private refresh(): void {
    const selected = this.buildingSystem.getSelectedBuildingId();
    this.ids.forEach((id, index) => {
      const slot = this.slots[index];
      slot.classList.toggle("selected", selected === id);
      slot.disabled = !canAfford(BUILDINGS[id].cost, this.state);
    });
  }
}
