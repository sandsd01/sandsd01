import { getRecipe, RECIPES, type RecipeDef } from "../data/recipes";
import type { GameState } from "../state/game-state";
import { addItem, hasQty, removeItem } from "./inventory";
import { events } from "../utils/events";

export function canCraft(state: GameState, recipeId: string): boolean {
  const recipe = getRecipe(recipeId);
  return recipe.inputs.every((input) => hasQty(state, input.itemId, input.qty));
}

// Instant-craft for MVP (craftTimeMs is data for future UI feedback / a
// progress bar, but not enforced with a timer yet).
export function craft(state: GameState, recipeId: string): boolean {
  const recipe = getRecipe(recipeId);
  if (!canCraft(state, recipeId)) return false;

  for (const input of recipe.inputs) {
    removeItem(state, input.itemId, input.qty);
  }
  addItem(state, recipe.output.itemId, recipe.output.qty);
  events.emit("item-crafted", { itemId: recipe.output.itemId, qty: recipe.output.qty });
  return true;
}

export function listRecipes(): RecipeDef[] {
  return RECIPES;
}
