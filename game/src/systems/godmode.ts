import type { GameState } from "../state/game-state";
import { events } from "../utils/events";

/**
 * Creative mode, reachable only by typing `/godmode` into the chat box.
 *
 * This exists to make the game testable and buildable by hand. Laying out a
 * base meant gathering its materials first, checking a raid meant surviving
 * the walk to it, and looking at the sky island meant owning the wings —
 * every one of those is the game working correctly and all of them are in the
 * way when what you want is to *look at something*.
 *
 * Modelled on Minecraft's creative mode rather than invented: fly, take no
 * damage, build for free, break instantly, never tire. Those five are what
 * "creative" means to anyone who would type this command, and picking a
 * different set would make the name a lie.
 *
 * It is deliberately one flag rather than five. Five toggles is five states to
 * be half-in, and a player who turned off damage but left building expensive
 * would have a mode nobody asked for. On or off.
 */

/** How high creative flight goes. Well past the sky island's own ceiling. */
export const GODMODE_FLIGHT_CEILING = 120;

export function isGodMode(state: GameState): boolean {
  return state.godMode === true;
}

/**
 * Flips it and returns the new value.
 *
 * Emits rather than letting callers announce it, so the HUD badge and the chat
 * line can never disagree about which way it went.
 */
export function toggleGodMode(state: GameState): boolean {
  state.godMode = !state.godMode;
  events.emit("godmode-changed", { on: state.godMode });
  return state.godMode;
}
