import { getItem } from "../data/items";
import type { GameState, InventorySlot } from "../state/game-state";
import { addItem, getQty, removeItem } from "./inventory";
import { events } from "../utils/events";

// Storage for placed containers. A barrel was buildable from the first release
// and read by nothing — a container that contained nothing.
//
// Contents live in `state.containers`, keyed by the placed building's id,
// rather than on the building record, so everything that places, draws and
// deletes buildings goes on treating a barrel as just another building.

/** How many distinct stacks one container holds. */
export const CONTAINER_SLOTS = 12;

export function containerOf(state: GameState, buildingId: string): InventorySlot[] {
  if (!state.containers[buildingId]) state.containers[buildingId] = [];
  return state.containers[buildingId];
}

export function containerCount(state: GameState, buildingId: string): number {
  return containerOf(state, buildingId).reduce((sum, slot) => sum + slot.qty, 0);
}

/** Moves up to `qty` of an item from the player into the container. */
export function deposit(state: GameState, buildingId: string, itemId: string, qty: number): number {
  const have = getQty(state, itemId);
  const moving = Math.min(have, qty);
  if (moving <= 0) return 0;

  const slots = containerOf(state, buildingId);
  const stackSize = getItem(itemId).stackSize;
  let remaining = moving;

  for (const slot of slots) {
    if (slot.itemId !== itemId) continue;
    const space = stackSize - slot.qty;
    if (space <= 0) continue;
    const add = Math.min(space, remaining);
    slot.qty += add;
    remaining -= add;
    if (remaining <= 0) break;
  }
  while (remaining > 0 && slots.length < CONTAINER_SLOTS) {
    const add = Math.min(stackSize, remaining);
    slots.push({ itemId, qty: add });
    remaining -= add;
  }

  // Whatever wouldn't fit stays with the player rather than vanishing.
  const stored = moving - remaining;
  if (stored > 0) {
    removeItem(state, itemId, stored);
    events.emit("container-changed", { buildingId });
  }
  return stored;
}

/** Moves up to `qty` of an item from the container back to the player. */
export function withdraw(state: GameState, buildingId: string, itemId: string, qty: number): number {
  const slots = containerOf(state, buildingId);
  let remaining = qty;
  let taken = 0;

  for (const slot of slots) {
    if (slot.itemId !== itemId || remaining <= 0) continue;
    const take = Math.min(slot.qty, remaining);
    slot.qty -= take;
    remaining -= take;
    taken += take;
  }
  if (taken > 0) {
    state.containers[buildingId] = slots.filter((slot) => slot.qty > 0);
    // The player's own inventory has no cap, so this always lands.
    addItem(state, itemId, taken);
    events.emit("container-changed", { buildingId });
  }
  return taken;
}

/** Fills a container outright — used to stock the world's points of interest. */
export function stock(state: GameState, buildingId: string, contents: InventorySlot[]): void {
  state.containers[buildingId] = contents.map((slot) => ({ ...slot }));
  events.emit("container-changed", { buildingId });
}
