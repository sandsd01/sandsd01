// Simple circle-based collision shared by the player controller, enemy AI,
// and anything else that needs to avoid walking through world objects.
// Deliberately not a physics engine — see plan notes on keeping the MVP's
// physical needs (don't walk through things, stay on terrain) solved with
// plain math rather than a rigid-body simulation.
export interface Collidable {
  x: number;
  z: number;
  radius: number;
}

// Pushes (x, z) out of any overlapping collidable, returning the corrected position.
export function resolveCollisions(
  x: number,
  z: number,
  selfRadius: number,
  collidables: Collidable[],
): { x: number; z: number } {
  let cx = x;
  let cz = z;
  for (const c of collidables) {
    const dx = cx - c.x;
    const dz = cz - c.z;
    const dist = Math.hypot(dx, dz);
    const minDist = selfRadius + c.radius;
    if (dist > 0 && dist < minDist) {
      const push = minDist - dist;
      cx += (dx / dist) * push;
      cz += (dz / dist) * push;
    }
  }
  return { x: cx, z: cz };
}
