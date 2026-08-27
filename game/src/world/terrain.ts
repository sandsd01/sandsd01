import * as THREE from "three";
import { ValueNoise2D } from "./noise";

// MVP world is a single fixed-size heightmap plane (not infinite/streamed).
export const WORLD_SIZE = 200;
export const OPEN_RADIUS = 22; // flattened build/farm zone around spawn
const SEGMENTS = 128;
const HEIGHT_SCALE = 6;

export class Terrain {
  readonly mesh: THREE.Mesh;
  private readonly noise: ValueNoise2D;

  constructor(seed: number) {
    this.noise = new ValueNoise2D(seed);

    const geometry = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, SEGMENTS, SEGMENTS);
    geometry.rotateX(-Math.PI / 2);

    const position = geometry.attributes.position;
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i);
      const z = position.getZ(i);
      position.setY(i, this.heightAt(x, z));
    }
    geometry.computeVertexNormals();

    const material = new THREE.MeshStandardMaterial({ color: 0x5a8a4a, flatShading: false });
    this.mesh = new THREE.Mesh(geometry, material);
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
    return raw * flatten;
  }
}
