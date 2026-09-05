import * as THREE from "three";
import { ValueNoise2D } from "./noise";
import { mulberry32 } from "../utils/rng";
import { merge, paint, placed, roughen, varyColor } from "./geometry";
import { ResourceNode } from "./resource-node";
import { createPortal, type PortalSite } from "./portal";
import { disposeGroup, type Region } from "./region";
import { getZone } from "./zones";
import type { GroundSurface, Terrain } from "./terrain";
import type { ModelLibrary } from "./models";

/**
 * The island above, and the tree on the overworld that leads to it.
 *
 * The cave's opposite in every way that can be seen: bright where it is dark,
 * open where it is close, and — the only genuinely new thing in either place —
 * with an edge you can walk off. A cave is a room; this is a rock in the sky,
 * and the game would be lying about that if you could lean on thin air.
 */

/** How far the island reaches at its widest. */
const ISLAND_RADIUS = 30;
/**
 * How far the *region* reaches, which is deliberately much further.
 *
 * The world-edge clamp holds a body inside `halfExtent`, and holding one to
 * the island's own edge would be exactly the wrong thing here: walking off is
 * the mechanic. So the clamp guards the airspace instead, and the island's
 * shape is left to the ground height.
 */
const SKY_HALF_EXTENT = 58;
/** How far the island's underside falls away from its rim. */
const SKY_VOID_Y = -60;
/** Below this, the player has fallen and is sent home. */
export const SKY_FALL_LIMIT = -18;
/**
 * How much the shelf rolls.
 *
 * Deliberately gentle. At 2.2 the island had hills long enough to hide its own
 * rim, so a player four paces from a sixty-unit drop could see nothing but
 * grass and sky — a screenshot from the rim showed no edge at all. Whatever
 * else is true of this place, you have to be able to see where it stops.
 */
const ISLAND_RELIEF = 0.9;

const PORTAL_TINT_UP = 0x7dd3fc;
const PORTAL_TINT_BACK = 0xf0b429;

/** Where the player lands, and the way back, both well inside the rim. */
const ARRIVAL_X = 0;
const ARRIVAL_Z = 15;
const EXIT_X = 11;
const EXIT_Z = 19;

/**
 * The island's ground.
 *
 * Inside the rim it is a gently rolling rock shelf; outside it there is
 * nothing, expressed as a floor so far down that a body which walks out over
 * it is unambiguously falling. The rim itself is noise-warped rather than
 * circular, so the edge is somewhere you have to look at rather than a
 * boundary you can predict from the middle.
 */
class SkyGround implements GroundSurface {
  private readonly surface: ValueNoise2D;
  private readonly rim: ValueNoise2D;

  constructor(seed: number) {
    this.surface = new ValueNoise2D(seed ^ 0x5c1a2b);
    this.rim = new ValueNoise2D(seed ^ 0x0b1d3e);
  }

  /** How far the island reaches in the direction of a point. */
  rimAt(x: number, z: number): number {
    const angle = Math.atan2(z, x);
    // Sampled around a circle rather than over the plane, so the warp is a
    // function of bearing alone and the rim cannot double back on itself.
    const warp = this.rim.fbm2D(Math.cos(angle) * 3, Math.sin(angle) * 3, 3, 0.5, 1);
    return ISLAND_RADIUS * (1 + warp * 0.18);
  }

  isOverIsland(x: number, z: number): boolean {
    return Math.hypot(x, z) <= this.rimAt(x, z);
  }

  heightAt(x: number, z: number): number {
    const distance = Math.hypot(x, z);
    const rim = this.rimAt(x, z);
    if (distance > rim) return SKY_VOID_Y;
    const roll = this.surface.fbm2D(x, z, 3, 0.5, 0.05) * ISLAND_RELIEF;
    // The outer two units tip down hard, so the rim is a lip with a shadow
    // under it rather than a line where the grass happens to stop.
    const lip = Math.min(1, (rim - distance) / 2);
    return roll - (1 - lip) * 2.6;
  }
}

