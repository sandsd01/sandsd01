import type { GameState } from "../state/game-state";
import { events } from "../utils/events";

export function damagePlayer(state: GameState, amount: number): void {
  if (state.player.health <= 0) return;
  state.player.health = Math.max(0, state.player.health - amount);
  events.emit("player-damaged", { amount });
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
