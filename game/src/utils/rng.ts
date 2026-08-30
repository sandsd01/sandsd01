// Deterministic PRNG (mulberry32) so a given world seed always reproduces the same world.
export function mulberry32(seed: number): () => number {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashStringToSeed(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (Math.imul(31, hash) + str.charCodeAt(i)) | 0;
  }
  return hash;
}

// Helpers over a `rand` from mulberry32. They take the generator rather than
// reaching for Math.random so the caller decides which stream a roll comes
// from — world generation must stay reproducible from the seed, and runtime
// rolls deliberately do not.

/** An integer in [min, max], inclusive at both ends. */
export function randomInt(rand: () => number, min: number, max: number): number {
  if (max <= min) return min;
  return min + Math.floor(rand() * (max - min + 1));
}

/** True with probability `p`. `p <= 0` never fires, `p >= 1` always does. */
export function chance(rand: () => number, p: number): boolean {
  if (p <= 0) return false;
  if (p >= 1) return true;
  return rand() < p;
}

/**
 * Picks one entry in proportion to its weight. Replaces the inline threshold
 * chains this codebase had been writing by hand (see `pickKind` in
 * world/world-objects.ts), which are easy to get wrong when an entry is added
 * in the middle and every later threshold has to shift.
 *
 * Returns null for an empty list or when every weight is zero, so a caller
 * that means "sometimes nothing" can say so with weights alone.
 */
export function weightedPick<T>(
  rand: () => number,
  entries: readonly { weight: number; value: T }[],
): T | null {
  let total = 0;
  for (const entry of entries) total += Math.max(0, entry.weight);
  if (total <= 0) return null;

  let roll = rand() * total;
  for (const entry of entries) {
    roll -= Math.max(0, entry.weight);
    if (roll < 0) return entry.value;
  }
  // Only reachable through floating-point drift on the last entry.
  return entries[entries.length - 1].value;
}
