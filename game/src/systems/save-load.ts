import { createInitialState, type GameState } from "../state/game-state";
import { learnAllRecipes } from "./crafting";
import { assignFromInventory, normaliseHotbar } from "./equipment";
import { events } from "../utils/events";
import { raidStartAfter } from "./day-night";
import { START_LEVEL } from "../data/levels";
import { STAT_IDS, initialStats } from "../data/stats";
import { recomputeMaxHealth } from "./progression";

const STORAGE_KEY = "romestead-save-v1";

export function saveGame(state: GameState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    events.emit("game-saved", {});
  } catch (err) {
    console.warn("Failed to save game:", err);
  }
}

// Returns null if there's no save, or it's unreadable/corrupt — callers
// should fall back to a fresh world in that case rather than crashing.
export function loadGame(): GameState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as GameState;
    if (!parsed || typeof parsed !== "object" || !parsed.player || !Array.isArray(parsed.inventory)) {
      return null;
    }
    backfillDefaults(parsed);
    events.emit("game-loaded", {});
    return parsed;
  } catch (err) {
    console.warn("Failed to load save, starting fresh:", err);
    return null;
  }
}

// Fields added after a save was written come back undefined. Rather than
// versioning the whole save, fill in anything missing with its starting value:
// a save from before stamina existed should load as a rested player, not one
// who can never sprint again.
function backfillDefaults(state: GameState): void {
  const defaults = createInitialState().player;
  for (const key of Object.keys(defaults) as (keyof typeof defaults)[]) {
    if (typeof state.player[key] !== "number") state.player[key] = defaults[key];
  }

  // Top-level arrays added later. Anything that iterates them would throw on
  // an older save, so they have to exist before anything else touches state.
  if (!Array.isArray(state.placedBuildings)) state.placedBuildings = [];
  if (!Array.isArray(state.plots)) state.plots = [];
  if (!Array.isArray(state.unseenRecipes)) state.unseenRecipes = [];
  if (!state.containers || typeof state.containers !== "object") state.containers = {};
  // A save from before node progress was persisted loads with a full world,
  // which is exactly what it had before — no node was ever recorded as worked,
  // so there is nothing to restore and an empty record is the honest default.
  if (!state.nodes || typeof state.nodes !== "object") state.nodes = {};
  // Same story for the caches: a save from before they could refill has no
  // timers, and no timer is exactly right — every cache in it was either full
  // or emptied by a player who was told it would stay that way. They start
  // counting from the first frame after the load instead of retroactively.
  if (!state.pois || typeof state.pois !== "object") state.pois = {};
  // And a save from before landmarks were remembered has found none of them,
  // which is what an empty list says. `createPointsOfInterest` gives that save
  // its outer-ring caches on load, so the far landmarks are there to find.
  if (!Array.isArray(state.discovered)) state.discovered = [];
  // Pieces placed before rotation existed were all placed unrotated, and
  // pieces placed before anything could hit them are undamaged.
  for (const placed of state.placedBuildings) {
    if (typeof placed.rotation !== "number") placed.rotation = 0;
    if (typeof placed.damage !== "number") placed.damage = 0;
    if (typeof placed.open !== "boolean") placed.open = false;
  }

  // A save from before raids existed has to be given a schedule, and it has to
  // be counted from where that save's own clock stands. Filling the field with
  // a zeroed record instead would put `nextRaidAtMs` in the distant past and
  // raid a returning player the instant their world finished loading.
  if (!state.raid || typeof state.raid !== "object") {
    state.raid = {
      nextRaidAtMs: raidStartAfter(state.elapsedMs ?? 0),
      active: false,
      wave: 0,
      endsAtMs: 0,
      count: 0,
    };
  }
  // And a save from between the two — it has a `raid` record but predates the
  // counter, so the whole-object guard above skips it. Filling only the
  // missing-record case is the easy half of this to get right and the easy
  // half to stop at.
  if (typeof state.raid.count !== "number") state.raid.count = 0;
  // Every save written before there was anywhere else to be was written on the
  // surface, which is also the only place a save can legitimately resume: a
  // dungeon is regenerated on entry, so a save taken inside one has nothing to
  // come back to. Someone who quit underground is put back at the entrance
  // they used, and if that was never recorded, at wherever they stood.
  if (state.regionReturn === undefined) state.regionReturn = null;
  if (state.region !== "surface") {
    if (state.regionReturn) {
      state.player.x = state.regionReturn.x;
      state.player.z = state.regionReturn.z;
    }
    state.region = "surface";
  }
  // Levels. `player.level`/`player.exp` are numbers on `player`, so the generic
  // loop above has already filled them — but it fills from `createInitialState`,
  // which starts at level 1, and a save that predates levelling *should* start
  // at level 1. That is the right answer by luck rather than by design, so it
  // is worth saying: a level of 0 would break `expToNext`, and this is why it
  // cannot happen.
  if (!Number.isFinite(state.player.level) || state.player.level < START_LEVEL) {
    state.player.level = START_LEVEL;
  }
  if (!Number.isFinite(state.player.exp) || state.player.exp < 0) state.player.exp = 0;

  // These two are not numbers on `player`, so they need their own guards — and
  // the inner one is the lesson `raid.count` taught at the bottom of this
  // function: a whole-object check skips a save that has the record but lacks a
  // field added later.
  if (typeof state.statPoints !== "number") state.statPoints = 0;
  if (!state.stats || typeof state.stats !== "object") state.stats = initialStats();
  for (const id of STAT_IDS) {
    if (typeof state.stats[id] !== "number") state.stats[id] = 0;
  }
  // `maxHealth` is stored, and now has two contributors that a stored number
  // cannot be trusted to agree with — the level and Vigour. Rebuilt from both
  // rather than believed, so a save written before either existed, or edited
  // by hand, lands on the figure the character has actually earned.
  recomputeMaxHealth(state);
  state.player.health = Math.min(state.player.health, state.player.maxHealth);

  // Nothing was worn before there was anything to wear.
  if (typeof state.armour !== "string") state.armour = null;

  // A save written before the hotbar existed comes back with none. Fill it
  // from what they are already carrying rather than handing them an empty bar
  // and no way to hold the axe they have had all along.
  const hadHotbar = Array.isArray(state.hotbar);
  normaliseHotbar(state);
  if (!hadHotbar) assignFromInventory(state);

  if (!Array.isArray(state.knownRecipes)) {
    // A save written before recipes could be discovered belongs to someone who
    // has always been able to see all of them. Deriving their known set from
    // what happens to be in their pockets right now would take recipes away
    // from a player who already had them — so an old save learns everything.
    learnAllRecipes(state);
  }
}

export function clearSave(): void {
  localStorage.removeItem(STORAGE_KEY);
}
