import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

// Colour is baked into each geometry's vertices rather than carried on a
// material, so every prop of a given kind can share one material (and one
// shader program) while still varying its palette per instance. The parts of
// a prop are then merged into a single geometry, so a tree is one draw call
// instead of four.

export function paint(geometry: THREE.BufferGeometry, color: THREE.ColorRepresentation): THREE.BufferGeometry {
  const count = geometry.attributes.position.count;
  const colors = new Float32Array(count * 3);
  const c = new THREE.Color(color);
  for (let i = 0; i < count; i++) c.toArray(colors, i * 3);
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geometry;
}

export interface PlaceOpts {
  rotX?: number;
  rotY?: number;
  rotZ?: number;
  scale?: number;
  scaleY?: number;
}

// Positions/rotates/scales a part before it gets merged, since merging bakes
// transforms away and the parts no longer have their own matrices.
export function placed(
  geometry: THREE.BufferGeometry,
  x: number,
  y: number,
  z: number,
  opts: PlaceOpts = {},
): THREE.BufferGeometry {
  const { rotX = 0, rotY = 0, rotZ = 0, scale = 1, scaleY = scale } = opts;
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rotX, rotY, rotZ)),
    new THREE.Vector3(scale, scaleY, scale),
  );
  geometry.applyMatrix4(m);
  return geometry;
}

export function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  // mergeGeometries refuses to mix indexed and non-indexed inputs, and the
  // primitives here are a mix of both (cylinders/cones/tori are indexed,
  // icosahedra/octahedra are not). Flattening everything to non-indexed also
  // happens to be what flat shading wants.
  const flat = parts.map((part) => {
    if (part.index === null) return part;
    const nonIndexed = part.toNonIndexed();
    part.dispose();
    return nonIndexed;
  });
  const merged = mergeGeometries(flat, false);
  for (const part of flat) part.dispose();
  if (!merged) throw new Error("Failed to merge prop geometry");
  return merged;
}

// Pushes each vertex out along a random offset so a stock polyhedron reads as
// a hand-chipped rock instead of a perfect solid. Operates on the non-indexed
// form so flat shading keeps its facets.
export function roughen(geometry: THREE.BufferGeometry, amount: number, rand: () => number): THREE.BufferGeometry {
  const pos = geometry.attributes.position as THREE.BufferAttribute;
  // Vertices are shared between faces pre-roughening; jitter by grid-snapped
  // position so co-located vertices move together and the solid stays closed.
  const cache = new Map<string, THREE.Vector3>();
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const key = `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;
    let offset = cache.get(key);
    if (!offset) {
      offset = new THREE.Vector3(
        (rand() * 2 - 1) * amount,
        (rand() * 2 - 1) * amount,
        (rand() * 2 - 1) * amount,
      );
      cache.set(key, offset);
    }
    pos.setXYZ(i, v.x + offset.x, v.y + offset.y, v.z + offset.z);
  }
  pos.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

// Small hue/brightness wobble around a base colour, so a stand of trees isn't
// a field of identical clones.
export function varyColor(base: THREE.ColorRepresentation, rand: () => number, spread = 0.06): THREE.Color {
  const c = new THREE.Color(base);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  return c.setHSL(
    (hsl.h + (rand() * 2 - 1) * spread * 0.5 + 1) % 1,
    THREE.MathUtils.clamp(hsl.s + (rand() * 2 - 1) * spread, 0, 1),
    THREE.MathUtils.clamp(hsl.l + (rand() * 2 - 1) * spread, 0.05, 0.95),
  );
}
