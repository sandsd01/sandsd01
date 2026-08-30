import {
  BUILDINGS,
  BUILDING_CATEGORIES,
  BUILDING_CATEGORY_LABELS,
  type BuildingCategory,
} from "../data/buildings";
import type { BuildingSystem } from "../systems/building";
import type { GameState } from "../state/game-state";
import { events } from "../utils/events";
import { canAfford, costLine } from "./cost-line";
import { el } from "./dom";
import { icon, type IconName } from "./icons";

type Filter = "all" | BuildingCategory;

// One glyph per category, from icons already bundled but never used.
const CATEGORY_ICONS: Record<BuildingCategory, IconName> = {
  structure: "brickWall",
  station: "flame",
  storage: "squareStack",
  farming: "shovel",
};

export class BuildingPanel {
  private readonly panel: HTMLDivElement;
  private readonly chips: HTMLDivElement;
  private readonly list: HTMLDivElement;
  private visible = false;
  private filter: Filter = "all";

  constructor(
    root: HTMLElement,
    private readonly buildingSystem: BuildingSystem,
    private readonly canvas: HTMLCanvasElement,
    private readonly state: GameState,
  ) {
    this.panel = el("div", "panel");
    this.panel.appendChild(el("h2", undefined, "Build"));
    this.chips = el("div", "panel-chips");
    this.panel.appendChild(this.chips);
    this.buildChips();
    this.list = el("div");
    this.panel.appendChild(this.list);
    this.panel.appendChild(
      el(
        "p",
        "panel-hint",
        "Select a piece, aim where you want it, right-click to place. R rotates, Q cancels. Press B to close.",
      ),
    );
    root.appendChild(this.panel);

    events.on("inventory-changed", () => {
      if (this.visible) this.render();
    });
    // Q cancels placement from outside this panel; without this the row would
    // go on claiming to be "Selected".
    events.on("building-selection-changed", () => {
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

  private buildChips(): void {
    const filters: Filter[] = ["all", ...BUILDING_CATEGORIES];
    this.chips.replaceChildren(
      ...filters.map((value) => {
        const label = value === "all" ? "All" : BUILDING_CATEGORY_LABELS[value];
        const chip = el("button", "panel-chip", label);
        chip.type = "button";
        chip.addEventListener("click", () => {
          this.filter = value;
          this.render();
        });
        return chip;
      }),
    );
  }

  private syncChips(): void {
    const filters: Filter[] = ["all", ...BUILDING_CATEGORIES];
    this.chips.querySelectorAll("button").forEach((chip, i) => {
      const active = filters[i] === this.filter;
      chip.classList.toggle("selected", active);
      chip.setAttribute("aria-pressed", String(active));
    });
  }

  private render(): void {
    this.syncChips();
    const selected = this.buildingSystem.getSelectedBuildingId();
    const shown = Object.values(BUILDINGS).filter(
      (def) => this.filter === "all" || def.category === this.filter,
    );

    this.list.replaceChildren(
      ...shown.map((def) => {
        const row = el("div", "panel-row");
        // Icon and text travel together; the row is space-between, so a loose
        // icon child would be flung to the far edge from its own words.
        const main = el("div", "panel-row-main");
        main.appendChild(icon(CATEGORY_ICONS[def.category], "icon panel-row-icon"));

        const info = el("div", "panel-row-info");
        info.appendChild(el("span", "panel-row-title", def.name));
        info.appendChild(costLine("Cost", def.cost, this.state));
        main.appendChild(info);
        row.appendChild(main);

        // Selectable even when you cannot afford it. A disabled button hid
        // what the piece costs behind a dead control, which is the opposite
        // of what the crafting panel does — there, everything is listed with
        // what is missing spelled out.
        const affordable = canAfford(def.cost, this.state);
        const button = el("button", undefined, selected === def.id ? "Selected" : "Select");
        if (selected === def.id) button.classList.add("selected");
        button.addEventListener("click", () => {
          this.buildingSystem.selectBuilding(def.id);
          this.close();
          // Re-acquire pointer lock immediately (it was released to make
          // this button clickable) so the very next click places the
          // building instead of being consumed just re-locking the pointer.
          this.canvas.requestPointerLock();
        });
        row.appendChild(button);
        if (!affordable) row.classList.add("unaffordable");
        return row;
      }),
    );
  }
}
