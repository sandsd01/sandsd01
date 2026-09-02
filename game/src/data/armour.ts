import type { GameState } from "../state/game-state";

/**
 * What can be worn, and how much of a hit it takes off.
 *
 * A table rather than a branch in the combat code, for the same reason
 * `WEAPON_DAMAGE` in data/tools.ts is one: what protects you is content, and a
 * new tier should be a row here and nothing else.
 */
export interface ArmourDef {
  /** Fraction of incoming damage absorbed, 0..1. */
  reduction: number;
}

export const ARMOUR: Record<string, ArmourDef> = {
  hide_armour: { reduction: 0.2 },
  iron_armour: { reduction: 0.4 },
};

export function isArmour(itemId: string): boolean {
  return itemId in ARMOUR;
}

/** How much of a hit the worn piece absorbs, or 0 when nothing is worn. */
export function reductionFor(state: GameState): number {
  const worn = state.armour;
  return worn ? (ARMOUR[worn]?.reduction ?? 0) : 0;
}
