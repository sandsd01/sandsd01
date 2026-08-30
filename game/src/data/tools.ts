import type { GameState } from "../state/game-state";
import { equippedItemId } from "../systems/equipment";

// What a tool is for, and how fast it works. Kept as data next to the items
// rather than as a string match in the gathering system, so a new tool tier is
// a row here and nothing else.
export type ToolKind = "axe" | "pickaxe";

export interface ToolDef {
  kind: ToolKind;
  /** Melee damage when this is what you happen to be swinging. */
  damage: number;
  /**
   * Multiplier on the time a swing takes — lower is faster. This is what makes
   * an iron tool worth the iron; a tier that only reads better in the
   * inventory is not a reward.
   */
  speed: number;
}

export const TOOLS: Record<string, ToolDef> = {
  axe: { kind: "axe", speed: 1, damage: 14 },
  pickaxe: { kind: "pickaxe", speed: 1, damage: 12 },
  iron_axe: { kind: "axe", speed: 0.6, damage: 20 },
  iron_pickaxe: { kind: "pickaxe", speed: 0.6, damage: 16 },
};

// Weapons live beside the tools rather than as constants inside combat.ts:
// what you can hit with is content, and an axe is a poor weapon rather than
// no weapon at all.
export const WEAPON_DAMAGE: Record<string, number> = {
  sword: 25,
  iron_sword: 40,
};

/** Bare hands. */
export const UNARMED_DAMAGE = 6;

/** Damage for whatever is in hand — a weapon, a tool, or nothing. */
export function heldDamage(state: GameState): number {
  const held = equippedItemId(state);
  if (held === null) return UNARMED_DAMAGE;
  return WEAPON_DAMAGE[held] ?? TOOLS[held]?.damage ?? UNARMED_DAMAGE;
}

/**
 * The speed multiplier of the tool actually in hand for this kind of work, or
 * null when the player is holding something else.
 *
 * This used to scan the whole inventory for the best tool of the kind, which
 * meant a crafted axe worked from inside the bag and nothing on screen ever
 * changed when you made one. What you hold is now what you work with.
 */
export function heldToolSpeed(state: GameState, kind: ToolKind): number | null {
  const held = equippedItemId(state);
  if (held === null) return null;
  const tool = TOOLS[held];
  return tool && tool.kind === kind ? tool.speed : null;
}

// For the "you need an axe for this" message: the plainest name of the tier
// the player is missing, not the fanciest one they could eventually hold.
export const TOOL_KIND_NAMES: Record<ToolKind, string> = {
  axe: "axe",
  pickaxe: "pickaxe",
};
