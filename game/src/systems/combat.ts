import type { GameState } from "../state/game-state";
import type { EnemyManager } from "./enemy-ai";
import type { Target } from "./targeting";
import { hasQty } from "./inventory";
import { events } from "../utils/events";

const ATTACK_RANGE = 2.2;
const ATTACK_COOLDOWN_MS = 500;
const BASE_DAMAGE = 10;
const SWORD_DAMAGE = 25;
const IRON_SWORD_DAMAGE = 40;

// Player-initiated melee combat: single-target, against whichever enemy the
// crosshair is on. The swing still plays when nothing is aimed at — a miss
// should look like a miss, not like a button that did nothing.
export class PlayerCombat {
  private lastAttackMs = -Infinity;

  // Whether the cooldown has elapsed, so the caller can hold the button down
  // and have the swing land at the weapon's own rhythm rather than the frame
  // rate's.
  canAttack(nowMs: number): boolean {
    return nowMs - this.lastAttackMs >= ATTACK_COOLDOWN_MS;
  }

  tryAttack(
    state: GameState,
    enemyManager: EnemyManager,
    target: Target,
    nowMs: number,
  ): void {
    if (!this.canAttack(nowMs)) return;
    this.lastAttackMs = nowMs;
    events.emit("player-attack", {});

    const enemy = target.kind === "enemy" ? target.enemy : undefined;
    // Reach is generous enough to aim at something across a clearing; a melee
    // swing still only lands at arm's length.
    if (!enemy || target.distance > ATTACK_RANGE) return;

    const damage = hasQty(state, "iron_sword", 1)
      ? IRON_SWORD_DAMAGE
      : hasQty(state, "sword", 1)
        ? SWORD_DAMAGE
        : BASE_DAMAGE;
    const dead = enemy.takeDamage(damage, nowMs);
    events.emit("enemy-hit", { id: enemy.id, damage });
    if (dead) enemyManager.removeEnemy(enemy.id, nowMs);
  }
}
