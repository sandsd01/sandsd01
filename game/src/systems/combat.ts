import type { GameState } from "../state/game-state";
import type { EnemyManager } from "./enemy-ai";
import type { Target } from "./targeting";
import { heldDamage } from "../data/tools";
import { events } from "../utils/events";

const ATTACK_RANGE = 2.2;
const ATTACK_COOLDOWN_MS = 500;

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

    // What you are swinging, not what you own — carrying a sword in the bag
    // while holding a pickaxe should hit like a pickaxe.
    const damage = heldDamage(state);
    const dead = enemy.takeDamage(damage, nowMs);
    events.emit("enemy-hit", { id: enemy.id, damage });
    if (dead) enemyManager.removeEnemy(enemy.id, nowMs);
  }
}
