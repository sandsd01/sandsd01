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
