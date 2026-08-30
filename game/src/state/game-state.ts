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
  /**
   * The eight quick slots, holding **item ids rather than inventory indices**.
   * `removeItem` rebuilds `inventory` as a filtered copy every time anything
   * is spent, so an index stored here would quietly come to point at a
   * different item.
   */
  hotbar: (string | null)[];
  /** Which of those slots is in hand. */
  equippedSlot: number;
  /**
   * Contents of each placed container, keyed by `PlacedBuilding.id`. Kept out
   * of the building record so a barrel with things in it is still just a
   * building to everything that places and draws them.
   */
  containers: Record<string, InventorySlot[]>;
  /**
   * How far each resource node has been worked, keyed by `ResourceNode.id`.
   * **Sparse on purpose** — a node that is still untouched is simply absent,
   * so a fresh world adds nothing to the save rather than several hundred
   * default entries.
   *
   * Without this the world is re-scattered from the seed on every boot, which
   * made reloading the page a faster way to restock a felled tree than waiting
   * out its 20-35 second respawn.
   */
  nodes: Record<string, NodeSaveState>;
}

/** Persisted per-node progress. `depletedAtMs` is on the `elapsedMs` clock. */
export interface NodeSaveState {
  hits: number;
  depleted: boolean;
  depletedAtMs: number;
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
    // Seeded from the starting kit by equipment.ts, so the player begins
    // holding their axe rather than holding nothing.
    hotbar: [null, null, null, null, null, null, null, null],
    equippedSlot: 0,
    containers: {},
    nodes: {},
  };
}
