import * as THREE from "three";
import { merge, placed } from "./geometry";
import { getZone } from "./zones";
import type { Terrain } from "./terrain";

// Grass is the cheapest way to stop the ground reading as a bare painted
// surface. One InstancedMesh means the whole field is a single draw call, so
// density here costs almost nothing.
// Grass dominates the world's triangle budget if left unchecked — it's the
// only thing placed in the thousands. Two open-ended 3-sided blades is six
// triangles a tuft, which is what keeps a field of them affordable.
const TUFT_COUNT = 4000;
const FIELD_RADIUS = 58;
// Kept close to the ground colours: grass should thicken the surface, not
// stipple it with dark dots.
const BLADE_COLORS = [0x8ab84f, 0x9ac95d, 0x7ba845, 0xa3d067];

function buildTuftGeometry(): THREE.BufferGeometry {
  // Three splayed blades. Deliberately small — at player height (1.7) a tuft
  // taller than ~0.2 stops reading as grass and starts reading as a spike.
  const blades: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 2; i++) {
    const a = (i / 2) * Math.PI * 2;
    // openEnded drops the base cap nobody can see from above ground, halving
    // the triangles per blade.
    blades.push(
      placed(
        new THREE.ConeGeometry(0.032, 0.18, 3, 1, true),
        Math.cos(a) * 0.035,
        0.09,
        Math.sin(a) * 0.035,
        { rotX: Math.cos(a) * 0.3, rotZ: Math.sin(a) * 0.3, rotY: a },
      ),
    );
  }
  return merge(blades);
}

export function createGrass(terrain: Terrain, seed: number): THREE.InstancedMesh {
  const rand = mulberryFrom(seed);
  const geometry = buildTuftGeometry();
  const material = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 });

  const mesh = new THREE.InstancedMesh(geometry, material, TUFT_COUNT);
  mesh.receiveShadow = true;
  // Deliberately not a shadow caster: thousands of tiny casters cost a lot of
  // shadow-map fill for detail nobody can see at this scale.
  mesh.castShadow = false;
  mesh.frustumCulled = false;
  mesh.name = "grass";

  const matrix = new THREE.Matrix4();
  const color = new THREE.Color();
  const position = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3();

  let placedCount = 0;
  for (let attempt = 0; attempt < TUFT_COUNT * 3 && placedCount < TUFT_COUNT; attempt++) {
    // Sample on a disc around spawn — beyond the fog line grass is invisible.
    const a = rand() * Math.PI * 2;
    const d = Math.sqrt(rand()) * FIELD_RADIUS;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;

    const zone = getZone(x, z);
    // Rock and mud don't grow grass; that contrast is what makes the biomes
    // read as different ground rather than differently-tinted lawn.
    if (zone === "rocky") continue;
    if (zone === "wetland" && rand() < 0.65) continue;

    position.set(x, terrain.heightAt(x, z), z);
    quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * Math.PI * 2);
    const s = 0.75 + rand() * 0.6;
    scale.set(s, s * (0.8 + rand() * 0.7), s);
    matrix.compose(position, quat, scale);
    mesh.setMatrixAt(placedCount, matrix);

    color.setHex(BLADE_COLORS[Math.floor(rand() * BLADE_COLORS.length)]);
    mesh.setColorAt(placedCount, color);
    placedCount++;
  }

  // Unused slots would otherwise render as a pile of tufts at the origin.
  mesh.count = placedCount;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  return mesh;
}

// Local copy of the project's PRNG so grass placement has its own stream and
// doesn't shift the resource-node layout for a given seed.
function mulberryFrom(seed: number): () => number {
  let a = seed ^ 0x9e3779b9;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
