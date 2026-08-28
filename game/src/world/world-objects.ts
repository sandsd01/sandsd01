import * as THREE from "three";
import { mulberry32 } from "../utils/rng";
import { getZone, type ZoneId } from "./zones";
import { WORLD_SIZE, type Terrain } from "./terrain";
import { ResourceNode, type ResourceNodeKind } from "./resource-node";
import type { ModelLibrary } from "./models";

// Which resource node(s) spawn in each biome, and how the pick is weighted —
// a small chance of the "other" zone's staple resource, plus a rarer special
// node unique to that biome, keeps each zone from feeling monotonous.
function pickKind(zone: ZoneId, rand: () => number): ResourceNodeKind {
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
const CANDIDATE_ATTEMPTS = 900;

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

  for (let i = 0; i < CANDIDATE_ATTEMPTS; i++) {
    const x = (rand() * 2 - 1) * half;
    const z = (rand() * 2 - 1) * half;
    const zone = getZone(x, z);
    if (zone === "open") continue;

    const tooClose = nodes.some((n) => {
      const dx = n.object.position.x - x;
      const dz = n.object.position.z - z;
      return Math.hypot(dx, dz) < MIN_SPACING;
    });
    if (tooClose) continue;

    const kind = pickKind(zone, rand);

    const y = terrain.heightAt(x, z);
    // The node builds its own randomised geometry, rotation and scale from
    // this stream, so no two props of a kind come out identical.
    nodes.push(new ResourceNode(kind, x, y, z, rand, models));
  }

  return nodes;
}

export function addNodesToScene(scene: THREE.Scene, nodes: ResourceNode[]): void {
  for (const node of nodes) scene.add(node.object);
}
