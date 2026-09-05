/**
 * The level curve.
 *
 * One function, so the whole of "how long is a level" is a single line to
 * argue with. The shape is the genre's — steady, and with no ceiling — but the
 * numbers are this game's and they are *measured*, not borrowed.
 *
 * What was measured, by killing everything the spawner produced over five
 * game-minutes in each place: **6.3 kills a minute near the homestead, and
 * 16.7 out on the frontier**. Those are ceilings — a player who never misses
 * and never walks — but the walk turns out not to matter much, because at a
 * mean spawn distance of sixty units even a sprint costs about eight seconds
 * against a nine-second spawn interval. The supply, not the fighting, is what
 * sets the pace, and the fighting is only the bottleneck for a player with
 * bare hands.
 *
 * Near home that is roughly 50 exp a minute (mostly zombies at 8). On the
 * frontier the interval drops to 3.5 seconds and brutes at 20 become common,
 * which is worth three to four times as much. That gap is the point: it means
 * the curve can steepen without ever stalling, because the answer to "this
 * level is taking a while" is somewhere to go rather than something to wait
 * for.
 *
 * Against 50 a minute, `30 * n^1.1` puts the first level at about 35 seconds,
 * the third at two minutes and the tenth at seven and a half — inside the
 * small-reward band early, stretching steadily, and never stopping. A raid
 * lands every eighteen minutes and until now nothing at all happened in
 * between; this is what fills that.
 */

/** EXP from this level to the next. Never returns zero, so it cannot stall. */
export function expToNext(level: number): number {
  const n = Math.max(1, Math.floor(level));
  return Math.round(30 * Math.pow(n, 1.1));
}

/** Where a fresh character starts. */
export const START_LEVEL = 1;

/** How many points a level hands over to spend. */
export const POINTS_PER_LEVEL = 3;

/**
 * Health added by the level itself, on top of anything Vigour buys.
 *
 * Small and automatic. Levelling has to feel like it did something even for a
 * player who has not opened the stats panel yet — and a character whose only
 * growth is behind a menu they have not found is a character who does not grow.
 */
export const HEALTH_PER_LEVEL = 4;

/**
 * Health at level 1 with nothing spent.
 *
 * Here rather than inline in `createInitialState` because `recomputeMaxHealth`
 * has to be able to rebuild the whole figure from scratch — and a base it
 * cannot see is a base it would have to guess.
 */
export const BASE_MAX_HEALTH = 100;
