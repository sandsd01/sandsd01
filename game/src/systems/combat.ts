import type { GameState } from "../state/game-state";
import type { EnemyManager } from "./enemy-ai";
import type { Target } from "./targeting";
import { heldCleaves, heldDamage } from "../data/tools";
import { attackSpeedScale } from "../data/stats";
import { events } from "../utils/events";

const ATTACK_RANGE = 2.2;
const ATTACK_COOLDOWN_MS = 500;

/**
 * How far a cleaving weapon reaches, and how wide.
 *
 * A little past the normal swing, because a weapon that hits three things at
 * arm's length is worth less than it sounds when arm's length is 2.2 units and
 * enemies do not politely queue. The arc is deliberately *not* a circle: 140
 * degrees in front means turning your back on something still costs you, which
 * is the difference between a wide swing and a bomb.
 */
const CLEAVE_RANGE = 3.2;
const CLEAVE_ARC = (140 * Math.PI) / 180;

/**
 * The arc's shape, for anything that needs to reason about it from outside.
 *
 * Exported so a check can place enemies just inside and just outside the sweep
 * using the game's own numbers. A suite that hard-coded 3.2 and 140 would keep
 * passing after a retune while testing the wrong geometry.
 */
export function cleaveShape(): { range: number; arcDegrees: number } {
  return { range: CLEAVE_RANGE, arcDegrees: (CLEAVE_ARC * 180) / Math.PI };
}

// Player-initiated melee combat: single-target, against whichever enemy the
// crosshair is on. The swing still plays when nothing is aimed at — a miss
// should look like a miss, not like a button that did nothing.
export class PlayerCombat {
  private lastAttackMs = -Infinity;

  // Whether the cooldown has elapsed, so the caller can hold the button down
  // and have the swing land at the weapon's own rhythm rather than the frame
  // rate's — a rhythm Swiftness is allowed to quicken, which is why this needs
  // the state as well as the clock.
  canAttack(state: GameState, nowMs: number): boolean {
    return nowMs - this.lastAttackMs >= ATTACK_COOLDOWN_MS * attackSpeedScale(state);
  }

  tryAttack(
    state: GameState,
    enemyManager: EnemyManager,
    target: Target,
    nowMs: number,
  ): void {
    if (!this.canAttack(state, nowMs)) return;
    this.lastAttackMs = nowMs;
    events.emit("player-attack", {});

    // What you are swinging, not what you own — carrying a sword in the bag
    // while holding a pickaxe should hit like a pickaxe.
    const damage = heldDamage(state);

    if (heldCleaves(state)) {
      this.cleave(state, enemyManager, damage, nowMs);
      return;
    }

    const enemy = target.kind === "enemy" ? target.enemy : undefined;
    // Reach is generous enough to aim at something across a clearing; a melee
    // swing still only lands at arm's length.
    if (!enemy || target.distance > ATTACK_RANGE) return;

    const dead = enemy.takeDamage(damage, nowMs);
    events.emit("enemy-hit", { id: enemy.id, damage });
    if (dead) enemyManager.removeEnemy(enemy.id, nowMs);
  }

  /**
   * One swing, every enemy in the arc in front of the player.
   *
   * Aim is ignored on purpose — a wide swing goes where the body is facing,
   * not where the eyes are, and requiring the crosshair to be on something
   * would make the sweep feel like a single-target hit that occasionally
   * splashed. `player.yaw` is what the movement code already turns the body
   * to, so this is the direction the character is visibly facing.
   *
   * Each enemy takes the weapon's full damage rather than a share of it: what
   * the weapon buys is *how many*, and dividing the damage would make it worse
   * than a sword against a crowd, which is the one thing it is for.
   */
  private cleave(
    state: GameState,
    enemyManager: EnemyManager,
    damage: number,
    nowMs: number,
  ): void {
    // Yaw 0 faces -z, and `player.yaw` is set from the movement vector as
    // atan2(x, z) — so the facing vector is (sin, cos), not (cos, sin).
    const facingX = Math.sin(state.player.yaw);
    const facingZ = Math.cos(state.player.yaw);
    const half = CLEAVE_ARC / 2;

    // Collected before any damage lands: `removeEnemy` mutates the manager's
    // list, and killing the first of three mid-iteration is how the third
    // silently stops being hit.
    const struck: { id: string }[] = [];
    for (const enemy of enemyManager.getEnemies()) {
      const dx = enemy.object.position.x - state.player.x;
      const dz = enemy.object.position.z - state.player.z;
      const dist = Math.hypot(dx, dz);
      if (dist > CLEAVE_RANGE) continue;
      // Something standing exactly on the player has no direction; hit it.
      if (dist > 0.001) {
        const cos = (dx * facingX + dz * facingZ) / dist;
        if (Math.acos(Math.min(1, Math.max(-1, cos))) > half) continue;
      }
      const dead = enemy.takeDamage(damage, nowMs);
      events.emit("enemy-hit", { id: enemy.id, damage });
      if (dead) struck.push({ id: enemy.id });
    }
    for (const { id } of struck) enemyManager.removeEnemy(id, nowMs);
  }
}
