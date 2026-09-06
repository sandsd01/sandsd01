import type { GameState } from "../state/game-state";
import { equippedItemId } from "../systems/equipment";
import { damageScale } from "./stats";
import { drawScale } from "./worn";

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
  /**
   * Chance of an extra unit on top of a swing's normal roll. Speed alone
   * stops being a reward once the player has time to spare — this makes the
   * iron tier pay out more per node as well as sooner.
   */
  yieldBonusChance: number;
}

export const TOOLS: Record<string, ToolDef> = {
  axe: { kind: "axe", speed: 1, damage: 14, yieldBonusChance: 0 },
  pickaxe: { kind: "pickaxe", speed: 1, damage: 12, yieldBonusChance: 0 },
  iron_axe: { kind: "axe", speed: 0.6, damage: 20, yieldBonusChance: 0.5 },
  iron_pickaxe: { kind: "pickaxe", speed: 0.6, damage: 16, yieldBonusChance: 0.5 },
};

// Weapons live beside the tools rather than as constants inside combat.ts:
// what you can hit with is content, and an axe is a poor weapon rather than
// no weapon at all.
export const WEAPON_DAMAGE: Record<string, number> = {
  bone_club: 18,
  sword: 25,
  iron_sword: 40,
  // The top of what a forge can make, and deliberately still under the
  // stormcleave below it. The rule the found tier is built on — a weapon you
  // stumble across has to beat one you can simply decide to build — is worth
  // more than giving the sky island a headline number.
  skysteel_sword: 46,
  // Above the iron sword, and it hits everything in front of you rather than
  // the one thing aimed at — deliberately the top of the tier, because it
  // cannot be crafted at any price and a found weapon that merely matched the
  // forge would be a disappointment rather than a reward. The arc that makes
  // it swing wide lives in `systems/combat.ts`.
  stormcleave: 52,
};

/**
 * Weapons that hit every enemy in an arc rather than only the aimed one.
 *
 * A set rather than a flag on each weapon, and here rather than in
 * `systems/combat.ts`, for the same reason `WEAPON_DAMAGE` is here: what a
 * weapon does is content, and a second cleaving weapon should be one more
 * string, not another branch in the combat code.
 */
export const CLEAVE_WEAPONS = new Set<string>(["stormcleave"]);

/** Whether what is in hand swings wide. */
export function heldCleaves(state: GameState): boolean {
  const held = equippedItemId(state);
  return held !== null && CLEAVE_WEAPONS.has(held);
}

/** Bare hands. */
export const UNARMED_DAMAGE = 6;

/**
 * The bow, and what one of its arrows does on impact.
 *
 * Deliberately absent from `WEAPON_DAMAGE` above: a bow swung as a club has to
 * be worth no more than a fist. Left in that table it would be a sword that
 * also shoots, and there would be no reason to carry anything else.
 */
export const BOW_ID = "bow";
/** Under a sword's 25 — reach is what you are paying for, not raw damage. */
export const ARROW_DAMAGE = 22;

/**
 * How long the bow takes between shots.
 *
 * A resolver for the same reason `arrowDamage` is one: the constant was read
 * straight out of `main.ts`, which meant the bow's rhythm was the one number
 * in the game nothing could ever modify. Swiftness is deliberately *not* in
 * here — it already quickens the melee swing, and letting it quicken the bow
 * too would make one stat the answer to every weapon.
 */
export const DRAW_MS = 700;

export function drawTimeFor(state: GameState): number {
  return DRAW_MS * drawScale(state);
}

/** Damage for whatever is in hand — a weapon, a tool, or nothing. */
export function heldDamage(state: GameState): number {
  const held = equippedItemId(state);
  const base = held === null ? UNARMED_DAMAGE : WEAPON_DAMAGE[held] ?? TOOLS[held]?.damage ?? UNARMED_DAMAGE;
  // Might is applied here, at the one place that already answers "how hard did
  // that hit", rather than at either of the two callers. Armour is done the
  // same way in `damagePlayer`, and for the same reason: a multiplier spread
  // across call sites is a multiplier that one of them will forget.
  return Math.max(1, Math.round(base * damageScale(state)));
}

/**
 * Damage an arrow does on impact.
 *
 * This function is the point. `ARROW_DAMAGE` was read straight out of the
 * constant at the one place arrows land, which meant the bow was the only
 * weapon in the game nothing could ever modify — no stat, and no future piece
 * of gear. Now it has the same shape as the melee path.
 */
export function arrowDamage(state: GameState): number {
  return Math.max(1, Math.round(ARROW_DAMAGE * damageScale(state)));
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
  const held = heldToolFor(state, kind);
  return held ? held.speed : null;
}

/** The bonus-yield chance of the tool in hand for this work, or 0 for none. */
export function heldYieldBonus(state: GameState, kind: ToolKind): number {
  return heldToolFor(state, kind)?.yieldBonusChance ?? 0;
}

function heldToolFor(state: GameState, kind: ToolKind): ToolDef | null {
  const held = equippedItemId(state);
  if (held === null) return null;
  const tool = TOOLS[held];
  return tool && tool.kind === kind ? tool : null;
}

// For the "you need an axe for this" message: the plainest name of the tier
// the player is missing, not the fanciest one they could eventually hold.
export const TOOL_KIND_NAMES: Record<ToolKind, string> = {
  axe: "axe",
  pickaxe: "pickaxe",
};
