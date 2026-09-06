import type { GameState } from "../state/game-state";
import { BASE_MAX_HEALTH, HEALTH_PER_LEVEL, POINTS_PER_LEVEL, START_LEVEL, expToNext } from "../data/levels";
import { STATS, bonusMaxHealth, type StatId } from "../data/stats";
import { ENEMIES } from "../data/enemies";
import { events } from "../utils/events";

/**
 * Levelling: the fast reward loop the game did not have.
 *
 * A raid lands every eighteen minutes and, until now, nothing whatsoever
 * happened in between — every fight in that gap cost health and time and paid
 * in a quieter field. This is the other half of that: killing something now
 * moves a bar, and the bar moves often enough to be worth watching.
 *
 * Everything here funnels through two functions on purpose. `grantExp` is the
 * only way exp is ever added, and `recomputeMaxHealth` is the only thing that
 * writes `maxHealth`. The second matters more than it looks: max health is now
 * fed by two independent sources (the level itself and Vigour), it is stored
 * in the save, and anything that added to it incrementally would drift the
 * first time a save was edited, a stat was refunded, or the numbers were
 * retuned. Rebuilding the whole figure from level and points is the version
 * that cannot go wrong.
 */

/**
 * What one kill is worth.
 *
 * Zero for an unknown id rather than a throw: this is called from an event
 * listener, and an enemy the table has never heard of should pay nothing, not
 * take the frame down with it.
 */
export function expForKill(enemyId: string): number {
  return ENEMIES[enemyId]?.exp ?? 0;
}

/**
 * Max health from scratch: the base, what the levels added, and what Vigour
 * bought. Idempotent — call it as often as you like.
 */
export function recomputeMaxHealth(state: GameState): void {
  const fromLevels = Math.max(0, state.player.level - START_LEVEL) * HEALTH_PER_LEVEL;
  const next = BASE_MAX_HEALTH + fromLevels + bonusMaxHealth(state);
  if (next === state.player.maxHealth) return;
  state.player.maxHealth = next;
  // Health is left where it is rather than topped up: raising the ceiling is
  // not healing, and a player who spends a point mid-fight should not be able
  // to use the stats panel as a bandage. Levelling *itself* does heal — see
  // below — because that is the moment being rewarded.
  state.player.health = Math.min(state.player.health, state.player.maxHealth);
  events.emit("player-health-changed", {
    current: state.player.health,
    max: state.player.maxHealth,
  });
}

/**
 * Adds exp and levels up as many times as it takes.
 *
 * A loop rather than a single check because a late-game kill worth several
 * levels should hand over all of them at once — and because a curve that is
 * ever retuned downward must not leave a character stuck mid-bar.
 */
export function grantExp(state: GameState, amount: number): void {
  if (!Number.isFinite(amount) || amount <= 0) return;
  state.player.exp += Math.round(amount);

  let levelled = 0;
  // Bounded: `expToNext` is strictly positive and grows, so this terminates —
  // but a guard costs nothing and a frozen tab costs everything.
  while (levelled < 100 && state.player.exp >= expToNext(state.player.level)) {
    state.player.exp -= expToNext(state.player.level);
    state.player.level += 1;
    state.statPoints += POINTS_PER_LEVEL;
    levelled += 1;
  }

  if (levelled > 0) {
    recomputeMaxHealth(state);
    // Full health on the way up, exactly as the genre this borrows from does
    // it. It is what makes a level land in the middle of a fight rather than
    // in a menu afterwards, and it is the reason the aura is worth watching
    // for: it means you survived the next thirty seconds.
    //
    // Not while dead, though. An arrow already in flight can land after the
    // player has fallen, and healing them here would clear `isPlayerDead`
    // while the two-second respawn is already pending — so they would stand
    // back up and then, a moment later, be yanked home by a respawn that no
    // longer applies to them. Death is resolved by the death path or not at
    // all; the level itself still counts.
    if (state.player.health > 0) {
      state.player.health = state.player.maxHealth;
      state.player.stamina = state.player.maxStamina;
      events.emit("player-health-changed", {
        current: state.player.health,
        max: state.player.maxHealth,
      });
      events.emit("player-stamina-changed", {
        current: state.player.stamina,
        max: state.player.maxStamina,
      });
    }
    events.emit("player-levelled-up", { level: state.player.level, points: state.statPoints });
  }

  events.emit("player-exp-changed", {
    level: state.player.level,
    exp: state.player.exp,
    toNext: expToNext(state.player.level),
  });
}

/**
 * What a death takes off the bar.
 *
 * A fifth of the level being worked on, rather than a flat number, because the
 * curve has no ceiling: twenty exp is most of level one and invisible by level
 * forty, so a constant would mean "harsh, then nothing". A fraction is the
 * same small bite the whole way up.
 */
const DEATH_EXP_FRACTION = 0.2;

/**
 * Takes a little progress back when the player dies. Returns what was lost.
 *
 * Dying was free — `respawnPlayer` refills health and puts the player at the
 * homestead, and nothing anywhere took anything. Free is understating it: the
 * only other way to restore health is eating, so at level 36 a full bar is
 * about fourteen loaves of bread, or one death. A player losing a fight was
 * being *rewarded* for finishing it face down, and a fall from the sky island
 * was the cheapest way home.
 *
 * **The level itself never moves.** Only progress inside the current one is at
 * risk. Dropping a level would have to claw back the stat points it paid out,
 * which are already spent by then and cannot be honestly unspent — and it
 * would contradict the endless climb this whole system was asked for. Levels
 * go up; the bar underneath them can go back down.
 */
export function loseExpOnDeath(state: GameState): number {
  const loss = Math.round(expToNext(state.player.level) * DEATH_EXP_FRACTION);
  const before = state.player.exp;
  state.player.exp = Math.max(0, before - loss);
  const lost = before - state.player.exp;

  // The same shape `grantExp` emits, so the HUD bar moves on the way down as
  // well as up. Without it the loss is real and invisible, which is the worst
  // of both.
  events.emit("player-exp-changed", {
    level: state.player.level,
    exp: state.player.exp,
    toNext: expToNext(state.player.level),
  });
  return lost;
}

/** Spends one point. Returns whether it went anywhere. */
export function allocateStat(state: GameState, id: StatId): boolean {
  if (state.statPoints <= 0) return false;
  if (!STATS[id]) return false;
  state.statPoints -= 1;
  state.stats[id] = (state.stats[id] ?? 0) + 1;
  // Vigour is the one that changes a stored number rather than a derived one,
  // so it has to be rebuilt here. The others are read live at their chokepoint
  // and need nothing.
  recomputeMaxHealth(state);
  events.emit("stats-changed", { id, points: state.statPoints });
  events.emit("notification", { message: `${STATS[id].name} raised to ${state.stats[id]}` });
  return true;
}
