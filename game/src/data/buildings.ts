import type { ItemStack } from "./recipes";
import type { Cell } from "../utils/grid";

/** How the Build panel groups pieces — for finding things, nothing more. */
export type BuildingCategory = "structure" | "station" | "storage" | "farming";

export const BUILDING_CATEGORIES: BuildingCategory[] = [
  "structure",
  "station",
  "storage",
  "farming",
];

export const BUILDING_CATEGORY_LABELS: Record<BuildingCategory, string> = {
  structure: "Structure",
  station: "Stations",
  storage: "Storage",
  farming: "Farming",
};

export interface BuildingDef {
  category: BuildingCategory;
  id: string;
  name: string;
  footprintCells: Cell[]; // relative to the placement anchor cell
  cost: ItemStack[];
  height: number;
  /**
   * How much damage the piece absorbs before it is destroyed. Stated per piece
   * rather than derived from `cost`, because how much a thing costs and how
   * well it holds a line are different questions — brick costs a little more
   * than timber and should stop rather more than a little more.
   */
  maxHealth: number;
  color: number;
  isPlot: boolean; // true for farmable plots (see systems/farming.ts)
  /** true for anything that stores items (see systems/containers.ts) */
  isContainer?: boolean;
  /**
   * true for a piece that can stand open. A shut door is a wall in every
   * respect — it blocks, it can be hit, it can be repaired — and an open one
   * is not there at all as far as movement is concerned.
   */
  isDoor?: boolean;
}

export const BUILDINGS: Record<string, BuildingDef> = {
  wall: {
    id: "wall",
    category: "structure",
    name: "Wall",
    footprintCells: [{ x: 0, z: 0 }],
    cost: [{ itemId: "plank", qty: 4 }],
    height: 2,
    maxHealth: 120,
    color: 0xc19a6b,
    isPlot: false,
  },
  foundation: {
    id: "foundation",
    category: "structure",
    name: "Foundation",
    footprintCells: [{ x: 0, z: 0 }],
    cost: [{ itemId: "stone", qty: 6 }],
    height: 0.2,
    maxHealth: 80,
    color: 0x9a9a9a,
    isPlot: false,
  },
  farm_plot: {
    id: "farm_plot",
    category: "farming",
    name: "Farm Plot",
    footprintCells: [{ x: 0, z: 0 }],
    cost: [{ itemId: "wood", qty: 3 }],
    height: 0.15,
    maxHealth: 40,
    color: 0x6b4a2b,
    isPlot: true,
  },
  brick_wall: {
    id: "brick_wall",
    category: "structure",
    name: "Brick Wall",
    footprintCells: [{ x: 0, z: 0 }],
    cost: [{ itemId: "brick", qty: 3 }],
    height: 2.4,
    maxHealth: 300,
    color: 0xa85c3a,
    isPlot: false,
  },
  // Workshop pieces. The forge is the only one with a rule attached (see
  // systems/crafting.ts): smelting and smithing need one standing nearby.
  forge: {
    id: "forge",
    category: "station",
    name: "Forge",
    footprintCells: [{ x: 0, z: 0 }],
    cost: [
      { itemId: "stone", qty: 10 },
      { itemId: "clay", qty: 4 },
    ],
    height: 1.7,
    maxHealth: 60,
    color: 0x6a4030,
    isPlot: false,
  },
  anvil: {
    id: "anvil",
    category: "station",
    name: "Anvil",
    footprintCells: [{ x: 0, z: 0 }],
    // Ore rather than ingots: an anvil you could only build after smelting,
    // which itself needs the forge, would be a dead end on a fresh world.
    cost: [
      { itemId: "stone", qty: 6 },
      { itemId: "iron_ore", qty: 2 },
    ],
    height: 0.85,
    maxHealth: 60,
    color: 0x3a3a42,
    isPlot: false,
  },
  workbench: {
    id: "workbench",
    category: "station",
    name: "Workbench",
    footprintCells: [{ x: 0, z: 0 }],
    cost: [{ itemId: "plank", qty: 4 }],
    height: 0.9,
    maxHealth: 60,
    color: 0xa8794a,
    isPlot: false,
  },
  // The first piece that is not one cell. `footprintCells` and everything that
  // walks it were written for this from the start and then never used, so
  // every building in the game was 1x1 and the machinery sat idle.
  long_wall: {
    id: "long_wall",
    category: "structure",
    name: "Long Wall",
    footprintCells: [
      { x: 0, z: 0 },
      { x: 1, z: 0 },
    ],
    cost: [{ itemId: "plank", qty: 7 }],
    height: 2,
    maxHealth: 200,
    color: 0xc19a6b,
    isPlot: false,
  },
  // The piece the raid work left the game needing. Walls stop the player as
  // well as the raiders, so before this a ring of wall around a homestead was
  // a cell: seal it and you are inside for good, leave a gap and the gap is
  // exactly where the raiders walk in. Timber rather than iron on purpose —
  // a door you cannot build until you have smelted is a door nobody has on
  // the night of the first raid.
  gate: {
    id: "gate",
    category: "structure",
    name: "Gate",
    footprintCells: [{ x: 0, z: 0 }],
    cost: [{ itemId: "plank", qty: 6 }],
    height: 2,
    maxHealth: 100,
    color: 0xb08653,
    isPlot: false,
    isDoor: true,
  },
  // Low enough to be walked over rather than around — see WALKABLE_HEIGHT in
  // systems/building.ts. That is the whole design: raiders come straight at
  // the player and take whatever is underfoot on the way.
  spike_trap: {
    id: "spike_trap",
    category: "structure",
    name: "Spike Trap",
    footprintCells: [{ x: 0, z: 0 }],
    cost: [
      { itemId: "wood", qty: 6 },
      { itemId: "stone", qty: 3 },
    ],
    height: 0.2,
    maxHealth: 60,
    color: 0x7c7266,
    isPlot: false,
  },
  barrel: {
    id: "barrel",
    category: "storage",
    name: "Barrel",
    isContainer: true,
    footprintCells: [{ x: 0, z: 0 }],
    cost: [{ itemId: "plank", qty: 3 }],
    height: 0.95,
    maxHealth: 60,
    color: 0x7a4a2c,
    isPlot: false,
  },
};

export function getBuilding(id: string): BuildingDef {
  const building = BUILDINGS[id];
  if (!building) throw new Error(`Unknown building id: ${id}`);
  return building;
}
