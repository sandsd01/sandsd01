import * as THREE from "three";
import { mulberry32 } from "../utils/rng";
import { instantiate, type ModelLibrary } from "./models";
import { getZone, type ZoneId } from "./zones";
import type { Terrain } from "./terrain";

// Landmarks: the things you navigate by.
//
// The world had none. It had districts (the biomes) and edges (their borders),
// but nothing you could see from far off and steer towards, so every direction
// looked the same and there was nowhere to go. Landmarks are the single most
// effective wayfinding tool an open world has, and "weenies" — big distant
// attractors — are what pull a player outward in the first place.
//
// Three rules they follow, from what makes them work rather than from taste:
//  - tall enough to clear the tree line and read over the horizon;
//  - contrasting in *shape and value*, not only in colour, because that is
//    what catches an eye that is looking where it is walking;
//  - one per biome, so where you are is legible from what you can see.
//
// The world's fog runs 95→250 over a 200-unit map, so a landmark on the far
// side reads as a pale silhouette — atmospheric perspective for free.

export interface Landmark {
  id: string;
  name: string;
  zone: ZoneId;
  x: number;
  z: number;
  object: THREE.Object3D;
  /** Height above the ground, for the "can you see it" check. */
  height: number;
  /** True for the outer ring, past the frontier. */
  far: boolean;
}

// The near ring: far enough out to be a journey, close enough to stay inside
// the fog's reach from home.
const MIN_RADIUS = 58;
const MAX_RADIUS = 96;
/**
 * The far ring, out past FRONTIER_RADIUS.
 *
 * These are **not** visible from the homestead — the fog closes at 250 and
 * these stand at 130 to 175 with a world's worth of hills in between — and
 * that is the point. The near ring is what you steer by; the far ring is what
 * you find, and once found the minimap keeps a pin on it (see ui/minimap.ts)
 * so the second trip is navigation rather than another search.
 */
const FAR_MIN_RADIUS = 130;
const FAR_MAX_RADIUS = 175;

interface Recipe {
  zone: Exclude<ZoneId, "open">;
  name: string;
  build: (models: ModelLibrary, rand: () => number) => THREE.Object3D;
  /** Which ring this one belongs to. */
  far?: boolean;
}

// A dead giant, bleached pale against the forest's green: the value contrast
// is what makes it carry, not the size alone.
function deadGiant(models: ModelLibrary): THREE.Object3D {
  const group = new THREE.Group();
  const source = models["tree-high"] ?? models.tree;
  if (!source) return group;
  const trunk = instantiate(source);
  // Checked against a render from spawn: at 3.6 it cleared the treeline but
  // read as just another trunk — slim, and pale against an equally pale sky.
  // Widening it as well as raising it is what makes the silhouette carry.
  trunk.scale.set(5.2, 4.6, 5.2);
  trunk.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    const material = (mesh.material as THREE.MeshStandardMaterial).clone();
    // Wash the colour out rather than recolouring: the silhouette stays a
    // tree, but a bleached one, which is what makes it read as *the* tree.
    material.color.lerp(new THREE.Color(0xcfc6ad), 0.72);
    mesh.material = material;
  });
  group.add(trunk);
  return group;
}

// A spire: rocks stacked and stretched into something with a vertical line,
// which nothing else in the rocky biome has.
function stoneSpire(models: ModelLibrary, rand: () => number): THREE.Object3D {
  const group = new THREE.Group();
  const source = models["rocks-high"] ?? models["rocks-low"];
  if (!source) return group;
  let y = 0;
  for (let i = 0; i < 4; i++) {
    const chunk = instantiate(source);
    const scale = 3.4 - i * 0.55;
    chunk.scale.set(scale, scale * 1.5, scale);
    chunk.position.set((rand() - 0.5) * 0.9, y, (rand() - 0.5) * 0.9);
    chunk.rotation.y = rand() * Math.PI * 2;
    chunk.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) child.castShadow = true;
    });
    group.add(chunk);
    y += scale * 1.7;
  }
  return group;
}

// A ring you can walk into. Lynch would call this a *node* rather than a
// landmark: somewhere you arrive at, not only something you steer by.
function standingStones(models: ModelLibrary, rand: () => number): THREE.Object3D {
  const group = new THREE.Group();
  const source = models.stones ?? models["rocks-low"];
  if (!source) return group;
  const count = 8;
  const radius = 5.4;
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    const stone = instantiate(source);
    // Tall enough to clear the tree line: measured at 3.3 units on the first
    // pass, which read as a garden feature rather than something to steer by.
    stone.scale.set(2.6, 13 + rand() * 3.5, 2.6);
    stone.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
    stone.rotation.y = angle + (rand() - 0.5) * 0.4;
    stone.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) child.castShadow = true;
    });
    group.add(stone);
  }
  return group;
}

