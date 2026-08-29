import { hashStringToSeed } from "../utils/rng";
import { DAY_LENGTH_MS } from "../systems/day-night";

export interface InventorySlot {
  itemId: string;
  qty: number;
}

export interface PlacedBuilding {
  id: string;
  buildingId: string;
  cellX: number;
  cellZ: number;
}

export interface PlotState {
  buildingId: string; // matches a PlacedBuilding.id whose def.isPlot is true
  cropId: string | null;
  plantedAtMs: number | null;
}

export interface PlayerState {
  x: number;
  y: number;
  z: number;
  yaw: number;
  health: number;
  maxHealth: number;
  stamina: number;
  maxStamina: number;
}

// A single plain, JSON-serializable object that every gameplay system reads
// and writes through. This is what save-load.ts persists to localStorage,
// and — if networked multiplayer is ever added — the natural thing a sync
// layer would diff/broadcast, without any system needing to change.
export interface GameState {
  seed: number;
  elapsedMs: number;
  player: PlayerState;
  inventory: InventorySlot[];
  placedBuildings: PlacedBuilding[];
  plots: PlotState[];
  /**
   * Recipe ids the player has discovered. A recipe is learned the first time
   * they hold one of its ingredients, so the crafting panel grows with the
   * world instead of listing everything from the first minute.
   */
  knownRecipes: string[];
  /** Discovered but not yet looked at — drives the NEW badge in the panel. */
  unseenRecipes: string[];
}

export function createInitialState(seedInput: string | number = "romestead"): GameState {
  const seed = typeof seedInput === "string" ? hashStringToSeed(seedInput) : seedInput;
  return {
    seed,
    // Start mid-morning rather than at midnight (t=0) so a fresh game opens
    // in daylight instead of darkness.
    elapsedMs: DAY_LENGTH_MS * 0.4,
    player: { x: 0, y: 0, z: 8, yaw: 0, health: 100, maxHealth: 100, stamina: 100, maxStamina: 100 },
    inventory: [
      { itemId: "axe", qty: 1 },
      { itemId: "pickaxe", qty: 1 },
      { itemId: "wheat_seed", qty: 4 },
    ],
    placedBuildings: [],
    plots: [],
    // Nothing consumes the starting axe, pickaxe or seeds, so discovery alone
    // would open the panel completely empty. Plank is the one recipe that
    // turns a raw gathered thing into the input for everything else, so it is
    // the thread to pull: its row reads "Needs: x Wood 0/2", which says where
    // to go next. Holding a plank then unlocks the tools and the sword.
    knownRecipes: ["plank"],
    unseenRecipes: [],
  };
}
