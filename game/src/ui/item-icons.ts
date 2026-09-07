import { getItem } from "../data/items";
import { colorToCss } from "./dom";
import { icon, type IconName } from "./icons";

/**
 * One glyph per item, for every list in the game that shows one.
 *
 * There used to be two of these tables. `hud.ts` had fourteen entries for the
 * resource chips and `item-hotbar.ts` had twenty-nine for the quick bar — the
 * fourteen a strict subset of the twenty-nine, except for `plank`, which the
 * two disagreed about. Neither knew the other existed, so an item added to one
 * did not appear in the other, and the eight wearable items were in neither.
 *
 * Both tables also predated four screens that show items and draw no glyph at
 * all: the bag, the barrel, and the two cost lines. A single table is what lets
 * those be fixed once rather than five times.
 *
 * The rule that matters here: two rows drawing the same picture is two rows
 * whose picture has stopped carrying information. `uicheck` enforces it on the
 * chip row by rasterising each glyph and comparing path geometry, because
 * comparing names cannot catch two lucide icons that happen to draw the same
 * shape — and because this project has picked a duplicate by hand three times.
 */
const ITEM_ICONS: Record<string, IconName> = {
  // --- raw materials -------------------------------------------------------
  wood: "trees",
  stone: "mountain",
  // `squareStack` rather than the hotbar's `layers`: clay owns `layers`, and
  // clay is in the chip row where the no-duplicates rule is enforced, so plank
  // is the one that has to move. This is the one entry the two tables
  // disagreed about, and it disagreed in the direction that made the hotbar
  // show clay and plank wearing the same glyph.
  plank: "squareStack",
  clay: "layers",
  brick: "brickWall",
  // Ore and ingot share deliberately: one material at two stages, the way the
  // tools share a glyph across their tiers.
  iron_ore: "gem",
  iron_ingot: "gem",
  cloud_iron: "cloud",
  skysteel_ingot: "cloud",
  ancient_stone: "landmark",
  glow_crystal: "sparkles",
  bone: "bone",
  hide: "footprints",

  // --- tools and weapons ---------------------------------------------------
  // A tier shares its family's glyph on purpose: an iron axe is an axe.
  axe: "axe",
  iron_axe: "axe",
  pickaxe: "pickaxe",
  iron_pickaxe: "pickaxe",
  sword: "sword",
  iron_sword: "sword",
  skysteel_sword: "sword",
  bone_club: "hammer",
  bow: "crosshair",
  arrow: "navigation",
  crystal_lantern: "lamp",

  // --- food and farming ----------------------------------------------------
  wheat_seed: "sprout",
  wheat: "wheat",
  berry: "grape",
  // Not `wheat`, which is what it was: wheat and the bread baked from it are
  // two rows a player has to tell apart, and they sat side by side wearing one
  // glyph. Unlike ore/ingot above, these are both things you can hold at once.
  bread: "croissant",
  // Not `flame`, which is now the ember cloak's — and a bowl says "food" where
  // a flame said "cooking", which is the pot, not the meal.
  broth: "soup",

  // --- worn gear -----------------------------------------------------------
  // None of these had an icon in either old table, so all eight fell through
  // to the fallback. They are the newest items in the game and the ones most
  // worth telling apart, since the bag is where you choose between them.
  //
  // The three armours share `shirt` for the same reason three swords share
  // `sword`: one kind of thing at three tiers.
  hide_armour: "shirt",
  iron_armour: "shirt",
  skysteel_armour: "shirt",
  stormcleave: "swords",
  divine_wings: "feather",
  ember_cloak: "flame",
  quickdraw_ring: "torus",
  gatherers_charm: "leaf",
};

/**
 * What an item with no entry above draws.
 *
 * A question mark, not the crate `item-hotbar.ts` used to fall back to. A crate
 * is a plausible icon for a material, so a missing entry looked deliberate and
 * survived — that is how eight items ended up with no glyph and nobody noticed.
 * A question mark is visibly wrong in a screenshot, and it is what makes "no
 * row renders the fallback" a check that can actually be written.
 */
export const ITEM_ICON_FALLBACK: IconName = "circleHelp";

/** The glyph name for an item, or the fallback if it has none. */
export function itemIcon(itemId: string): IconName {
  return ITEM_ICONS[itemId] ?? ITEM_ICON_FALLBACK;
}

/**
 * A rendered glyph for an item, tinted with the item's own colour.
 *
 * The tint comes from `ITEMS[id].color` rather than a table beside this one.
 * `hud.ts` used to keep an `ITEM_COLORS` map of fourteen entries; every single
 * value was identical to the item's own `color`, so it was a copy that could
 * only ever drift — a recoloured item would have changed in the world and in
 * the hotbar, and stayed the old colour in the chip row alone.
 */
export function itemIconEl(itemId: string, className = "icon"): HTMLSpanElement {
  const glyph = icon(itemIcon(itemId), className);
  glyph.style.color = colorToCss(getItem(itemId).color);
  return glyph;
}

/** Every id this table names. Exported so a check can walk it. */
export function iconedItemIds(): string[] {
  return Object.keys(ITEM_ICONS);
}
