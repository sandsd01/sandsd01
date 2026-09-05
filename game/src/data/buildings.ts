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
   * A piece you walk **onto** rather than into.
   *
   * It is not a collider for the player at all — `BuildingSystem.topAt` gives
   * its surface height instead, and a grounded body follows its floor, so
   * walking up a ramp needs no new movement rule. Enemies still treat it as
   * solid: a raised platform they cannot climb is the entire point of it.
   */
  standable?: boolean;
  /**
   * A piece that lights the ground around it, and the shape of that light.
   * Stated as data because "does this thing glow" is content, not behaviour —
   * see BuildingSystem#spawnMesh, which is the only place that reads it.
   */
  light?: { color: number; intensity: number; distance: number; height: number };
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
  // What a journey to the frontier buys. Brick tops out at 300, which a raid
  // in the teens walks through: this is the piece that lets a base keep pace
  // with a schedule that escalates forever. Deliberately a *wall* and not a
  // third suit of armour — the player's own numbers stopped climbing when
  // iron armour was crafted, and the homestead is what grows after that.
  reinforced_wall: {
    id: "reinforced_wall",
    category: "structure",
    name: "Reinforced Wall",
    footprintCells: [{ x: 0, z: 0 }],
    cost: [
      { itemId: "ancient_stone", qty: 4 },
      { itemId: "brick", qty: 2 },
    ],
    height: 2.6,
    maxHealth: 700,
    // Lighter than the ancient stone node it is quarried from (0x6d6a78), not
    // the same value: rendered at the node's own colour a wall of these came
    // out as a flat near-black slab with none of its posts or rail visible —
    // the most expensive piece in the game reading as a hole in the world.
    // Its posts take the darker node colour instead, so the piece has internal
    // contrast the way the brick wall does. Seen, not reasoned about.
    color: 0x9a94ad,
    isPlot: false,
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
  // The spike trap wears a wave down; this one takes pieces out of it. Same
  // rule as the spike trap — it never wears out — so the cost is the frontier
  // trip, paid once, rather than a consumable that turns every raid into a
  // restocking errand.
  heavy_trap: {
    id: "heavy_trap",
    category: "structure",
    name: "Heavy Trap",
    footprintCells: [{ x: 0, z: 0 }],
    cost: [
      { itemId: "ancient_stone", qty: 3 },
      { itemId: "iron_ingot", qty: 1 },
    ],
    height: 0.2,
    maxHealth: 100,
    color: 0x5c5a68,
    isPlot: false,
  },
  // What the cave buys. Darkness is the oldest threat in this game — a raid
  // has been survivable since the first wall, but the field at night has never
  // been *visible*, and until now nothing you could craft answered that. A
  // brazier is not stronger than anything; it lets you see what is coming.
  brazier: {
    id: "brazier",
    category: "structure",
    name: "Brazier",
    footprintCells: [{ x: 0, z: 0 }],
    cost: [
      { itemId: "glow_crystal", qty: 2 },
      { itemId: "stone", qty: 4 },
    ],
    height: 1.5,
    // Low: it is a light, not a wall, and a raider that walks into one should
    // put it out. Standing lights that also happened to be tough would make
    // the brazier the cheapest fortification in the game.
    maxHealth: 70,
    color: 0x5b5560,
    // Near-white with only a hint of the crystal's blue. A saturated cyan is
    // what the crystal itself is, and it looked right in the abstract — but a
    // cyan light falling on grass comes back green, and the first night shot
    // had the homestead lit like a radioactive spill. The tint belongs on the
    // crystal, not on everything the crystal shines at.
    light: { color: 0xdcecff, intensity: 10, distance: 22, height: 1.55 },
    isPlot: false,
  },
  // Ground you can get above, and the first vertical thing in the game.
  //
  // A *tower* was the obvious shape and does not work: the grid is one unit a
  // cell, a jump clears 1.11 units (JUMP_SPEED squared over twice GRAVITY),
  // and pieces do not stack — so a platform high enough to matter would have
  // needed a climbing mode the game does not have. A ramp needs none: you
  // walk up it exactly as you walk up a hill. It also fits the fiction better
  // than a tower does.
  //
  // 2.4 high, against an enemy reach of ENEMY_REACH_HEIGHT: standing up here
  // puts you out of a raider's swing while your bow still reaches them, which
  // is the first time in this game that the bow has had a job walls could not
  // already do.
  rampart: {
    id: "rampart",
    category: "structure",
    name: "Rampart",
    // Four cells of climb for 2.4 of rise, then two of standing room. Any
    // steeper and it reads as a wall you are inexplicably walking up.
    footprintCells: [
      { x: 0, z: 0 },
      { x: 0, z: 1 },
      { x: 1, z: 0 },
      { x: 1, z: 1 },
      { x: 2, z: 0 },
      { x: 2, z: 1 },
      { x: 3, z: 0 },
      { x: 3, z: 1 },
      { x: 4, z: 0 },
      { x: 4, z: 1 },
      { x: 5, z: 0 },
      { x: 5, z: 1 },
    ],
    cost: [
      { itemId: "cloud_iron", qty: 3 },
      { itemId: "brick", qty: 4 },
    ],
    height: 2.4,
    // Sturdy, but it is a floor rather than a wall: raiders walk round it
    // rather than through it, so it is rarely what they are hitting.
    maxHealth: 260,
    color: 0x8d8698,
    standable: true,
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
