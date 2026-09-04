import * as THREE from "three";
import { ValueNoise2D } from "./noise";
import { getZone, initZones, ZONE_GROUND_COLOR } from "./zones";

// A single fixed-size heightmap plane (not infinite/streamed).
//
// 400 rather than the 200 it shipped with. At 200 the far edge was a couple
// of minutes' walk from the door, which meant "out there" was somewhere you
// had already been by the end of the first day and the map had no room for a
// place you have not seen yet.
export const WORLD_SIZE = 400;
export const OPEN_RADIUS = 22; // flattened build/farm zone around spawn
// Segments scale with the world, not with the triangle budget: 128 quads over
// 200 units was a ~1.6-unit quad, and keeping that count on a world twice as
// wide would have doubled the quad to 3.1 units — every hill within sight of
// the homestead would have come out visibly coarser as a side effect of
// somewhere far away getting bigger. 192 holds the quad at ~2.1 units, and the
// cost was measured (see the PR) rather than assumed.
const SEGMENTS = 192;
const HEIGHT_SCALE = 6;
// How far the wetland basin sits below the rest of the world.
const WETLAND_DEPTH = 1.2;

// Steep ground reads as exposed rock rather than grass, which is what stops
// the hills from looking like a painted-green bedsheet.
const SLOPE_ROCK = new THREE.Color(0x7c7466);

export class Terrain {
  readonly mesh: THREE.Mesh;
  private readonly noise: ValueNoise2D;

  constructor(seed: number) {
    this.noise = new ValueNoise2D(seed);
    // Zone boundaries are warped from the same seed, and every getZone caller
    // below (and in world-objects/building) runs after this.
    initZones(seed);

    const geometry = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, SEGMENTS, SEGMENTS);
    geometry.rotateX(-Math.PI / 2);

    const position = geometry.attributes.position;
    const colors = new Float32Array(position.count * 3);
    const base = new THREE.Color();
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i);
      const z = position.getZ(i);
      position.setY(i, this.heightAt(x, z));

      base.setHex(ZONE_GROUND_COLOR[getZone(x, z)]);

      // Blend toward rock on steep faces, so cliffs and hillsides differ from
      // the flats instead of every zone being one flat colour.
      base.lerp(SLOPE_ROCK, THREE.MathUtils.smoothstep(this.slopeAt(x, z), 0.45, 1.1));

      // Fine per-vertex brightness jitter breaks up the remaining flatness and
      // hides the hard line where two zones meet.
      const tint = 1 + this.noise.noise2D(x * 0.35, z * 0.35) * 0.11;
      base.multiplyScalar(tint);

      base.toArray(colors, i * 3);
    }
    geometry.computeVertexNormals();
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.95,
      metalness: 0,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.receiveShadow = true;
    this.mesh.name = "terrain";
  }

  // Shared height function used both to build the mesh and to query height at
  // runtime (player/enemy/object placement) — a single source of truth avoids
  // any mismatch between the rendered surface and gameplay logic, and is
  // simpler/cheaper than raycasting against the mesh every frame.
  heightAt(x: number, z: number): number {
    const raw = this.noise.fbm2D(x, z, 4, 0.5, 0.015) * HEIGHT_SCALE;
    const distFromSpawn = Math.hypot(x, z);
    const flatten = THREE.MathUtils.smoothstep(distFromSpawn, OPEN_RADIUS * 0.5, OPEN_RADIUS);
    // The wetland sits in a shallow basin, so its dips fall below the water
    // plane and actually hold ponds. Faded in with distance rather than
    // switched on at z=0, which would leave a cliff down the middle.
    const basin = WETLAND_DEPTH * THREE.MathUtils.smoothstep(-z, 10, 45) * flatten;
    return raw * flatten - basin;
  }

  // Approximate gradient magnitude of the height field, by finite difference.
  private slopeAt(x: number, z: number): number {
    const e = 1;
    const h = this.heightAt(x, z);
    const dx = (this.heightAt(x + e, z) - h) / e;
    const dz = (this.heightAt(x, z + e) - h) / e;
    return Math.hypot(dx, dz);
  }
}
