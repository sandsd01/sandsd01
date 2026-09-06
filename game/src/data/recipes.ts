export interface ItemStack {
  itemId: string;
  qty: number;
}

// What the crafting panel's filter chips are built from. A recipe belongs to
// exactly one — the categories are for finding things, and an item that could
// arguably sit in two would only make the list harder to scan.
export type RecipeCategory = "materials" | "tools" | "weapons" | "farming" | "food";

export const RECIPE_CATEGORIES: RecipeCategory[] = [
  "materials",
  "tools",
  "weapons",
  "farming",
  "food",
];

export const RECIPE_CATEGORY_LABELS: Record<RecipeCategory, string> = {
  materials: "Materials",
  tools: "Tools",
  weapons: "Weapons",
  farming: "Farming",
  food: "Food",
};

export interface RecipeDef {
  id: string;
  name: string;
  inputs: ItemStack[];
  output: ItemStack;
  category: RecipeCategory;
  /**
   * Building id that must be standing nearby to craft this. Each station has
   * its own job: the Forge smelts, the Anvil shapes metal into weapons, and
   * the Workbench assembles everything else. Anything without one is
   * craftable in the field.
   */
  requiresStation?: string;
}

export const RECIPES: RecipeDef[] = [
  {
    id: "plank",
    name: "Plank",
    inputs: [{ itemId: "wood", qty: 2 }],
    output: { itemId: "plank", qty: 1 },
    category: "materials",
  },
  {
    id: "axe",
    name: "Axe",
    inputs: [
      { itemId: "plank", qty: 2 },
      { itemId: "stone", qty: 1 },
    ],
    output: { itemId: "axe", qty: 1 },
    category: "tools",
  },
  {
    id: "pickaxe",
    name: "Pickaxe",
    inputs: [
      { itemId: "plank", qty: 2 },
      { itemId: "stone", qty: 2 },
    ],
    output: { itemId: "pickaxe", qty: 1 },
    category: "tools",
  },
  {
    id: "sword",
    name: "Sword",
    inputs: [
      { itemId: "plank", qty: 1 },
      { itemId: "stone", qty: 3 },
    ],
    output: { itemId: "sword", qty: 1 },
    category: "weapons",
  },
  {
    id: "wheat_seed",
    name: "Wheat Seeds (from Wheat)",
    inputs: [{ itemId: "wheat", qty: 1 }],
    output: { itemId: "wheat_seed", qty: 2 },
    category: "farming",
  },
  {
    id: "brick",
    name: "Brick",
    inputs: [{ itemId: "clay", qty: 2 }],
    output: { itemId: "brick", qty: 1 },
    category: "materials",
  },
  {
    id: "iron_ingot",
    name: "Iron Ingot",
    inputs: [
      { itemId: "iron_ore", qty: 2 },
      { itemId: "wood", qty: 1 },
    ],
    output: { itemId: "iron_ingot", qty: 1 },
    category: "materials",
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
    category: "weapons",
    // Shaping a blade belongs at the anvil, not in the smelter. This also
    // gives the anvil a job: it was buildable but gated nothing.
    requiresStation: "anvil",
  },
  {
    id: "iron_axe",
    name: "Iron Axe",
    inputs: [
      { itemId: "iron_ingot", qty: 2 },
      { itemId: "plank", qty: 2 },
    ],
    output: { itemId: "iron_axe", qty: 1 },
    category: "tools",
    requiresStation: "workbench",
  },
  {
    id: "iron_pickaxe",
    name: "Iron Pickaxe",
    inputs: [
      { itemId: "iron_ingot", qty: 2 },
      { itemId: "plank", qty: 2 },
    ],
    output: { itemId: "iron_pickaxe", qty: 1 },
    category: "tools",
    requiresStation: "workbench",
  },
  {
    id: "bread",
    name: "Bread",
    inputs: [{ itemId: "wheat", qty: 3 }],
    output: { itemId: "bread", qty: 1 },
    category: "food",
    requiresStation: "workbench",
  },
  {
    // A weapon between the plain sword and the iron one, made from what the
    // dead leave behind — so the first real upgrade can come from fighting
    // rather than from finding an iron vein.
    id: "bone_club",
    name: "Bone Club",
    inputs: [
      { itemId: "bone", qty: 3 },
      { itemId: "hide", qty: 2 },
      { itemId: "wood", qty: 2 },
    ],
    output: { itemId: "bone_club", qty: 1 },
    category: "weapons",
  },
  {
    // The first thing the player can put *on*. Hide's only uses were the club
    // and the bow, so a brute's better drop fed two dead ends and nothing that
    // made the next raid survivable.
    id: "hide_armour",
    name: "Hide Armour",
    inputs: [
      { itemId: "hide", qty: 6 },
      { itemId: "plank", qty: 2 },
    ],
    output: { itemId: "hide_armour", qty: 1 },
    category: "tools",
    requiresStation: "workbench",
  },
  {
    /**
     * What the sky island is *for*.
     *
     * Cloud iron had exactly one use — three units towards a watchtower —
     * against an island that pays 99 for a full clear and respawns its nodes
     * every forty seconds. Climb the tree once, build the one tower, and the
     * whole region was finished forever. Measured, not guessed: thirteen
     * nodes up there, 99 units in a single sweep, a thirty-three to one
     * mismatch with the only thing that wanted any.
     *
     * Four to one so the trip is felt at the forge rather than only at the
     * anvil, and so the numbers below can be read as journeys rather than as
     * arithmetic.
     */
    id: "skysteel_ingot",
    name: "Skysteel Ingot",
    inputs: [{ itemId: "cloud_iron", qty: 4 }],
    output: { itemId: "skysteel_ingot", qty: 1 },
    category: "materials",
    requiresStation: "forge",
  },
  {
    id: "skysteel_sword",
    name: "Skysteel Sword",
    inputs: [
      { itemId: "skysteel_ingot", qty: 6 },
      { itemId: "plank", qty: 1 },
    ],
    output: { itemId: "skysteel_sword", qty: 1 },
    category: "weapons",
    requiresStation: "anvil",
  },
  {
    id: "skysteel_armour",
    name: "Skysteel Armour",
    inputs: [
      { itemId: "skysteel_ingot", qty: 10 },
      { itemId: "hide", qty: 4 },
    ],
    output: { itemId: "skysteel_armour", qty: 1 },
    category: "tools",
    requiresStation: "anvil",
  },
  {
    // And the first destination for iron that is not another tool.
    id: "iron_armour",
    name: "Iron Armour",
    inputs: [
      { itemId: "iron_ingot", qty: 5 },
      { itemId: "hide", qty: 3 },
    ],
    output: { itemId: "iron_armour", qty: 1 },
    category: "tools",
    requiresStation: "anvil",
  },
  {
    // The answer to a wall you cannot fight from. Hide's only use until now was
    // the club, which meant a brute's better drop fed one dead-end item.
    id: "bow",
    name: "Bow",
    inputs: [
      { itemId: "wood", qty: 3 },
      { itemId: "hide", qty: 2 },
    ],
    output: { itemId: "bow", qty: 1 },
    category: "weapons",
  },
  {
    // Four at a time, from staples: ammunition you have to stop and make one
    // at a time is ammunition nobody uses. Spent arrows can be picked back up,
    // so this is the cost of *losing* them, not of firing them.
    id: "arrow",
    name: "Arrows",
    inputs: [
      { itemId: "plank", qty: 1 },
      { itemId: "stone", qty: 1 },
    ],
    output: { itemId: "arrow", qty: 4 },
    category: "weapons",
  },
  {
    // Food had exactly one recipe before this, which made a whole crafting
    // category a single row. Broth also gives bone a use for a player who
    // never gets round to a club.
    id: "broth",
    name: "Broth",
    inputs: [
      { itemId: "bone", qty: 2 },
      { itemId: "berry", qty: 3 },
    ],
    output: { itemId: "broth", qty: 1 },
    category: "food",
    requiresStation: "workbench",
  },
];

export function getRecipe(id: string): RecipeDef {
  const recipe = RECIPES.find((r) => r.id === id);
  if (!recipe) throw new Error(`Unknown recipe id: ${id}`);
  return recipe;
}