// A tilted slab on a cairn: the one shape in the world that is not upright,
// so it reads as *made and then abandoned* rather than as another rock. The
// far ring has to be told apart from the near one at a glance, which a bigger
// version of an existing landmark would not manage.
function fallenObelisk(models: ModelLibrary, rand: () => number): THREE.Object3D {
  const group = new THREE.Group();
  const source = models["rocks-low"] ?? models["rocks-high"] ?? models.stones;
  if (!source) return group;
  // The cairn it fell off.
  for (let i = 0; i < 5; i++) {
    const chunk = instantiate(source);
    const scale = 2.2 + rand() * 1.1;
    chunk.scale.set(scale, scale * 0.7, scale);
    const a = (i / 5) * Math.PI * 2;
    chunk.position.set(Math.cos(a) * 2.2, rand() * 0.8, Math.sin(a) * 2.2);
    chunk.rotation.y = rand() * Math.PI * 2;
    chunk.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) child.castShadow = true;
    });
    group.add(chunk);
  }
  // And the slab across it, leaning. Pale, so the diagonal carries as a value
  // break against the ground rather than as one more grey mass.
  const slab = instantiate(source);
  slab.scale.set(2.1, 15, 2.1);
  slab.position.set(0, 4.4, 0);
  slab.rotation.set(0, rand() * Math.PI, 0.62);
  slab.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    const material = (mesh.material as THREE.MeshStandardMaterial).clone();
    material.color.lerp(new THREE.Color(0xd9d2e4), 0.6);
    mesh.material = material;
  });
  group.add(slab);
  return group;
}

// A ring of dead trunks, close-packed. In the forest it reads as a clearing
// something happened in — the near ring's Bleached Giant is one pale trunk, so
// a grove of them says "further out" without inventing a new material.
function ashenGrove(models: ModelLibrary, rand: () => number): THREE.Object3D {
  const group = new THREE.Group();
  const source = models["tree-high"] ?? models.tree;
  if (!source) return group;
  for (let i = 0; i < 7; i++) {
    const trunk = instantiate(source);
    const scale = 3.2 + rand() * 1.6;
    trunk.scale.set(scale * 0.8, scale, scale * 0.8);
    const a = (i / 7) * Math.PI * 2 + rand() * 0.3;
    const d = 4.5 + rand() * 2.2;
    trunk.position.set(Math.cos(a) * d, 0, Math.sin(a) * d);
    trunk.rotation.set((rand() - 0.5) * 0.16, rand() * Math.PI * 2, (rand() - 0.5) * 0.16);
    trunk.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      const material = (mesh.material as THREE.MeshStandardMaterial).clone();
      material.color.lerp(new THREE.Color(0x4a4038), 0.75);
      mesh.material = material;
    });
    group.add(trunk);
  }
  return group;
}

// A single stone, far taller than anything the near ring holds, standing alone
// in the marsh.
function drownedPillar(models: ModelLibrary, rand: () => number): THREE.Object3D {
  const group = new THREE.Group();
  const source = models.stones ?? models["rocks-high"] ?? models["rocks-low"];
  if (!source) return group;
  const pillar = instantiate(source);
  pillar.scale.set(3.4, 22, 3.4);
  pillar.rotation.set(0.05, rand() * Math.PI, 0.04);
  pillar.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) child.castShadow = true;
  });
  group.add(pillar);
  // A few fallen pieces at its foot, so the height has something to be read
  // against — a lone column has no scale of its own at a distance.
  for (let i = 0; i < 3; i++) {
    const chunk = instantiate(source);
    const scale = 1.6 + rand() * 0.9;
    chunk.scale.set(scale, scale * 0.5, scale);
    const a = rand() * Math.PI * 2;
    chunk.position.set(Math.cos(a) * 3.2, 0.2, Math.sin(a) * 3.2);
    chunk.rotation.set(rand() * 0.5, rand() * Math.PI, rand() * 0.5);
    chunk.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) child.castShadow = true;
    });
    group.add(chunk);
  }
  return group;
}

const RECIPES: Recipe[] = [
  { zone: "forest", name: "The Bleached Giant", build: (m) => deadGiant(m) },
  { zone: "rocky", name: "The Spire", build: stoneSpire },
  { zone: "wetland", name: "The Standing Stones", build: standingStones },
  { zone: "forest", name: "The Ashen Grove", build: ashenGrove, far: true },
  { zone: "rocky", name: "The Fallen Obelisk", build: fallenObelisk, far: true },
  { zone: "wetland", name: "The Drowned Pillar", build: drownedPillar, far: true },
];

/**
 * Places one landmark per biome at a seeded position inside that biome.
 * Candidates are rejected until one lands in the right zone, because the zone
 * borders are noise-warped and no longer a formula you can solve for.
 */
export function createLandmarks(
  scene: THREE.Scene,
  terrain: Terrain,
  seed: number,
  models: ModelLibrary,
): Landmark[] {
  const rand = mulberry32(seed ^ 0x1a9d33);
  const landmarks: Landmark[] = [];

  for (const recipe of RECIPES) {
    const min = recipe.far ? FAR_MIN_RADIUS : MIN_RADIUS;
    const max = recipe.far ? FAR_MAX_RADIUS : MAX_RADIUS;
    let placed: { x: number; z: number } | null = null;
    for (let attempt = 0; attempt < 400 && !placed; attempt++) {
      const angle = rand() * Math.PI * 2;
      const radius = min + rand() * (max - min);
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      if (getZone(x, z) === recipe.zone) placed = { x, z };
    }
    if (!placed) continue;

    const object = recipe.build(models, rand);
    object.position.set(placed.x, terrain.heightAt(placed.x, placed.z), placed.z);
    scene.add(object);

    const box = new THREE.Box3().setFromObject(object);
    landmarks.push({
      // Zone alone is no longer unique — each biome has a near and a far
      // landmark, and two objects sharing an id would collide in the
      // discovery record the minimap pins are drawn from.
      id: `landmark-${recipe.far ? "far-" : ""}${recipe.zone}`,
      name: recipe.name,
      zone: recipe.zone,
      x: placed.x,
      z: placed.z,
      far: recipe.far === true,
      object,
      height: box.isEmpty() ? 0 : box.max.y - box.min.y,
    });
  }

  return landmarks;
}
