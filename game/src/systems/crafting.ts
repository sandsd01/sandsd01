import { getRecipe, RECIPES, type RecipeDef } from "../data/recipes";
import { getItem } from "../data/items";
import type { GameState } from "../state/game-state";
import { addItem, hasQty, removeItem } from "./inventory";
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

// Instant-craft for MVP (craftTimeMs is data for future UI feedback / a
// progress bar, but not enforced with a timer yet).
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
  events.emit("notification", {
    message: `Crafted ${recipe.output.qty}x ${getItem(recipe.output.itemId).name}`,
  });
  return true;
}

export function listRecipes(): RecipeDef[] {
  return RECIPES;
}
