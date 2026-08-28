import { craft, hasIngredients, listRecipes, type StationCheck } from "../systems/crafting";
import { getBuilding } from "../data/buildings";
import type { GameState } from "../state/game-state";
import { events } from "../utils/events";
import { costLine } from "./cost-line";
import { el } from "./dom";

export class CraftingPanel {
  private readonly panel: HTMLDivElement;
  private readonly list: HTMLDivElement;
  private visible = false;

  constructor(
    root: HTMLElement,
    private readonly state: GameState,
    private readonly hasStation: StationCheck = () => true,
  ) {
    this.panel = el("div", "panel");
    this.panel.appendChild(el("h2", undefined, "Crafting"));
    this.list = el("div");
    this.panel.appendChild(this.list);
    this.panel.appendChild(el("p", "panel-hint", "Press C to close."));
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
    this.list.replaceChildren(
      ...listRecipes().map((recipe) => {
        const row = el("div", "panel-row");
        const info = el("div", "panel-row-info");
        info.appendChild(el("span", "panel-row-title", recipe.name));
        info.appendChild(costLine("Needs", recipe.inputs, this.state));

        // A disabled button always says why. Missing ingredients are already
        // spelled out by the cost line, so this covers the other reason.
        const station = recipe.requiresStation;
        const stationMissing = station !== undefined && !this.hasStation(station);
        if (stationMissing) {
          info.appendChild(
            el("span", "panel-row-warn", `Needs a ${getBuilding(station).name} nearby`),
          );
        }
        row.appendChild(info);

        const button = el("button", undefined, "Craft");
        button.disabled = stationMissing || !hasIngredients(this.state, recipe.id);
        button.addEventListener("click", () => {
          craft(this.state, recipe.id, this.hasStation);
          this.render();
        });
        row.appendChild(button);
        return row;
      }),
    );
  }
}
