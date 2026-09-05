import type { GameState } from "../state/game-state";

/**
 * What a level is spent on.
 *
 * Five rather than the genre's usual six, and chosen by working backwards from
 * the code rather than forwards from the reference: this game has no magic and
 * no critical hits, so an INT and a LUK copied across would have had nothing
 * to attach to and would read on the panel as stats that do nothing. Every one
 * of these five multiplies a number that already exists at a place the game
 * already funnels through — see the table in each doc comment.
 */
export type StatId = "might" | "vigour" | "swiftness" | "craft" | "fortune";

export const STAT_IDS: StatId[] = ["might", "vigour", "swiftness", "craft", "fortune"];

export interface StatDef {
  id: StatId;
  name: string;
  /** One line, shown on the panel. Says what the number does, not what it is. */
  blurb: string;
}

export const STATS: Record<StatId, StatDef> = {
  might: { id: "might", name: "Might", blurb: "Harder hits, in the hand and from the bow" },
  vigour: { id: "vigour", name: "Vigour", blurb: "More health, and less of every hit gets through" },
  swiftness: { id: "swiftness", name: "Swiftness", blurb: "Faster on your feet, faster to swing" },
  craft: { id: "craft", name: "Craft", blurb: "Quicker at a node, and more out of it" },
  fortune: { id: "fortune", name: "Fortune", blurb: "The rare things fall more often" },
};

/** Everyone starts flat. A point spent is the only way any of these move. */
export function initialStats(): Record<StatId, number> {
  return { might: 0, vigour: 0, swiftness: 0, craft: 0, fortune: 0 };
}

export function statValue(state: GameState, id: StatId): number {
  return state.stats?.[id] ?? 0;
}

// ---------------------------------------------------------------------------
// What each point is worth
// ---------------------------------------------------------------------------
//
// Per-point rather than curved, and small. A point has to be felt — a player
// who spends one and cannot tell has been given a menu, not a choice — but a
// game with no level cap cannot afford a stat that doubles every ten points.
// These are the numbers to calibrate; the shape is deliberately boring.

/** Melee and arrow damage, as a multiplier. +6% a point. */
export function damageScale(state: GameState): number {
  return 1 + statValue(state, "might") * 0.06;
}

/** Health added on top of the base 100. */
export function bonusMaxHealth(state: GameState): number {
  return statValue(state, "vigour") * 6;
}

/**
 * Damage absorbed by Vigour alone, before armour.
 *
 * Capped well short of 1: a stat that can reach immunity ends the game rather
 * than deepening it, and this one has no level cap to stop at.
 */
export function vigourReduction(state: GameState): number {
  const points = statValue(state, "vigour");
  return Math.min(0.35, points * 0.012);
}

/** Move speed, as a multiplier. Capped — outrunning every enemy is not a build. */
export function speedScale(state: GameState): number {
  return Math.min(1.5, 1 + statValue(state, "swiftness") * 0.015);
}

/** Attack cooldown, as a multiplier. Lower is faster; floored at half. */
export function attackSpeedScale(state: GameState): number {
  return Math.max(0.5, 1 - statValue(state, "swiftness") * 0.02);
}

/** Stamina regained per second, as a multiplier. */
export function staminaRegenScale(state: GameState): number {
  return 1 + statValue(state, "swiftness") * 0.03;
}

/** Gather time, as a multiplier. Lower is faster; floored, like tools. */
export function gatherSpeedScale(state: GameState): number {
  return Math.max(0.45, 1 - statValue(state, "craft") * 0.02);
}

/** Extra chance of one more unit per swing, on top of the tool's own. */
export function bonusYieldChance(state: GameState): number {
  return Math.min(0.5, statValue(state, "craft") * 0.02);
}

/**
 * Multiplier on how often a rare drop rolls.
 *
 * The one stat that pays in *content* rather than in numbers, which is why it
 * is here at all: the gear that grants abilities is found, not built, so a
 * player who wants it has somewhere to put their points.
 */
export function rareDropScale(state: GameState): number {
  return 1 + statValue(state, "fortune") * 0.08;
}
