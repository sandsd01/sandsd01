import { listRecipes } from "../systems/crafting";
import { canCraft, craft } from "../systems/crafting";
import type { GameState } from "../state/game-state";
import { getItem } from "../data/items";
import { events } from "../utils/events";
import { el } from "./dom";

export class CraftingPanel {
  private readonly panel: HTMLDivElement;
  private readonly list: HTMLDivElement;
  private visible = false;

  constructor(root: HTMLElement, private readonly state: GameState) {
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

  private render(): void {
    this.list.replaceChildren(
      ...listRecipes().map((recipe) => {
        const row = el("div", "panel-row");
        const info = el("div", "panel-row-info");
        info.appendChild(el("span", "panel-row-title", recipe.name));
        const inputsText = recipe.inputs
          .map((i) => `${i.qty}x ${getItem(i.itemId).name}`)
          .join(", ");
        info.appendChild(el("span", "panel-row-sub", `Needs: ${inputsText}`));
        row.appendChild(info);

        const button = el("button", undefined, "Craft");
        const craftable = canCraft(this.state, recipe.id);
        button.disabled = !craftable;
        button.addEventListener("click", () => {
          craft(this.state, recipe.id);
          this.render();
        });
        row.appendChild(button);
        return row;
      }),
    );
  }
}
