import type { GameState } from "../state/game-state";
import { events } from "../utils/events";
import { reductionFor } from "../data/armour";
import { vigourReduction } from "../data/stats";

/**
 * The only way the player loses health, which is why armour is applied here
 * and nowhere else: every future source of damage gets the reduction for free
 * rather than each one having to remember it.
 */
export function damagePlayer(state: GameState, amount: number): void {
  if (state.player.health <= 0) return;
  // Armour and Vigour stack multiplicatively rather than by adding their
  // percentages: added, a good suit plus a heavy Vigour build reaches zero
  // damage, and a game with no level cap would get there eventually. Multiplied,
  // neither can ever finish the job — and the floor of 1 below means being
  // surrounded always costs something however good the kit is.
  const reduction = 1 - (1 - reductionFor(state)) * (1 - vigourReduction(state));
  const taken = Math.max(1, Math.round(amount * (1 - reduction)));
  state.player.health = Math.max(0, state.player.health - taken);
  // The damage that actually landed, not what was swung: the red flash and
  // anything else listening would otherwise report a hit the player never took.
  events.emit("player-damaged", { amount: taken });
  events.emit("player-health-changed", {
    current: state.player.health,
    max: state.player.maxHealth,
  });
  if (state.player.health <= 0) {
    events.emit("player-died", {});
  }
}

// Capped at max health; returns how much was actually restored so a caller
// can tell "you were already full" from "that healed you".
export function healPlayer(state: GameState, amount: number): number {
  const before = state.player.health;
  state.player.health = Math.min(state.player.maxHealth, before + amount);
  const healed = state.player.health - before;
  if (healed > 0) {
    events.emit("player-health-changed", {
      current: state.player.health,
      max: state.player.maxHealth,
    });
  }
  return healed;
}

export function respawnPlayer(state: GameState): void {
  state.player.health = state.player.maxHealth;
  state.player.x = 0;
  state.player.z = 8;
  events.emit("player-health-changed", {
    current: state.player.health,
    max: state.player.maxHealth,
  });
  events.emit("player-respawned", {});
}

export function isPlayerDead(state: GameState): boolean {
  return state.player.health <= 0;
}
