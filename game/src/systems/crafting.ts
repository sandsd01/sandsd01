import { getRecipe, RECIPES, type RecipeDef } from "../data/recipes";
import { getItem } from "../data/items";
import type { GameState } from "../state/game-state";
import { addItem, getQty, hasQty, removeItem } from "./inventory";
import { events } from "../utils/events";

// Whether a station of the given building id is within reach. Recipes that
// don't need one never call it.
export type StationCheck = (buildingId: string) => boolean;

export function hasIngredients(state: GameState, recipeId: string): boolean {
  const recipe = getRecipe(recipeId);
  return recipe.inputs.every((input) => hasQty(state, input.itemId, input.qty));
}

export function canCraft(
  state: GameState,
  recipeId: string,
  hasStation: StationCheck = () => true,
): boolean {
  const recipe = getRecipe(recipeId);
  if (recipe.requiresStation && !hasStation(recipe.requiresStation)) return false;
  return hasIngredients(state, recipeId);
}

// How many times this recipe could be made right now, ignoring the station.
// The panel shows the number on the batch button rather than a word like
// "max", so the player knows what they are about to spend before they spend it.
export function craftableCount(state: GameState, recipeId: string): number {
  const recipe = getRecipe(recipeId);
  let count = Infinity;
  for (const input of recipe.inputs) {
    count = Math.min(count, Math.floor(getQty(state, input.itemId) / input.qty));
  }
  return Number.isFinite(count) ? count : 0;
}

// Crafting is instant and always has been. Recipes used to carry a
// craftTimeMs that nothing read; a duration was considered and dropped —
// waiting on a progress bar to receive something you already paid for is the
// most complained-about thing in this genre's crafting.
export function craft(
  state: GameState,
  recipeId: string,
  hasStation: StationCheck = () => true,
): boolean {
  const recipe = getRecipe(recipeId);
  if (!canCraft(state, recipeId, hasStation)) return false;

  for (const input of recipe.inputs) {
    removeItem(state, input.itemId, input.qty);
  }
  addItem(state, recipe.output.itemId, recipe.output.qty);
  events.emit("item-crafted", { itemId: recipe.output.itemId, qty: recipe.output.qty });
  return true;
}

/**
 * Crafts up to `count` of a recipe, stopping early if anything runs out.
 * Returns how many were actually made.
 *
 * The one summary toast lives here rather than in `craft`: the HUD has a
 * single toast element that overwrites itself, so a batch announcing each
 * item would leave only the last one readable.
 */
export function craftMany(
  state: GameState,
  recipeId: string,
  count: number,
  hasStation: StationCheck = () => true,
): number {
  const recipe = getRecipe(recipeId);
  let made = 0;
  for (let i = 0; i < count; i++) {
    if (!craft(state, recipeId, hasStation)) break;
    made++;
  }
  if (made > 0) {
    events.emit("notification", {
      message: `Crafted ${made * recipe.output.qty}x ${getItem(recipe.output.itemId).name}`,
    });
  }
  return made;
}

// --- Discovery ------------------------------------------------------------

// A recipe is learned by holding one of its ingredients. This is Valheim's
// rule, and it is what turns the panel from a wall of things you cannot make
// into a record of what the world has shown you so far.
function recipesUsing(itemId: string): RecipeDef[] {
  return RECIPES.filter((recipe) => recipe.inputs.some((input) => input.itemId === itemId));
}

/**
 * Learns every recipe that takes `itemId` as an ingredient. Returns only the
 * ones that were newly learned, so the caller can announce them once as a
 * group instead of firing a toast per recipe.
 */
export function discoverFrom(state: GameState, itemId: string): RecipeDef[] {
  const learned: RecipeDef[] = [];
  for (const recipe of recipesUsing(itemId)) {
    if (state.knownRecipes.includes(recipe.id)) continue;
    state.knownRecipes.push(recipe.id);
    state.unseenRecipes.push(recipe.id);
    learned.push(recipe);
  }
  return learned;
}

/** Learns everything the current inventory implies, announcing nothing. */
export function discoverFromInventory(state: GameState): void {
  for (const slot of state.inventory) {
    for (const recipe of recipesUsing(slot.itemId)) {
      if (!state.knownRecipes.includes(recipe.id)) state.knownRecipes.push(recipe.id);
    }
  }
}

export function learnAllRecipes(state: GameState): void {
  state.knownRecipes = RECIPES.map((recipe) => recipe.id);
}

export function listKnownRecipes(state: GameState): RecipeDef[] {
  return RECIPES.filter((recipe) => state.knownRecipes.includes(recipe.id));
}

export function listRecipes(): RecipeDef[] {
  return RECIPES;
}
