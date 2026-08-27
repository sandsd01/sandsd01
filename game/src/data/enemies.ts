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
  },
};

export function getEnemy(id: string): EnemyDef {
  const enemy = ENEMIES[id];
  if (!enemy) throw new Error(`Unknown enemy id: ${id}`);
  return enemy;
}
