import { getItem } from "../data/items";
import { healPlayer } from "../player/player-state";
import type { GameState, InventorySlot } from "../state/game-state";
import { events } from "../utils/events";

// Pure functions operating on GameState.inventory — no Three.js/rendering
// dependency, so this stays easy to reason about and (later) unit-test.
export function getQty(state: GameState, itemId: string): number {
  return state.inventory
    .filter((slot) => slot.itemId === itemId)
    .reduce((sum, slot) => sum + slot.qty, 0);
}

export function hasQty(state: GameState, itemId: string, qty: number): boolean {
  return getQty(state, itemId) >= qty;
}

export function addItem(state: GameState, itemId: string, qty: number): void {
  if (qty <= 0) return;
  const def = getItem(itemId);
  let remaining = qty;

  for (const slot of state.inventory) {
    if (slot.itemId !== itemId) continue;
    const space = def.stackSize - slot.qty;
    if (space <= 0) continue;
    const add = Math.min(space, remaining);
    slot.qty += add;
    remaining -= add;
    if (remaining <= 0) break;
  }

  while (remaining > 0) {
    const add = Math.min(def.stackSize, remaining);
    const slot: InventorySlot = { itemId, qty: add };
    state.inventory.push(slot);
    remaining -= add;
  }

  events.emit("inventory-changed", { itemId });
}

// Returns false (and makes no changes) if there isn't enough of the item.
export function removeItem(state: GameState, itemId: string, qty: number): boolean {
  if (!hasQty(state, itemId, qty)) return false;
  let remaining = qty;

  for (const slot of state.inventory) {
    if (slot.itemId !== itemId || remaining <= 0) continue;
    const take = Math.min(slot.qty, remaining);
    slot.qty -= take;
    remaining -= take;
  }
  state.inventory = state.inventory.filter((slot) => slot.qty > 0);

  events.emit("inventory-changed", { itemId });
  return true;
}

// Eats one of an edible item, healing the player. Edibility is the presence of
// `heals` on the item — there is no separate flag that could fall out of step
// with it.
export function consumeItem(state: GameState, itemId: string): boolean {
  const def = getItem(itemId);
  if (def.heals === undefined) return false;
  if (!hasQty(state, itemId, 1)) return false;
  if (state.player.health >= state.player.maxHealth) {
    events.emit("notification", { message: "Already at full health" });
    return false;
  }
  removeItem(state, itemId, 1);
  const healed = healPlayer(state, def.heals);
  events.emit("notification", { message: `Ate ${def.name} (+${healed} health)` });
  return true;
}
