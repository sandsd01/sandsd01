import type { GameState } from "../state/game-state";
import { events } from "../utils/events";

const STORAGE_KEY = "romestead-save-v1";

export function saveGame(state: GameState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    events.emit("game-saved", {});
  } catch (err) {
    console.warn("Failed to save game:", err);
  }
}

// Returns null if there's no save, or it's unreadable/corrupt — callers
// should fall back to a fresh world in that case rather than crashing.
export function loadGame(): GameState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as GameState;
    if (!parsed || typeof parsed !== "object" || !parsed.player || !Array.isArray(parsed.inventory)) {
      return null;
    }
    events.emit("game-loaded", {});
    return parsed;
  } catch (err) {
    console.warn("Failed to load save, starting fresh:", err);
    return null;
  }
}

export function clearSave(): void {
  localStorage.removeItem(STORAGE_KEY);
}
