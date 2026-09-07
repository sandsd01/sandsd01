import type { GameState } from "../state/game-state";

/**
 * What can be worn, where, and what wearing it does.
 *
 * This replaces the single `state.armour` field and the `ARMOUR` table it was
 * keyed against. The reason for three slots now, when one was deliberately
 * chosen before (the old comment on `GameState.armour` argued that "three
 * slots is three times the UI for depth the player cannot read off the
 * screen"), is that the depth is now readable: a slot no longer holds a
 * percentage, it holds an *ability*. "I am wearing the cloak that burns what
 * hits me" is a thing a player can say; "I am wearing 40% instead of 20%" was
 * not.
 *
 * The table stays keyed by item id and flat, exactly like `ARMOUR` and
 * `WEAPON_DAMAGE` before it: a new piece is a row here, and nothing else.
 */
export type WornSlot = "armour" | "back" | "trinket";

/** Order is the order the character sheet lists them in. */
export const WORN_SLOTS: WornSlot[] = ["armour", "back", "trinket"];

export const SLOT_NAMES: Record<WornSlot, string> = {
  armour: "Armour",
  back: "Back",
  trinket: "Trinket",
};

export interface WornDef {
  slot: WornSlot;
  /** Fraction of incoming damage absorbed, 0..1. Armour only. */
  reduction?: number;
  /**
   * Fraction of a landed hit paid back to whoever landed it.
   *
   * Applied to the damage that actually got through, not to what was swung —
   * so armour and Vigour reduce what you reflect as well as what you take.
   * That is the honest reading of "it burns what touches you".
   */
  thorns?: number;
  /** Multiplier on the bow's draw time. Lower is faster. */
  drawScale?: number;
  /**
   * How far a gathering swing reaches past the node actually struck, hitting
   * others of the same kind. 0 or absent means only the aimed node.
   */
  gatherReach?: number;
  /**
   * How far above the ground this lets the wearer fly, in world units. 0 or
   * absent means no flight at all.
   *
   * A ceiling rather than a boolean because the number *is* the ability: what
   * separates flight from a very good jump is how far up it goes, and a piece
   * that flew half as high would be a row here rather than a second code path.
   */
  flightCeiling?: number;
  /**
   * How far the wearer's own light reaches, in world units. 0 or absent means
   * no light at all.
   *
   * A radius rather than a brightness because the radius is what the player
   * experiences — "I can see about that far" — and because the brazier this
   * borrows from is already tuned in those terms. The intensity is derived
   * from it at the point of use, so the two cannot drift apart.
   */
  lightRadius?: number;
  /** One line for the character sheet. Says what it does, not what it is. */
  blurb: string;
}

export const WORN: Record<string, WornDef> = {
  // The two that already existed, moved across unchanged.
  hide_armour: { slot: "armour", reduction: 0.2, blurb: "Takes a fifth off every hit" },
  iron_armour: { slot: "armour", reduction: 0.4, blurb: "Takes a bit under half off every hit" },
  skysteel_armour: {
    slot: "armour",
    reduction: 0.5,
    blurb: "Takes half off every hit",
  },

  // The rare tier. Found, never crafted — see `data/loot.ts`.
  ember_cloak: {
    slot: "back",
    thorns: 0.6,
    blurb: "Whatever hits you takes most of it back",
  },
  quickdraw_ring: {
    slot: "trinket",
    drawScale: 0.45,
    blurb: "Draws a bow in well under half the time",
  },
  gatherers_charm: {
    slot: "trinket",
    gatherReach: 4.5,
    blurb: "One swing works every node of that kind nearby",
  },
  divine_wings: {
    slot: "back",
    flightCeiling: 40,
    blurb: "Double-tap jump to fly. Space up, Shift down",
  },

  /**
   * The cave's piece, and the first trinket that is crafted rather than found.
   *
   * Both halves of that matter. The cave was the one region whose material
   * bought nothing you wear: a trip down yields 198 crystals and the brazier,
   * its only other use, costs two — ninety-nine braziers from one visit, for a
   * base that wants a handful. And every other trinket in the game is a rare
   * drop, so a player the loot table never smiled on had an empty trinket slot
   * for the whole run with no way to fill it.
   *
   * Deliberately smaller than a brazier's twenty-two. A light you carry should
   * not be better than a light you built and defended — the lantern is what
   * gets you *to* the base at night, not what replaces it.
   */
  crystal_lantern: {
    slot: "trinket",
    lightRadius: 14,
    blurb: "Carries its own light. Night stops being blind",
  },
};

