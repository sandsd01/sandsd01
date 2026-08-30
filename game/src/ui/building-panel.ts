import { BUILDINGS } from "../data/buildings";
import type { BuildingSystem } from "../systems/building";
import type { GameState } from "../state/game-state";
import { events } from "../utils/events";
import { canAfford, costLine } from "./cost-line";
import { el } from "./dom";

export class BuildingPanel {
  private readonly panel: HTMLDivElement;
  private readonly list: HTMLDivElement;
  private visible = false;

  constructor(
    root: HTMLElement,
    private readonly buildingSystem: BuildingSystem,
    private readonly canvas: HTMLCanvasElement,
    private readonly state: GameState,
  ) {
    this.panel = el("div", "panel");
    this.panel.appendChild(el("h2", undefined, "Build"));
    this.list = el("div");
    this.panel.appendChild(this.list);
    this.panel.appendChild(
      el(
        "p",
        "panel-hint",
        "Select a piece, aim where you want it, right-click to place. Q cancels. Press B to close.",
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

  private render(): void {
    const selected = this.buildingSystem.getSelectedBuildingId();
    this.list.replaceChildren(
      ...Object.values(BUILDINGS).map((def) => {
        const row = el("div", "panel-row");
        const info = el("div", "panel-row-info");
        info.appendChild(el("span", "panel-row-title", def.name));
        info.appendChild(costLine("Cost", def.cost, this.state));
        row.appendChild(info);

        const affordable = canAfford(def.cost, this.state);
        const button = el("button", undefined, selected === def.id ? "Selected" : "Select");
        if (selected === def.id) button.classList.add("selected");
        button.disabled = !affordable;
        button.addEventListener("click", () => {
          this.buildingSystem.selectBuilding(def.id);
          this.close();
          // Re-acquire pointer lock immediately (it was released to make
          // this button clickable) so the very next click places the
          // building instead of being consumed just re-locking the pointer.
          this.canvas.requestPointerLock();
        });
        row.appendChild(button);
        return row;
      }),
    );
  }
}
