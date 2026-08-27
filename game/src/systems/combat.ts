import type { GameState } from "../state/game-state";
import type { EnemyManager } from "./enemy-ai";
import { hasQty } from "./inventory";
import { events } from "../utils/events";

const ATTACK_RANGE = 2.2;
const ATTACK_COOLDOWN_MS = 500;
const BASE_DAMAGE = 10;
const SWORD_DAMAGE = 25;
const IRON_SWORD_DAMAGE = 40;

// Player-initiated melee combat: a simple range check against the nearest
// enemy each swing (single-target, no full raycast needed for an MVP with a
// handful of enemies).
export class PlayerCombat {
  private lastAttackMs = -Infinity;

  tryAttack(
    state: GameState,
    enemyManager: EnemyManager,
    playerX: number,
    playerZ: number,
    nowMs: number,
  ): void {
    if (nowMs - this.lastAttackMs < ATTACK_COOLDOWN_MS) return;
    this.lastAttackMs = nowMs;
    events.emit("player-attack", {});

    const damage = hasQty(state, "iron_sword", 1)
      ? IRON_SWORD_DAMAGE
      : hasQty(state, "sword", 1)
        ? SWORD_DAMAGE
        : BASE_DAMAGE;
    for (const enemy of enemyManager.getEnemies()) {
      const dist = Math.hypot(
        enemy.object.position.x - playerX,
        enemy.object.position.z - playerZ,
      );
      if (dist <= ATTACK_RANGE) {
        const dead = enemy.takeDamage(damage, nowMs);
        events.emit("enemy-hit", { id: enemy.id, damage });
        if (dead) enemyManager.removeEnemy(enemy.id, nowMs);
        break;
      }
    }
  }
}
