export interface ItemStack {
  itemId: string;
  qty: number;
}

export interface RecipeDef {
  id: string;
  name: string;
  inputs: ItemStack[];
  output: ItemStack;
  craftTimeMs: number;
  /**
   * Building id that must be standing nearby to craft this. Smelting and
   * smithing need a Forge; everything else is craftable in the field.
   */
  requiresStation?: string;
}

export const RECIPES: RecipeDef[] = [
  {
    id: "plank",
    name: "Plank",
    inputs: [{ itemId: "wood", qty: 2 }],
    output: { itemId: "plank", qty: 1 },
    craftTimeMs: 500,
  },
  {
    id: "axe",
    name: "Axe",
    inputs: [
      { itemId: "plank", qty: 2 },
      { itemId: "stone", qty: 1 },
    ],
    output: { itemId: "axe", qty: 1 },
    craftTimeMs: 1500,
  },
  {
    id: "pickaxe",
    name: "Pickaxe",
    inputs: [
      { itemId: "plank", qty: 2 },
      { itemId: "stone", qty: 2 },
    ],
    output: { itemId: "pickaxe", qty: 1 },
    craftTimeMs: 1500,
  },
  {
    id: "sword",
    name: "Sword",
    inputs: [
      { itemId: "plank", qty: 1 },
      { itemId: "stone", qty: 3 },
    ],
    output: { itemId: "sword", qty: 1 },
    craftTimeMs: 2000,
  },
  {
    id: "wheat_seed",
    name: "Wheat Seeds (from Wheat)",
    inputs: [{ itemId: "wheat", qty: 1 }],
    output: { itemId: "wheat_seed", qty: 2 },
    craftTimeMs: 500,
  },
  {
    id: "brick",
    name: "Brick",
    inputs: [{ itemId: "clay", qty: 2 }],
    output: { itemId: "brick", qty: 1 },
    craftTimeMs: 1000,
  },
  {
    id: "iron_ingot",
    name: "Iron Ingot",
    inputs: [
      { itemId: "iron_ore", qty: 2 },
      { itemId: "wood", qty: 1 },
    ],
    output: { itemId: "iron_ingot", qty: 1 },
    craftTimeMs: 2000,
    requiresStation: "forge",
  },
  {
    id: "iron_sword",
    name: "Iron Sword",
    inputs: [
      { itemId: "iron_ingot", qty: 2 },
      { itemId: "plank", qty: 1 },
    ],
    output: { itemId: "iron_sword", qty: 1 },
    craftTimeMs: 2500,
    requiresStation: "forge",
  },
];

export function getRecipe(id: string): RecipeDef {
  const recipe = RECIPES.find((r) => r.id === id);
  if (!recipe) throw new Error(`Unknown recipe id: ${id}`);
  return recipe;
}
