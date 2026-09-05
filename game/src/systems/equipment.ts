import type { GameState } from "../state/game-state";
import { addItem, getQty, hasQty, removeItem } from "./inventory";
import { isWearable, slotFor, wornInSlot, type WornSlot } from "../data/worn";
import { events } from "../utils/events";

export const HOTBAR_SIZE = 8;

// What the player is holding, and how it gets there.
//
// The hotbar stores item ids, never inventory indices: `removeItem` replaces
// `state.inventory` with a filtered copy whenever anything is spent, so an
// index would silently start pointing at a different item.

/** The item in hand, or null when the slot is empty or that item ran out. */
export function equippedItemId(state: GameState): string | null {
  const id = state.hotbar[state.equippedSlot] ?? null;
  if (id === null) return null;
  // A slot keeps its item while the stack lasts. Once it is gone the slot
  // reads empty rather than pretending you still hold the last plank.
  return getQty(state, id) > 0 ? id : null;
}

export function selectSlot(state: GameState, index: number): void {
  if (index < 0 || index >= HOTBAR_SIZE) return;
  if (state.equippedSlot === index) return;
  state.equippedSlot = index;
  events.emit("equipped-changed", { itemId: equippedItemId(state) });
}

export function cycleSlot(state: GameState, direction: number): void {
  const next = (state.equippedSlot + direction + HOTBAR_SIZE) % HOTBAR_SIZE;
  selectSlot(state, next);
}

/**
 * Puts a newly acquired kind of item into the first free slot. Without this
 * the player would have to arrange their bag before they could use anything,
 * which is busywork the genre has long since stopped asking for.
 */
export function autoAssign(state: GameState, itemId: string): boolean {
  // Worn gear is worn, never held: a quick slot holding it would do nothing at
  // all when selected, while taking a slot from something that does. This
  // covers the cloak and the trinkets as well as armour, because it asks the
  // one table that knows what a slot is.
  if (isWearable(itemId)) return false;
  if (state.hotbar.includes(itemId)) return false;
  const free = state.hotbar.indexOf(null);
  if (free === -1) return false;
  state.hotbar[free] = itemId;
  if (free === state.equippedSlot) {
    events.emit("equipped-changed", { itemId: equippedItemId(state) });
  }
  return true;
}

/**
 * Puts an item into a specific slot, which is how the player fixes a bar that
 * auto-assignment filled with raw materials. Without this a sword crafted once
 * every slot is taken could never reach the hand at all.
 *
 * An item lives in one slot only: assigning it somewhere new clears the slot it
 * came from, so the bar can't show the same axe twice.
 */
export function assignToSlot(state: GameState, index: number, itemId: string | null): void {
  if (index < 0 || index >= HOTBAR_SIZE) return;
  if (itemId !== null) {
    const existing = state.hotbar.indexOf(itemId);
    if (existing === index) return;
    if (existing !== -1) state.hotbar[existing] = state.hotbar[index];
  }
  state.hotbar[index] = itemId;
  events.emit("equipped-changed", { itemId: equippedItemId(state) });
}

/**
 * Puts armour on, taking it out of the bag.
 *
 * Worn armour leaves `inventory` and comes back on `takeOffArmour`. Left in
 * both places it could be worn and spent at the same time — and a crafting
 * recipe would happily eat the thing keeping you alive.
 *
 * Returns false when the item is not armour or is not carried.
 */
export function wearItem(state: GameState, itemId: string): boolean {
  const slot = slotFor(itemId);
  if (slot === null || !hasQty(state, itemId, 1)) return false;
  // Only the slot this piece competes for. Taking off *everything* was correct
  // while there was one slot and is the obvious way to get this wrong now:
  // putting on a ring would have stripped your armour.
  takeOff(state, slot);
  removeItem(state, itemId, 1);
  state.worn[slot] = itemId;
  pruneHotbar(state);
  events.emit("worn-changed", { slot, itemId });
  return true;
}

/** Takes off whatever is in one slot and puts it back in the bag. */
export function takeOff(state: GameState, slot: WornSlot): string | null {
  const worn = wornInSlot(state, slot);
  if (!worn) return null;
  state.worn[slot] = null;
  addItem(state, worn, 1);
  events.emit("worn-changed", { slot, itemId: null });
  return worn;
}

/** Clears slots whose item is all gone, so the bar reflects what you have. */
export function pruneHotbar(state: GameState): void {
  let changed = false;
  state.hotbar.forEach((id, i) => {
    if (id !== null && getQty(state, id) <= 0) {
      state.hotbar[i] = null;
      if (i === state.equippedSlot) changed = true;
    }
  });
  if (changed) events.emit("equipped-changed", { itemId: equippedItemId(state) });
}

/** Fills the bar from whatever is already carried — new games and old saves. */
export function assignFromInventory(state: GameState): void {
  for (const slot of state.inventory) autoAssign(state, slot.itemId);
}

// Normalises a hotbar that came from a save written before it existed, or one
// that has been hand-edited. Length and slot index both have to be sane before
// anything indexes into them.
export function normaliseHotbar(state: GameState): void {
  if (!Array.isArray(state.hotbar)) state.hotbar = [];
  state.hotbar.length = HOTBAR_SIZE;
  for (let i = 0; i < HOTBAR_SIZE; i++) {
    if (typeof state.hotbar[i] !== "string") state.hotbar[i] = null;
  }
  if (
    typeof state.equippedSlot !== "number" ||
    state.equippedSlot < 0 ||
    state.equippedSlot >= HOTBAR_SIZE
  ) {
    state.equippedSlot = 0;
  }
}
