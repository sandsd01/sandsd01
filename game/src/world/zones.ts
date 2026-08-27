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
// are distinct biomes, not just different resource-spawn tables.
export const ZONE_GROUND_COLOR: Record<ZoneId, number> = {
  open: 0x6a9a4a,
  forest: 0x3f6b34,
  rocky: 0x8a8270,
  wetland: 0x4f6b52,
};
