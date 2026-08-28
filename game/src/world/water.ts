import * as THREE from "three";
import { WORLD_SIZE } from "./terrain";

// A single flat sheet across the world at a fixed height. Wherever the terrain
// dips below it, it reads as a pond; everywhere else the terrain simply hides
// it. That gets lakes in every natural depression — densest in the low-lying
// wetland — without generating or masking any per-pond geometry.
export const WATER_LEVEL = -2.0;

const SEGMENTS = 48;
const WAVE_AMPLITUDE = 0.07;

export class Water {
  readonly mesh: THREE.Mesh;
  private readonly basePositions: Float32Array;

  constructor() {
    const geometry = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, SEGMENTS, SEGMENTS);
    geometry.rotateX(-Math.PI / 2);
    this.basePositions = Float32Array.from(
      (geometry.attributes.position as THREE.BufferAttribute).array,
    );

    const material = new THREE.MeshStandardMaterial({
      color: 0x2f6f86,
      transparent: true,
      opacity: 0.82,
      roughness: 0.16,
      metalness: 0.1,
      flatShading: true,
    });

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.position.y = WATER_LEVEL;
    this.mesh.name = "water";
    // Receiving shadows on a moving translucent sheet reads as dirt, and
    // casting them would darken the pond bed it's supposed to reveal.
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
  }

  update(nowMs: number): void {
    const position = this.mesh.geometry.attributes.position as THREE.BufferAttribute;
    const t = nowMs * 0.0009;
    for (let i = 0; i < position.count; i++) {
      const x = this.basePositions[i * 3];
      const z = this.basePositions[i * 3 + 2];
      // Two crossed waves at different rates, so the surface never visibly
      // repeats on a single period.
      const h =
        Math.sin(x * 0.16 + t) * WAVE_AMPLITUDE + Math.cos(z * 0.21 + t * 1.35) * WAVE_AMPLITUDE;
      position.setY(i, h);
    }
    position.needsUpdate = true;
    // No computeVertexNormals: the material is flat-shaded, so three derives
    // face normals in the fragment shader and the normal attribute is unused.
    // Recomputing it every frame would be pure cost.
  }
}