/**
 * The island: a shelf on top, tapering to a point underneath.
 *
 * Built radially rather than as a plane, and that is not a tidiness choice.
 * The first pass was a square `PlaneGeometry` with everything off the island
 * pushed down to a floor — which put a seventy-eight-unit dark skirt across
 * the whole horizon, reading as "the ground goes on, darkly" exactly where the
 * answer had to be "there is nothing there". A radial mesh stops at the rim,
 * and what you see past it is the sky. Found in a screenshot.
 */
function buildIslandMesh(ground: SkyGround): THREE.Mesh {
  const SPOKES = 96;
  const TOP_RINGS = 26;
  const UNDER_RINGS = 12;
  /** How far the rock hangs below its own rim. */
  const DEPTH = 26;

  const rings = TOP_RINGS + UNDER_RINGS;
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const grass = new THREE.Color(0x93ab7a);
  const rock = new THREE.Color(0x5d5346);
  const deep = new THREE.Color(0x453c33);
  const colour = new THREE.Color();

  for (let ring = 0; ring <= rings; ring++) {
    for (let spoke = 0; spoke <= SPOKES; spoke++) {
      const angle = (spoke / SPOKES) * Math.PI * 2;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const rim = ground.rimAt(cos, sin);

      let radius: number;
      let y: number;
      if (ring <= TOP_RINGS) {
        const f = ring / TOP_RINGS;
        radius = rim * f;
        y = ground.heightAt(cos * radius, sin * radius);
        // Grass on the flat, bare rock where the ground tips into the lip.
        // A broad band of bare rock, not a hairline: the value break between
        // grass and stone is what a player reads as "it ends here", and it has
        // to be visible from the middle of the island.
        colour.copy(grass).lerp(rock, Math.min(1, Math.max(0, (f - 0.74) / 0.2)));
      } else {
        const u = (ring - TOP_RINGS) / UNDER_RINGS;
        // Tapering to a point, which is what makes it read as a piece of rock
        // torn out of the ground rather than as a disc.
        radius = rim * Math.pow(1 - u, 0.8);
        y = ground.heightAt(cos * rim, sin * rim) - DEPTH * Math.pow(u, 0.75);
        colour.copy(rock).lerp(deep, u);
      }

      positions.push(cos * radius, y, sin * radius);
      colors.push(colour.r, colour.g, colour.b);
    }
  }

  const stride = SPOKES + 1;
  for (let ring = 0; ring < rings; ring++) {
    for (let spoke = 0; spoke < SPOKES; spoke++) {
      const a = ring * stride + spoke;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.92,
      metalness: 0,
      // Seen from beneath on the way down; without this the island is a hole
      // in the sky from underneath.
      side: THREE.DoubleSide,
    }),
  );
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * The giant tree, standing on the overworld.
 *
 * Built rather than scaled from a model. The Bleached Giant is `tree-high` at
 * 5.2 x 4.6 x 5.2 — about eighteen units — and the point of this one is that
 * it is visible from the homestead, which means clearing the fog's own scale
 * rather than merely the treeline.
 */
