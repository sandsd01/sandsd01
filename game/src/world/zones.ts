import { OPEN_RADIUS } from "./terrain";
import { ValueNoise2D } from "./noise";

export type ZoneId = "open" | "forest" | "rocky" | "wetland";

// Domain warping: the coordinates are nudged by low-frequency noise *before*
// the zone test, so a boundary that is algebraically a straight line comes out
// as a meandering edge. Without it the forest met the rocky ground along a
// perfect ray from the origin, which reads as a map seam rather than a place.
const WARP_STRENGTH = 26;
const WARP_SCALE = 0.012;

let warp: ValueNoise2D = new ValueNoise2D(1);

/** Re-seeds the boundary warp; called by Terrain so a seed reproduces a world. */
export function initZones(seed: number): void {
  warp = new ValueNoise2D(seed ^ 0x2f19a3);
}

export function getZone(x: number, z: number): ZoneId {
  // The open build zone stays a true circle: placement rules and the spawn
  // clearing depend on it, and a wobbling build boundary would be a puzzle
  // rather than a feature.
  if (Math.hypot(x, z) < OPEN_RADIUS) return "open";

  const wx = x + warp.noise2D(x * WARP_SCALE, z * WARP_SCALE) * WARP_STRENGTH;
  const wz = z + warp.noise2D(x * WARP_SCALE + 41.7, z * WARP_SCALE - 17.3) * WARP_STRENGTH;

  if (wz < 0) return "wetland";
  return wx >= 0 ? "forest" : "rocky";
}

// Ground vertex color per zone (see Terrain) — the visual signal that these
// are distinct biomes, not just different resource-spawn tables. These read
// brighter than they look here: the renderer tone-maps the final image, which
// pulls saturated mid-tones down.
export const ZONE_GROUND_COLOR: Record<ZoneId, number> = {
  open: 0x86b455,
  forest: 0x4f7f3c,
  rocky: 0xa1977f,
  wetland: 0x5f8a63,
};
