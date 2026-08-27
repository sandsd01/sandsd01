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
};

export function getBuilding(id: string): BuildingDef {
  const building = BUILDINGS[id];
  if (!building) throw new Error(`Unknown building id: ${id}`);
  return building;
}
