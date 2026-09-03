import type { BuildingSystem } from "./building";
import type { Enemy, EnemyManager } from "./enemy-ai";
import { events } from "../utils/events";

/**
 * Spike traps: the first thing a player builds that does something to the
 * raiders rather than merely standing between them.
 *
 * There is no pathfinding to fool here. Raiders walk straight at the player,
 * and a trap is declared low enough (see `WALKABLE_HEIGHT` in building.ts)
 * that it is not a collidable at all — so they walk over it because they were
 * coming that way anyway. Laying a line of them in front of the gate is a
 * decision about *where* the fight happens, which is the only thing a wall
 * could say before.
 */

/**
 * What each kind of trap does per bite.
 *
 * The spike trap is low on purpose: it never wears out, so anything that
 * killed on its own would play the raid for the player — it wears a wave down,
 * it does not stop one. The heavy trap costs a trip to the frontier and hits
 * hard enough to actually finish a zombie, which is what that trip is for; it
 * does not wear out either, so its cost stays the journey rather than a
 * restocking errand before every raid.
 */
const TRAP_DAMAGE: Record<string, number> = {
  spike_trap: 6,
  heavy_trap: 22,
};
/** Per trap rather than per enemy — one bed of spikes stabs at its own rhythm. */
const TRAP_INTERVAL_MS = 1200;

export class TrapSystem {
  /** When each trap last went off, keyed by placed building id. */
  private readonly lastBite = new Map<string, number>();

  constructor(
    private readonly buildings: BuildingSystem,
    private readonly enemies: EnemyManager,
  ) {}

  /**
   * Stabs anything standing on a trap.
   *
   * **Enemies only.** A trap that also hurt the player would be punishing them
   * for something they cannot see, at night, while backing through their own
   * gate — the raiders have no such problem, because they never had to choose
   * where to walk.
   */
  update(nowMs: number, enemies: Enemy[]): void {
    for (const enemy of enemies) {
      if (enemy.dying) continue;
      const { x, z } = enemy.object.position;
      const buildingId = this.buildings.buildingTypeAt(x, z);
      const damage = buildingId ? TRAP_DAMAGE[buildingId] : undefined;
      if (damage === undefined) continue;
      const placedId = this.buildings.buildingIdAt(x, z);
      if (!placedId) continue;

      const last = this.lastBite.get(placedId) ?? -Infinity;
      if (nowMs - last < TRAP_INTERVAL_MS) continue;
      this.lastBite.set(placedId, nowMs);

      const dead = enemy.takeDamage(damage, nowMs);
      events.emit("trap-triggered", { id: placedId, enemyId: enemy.id });
      // Death goes through the manager, exactly as a sword swing does: loot,
      // the fade-out and the kill event all belong to the one place that owns
      // them, and a trap must not become a second way for an enemy to die.
      if (dead) this.enemies.removeEnemy(enemy.id, nowMs);
    }
  }

  /** Forgets traps that no longer exist, so a demolished one leaks nothing. */
  forget(placedId: string): void {
    this.lastBite.delete(placedId);
  }
}
