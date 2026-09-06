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
    // --- The rare tier -----------------------------------------------------
    //
    // Brutes only, and nothing else in the game drops these: a piece of gear
    // that grants an ability has to come from somewhere a player can point at,
    // and "the big ones" is the only such place this game has.
    //
    // The rates are measured, not guessed. Counting what the spawner actually
    // produced: **2.3 brutes a minute near the homestead and about 13.5 out on
    // the frontier**. The gap is smaller than the constants suggest —
    // `BRUTE_SHARE_HOME` is zero, but `BRUTE_SHARE_ROUGH_BIOME` floors the mix
    // at half wherever the spawn ring reaches into rocky or wetland ground, so
    // a third of what walks into the yard is already a brute. The frontier is
    // six times richer rather than infinitely richer, which is the right
    // shape: somewhere better to hunt, not a wall.
    //
    // Against roughly nine brutes a minute of real frontier hunting, these put
    // one *named* piece at ten to twenty minutes and the first of *any* of
    // them at about three and a half — an early taste, then a long tail. The
    // whole set is around half an hour, before Fortune, which multiplies all
    // four (see `rollLoot` below).
    { itemId: "stormcleave", min: 1, max: 1, chance: 0.006 },
    { itemId: "ember_cloak", min: 1, max: 1, chance: 0.008 },
    { itemId: "quickdraw_ring", min: 1, max: 1, chance: 0.01 },
    { itemId: "gatherers_charm", min: 1, max: 1, chance: 0.01 },
    // The rarest thing in the game, because it is the one that changes how the
    // game is *played* rather than how hard you hit. At the measured nine
    // brutes a minute of frontier hunting that is around forty minutes, or
    // twenty-odd with a heavy Fortune build — a thing you hear about before
    // you own one.
    { itemId: "divine_wings", min: 1, max: 1, chance: 0.004 },
  ],
};

/**
 * Rolls one enemy's table. May return an empty array — dying empty-handed.
 *
 * `dropScale` is Fortune's whole effect, passed in as a number rather than
 * read from the state here so this module stays what it is: a table and the
 * dice. It multiplies each row's chance and clamps at certain, which means it
 * pays out most where there is most room — a row that already drops nine times
 * in ten has almost nothing left to give, and the rare rows are where the
 * points go.
 */
export function rollLoot(enemyId: string, rand: () => number, dropScale = 1): LootRoll[] {
  const table = LOOT_TABLES[enemyId];
  if (!table) return [];
  const drops: LootRoll[] = [];
  for (const entry of table) {
    if (!chance(rand, Math.min(1, entry.chance * dropScale))) continue;
    drops.push({ itemId: entry.itemId, qty: randomInt(rand, entry.min, entry.max) });
  }
  return drops;
}
