import { createInitialState, type GameState } from "../state/game-state";
import { learnAllRecipes } from "./crafting";
import { assignFromInventory, normaliseHotbar } from "./equipment";
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
    backfillDefaults(parsed);
    events.emit("game-loaded", {});
    return parsed;
  } catch (err) {
    console.warn("Failed to load save, starting fresh:", err);
    return null;
  }
}

// Fields added after a save was written come back undefined. Rather than
// versioning the whole save, fill in anything missing with its starting value:
// a save from before stamina existed should load as a rested player, not one
// who can never sprint again.
function backfillDefaults(state: GameState): void {
  const defaults = createInitialState().player;
  for (const key of Object.keys(defaults) as (keyof typeof defaults)[]) {
    if (typeof state.player[key] !== "number") state.player[key] = defaults[key];
  }

  // Top-level arrays added later. Anything that iterates them would throw on
  // an older save, so they have to exist before anything else touches state.
  if (!Array.isArray(state.placedBuildings)) state.placedBuildings = [];
  if (!Array.isArray(state.plots)) state.plots = [];
  if (!Array.isArray(state.unseenRecipes)) state.unseenRecipes = [];
  if (!state.containers || typeof state.containers !== "object") state.containers = {};
  // A save from before node progress was persisted loads with a full world,
  // which is exactly what it had before — no node was ever recorded as worked,
  // so there is nothing to restore and an empty record is the honest default.
  if (!state.nodes || typeof state.nodes !== "object") state.nodes = {};

  // A save written before the hotbar existed comes back with none. Fill it
  // from what they are already carrying rather than handing them an empty bar
  // and no way to hold the axe they have had all along.
  const hadHotbar = Array.isArray(state.hotbar);
  normaliseHotbar(state);
  if (!hadHotbar) assignFromInventory(state);

  if (!Array.isArray(state.knownRecipes)) {
    // A save written before recipes could be discovered belongs to someone who
    // has always been able to see all of them. Deriving their known set from
    // what happens to be in their pockets right now would take recipes away
    // from a player who already had them — so an old save learns everything.
    learnAllRecipes(state);
  }
}

export function clearSave(): void {
  localStorage.removeItem(STORAGE_KEY);
}
