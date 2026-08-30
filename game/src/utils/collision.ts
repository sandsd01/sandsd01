// Simple circle-based collision shared by the player controller, enemy AI,
// and anything else that needs to avoid walking through world objects.
// Deliberately not a physics engine — see plan notes on keeping the MVP's
// physical needs (don't walk through things, stay on terrain) solved with
// plain math rather than a rigid-body simulation.
export interface Collidable {
  x: number;
  z: number;
  radius: number;
  /**
   * Half-extents for a square footprint. When present the shape is a box, not
   * a circle. Buildings need this: a circle of radius 0.5 inscribed in a 1x1
   * cell leaves the cell's corners uncovered, so a straight run of walls had
   * a diagonal gap at every join that the player could slip through.
   */
  halfExtent?: number;
  /**
   * Which faces of a box a body may be pushed out through. A face with
   * another box flush against it is *internal* — pushing out through it puts
   * the body inside the neighbour, and with a run of walls that reads as
   * slipping through the seam: approach a join head-on and the shallower-axis
   * rule shoves you sideways into the gap between two cells rather than
   * stopping you. Omitted means every face is open.
   */
  openFaces?: { xPos: boolean; xNeg: boolean; zPos: boolean; zNeg: boolean };
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
    if (c.halfExtent !== undefined) {
      // Circle vs axis-aligned box: push out along the shallower axis, which
      // is what keeps a body sliding along a wall rather than being flung
      // round its corner — but only through a face that is actually exposed.
      const dx = cx - c.x;
      const dz = cz - c.z;
      const overlapX = c.halfExtent + selfRadius - Math.abs(dx);
      const overlapZ = c.halfExtent + selfRadius - Math.abs(dz);
      if (overlapX <= 0 || overlapZ <= 0) continue;

      const faces = c.openFaces;
      const signX = Math.sign(dx || 1);
      const signZ = Math.sign(dz || 1);
      const canX = !faces || (signX > 0 ? faces.xPos : faces.xNeg);
      const canZ = !faces || (signZ > 0 ? faces.zPos : faces.zNeg);
      if (!canX && !canZ) continue;
      if (canX && (!canZ || overlapX < overlapZ)) cx += signX * overlapX;
      else cz += signZ * overlapZ;
      continue;
    }
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
