import { getItem } from "../data/items";
import type { ItemStack } from "../data/recipes";
import { getQty } from "../systems/inventory";
import type { GameState } from "../state/game-state";
import { el } from "./dom";

// A cost/requirement line reading "Wood 5/2, ✗ Stone 1/3" — what you have
// against what's needed, per ingredient. Shared by the crafting and building
// panels so a disabled button always has a visible reason next to it.
//
// A shortfall is marked with a glyph, not just a red tint. The counts alone
// are technically complete, but "1/3" and "5/2" are the same shape at a
// glance — you have to read and compare both numbers on every line to find
// the one that is blocking you. The mark is what makes it scannable, and it
// survives being colour-blind or reading on a washed-out screen.
export function costLine(label: string, stacks: ItemStack[], state: GameState): HTMLSpanElement {
  const line = el("span", "panel-row-sub");
  line.append(`${label}: `);
  stacks.forEach((stack, i) => {
    const have = getQty(state, stack.itemId);
    const short = have < stack.qty;
    const part = el("span", short ? "cost-short" : "cost-ok");
    if (short) {
      const mark = el("span", "cost-mark", "\u2717");
      mark.setAttribute("aria-label", "short");
      part.appendChild(mark);
    }
    // The "Name have/need" run stays contiguous and unadorned — it is the
    // thing being read, and the mark sits outside it.
    part.append(`${getItem(stack.itemId).name} ${have}/${stack.qty}`);
    line.appendChild(part);
    if (i < stacks.length - 1) line.append(", ");
  });
  return line;
}

export function canAfford(stacks: ItemStack[], state: GameState): boolean {
  return stacks.every((stack) => getQty(state, stack.itemId) >= stack.qty);
}
