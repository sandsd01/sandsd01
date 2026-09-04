import * as THREE from "three";
import { mulberry32 } from "../utils/rng";
import { getZone, type ZoneId } from "./zones";
import { WORLD_SIZE, type Terrain } from "./terrain";
import { ResourceNode, type ResourceNodeKind } from "./resource-node";
import type { ModelLibrary } from "./models";

/**
 * How far out the world stops being an extension of home and starts being
 * somewhere you travelled to.
 *
 * Everything the game needs to be played can be gathered within a short walk
 * of the homestead, which is the right shape for the first hour and the wrong
 * one for the tenth: past this radius there is a material that exists nowhere
 * else, so distance buys something no amount of chopping nearby ever will.
 */
export const FRONTIER_RADIUS = 120;

// Which resource node(s) spawn in each biome, and how the pick is weighted —
// a small chance of the "other" zone's staple resource, plus a rarer special
// node unique to that biome, keeps each zone from feeling monotonous.
//
// `radius` is not decoration: past FRONTIER_RADIUS every biome can turn up
// ancient stone, and inside it none of them can. That single asymmetry is what
// makes the far half of the map a destination rather than more of the same
// ground with a longer walk attached.
function pickKind(zone: ZoneId, radius: number, rand: () => number): ResourceNodeKind {
  // Its own draw, not a slice off the front of the biome roll. Sharing one
  // would have swallowed whichever kind sat lowest in each table — the far
  // forest's `roll < 0.12` rock branch is entirely inside a `roll < 0.16`
  // frontier branch, so past the frontier the forest would have stopped
  // producing stone at all, silently, as a side effect of adding a material.
  if (radius >= FRONTIER_RADIUS && rand() < 0.16) return "ancient_stone";
  const roll = rand();
  switch (zone) {
    case "forest":
      if (roll < 0.12) return "rock";
      if (roll < 0.24) return "berry_bush";
      return "tree";
    case "rocky":
      if (roll < 0.12) return "tree";
      if (roll < 0.2) return "iron_vein";
      return "rock";
    case "wetland":
      // Not wall-to-wall clay: scrubby trees and bushes break up what was
      // otherwise a field of identical pits stretching to the horizon.
      if (roll < 0.26) return "tree";
      if (roll < 0.42) return "berry_bush";
      return "clay_pit";
    default:
      return "tree";
  }
}

const MIN_SPACING = 3.5;
// Attempts per square unit of world, not a flat count. The scatter used to be
// a hard 900 tries over the whole map; carried unchanged onto a world with
// four times the area that is not "the same world, bigger" but the same number
// of trees spread a quarter as thickly — the forest would have thinned out
// everywhere, including ground the player already knew, as a side effect of
// somewhere far away existing. Density is the thing worth holding constant.
const ATTEMPTS_PER_SQUARE_UNIT = 900 / (200 * 200);

// Scatters trees/rocks procedurally at world-init time using the same seed
// as the terrain, so a given seed always reproduces the same resource layout.
// Uses simple jittered rejection sampling (retry-on-overlap) rather than a
// full Poisson-disc implementation — sufficient for a bounded, non-streamed
// MVP world.
export function scatterResourceNodes(
  terrain: Terrain,
  seed: number,
  models: ModelLibrary = {},
): ResourceNode[] {
  const rand = mulberry32(seed ^ 0x51ed270b);
  const nodes: ResourceNode[] = [];
  const half = WORLD_SIZE / 2;
  const attempts = Math.round(WORLD_SIZE * WORLD_SIZE * ATTEMPTS_PER_SQUARE_UNIT);

  // A flat list scanned per candidate is O(n²), which was invisible at 900
  // attempts and is not at 3600. The grid buckets accepted points by cell so
  // the spacing test only looks at neighbours that could possibly be too
  // close — the same rejection rule, just not asking every tree in the world.
  const buckets = new Map<string, { x: number; z: number }[]>();
  const cellKey = (x: number, z: number) =>
    `${Math.floor(x / MIN_SPACING)},${Math.floor(z / MIN_SPACING)}`;
  const tooClose = (x: number, z: number): boolean => {
    const cx = Math.floor(x / MIN_SPACING);
    const cz = Math.floor(z / MIN_SPACING);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        for (const p of buckets.get(`${cx + dx},${cz + dz}`) ?? []) {
          if (Math.hypot(p.x - x, p.z - z) < MIN_SPACING) return true;
        }
      }
    }
    return false;
  };

  for (let i = 0; i < attempts; i++) {
    const x = (rand() * 2 - 1) * half;
    const z = (rand() * 2 - 1) * half;
    const zone = getZone(x, z);
    if (zone === "open") continue;
    if (tooClose(x, z)) continue;

    const kind = pickKind(zone, Math.hypot(x, z), rand);

    const y = terrain.heightAt(x, z);
    // The node builds its own randomised geometry, rotation and scale from
    // this stream, so no two props of a kind come out identical.
    nodes.push(new ResourceNode(kind, x, y, z, rand, models));
    const key = cellKey(x, z);
    const bucket = buckets.get(key);
    if (bucket) bucket.push({ x, z });
    else buckets.set(key, [{ x, z }]);
  }

  return nodes;
}

export function addNodesToScene(scene: THREE.Object3D, nodes: ResourceNode[]): void {
  for (const node of nodes) scene.add(node.object);
}
