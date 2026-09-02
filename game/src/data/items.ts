export type ItemCategory = "resource" | "tool" | "seed" | "crop" | "building";

export interface ItemDef {
  id: string;
  name: string;
  category: ItemCategory;
  stackSize: number;
  color: number;
  /**
   * Health restored when eaten. Only edible items carry it — its presence is
   * what makes an item edible, so there's no separate flag to keep in step.
   */
  heals?: number;
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
  // Berries are the field snack: picked, not cooked, so they heal a little.
  berry: {
    id: "berry",
    name: "Berry",
    category: "resource",
    stackSize: 99,
    color: 0x9a2a4a,
    heals: 8,
  },
  clay: { id: "clay", name: "Clay", category: "resource", stackSize: 99, color: 0x8a5a42 },
  iron_ore: { id: "iron_ore", name: "Iron Ore", category: "resource", stackSize: 99, color: 0x6a5a52 },
  iron_ingot: { id: "iron_ingot", name: "Iron Ingot", category: "resource", stackSize: 99, color: 0xd8d8e0 },
  brick: { id: "brick", name: "Brick", category: "resource", stackSize: 99, color: 0xa85c3a },
  iron_sword: { id: "iron_sword", name: "Iron Sword", category: "tool", stackSize: 1, color: 0xe0e0f0 },
  iron_axe: { id: "iron_axe", name: "Iron Axe", category: "tool", stackSize: 1, color: 0xc8cad6 },
  iron_pickaxe: {
    id: "iron_pickaxe",
    name: "Iron Pickaxe",
    category: "tool",
    stackSize: 1,
    color: 0xc8cad6,
  },
  // What farming is finally for: wheat had no use but growing more wheat.
  bread: { id: "bread", name: "Bread", category: "crop", stackSize: 99, color: 0xd9a441, heals: 40 },
  // Dropped by the dead, and the only things that are. Killing used to pay
  // nothing at all, so combat was a pure cost — these are what make a fight
  // worth picking, and both feed recipes rather than sitting in the bag.
  bone: { id: "bone", name: "Bone", category: "resource", stackSize: 99, color: 0xe6e0cc },
  hide: { id: "hide", name: "Hide", category: "resource", stackSize: 99, color: 0x7a5238 },
  hide_armour: {
    id: "hide_armour",
    name: "Hide Armour",
    category: "tool",
    stackSize: 1,
    color: 0x7a5238,
  },
  iron_armour: {
    id: "iron_armour",
    name: "Iron Armour",
    category: "tool",
    stackSize: 1,
    color: 0x9aa3ad,
  },
  bow: {
    id: "bow",
    name: "Bow",
    category: "tool",
    stackSize: 1,
    color: 0x8a6134,
  },
  // Ammunition, and the only consumable that comes back: a spent arrow lands
  // on the ground as an ordinary drop, so shooting is a loop of spend and
  // retrieve rather than a resource that only ever runs down.
  arrow: {
    id: "arrow",
    name: "Arrow",
    category: "resource",
    stackSize: 99,
    color: 0xcfc3a8,
  },
  bone_club: { id: "bone_club", name: "Bone Club", category: "tool", stackSize: 1, color: 0xdcd3b8 },
  broth: { id: "broth", name: "Broth", category: "crop", stackSize: 99, color: 0xb5793c, heals: 25 },
};

export function getItem(id: string): ItemDef {
  const item = ITEMS[id];
  if (!item) throw new Error(`Unknown item id: ${id}`);
  return item;
}
