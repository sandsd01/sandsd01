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
};

export function getItem(id: string): ItemDef {
  const item = ITEMS[id];
  if (!item) throw new Error(`Unknown item id: ${id}`);
  return item;
}