export function buildGiantTree(rand: () => number, models: ModelLibrary): THREE.Object3D {
  const group = new THREE.Group();
  const parts: THREE.BufferGeometry[] = [];
  // Pale, weathered bark and a near-black canopy, against a forest of mid
  // greens on warm brown. Size alone did not carry it: the first pass was
  // fifty-five units tall and eighty from spawn, and in the screenshot it read
  // as an ordinary trunk that happened to be nearer. The Bleached Giant hit
  // exactly this and answered it the same way — the silhouette stays a tree,
  // but plainly not one of *these* trees.
  const bark = 0x9c8f7d;

  // The trunk, tapering in stacked drums. A single cylinder reads as a pole;
  // the steps between drums are what give it bark at this distance.
  const SEGMENTS = 9;
  const TOTAL = 46;
  let y = 0;
  for (let i = 0; i < SEGMENTS; i++) {
    const h = TOTAL / SEGMENTS;
    const lower = 3.4 * (1 - i / SEGMENTS) + 1.1;
    const upper = 3.4 * (1 - (i + 1) / SEGMENTS) + 1.1;
    parts.push(
      placed(
        roughen(paint(new THREE.CylinderGeometry(upper, lower, h, 9), varyColor(bark, rand, 0.06)), 0.22, rand),
        (rand() - 0.5) * 0.5,
        y + h / 2,
        (rand() - 0.5) * 0.5,
        { rotY: rand() * Math.PI },
      ),
    );
    y += h;
  }

  // Buttress roots, so it stands rather than being planted.
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + rand() * 0.3;
    parts.push(
      placed(
        paint(new THREE.BoxGeometry(1.5, 5.5, 1.5), varyColor(bark, rand, 0.07)),
        Math.cos(a) * 3.4,
        2.2,
        Math.sin(a) * 3.4,
        { rotX: Math.cos(a) * 0.32, rotZ: -Math.sin(a) * 0.32, rotY: a },
      ),
    );
  }

  // The canopy: several overlapping masses rather than one ball, so the
  // silhouette has a shape from every side.
  const leaf = 0x2c5f4a;
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const r = i === 0 ? 0 : 5.5 + rand() * 3.5;
    const s = i === 0 ? 9.5 : 5.5 + rand() * 3;
    parts.push(
      placed(
        roughen(paint(new THREE.IcosahedronGeometry(s, 1), varyColor(leaf, rand, 0.09)), s * 0.14, rand),
        Math.cos(a) * r,
        TOTAL + 2 + (i === 0 ? 3.5 : rand() * 6),
        Math.sin(a) * r,
      ),
    );
  }

  const mesh = new THREE.Mesh(
    merge(parts),
    new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 }),
  );
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  void models;
  return group;
}

const TREE_MIN_RADIUS = 95;
const TREE_MAX_RADIUS = 125;
/** Cleared around the trunk, so the way up is not standing behind a boulder. */
const CLEARING_RADIUS = 14;
const PORTAL_OFFSET = 7;
const RETURN_CLEARANCE = 13;

/**
 * Plants the one giant tree and the portal at its foot.
 *
 * Forest zone by preference and mid-range by distance: far enough that going
 * there is a journey, near enough that it is on the skyline from the
 * homestead on the first morning. That last part is the whole reason it is
 * this big — it is the first thing in this game that tells a new player where
 * to go without a word of text.
 */
export function createGiantTree(
  parent: THREE.Object3D,
  terrain: Terrain,
  seed: number,
  models: ModelLibrary,
  nodes: ResourceNode[],
): PortalSite | null {
  const rand = mulberry32(seed ^ 0x7ee5);
  let spot: { x: number; z: number } | null = null;
  for (let attempt = 0; attempt < 400 && !spot; attempt++) {
    const angle = rand() * Math.PI * 2;
    const radius = TREE_MIN_RADIUS + rand() * (TREE_MAX_RADIUS - TREE_MIN_RADIUS);
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    // Forest first; after two thirds of the attempts, anywhere. A tree that
    // failed to exist because the draws went badly would be a missing feature.
    if (attempt < 260 && getZone(x, z) !== "forest") continue;
    spot = { x, z };
  }
  if (!spot) return null;

  for (let n = nodes.length - 1; n >= 0; n--) {
    const at = nodes[n].object.position;
    if (Math.hypot(at.x - spot.x, at.z - spot.z) > CLEARING_RADIUS) continue;
    parent.remove(nodes[n].object);
    nodes.splice(n, 1);
  }

  const object = buildGiantTree(rand, models);
  object.position.set(spot.x, terrain.heightAt(spot.x, spot.z), spot.z);
  parent.add(object);

  const inward = Math.hypot(spot.x, spot.z) || 1;
  const px = spot.x - (spot.x / inward) * PORTAL_OFFSET;
  const pz = spot.z - (spot.z / inward) * PORTAL_OFFSET;
  const portal = createPortal(px, terrain.heightAt(px, pz), pz, "sky", PORTAL_TINT_UP);
  parent.add(portal.object);

  const rx = spot.x - (spot.x / inward) * (PORTAL_OFFSET + RETURN_CLEARANCE);
  const rz = spot.z - (spot.z / inward) * (PORTAL_OFFSET + RETURN_CLEARANCE);
  return { portal, returnX: rx, returnZ: rz };
}

