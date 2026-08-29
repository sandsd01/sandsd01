import { getBuilding } from "../data/buildings";
import { getItem } from "../data/items";
import {
  RECIPE_CATEGORIES,
  RECIPE_CATEGORY_LABELS,
  type RecipeCategory,
  type RecipeDef,
} from "../data/recipes";
import {
  canCraft,
  craftableCount,
  craftMany,
  hasIngredients,
  listKnownRecipes,
  type StationCheck,
} from "../systems/crafting";
import type { GameState } from "../state/game-state";
import { events } from "../utils/events";
import { costLine } from "./cost-line";
import { el } from "./dom";
import { indefinite } from "../utils/text";
import { icon, type IconName } from "./icons";

// One glyph per category, so a row is identifiable before it is read. Every
// name here already ships in ui/icons.ts — no new assets.
const CATEGORY_ICONS: Record<RecipeCategory, IconName> = {
  materials: "squareStack",
  tools: "hammer",
  weapons: "sword",
  farming: "sprout",
  food: "wheat",
};

type Filter = RecipeCategory | "all";

// How many a single batch press will make. Beyond this the button stops being
// a convenience and starts being a way to empty your pockets by accident.
const BATCH_CAP = 10;

export class CraftingPanel {
  private readonly panel: HTMLDivElement;
  private readonly list: HTMLDivElement;
  private readonly chips: HTMLDivElement;
  private readonly search: HTMLInputElement;
  private readonly craftableToggle: HTMLButtonElement;
  private visible = false;
  private filter: Filter = "all";
  private craftableOnly = false;

  constructor(
    root: HTMLElement,
    private readonly state: GameState,
    private readonly hasStation: StationCheck,
  ) {
    this.panel = el("div", "panel");
    this.panel.appendChild(el("h2", undefined, "Crafting"));

    // Filter chips rather than tabs: a chip row shows every category at once
    // with the active one marked, so switching costs one click and no reading.
    this.chips = el("div", "panel-chips");
    this.panel.appendChild(this.chips);

    const controls = el("div", "panel-controls");
    this.search = document.createElement("input");
    this.search.type = "search";
    this.search.className = "panel-search";
    this.search.placeholder = "Search recipes";
    this.search.setAttribute("aria-label", "Search recipes");
    this.search.addEventListener("input", () => this.render());
    controls.appendChild(this.search);

    // The one filter players of this genre reach for first: hide what you
    // cannot make right now.
    this.craftableToggle = el("button", "panel-toggle", "Craftable now");
    this.craftableToggle.type = "button";
    this.craftableToggle.setAttribute("aria-pressed", "false");
    this.craftableToggle.addEventListener("click", () => {
      this.craftableOnly = !this.craftableOnly;
      this.render();
    });
    controls.appendChild(this.craftableToggle);
    this.panel.appendChild(controls);

    this.list = el("div");
    this.panel.appendChild(this.list);
    this.panel.appendChild(el("p", "panel-hint", "Press C to close."));
    root.appendChild(this.panel);

    this.buildChips();

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
    // Bail before touching anything if this panel wasn't the one open:
    // togglePanel() closes *every* panel before opening the target, so an
    // unguarded close would clear the badges on the way in and they would
    // never be seen.
    if (!this.visible) return;
    this.visible = false;
    this.panel.classList.remove("visible");
    // Marking recipes seen on close rather than on open lets the badge stay up
    // for the whole visit, so a player who opened the panel for another reason
    // still notices what is new before it is cleared.
    this.state.unseenRecipes.length = 0;
  }

  isVisible(): boolean {
    return this.visible;
  }

