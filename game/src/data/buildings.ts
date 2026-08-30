import type { ItemStack } from "./recipes";
import type { Cell } from "../utils/grid";

export interface BuildingDef {
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
    name: "Wall",
    footprintCells: [{ x: 0, z: 0 }],
    cost: [{ itemId: "plank", qty: 4 }],
    height: 2,
    color: 0xc19a6b,
    isPlot: false,
  },
  foundation: {
    id: "foundation",
    name: "Foundation",
    footprintCells: [{ x: 0, z: 0 }],
    cost: [{ itemId: "stone", qty: 6 }],
    height: 0.2,
    color: 0x9a9a9a,
    isPlot: false,
  },
  farm_plot: {
    id: "farm_plot",
    name: "Farm Plot",
    footprintCells: [{ x: 0, z: 0 }],
    cost: [{ itemId: "wood", qty: 3 }],
    height: 0.15,
    color: 0x6b4a2b,
    isPlot: true,
  },
  brick_wall: {
    id: "brick_wall",
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
    name: "Workbench",
    footprintCells: [{ x: 0, z: 0 }],
    cost: [{ itemId: "plank", qty: 4 }],
    height: 0.9,
    color: 0xa8794a,
    isPlot: false,
  },
  barrel: {
    id: "barrel",
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
