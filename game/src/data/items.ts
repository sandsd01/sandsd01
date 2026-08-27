export type ItemCategory = "resource" | "tool" | "seed" | "crop" | "building";

export interface ItemDef {
  id: string;
  name: string;
  category: ItemCategory;
  stackSize: number;
  color: number;
}

// Content is data, not code: add a new item by adding a row here, not by
// touching any system logic.
export const ITEMS: Record<string, ItemDef> = {
  wood: { id: "wood", name: "Wood", category: "resource", stackSize: 99, color: 0x8b5a2b },
  stone: { id: "stone", name: "Stone", category: "resource", stackSize: 99, color: 0x8a8a8a },
  plank: { id: "plank", name: "Plank", category: "resource", stackSize: 99, color: 0xc19a6b },
  axe: { id: "axe", name: "Axe", category: "tool", stackSize: 1, color: 0xb0b0b0 },
  pickaxe: { id: "pickaxe", name: "Pickaxe", category: "tool", stackSize: 1, color: 0xb0b0b0 },
  sword: { id: "sword", name: "Sword", category: "tool", stackSize: 1, color: 0xd0d0e0 },
  wheat_seed: {
    id: "wheat_seed",
    name: "Wheat Seed",
    category: "seed",
    stackSize: 99,
    color: 0xd4c26a,
  },
  wheat: { id: "wheat", name: "Wheat", category: "crop", stackSize: 99, color: 0xe8c840 },
  berry: { id: "berry", name: "Berry", category: "resource", stackSize: 99, color: 0x9a2a4a },
  clay: { id: "clay", name: "Clay", category: "resource", stackSize: 99, color: 0x8a5a42 },
  iron_ore: { id: "iron_ore", name: "Iron Ore", category: "resource", stackSize: 99, color: 0x6a5a52 },
  iron_ingot: { id: "iron_ingot", name: "Iron Ingot", category: "resource", stackSize: 99, color: 0xd8d8e0 },
  brick: { id: "brick", name: "Brick", category: "resource", stackSize: 99, color: 0xa85c3a },
  iron_sword: { id: "iron_sword", name: "Iron Sword", category: "tool", stackSize: 1, color: 0xe0e0f0 },
};

export function getItem(id: string): ItemDef {
  const item = ITEMS[id];
  if (!item) throw new Error(`Unknown item id: ${id}`);
  return item;
}
