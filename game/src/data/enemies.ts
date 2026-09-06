export interface EnemyDef {
  id: string;
  name: string;
  maxHealth: number;
  damage: number;
  moveSpeed: number;
  aggroRadius: number;
  attackRange: number;
  attackCooldownMs: number;
  color: number;
  /**
   * Experience for the kill.
   *
   * Here rather than derived from `maxHealth` because the two are not the same
   * question: a brute is twice the health and rather more than twice the
   * fight, since it also hits harder and outlasts a health bar the zombie
   * never threatens.
   */
  exp: number;
  /**
   * How far out this enemy stops and shoots, instead of closing to melee.
   * Absent means it walks in and swings, as everything did before.
   *
   * A separate field rather than a `ranged: true` flag because the number is
   * the behaviour: it is the distance at which the enemy stops caring about
   * getting closer, and there is no sensible default for it.
   */
  standoff?: number;
}

export const ENEMIES: Record<string, EnemyDef> = {
  zombie: {
    id: "zombie",
    name: "Zombie",
    maxHealth: 30,
    damage: 8,
    moveSpeed: 2.2,
    aggroRadius: 14,
    attackRange: 1.4,
    attackCooldownMs: 1000,
    color: 0x4a6b3a,
    exp: 8,
  },
  /**
   * The answer to standing still.
   *
   * Measured before it existed: at night 30 a level-36 player could stand in
   * the open, press nothing at all, and finish the raid on 56% health — and at
   * night 60 more comfortably still. Every enemy walked into arm's reach, so
   * position was never a question the game asked.
   *
   * It is deliberately fragile — a third of a zombie's health — because the
   * counterplay has to be *reachable*. A slinger you can kill in one or two
   * swings once you close the distance rewards moving; one that also soaked
   * damage would just be a wall that shoots.
   */
  slinger: {
    id: "slinger",
    name: "Slinger",
    maxHealth: 22,
    damage: 10,
    moveSpeed: 2.4,
    aggroRadius: 22,
    attackRange: 12,
    standoff: 10,
    attackCooldownMs: 2200,
    color: 0x6b5a8a,
    exp: 14,
  },
  brute: {
    id: "brute",
    name: "Brute",
    maxHealth: 60,
    damage: 14,
    moveSpeed: 1.8,
    aggroRadius: 16,
    attackRange: 1.6,
    attackCooldownMs: 1200,
    color: 0x6b3a3a,
    exp: 20,
  },
};

export function getEnemy(id: string): EnemyDef {
  const enemy = ENEMIES[id];
  if (!enemy) throw new Error(`Unknown enemy id: ${id}`);
  return enemy;
}
