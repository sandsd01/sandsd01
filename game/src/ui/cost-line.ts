import { getItem } from "../data/items";
import type { ItemStack } from "../data/recipes";
import { getQty } from "../systems/inventory";
import type { GameState } from "../state/game-state";
import { el } from "./dom";

// A cost/requirement line reading "Wood 5/2, Stone 1/3" — what you have
// against what's needed, per ingredient. The numbers carry the information
// on their own; the color is redundant reinforcement so a shortfall is
// scannable without reading every row. Shared by the crafting and building
// panels so a disabled button always has a visible reason next to it.
export function costLine(label: string, stacks: ItemStack[], state: GameState): HTMLSpanElement {
  const line = el("span", "panel-row-sub");
  line.append(`${label}: `);
  stacks.forEach((stack, i) => {
    const have = getQty(state, stack.itemId);
    const part = el("span", have >= stack.qty ? "cost-ok" : "cost-short");
    part.textContent = `${getItem(stack.itemId).name} ${have}/${stack.qty}`;
    line.appendChild(part);
    if (i < stacks.length - 1) line.append(", ");
  });
  return line;
}

export function canAfford(stacks: ItemStack[], state: GameState): boolean {
  return stacks.every((stack) => getQty(state, stack.itemId) >= stack.qty);
}
