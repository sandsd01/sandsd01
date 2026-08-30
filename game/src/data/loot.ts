import { chance, randomInt } from "../utils/rng";

// What the dead leave behind.
//
// Killing an enemy used to pay nothing whatsoever — `enemy-killed` had a
// single listener, and it played a sound. Combat was pure cost: you spent
// health and time and got a quieter field. A drop table is what turns a fight
// into a decision worth making.

export interface LootEntry {
  itemId: string;
  /** Inclusive range rolled when this entry pays out. */
  min: number;
  max: number;
  /** Probability this entry drops at all, independent of the others. */
  chance: number;
}

export interface LootRoll {
  itemId: string;
  qty: number;
}

/**
 * Per enemy, keyed by `EnemyDef.id`. Entries roll independently rather than
 * picking one winner, so a brute can drop several things at once and the
 * tougher fight is reliably the richer one — a table that pays out once would
 * make the brute merely slower to kill, not better to kill.
 */
export const LOOT_TABLES: Record<string, LootEntry[]> = {
  zombie: [
    { itemId: "bone", min: 1, max: 2, chance: 0.7 },
    { itemId: "hide", min: 1, max: 1, chance: 0.25 },
  ],
  brute: [
    { itemId: "bone", min: 2, max: 3, chance: 0.9 },
    { itemId: "hide", min: 1, max: 2, chance: 0.6 },
    // The reason to take on the harder one rather than walk away.
    { itemId: "iron_ore", min: 1, max: 2, chance: 0.3 },
  ],
};

/** Rolls one enemy's table. May return an empty array — dying empty-handed. */
export function rollLoot(enemyId: string, rand: () => number): LootRoll[] {
  const table = LOOT_TABLES[enemyId];
  if (!table) return [];
  const drops: LootRoll[] = [];
  for (const entry of table) {
    if (!chance(rand, entry.chance)) continue;
    drops.push({ itemId: entry.itemId, qty: randomInt(rand, entry.min, entry.max) });
  }
  return drops;
}
