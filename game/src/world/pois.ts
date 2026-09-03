import { mulberry32 } from "../utils/rng";
import type { GameState, InventorySlot } from "../state/game-state";
import type { Landmark } from "./landmarks";
import { containerOf, stock } from "../systems/containers";
import { DAY_LENGTH_MS } from "../systems/day-night";
import { events } from "../utils/events";

// Points of interest: a reason to walk to the landmark you can see.
//
// A landmark tells you where to go; on its own it does not tell you why. Each
// one gets an abandoned cache at its foot — a barrel with something in it —
// so arriving pays for the trip. This is also what gives the container system
// a purpose from the first minute instead of waiting for the player to build
// and stock a barrel themselves.
//
// Emptying one used to end it forever: three caches, opened once, and the
// whole of exploration was spent by the end of the first afternoon. They now
// refill on a timer, which is what turns a landmark from a one-off errand into
// somewhere on a round.

/**
 * What each biome's cache holds, keyed by biome and by which ring it stands in.
 *
 * The far ring pays better *and* is the only place a cache can hold ancient
 * stone. A journey that returns the same six planks as the walk to the near
 * ring is a journey nobody makes twice.
 */
const LOOT: Record<string, InventorySlot[]> = {
  "forest:near": [
    { itemId: "plank", qty: 6 },
    { itemId: "berry", qty: 5 },
  ],
  "rocky:near": [
    { itemId: "iron_ore", qty: 4 },
    { itemId: "stone", qty: 8 },
  ],
  "wetland:near": [
    { itemId: "clay", qty: 6 },
    { itemId: "wheat_seed", qty: 3 },
  ],
  "forest:far": [
    { itemId: "plank", qty: 14 },
    { itemId: "arrow", qty: 12 },
    { itemId: "ancient_stone", qty: 2 },
  ],
  "rocky:far": [
    { itemId: "iron_ingot", qty: 3 },
    { itemId: "stone", qty: 18 },
    { itemId: "ancient_stone", qty: 3 },
  ],
  "wetland:far": [
    { itemId: "clay", qty: 12 },
    { itemId: "brick", qty: 6 },
    { itemId: "ancient_stone", qty: 2 },
  ],
};

/**
 * How long an emptied cache takes to be restocked, on the `elapsedMs` clock.
 *
 * Two days: long enough that clearing one is not a loop you can stand next to
 * and grind, short enough that a player who visits the far ring between raids
 * finds something there rather than the empty barrel they left.
 */
export const RESTOCK_MS = DAY_LENGTH_MS * 2;
/**
 * A cache does not refill under the player's nose. Whatever the fiction,
 * watching a barrel fill itself is the moment it stops being a place someone
 * abandoned and becomes a spawner.
 */
const RESTOCK_MIN_DISTANCE = 40;
/** How close counts as having found a landmark. */
const DISCOVERY_RADIUS = 34;

export interface PoiSite {
  /** The placed building id of the cache. */
  id: string;
  landmark: Landmark;
}

function lootFor(landmark: Landmark): InventorySlot[] {
  return LOOT[`${landmark.zone}:${landmark.far ? "far" : "near"}`] ?? [];
}

/**
 * Places a stocked barrel a few paces from each landmark. They are real placed
 * buildings, so they are targeted, drawn, saved and opened by exactly the same
 * code as one the player puts down — no separate "world container" concept.
 *
 * A landmark that already has a cache keeps it, contents and all. This is
 * matched by position rather than by id, so a save written when the world had
 * three landmarks loads with its three caches intact *and* gains one at each
 * of the three new ones, instead of the old blanket "any poi exists, so leave
 * everything alone" — which would have left half the world's landmarks bare
 * for anyone who had played before.
 */
export function createPointsOfInterest(
  state: GameState,
  landmarks: Landmark[],
  seed: number,
): PoiSite[] {
  const rand = mulberry32(seed ^ 0x77c1e5);
  const sites: PoiSite[] = [];
  const claimed = new Set<string>();
  let stocked = false;

  for (const landmark of landmarks) {
    const existing = state.placedBuildings.find(
      (b) =>
        b.id.startsWith("poi-") &&
        !claimed.has(b.id) &&
        Math.hypot(b.cellX - landmark.x, b.cellZ - landmark.z) < 14,
    );
    if (existing) {
      claimed.add(existing.id);
      sites.push({ id: existing.id, landmark });
      continue;
    }

    const angle = rand() * Math.PI * 2;
    // Just outside the landmark's own footprint, so the cache reads as placed
    // *at* it rather than buried inside it.
    const distance = 5 + rand() * 2;
    const x = Math.round(landmark.x + Math.cos(angle) * distance);
    const z = Math.round(landmark.z + Math.sin(angle) * distance);

    // Derived from the landmark rather than from a counter, so the id is the
    // same on every boot — `state.pois` keys its restock timers by it.
    const id = `poi-${landmark.id}`;
    state.placedBuildings.push({ id, buildingId: "barrel", cellX: x, cellZ: z });
    stock(state, id, lootFor(landmark));
    claimed.add(id);
    sites.push({ id, landmark });
    stocked = true;
  }

  if (stocked) events.emit("inventory-changed", { itemId: "" });
  return sites;
}

/**
 * Books and applies restocks, and records which landmarks have been found.
 *
 * Called every frame; it does a handful of distance checks over six sites, so
 * there is nothing here worth a timer of its own.
 */
export function updatePointsOfInterest(
  state: GameState,
  sites: PoiSite[],
  nowMs: number,
  playerX: number,
  playerZ: number,
): void {
  for (const site of sites) {
    const distance = Math.hypot(site.landmark.x - playerX, site.landmark.z - playerZ);
    if (distance < DISCOVERY_RADIUS && !state.discovered.includes(site.landmark.id)) {
      state.discovered.push(site.landmark.id);
      events.emit("notification", { message: `Discovered ${site.landmark.name}` });
    }

    const empty = containerOf(state, site.id).length === 0;
    const booked = state.pois[site.id];
    if (!empty) {
      // Something is in it — either it was never emptied, or the player has
      // used it as their own storage. Either way there is nothing to refill,
      // and a pending timer would dump loot on top of what they left there.
      if (booked) delete state.pois[site.id];
      continue;
    }
    if (!booked) {
      state.pois[site.id] = { restockAtMs: nowMs + RESTOCK_MS };
      continue;
    }
    if (nowMs < booked.restockAtMs) continue;
    if (Math.hypot(site.landmark.x - playerX, site.landmark.z - playerZ) < RESTOCK_MIN_DISTANCE) {
      continue;
    }
    stock(state, site.id, lootFor(site.landmark));
    delete state.pois[site.id];
    events.emit("inventory-changed", { itemId: "" });
  }
}
