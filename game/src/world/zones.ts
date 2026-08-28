import { OPEN_RADIUS } from "./terrain";

export type ZoneId = "open" | "forest" | "rocky" | "wetland";

// Simple non-streaming biome-like zoning: a flat open build/farm area around
// spawn; beyond that, the north half (z >= 0) splits into forest (+x) and
// rocky/mining terrain (-x), while the whole south half (z < 0) is wetland.
export function getZone(x: number, z: number): ZoneId {
  const distFromSpawn = Math.hypot(x, z);
  if (distFromSpawn < OPEN_RADIUS) return "open";
  if (z < 0) return "wetland";
  return x >= 0 ? "forest" : "rocky";
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
