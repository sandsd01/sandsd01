import { OPEN_RADIUS } from "./terrain";

export type ZoneId = "open" | "forest" | "rocky";

// Simple non-streaming biome-like zoning: a flat open build/farm area around
// spawn, forest on the +x half beyond it, rocky/mining terrain on the -x half.
export function getZone(x: number, z: number): ZoneId {
  const distFromSpawn = Math.hypot(x, z);
  if (distFromSpawn < OPEN_RADIUS) return "open";
  return x >= 0 ? "forest" : "rocky";
}
