import type { ItemStack } from "./recipes";

export interface CropDef {
  id: string;
  name: string;
  seedItemId: string;
  growthStages: number;
  stageDurationMs: number;
  yield: ItemStack;
  color: number;
}

export const CROPS: Record<string, CropDef> = {
  wheat: {
    id: "wheat",
    name: "Wheat",
    seedItemId: "wheat_seed",
    growthStages: 3,
    stageDurationMs: 15_000, // shortened for MVP playability/testing
    yield: { itemId: "wheat", qty: 3 },
    color: 0xe8c840,
  },
};

export function getCrop(id: string): CropDef {
  const crop = CROPS[id];
  if (!crop) throw new Error(`Unknown crop id: ${id}`);
  return crop;
}