  private buildChips(): void {
    const filters: Filter[] = ["all", ...RECIPE_CATEGORIES];
    this.chips.replaceChildren(
      ...filters.map((value) => {
        const label = value === "all" ? "All" : RECIPE_CATEGORY_LABELS[value];
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
    const filters: Filter[] = ["all", ...RECIPE_CATEGORIES];
    this.chips.querySelectorAll("button").forEach((chip, i) => {
      const active = filters[i] === this.filter;
      chip.classList.toggle("selected", active);
      chip.setAttribute("aria-pressed", String(active));
    });
    this.craftableToggle.classList.toggle("selected", this.craftableOnly);
    this.craftableToggle.setAttribute("aria-pressed", String(this.craftableOnly));
  }

  private visibleRecipes(): RecipeDef[] {
    const query = this.search.value.trim().toLowerCase();
    return listKnownRecipes(this.state).filter((recipe) => {
      if (this.filter !== "all" && recipe.category !== this.filter) return false;
      if (query && !recipe.name.toLowerCase().includes(query)) return false;
      if (this.craftableOnly && !canCraft(this.state, recipe.id, this.hasStation)) return false;
      return true;
    });
  }

  private render(): void {
    this.syncChips();
    const recipes = this.visibleRecipes();

    if (recipes.length === 0) {
      // An empty list has to say why it is empty, or it reads as a bug.
      const known = listKnownRecipes(this.state).length;
      const message =
        known === 0
          ? "Gather something to learn your first recipe."
          : "Nothing matches. Try another filter.";
      this.list.replaceChildren(el("p", "panel-empty", message));
      return;
    }

    this.list.replaceChildren(...recipes.map((recipe) => this.renderRow(recipe)));
  }

  private renderRow(recipe: RecipeDef): HTMLDivElement {
    const row = el("div", "panel-row");
    // Icon and text travel together; the row itself is space-between, so a
    // loose icon child would be flung to the opposite edge from its own words.
    const main = el("div", "panel-row-main");
    main.appendChild(icon(CATEGORY_ICONS[recipe.category], "icon panel-row-icon"));

    const info = el("div", "panel-row-info");

    const heading = el("div", "panel-row-heading");
    heading.appendChild(el("span", "panel-row-title", recipe.name));
    if (this.state.unseenRecipes.includes(recipe.id)) {
      heading.appendChild(el("span", "panel-badge", "NEW"));
    }
    info.appendChild(heading);

    // What you get was never shown at all — the row listed a price with no
    // product.
    const output = getItem(recipe.output.itemId);
    info.appendChild(
      el("span", "panel-row-sub", `Makes ${recipe.output.qty}x ${output.name}`),
    );
    info.appendChild(costLine("Needs", recipe.inputs, this.state));

    // A disabled button always says why. Missing ingredients are already
    // spelled out by the cost line, so this covers the other reason.
    const station = recipe.requiresStation;
    const stationMissing = station !== undefined && !this.hasStation(station);
    if (stationMissing) {
      info.appendChild(
        el(
          "span",
          "panel-row-warn",
          `Needs ${indefinite(getBuilding(station).name)} nearby`,
        ),
      );
    }
    main.appendChild(info);
    row.appendChild(main);

    const affordable = hasIngredients(this.state, recipe.id);
    const actions = el("div", "panel-row-actions");

    const button = el("button", undefined, "Craft");
    button.disabled = stationMissing || !affordable;
    button.addEventListener("click", () => this.doCraft(recipe.id, 1));
    actions.appendChild(button);

    // The batch button carries the real number rather than the word "max", so
    // the cost of pressing it is visible before it is pressed.
    const batch = Math.min(craftableCount(this.state, recipe.id), BATCH_CAP);
    if (!stationMissing && batch >= 2) {
      const batchButton = el("button", "panel-batch", `Craft x${batch}`);
      batchButton.addEventListener("click", () => this.doCraft(recipe.id, batch));
      actions.appendChild(batchButton);
    }

    row.appendChild(actions);
    return row;
  }

  private doCraft(recipeId: string, count: number): void {
    craftMany(this.state, recipeId, count, this.hasStation);
    this.render();
  }
}