/**
 * Builds the island fresh.
 *
 * Same bargain as the cave: a new seed every visit, nothing saved, the old one
 * disposed on the way out.
 */
export function createSkyRegion(seed: number, models: ModelLibrary): Region {
  const rand = mulberry32(seed);
  const ground = new SkyGround(seed);
  const group = new THREE.Group();

  const islandMesh = buildIslandMesh(ground);
  group.add(islandMesh);

  const nodes: ResourceNode[] = [];
  const minSpacing = 4.5;
  for (let i = 0; i < 220; i++) {
    const angle = rand() * Math.PI * 2;
    const radius = rand() * ISLAND_RADIUS;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    // Keep off the rim as well as off the landing area: a node you have to
    // stand on the lip to swing at is a node that kills you.
    if (!ground.isOverIsland(x * 1.14, z * 1.14)) continue;
    if (Math.hypot(x - ARRIVAL_X, z - ARRIVAL_Z) < 7) continue;
    if (nodes.some((n) => Math.hypot(n.object.position.x - x, n.object.position.z - z) < minSpacing))
      continue;
    const kind = rand() < 0.38 ? "cloud_iron" : "rock";
    nodes.push(new ResourceNode(kind, x, ground.heightAt(x, z), z, rand, models));
  }
  for (const node of nodes) group.add(node.object);

  const exit = createPortal(EXIT_X, ground.heightAt(EXIT_X, EXIT_Z), EXIT_Z, "surface", PORTAL_TINT_BACK);
  group.add(exit.object);

  return {
    id: "sky",
    name: "The Reach",
    surface: ground,
    group,
    ground: islandMesh,
    halfExtent: SKY_HALF_EXTENT,
    nodes,
    portals: [exit],
    mapGround: 0x6f7a5e,
    fallLimit: SKY_FALL_LIMIT,
    ambience: {
      // Everything the cave is not. The fog is pale and far rather than close
      // and black — up here it is distance that hides things, not darkness,
      // and the drop past the rim has to read as open air rather than as a
      // wall of murk.
      // Measured, like the cave's. At 40/170 the fog reached most of the way
      // across a sixty-unit island and washed it to near-white, so the drop
      // past the rim read as haze rather than as height. Pushed out past the
      // island's own width, the rock stays crisp and what lies beyond the
      // edge is the sky itself.
      fogColor: 0xcfe2f0,
      fogNear: 75,
      fogFar: 280,
      hemiSky: 0xdcefff,
      hemiGround: 0x8fa08a,
      hemiIntensity: 1.15,
      sunColor: 0xfff6e0,
      sunIntensity: 3.0,
      showSky: true,
    },
    // Fewer and slower than the cave: the island is small, and being crowded
    // somewhere with an edge is a different and much cheaper kind of danger
    // than being crowded somewhere with walls.
    enemies: { kinds: ["brute", "zombie"], maxAlive: 4, intervalMs: 9000 },
    dispose: () => disposeGroup(group),
  };
}

/** Where a player arriving on the island should be put. */
export const SKY_ARRIVAL = { x: ARRIVAL_X, z: ARRIVAL_Z };
