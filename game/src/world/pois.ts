import { mulberry32 } from "../utils/rng";
import type { GameState, InventorySlot } from "../state/game-state";
import type { Landmark } from "./landmarks";
import { stock } from "../systems/containers";
import { events } from "../utils/events";

// Points of interest: a reason to walk to the landmark you can see.
//
// A landmark tells you where to go; on its own it does not tell you why. Each
// one gets an abandoned cache at its foot — a barrel with something in it —
// so arriving pays for the trip. This is also what gives the container system
// a purpose from the first minute instead of waiting for the player to build
// and stock a barrel themselves.

/** What each biome's cache holds — flavoured by where it is found. */
const LOOT: Record<string, InventorySlot[]> = {
  forest: [
    { itemId: "plank", qty: 6 },
    { itemId: "berry", qty: 5 },
  ],
  rocky: [
    { itemId: "iron_ore", qty: 4 },
    { itemId: "stone", qty: 8 },
  ],
  wetland: [
    { itemId: "clay", qty: 6 },
    { itemId: "wheat_seed", qty: 3 },
  ],
};

let nextPoiId = 0;

/**
 * Places a stocked barrel a few paces from each landmark. They are real placed
 * buildings, so they are targeted, drawn, saved and opened by exactly the same
 * code as one the player puts down — no separate "world container" concept.
 */
export function createPointsOfInterest(
  state: GameState,
  landmarks: Landmark[],
  seed: number,
): string[] {
  // Only ever stocked once per world; a reload must not refill them.
  if (state.placedBuildings.some((b) => b.id.startsWith("poi-"))) {
    return state.placedBuildings.filter((b) => b.id.startsWith("poi-")).map((b) => b.id);
  }

  const rand = mulberry32(seed ^ 0x77c1e5);
  const ids: string[] = [];

  for (const landmark of landmarks) {
    const angle = rand() * Math.PI * 2;
    // Just outside the landmark's own footprint, so the cache reads as placed
    // *at* it rather than buried inside it.
    const distance = 5 + rand() * 2;
    const x = Math.round(landmark.x + Math.cos(angle) * distance);
    const z = Math.round(landmark.z + Math.sin(angle) * distance);

    const id = `poi-${nextPoiId++}`;
    state.placedBuildings.push({ id, buildingId: "barrel", cellX: x, cellZ: z });
    stock(state, id, LOOT[landmark.zone] ?? []);
    ids.push(id);
  }

  if (ids.length > 0) events.emit("inventory-changed", { itemId: "" });
  return ids;
}