export function slotFor(itemId: string): WornSlot | null {
  return WORN[itemId]?.slot ?? null;
}

/** Whether this item is worn rather than held. Replaces `isArmour`. */
export function isWearable(itemId: string): boolean {
  return itemId in WORN;
}

export function wornInSlot(state: GameState, slot: WornSlot): string | null {
  return state.worn?.[slot] ?? null;
}

/** Whether this exact piece is on the body right now. */
export function hasWorn(state: GameState, itemId: string): boolean {
  const slot = slotFor(itemId);
  return slot !== null && wornInSlot(state, slot) === itemId;
}

/**
 * The definition of whatever is worn in a slot, or null.
 *
 * Every ability below reads through this rather than checking for its own item
 * id by name — so a second cloak with a different `thorns` value is a row in
 * the table and not a branch in the combat code.
 */
export function defInSlot(state: GameState, slot: WornSlot): WornDef | null {
  const id = wornInSlot(state, slot);
  return id ? (WORN[id] ?? null) : null;
}

/** Everyone starts with empty hands and an empty back. */
export function initialWorn(): Record<WornSlot, string | null> {
  return { armour: null, back: null, trinket: null };
}

// ---------------------------------------------------------------------------
// What the worn pieces are worth
// ---------------------------------------------------------------------------
//
// Same shape as `data/stats.ts`: one `(state) => number` per effect, read at
// the single chokepoint that already decides that number. A multiplier spread
// across call sites is a multiplier one of them will forget.

/**
 * How much of a hit the armour slot absorbs, or 0 when nothing is worn.
 *
 * This used to live in `data/armour.ts` beside an `ARMOUR` table holding the
 * same two rows this file now holds. Keeping both would have been two tables
 * describing one thing that happened to agree — the same shape of bug as the
 * loot hook that silently dropped Fortune's scale, and just as invisible.
 */
export function reductionFor(state: GameState): number {
  return defInSlot(state, "armour")?.reduction ?? 0;
}

/** Fraction of a landed hit reflected back at whoever landed it. */
export function thornsFraction(state: GameState): number {
  return defInSlot(state, "back")?.thorns ?? 0;
}

/** Bow draw time, as a multiplier. Lower is faster. */
export function drawScale(state: GameState): number {
  return defInSlot(state, "trinket")?.drawScale ?? 1;
}

/**
 * How far a gathering swing spreads to nodes of the same kind, in world units.
 * Zero means the aimed node and nothing else, which is the default behaviour.
 */
export function gatherReach(state: GameState): number {
  return defInSlot(state, "trinket")?.gatherReach ?? 0;
}

/**
 * How far the wearer's own light reaches. 0 when nothing lit is worn.
 *
 * Same shape as `gatherReach`, and in the same slot: wearing the lantern is
 * giving up the ring or the charm, which is the whole trade. A player who
 * wants to see at night is choosing that over drawing a bow quickly.
 */
export function lanternRadius(state: GameState): number {
  return defInSlot(state, "trinket")?.lightRadius ?? 0;
}

/**
 * How far above the ground the player may fly, or 0 for not at all.
 *
 * Measured from the ground *underfoot* rather than from sea level, which the
 * controller is what enforces — a fixed altitude would let you fly through a
 * mountain by walking up to it, and would put the ceiling somewhere different
 * depending on where you took off.
 */
export function flightCeiling(state: GameState): number {
  return defInSlot(state, "back")?.flightCeiling ?? 0;
}

/** Whether the player can fly at all. */
export function canFly(state: GameState): boolean {
  return flightCeiling(state) > 0;
}
