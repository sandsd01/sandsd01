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
  color: number;
  isPlot: boolean; // true for farmable plots (see systems/farming.ts)
  /** true for anything that stores items (see systems/containers.ts) */
  isContainer?: boolean;
}

export const BUILDINGS: Record<string, BuildingDef> = {
  wall: {
    id: "wall",
    category: "structure",
    name: "Wall",
    footprintCells: [{ x: 0, z: 0 }],
    cost: [{ itemId: "plank", qty: 4 }],
    height: 2,
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
    color: 0xc19a6b,
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
    color: 0x7a4a2c,
    isPlot: false,
  },
};

export function getBuilding(id: string): BuildingDef {
  const building = BUILDINGS[id];
  if (!building) throw new Error(`Unknown building id: ${id}`);
  return building;
}
