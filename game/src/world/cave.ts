import * as THREE from "three";
import { ValueNoise2D } from "./noise";
import { mulberry32 } from "../utils/rng";
import { merge, paint, placed, roughen, varyColor } from "./geometry";
import { ResourceNode } from "./resource-node";
import { createPortal, type Portal } from "./portal";
import { disposeGroup, type Region } from "./region";
import { getZone } from "./zones";
import type { GroundSurface, Terrain } from "./terrain";
import type { ModelLibrary } from "./models";

/**
 * The cave, and the mouths on the surface that lead to it.
 *
 * Deliberately small — 70 units across against the overworld's 400. A cave is
 * somewhere you go *into*, and the whole of it should be walkable in about the
 * time it takes to clear it. Making it a second open world would be a second
 * open world to fill.
 */
export const CAVE_HALF_EXTENT = 35;
const FLOOR_SEGMENTS = 48;
/** How much the floor rolls. Enough to be uneven; not enough to hide a node. */
const FLOOR_RELIEF = 1.4;

const PORTAL_TINT_DOWN = 0x8b5cf6;
const PORTAL_TINT_BACK = 0xf0b429;

/** Where the player lands, and the way back, both on the same side. */
const ARRIVAL_X = 0;
const ARRIVAL_Z = CAVE_HALF_EXTENT - 11;
/**
 * The way out stands to one side of where the player lands, not behind it.
 *
 * The arming rule in `portal.ts` is what stops a bounce; this is about what
 * the player *sees*. Put directly behind the arrival point it lands inside the
 * chase camera, which only collides with the floor — so the first frame in the
 * cave was a screenful of amber portal, close enough to fill the view, with
 * the cave itself hidden behind it. Found in a screenshot; nothing in the
 * geometry or the numbers said it was wrong.
 */
const EXIT_X = 11;
const EXIT_Z = ARRIVAL_Z + 4;

/** A rolling rock floor. Its own noise, so it looks nothing like the hills. */
class CaveFloor implements GroundSurface {
  private readonly noise: ValueNoise2D;

  constructor(seed: number) {
    this.noise = new ValueNoise2D(seed ^ 0x0cafe5);
  }

  heightAt(x: number, z: number): number {
    return this.noise.fbm2D(x, z, 3, 0.5, 0.05) * FLOOR_RELIEF;
  }
}

function buildFloorMesh(floor: CaveFloor): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(
    CAVE_HALF_EXTENT * 2,
    CAVE_HALF_EXTENT * 2,
    FLOOR_SEGMENTS,
    FLOOR_SEGMENTS,
  );
  geometry.rotateX(-Math.PI / 2);
  const position = geometry.attributes.position;
  const colors = new Float32Array(position.count * 3);
  const base = new THREE.Color();
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const z = position.getZ(i);
    position.setY(i, floor.heightAt(x, z));
    // Damp rock, varied per vertex so the floor is not one flat sheet in a
    // place where there is no sun to break it up.
    base.setHex(0x6b6472);
    base.multiplyScalar(1 + floor.heightAt(x * 3.1, z * 3.1) * 0.09);
    base.toArray(colors, i * 3);
  }
  geometry.computeVertexNormals();
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 }),
  );
}

/** A wall of rock around the edge, so the cave reads as enclosed. */
function buildWalls(rand: () => number, floor: CaveFloor): THREE.Object3D {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 0.95,
  });
  const parts: THREE.BufferGeometry[] = [];
  const step = 4;
  for (let side = 0; side < 4; side++) {
    for (let t = -CAVE_HALF_EXTENT; t <= CAVE_HALF_EXTENT; t += step) {
      const along = t + (rand() - 0.5) * 2;
      // Set against the clamp, not past it. At +1.5 the rock stood a good four
      // units beyond the furthest the player could walk, so the cave ended at
      // an invisible line with the wall visible past it.
      const out = CAVE_HALF_EXTENT - 0.6;
      const x = side === 0 ? along : side === 1 ? out : side === 2 ? along : -out;
      const z = side === 0 ? -out : side === 1 ? along : side === 2 ? out : along;
      const h = 6 + rand() * 4;
      const w = 3.4 + rand() * 2;
      parts.push(
        placed(
          roughen(
            paint(new THREE.BoxGeometry(w, h, w), varyColor(0x5c5560, rand, 0.08)),
            0.5,
            rand,
          ),
          x,
          floor.heightAt(x, z) + h / 2 - 1,
          z,
          { rotY: rand() * Math.PI },
        ),
      );
    }
  }
  const mesh = new THREE.Mesh(merge(parts), material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return group;
}

/**
 * A cave mouth standing on the overworld, with the way down in front of it.
 *
 * Built here rather than in `landmarks.ts` because it is not a thing to steer
 * by — it is a door, and it has to read as one from close up, which is a
 * different job from reading as a silhouette at two hundred units.
 */
export function buildCaveMouth(rand: () => number, models: ModelLibrary): THREE.Object3D {
  const group = new THREE.Group();
  const source = models["rocks-high"] ?? models["rocks-low"];
  const parts: THREE.BufferGeometry[] = [];
  // An arch of boulders with a gap in the middle, which is the bit that says
  // "you can go in here" rather than "this is a pile of rocks".
  for (let i = 0; i < 9; i++) {
    const a = Math.PI * (0.12 + (i / 8) * 0.76);
    const r = 5.2;
    const s = 1.6 + rand() * 1.4;
    parts.push(
      placed(
        roughen(
          paint(new THREE.IcosahedronGeometry(s, 0), varyColor(0x54514c, rand, 0.09)),
          s * 0.3,
          rand,
        ),
        Math.cos(a) * r,
        Math.sin(a) * r * 0.85,
        (rand() - 0.5) * 1.2,
        { rotY: rand() * Math.PI },
      ),
    );
  }
  // A dark mouth behind the arch. Flat black-ish and unlit, so it reads as a
  // hole rather than as a painted wall.
  const mouth = new THREE.Mesh(
    new THREE.CircleGeometry(3.6, 18),
    new THREE.MeshBasicMaterial({ color: 0x0d0c12 }),
  );
  mouth.position.set(0, 3.2, -0.6);
  group.add(mouth);

  const mesh = new THREE.Mesh(
    merge(parts),
    new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 }),
  );
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  void source;
  return group;
}

/**
 * Builds the cave fresh.
 *
 * Called on **every** entry, with a seed that moves each time: the player
 * chose a dungeon that resets, so two trips into the same cave mouth are two
 * different caves. Nothing about it is saved.
 */
export function createCaveRegion(seed: number, models: ModelLibrary): Region {
  const rand = mulberry32(seed);
  const floor = new CaveFloor(seed);
  const group = new THREE.Group();

  const floorMesh = buildFloorMesh(floor);
  floorMesh.receiveShadow = true;
  group.add(floorMesh);
  group.add(buildWalls(rand, floor));

  // What is worth coming for, plus enough ordinary rock that the crystal reads
  // as the find rather than as the only thing here.
  const nodes: ResourceNode[] = [];
  const minSpacing = 4;
  for (let i = 0; i < 260; i++) {
    const x = (rand() * 2 - 1) * (CAVE_HALF_EXTENT - 4);
    const z = (rand() * 2 - 1) * (CAVE_HALF_EXTENT - 4);
    // Keep the landing area clear, so a player does not arrive inside a rock.
    if (Math.hypot(x - ARRIVAL_X, z - ARRIVAL_Z) < 7) continue;
    if (nodes.some((n) => Math.hypot(n.object.position.x - x, n.object.position.z - z) < minSpacing))
      continue;
    const kind = rand() < 0.34 ? "glow_crystal" : "rock";
    nodes.push(new ResourceNode(kind, x, floor.heightAt(x, z), z, rand, models));
  }
  for (const node of nodes) group.add(node.object);

  const exit = createPortal(
    EXIT_X,
    floor.heightAt(EXIT_X, EXIT_Z),
    EXIT_Z,
    "surface",
    PORTAL_TINT_BACK,
  );
  group.add(exit.object);

  return {
    id: "cave",
    name: "The Deep",
    surface: floor,
    group,
    ground: floorMesh,
    // The floor's own half-size. `PLAYER_EDGE_MARGIN` takes the player's stop
    // three units inside that, which is where the rock is.
    halfExtent: CAVE_HALF_EXTENT,
    nodes,
    portals: [exit],
    mapGround: 0x3c3844,
    ambience: {
      // Close, cold and dark — and measured rather than guessed. The first
      // pass ran fog from 6 to 44 over a near-black floor at 0.55 hemisphere,
      // which sounded like "a cave" and rendered as crystals floating in a
      // void: the ground two paces from the player's own feet was already
      // fogged past legibility, so there was no floor to read at all. These
      // numbers still hide the far wall, which is what makes the space feel
      // like it goes on, but the fog now begins beyond where the player is
      // standing rather than inside it.
      fogColor: 0x0a0a10,
      fogNear: 15,
      fogFar: 52,
      hemiSky: 0x4a4468,
      hemiGround: 0x2b2733,
      hemiIntensity: 1.15,
      // A cold key light. Left at whatever the day/night cycle last set it to,
      // a player who walked in at dusk would find the cave lit sunset-orange.
      sunColor: 0x9fb6d8,
      // Not zero: with no directional light at all the flat-shaded props lose
      // every edge and the floor becomes an unreadable smear.
      sunIntensity: 0.95,
      showSky: false,
    },
    enemies: { kinds: ["brute", "zombie"], maxAlive: 6, intervalMs: 6000 },
    dispose: () => disposeGroup(group),
  };
}

/** Where a player arriving in the cave should be put. */
export const CAVE_ARRIVAL = { x: ARRIVAL_X, z: ARRIVAL_Z };
export { PORTAL_TINT_DOWN };

/** How many ways down the overworld carries. */
const MOUTH_COUNT = 3;
const MOUTH_MIN_RADIUS = 42;
const MOUTH_MAX_RADIUS = 135;
/** Far enough apart that finding one is not the same as finding all of them. */
const MOUTH_SPACING = 70;
/**
 * How much ground around an arch is cleared of scenery.
 *
 * Big enough to cover the arch itself and the portal in front of it. The world
 * is scattered before the mouths are placed, so without this a doorway lands in
 * whatever happened to be growing there — the first screenshot had a portal
 * standing behind a row of boulders with only its top arc showing, which is
 * not a door you would ever walk into.
 */
const CLEARING_RADIUS = 11;
/** How far in front of the arch the way down stands. */
const PORTAL_OFFSET = 5;
/** How far in front of *that* a returning player is put. See the note below. */
const RETURN_CLEARANCE = 13;

/** A way down, and where walking back out of it puts you. */
export interface CaveMouth {
  portal: Portal;
  /** Where the player lands on returning — a few paces clear of the portal. */
  returnX: number;
  returnZ: number;
}

/**
 * Scatters the ways down across the overworld.
 *
 * Rejection-sampled the way landmarks are, and for the same reason: the zone
 * borders are noise-warped and there is no formula to solve for. Rock and
 * highland are preferred but not required — a run of unlucky draws should
 * cost the cave a good spot, not its existence.
 */
export function createCaveMouths(
  parent: THREE.Object3D,
  terrain: Terrain,
  seed: number,
  models: ModelLibrary,
  /** The surface's nodes. Anything standing in a doorway is taken out of it. */
  nodes: ResourceNode[],
): CaveMouth[] {
  const rand = mulberry32(seed ^ 0x1caf3);
  const mouths: CaveMouth[] = [];
  // The arch positions, kept separately: the spacing rule has to compare arch
  // against arch. Measuring a candidate arch against an existing *portal* —
  // which stands five units in front of its arch — quietly lets two caves sit
  // closer together than the rule says they may.
  const centres: { x: number; z: number }[] = [];

  for (let i = 0; i < MOUTH_COUNT; i++) {
    let spot: { x: number; z: number } | null = null;
    for (let attempt = 0; attempt < 300 && !spot; attempt++) {
      const angle = rand() * Math.PI * 2;
      const radius = MOUTH_MIN_RADIUS + rand() * (MOUTH_MAX_RADIUS - MOUTH_MIN_RADIUS);
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      if (centres.some((c) => Math.hypot(c.x - x, c.z - z) < MOUTH_SPACING)) continue;
      // Rock first, then anywhere: after two thirds of the attempts the zone
      // requirement is dropped rather than risking no cave at all. A cave
      // mouth in a wetland would still be a cave mouth; one that failed to
      // exist because the draws went badly would be a missing feature.
      if (attempt < 200 && getZone(x, z) !== "rocky") continue;
      spot = { x, z };
    }
    if (!spot) continue;
    centres.push(spot);

    for (let n = nodes.length - 1; n >= 0; n--) {
      const at = nodes[n].object.position;
      if (Math.hypot(at.x - spot.x, at.z - spot.z) > CLEARING_RADIUS) continue;
      parent.remove(nodes[n].object);
      nodes.splice(n, 1);
    }

    const object = buildCaveMouth(rand, models);
    object.position.set(spot.x, terrain.heightAt(spot.x, spot.z), spot.z);
    // Turned to face the middle of the world, so a player walking out from
    // home meets the opening rather than the back of the hill.
    //
    // `atan2(x, z)`, not `atan2(-x, -z)`: a yaw of θ sends the arch's own
    // front — its local -z, where the dark mouth sits — to world
    // (-sinθ, -cosθ), so these arguments are what point that at the origin.
    // Negated, the arch turns its back on the player and stands in front of
    // its own portal, which is what the first screenshot showed.
    object.rotation.y = Math.atan2(spot.x, spot.z);
    parent.add(object);

    // In front of the arch — on the side the player arrives from.
    const inward = Math.hypot(spot.x, spot.z) || 1;
    const px = spot.x - (spot.x / inward) * PORTAL_OFFSET;
    const pz = spot.z - (spot.z / inward) * PORTAL_OFFSET;
    const portal = createPortal(px, terrain.heightAt(px, pz), pz, "cave", PORTAL_TINT_DOWN);
    parent.add(portal.object);

    // Well clear of the portal, and for a reason that only a screenshot shows:
    // the chase camera sits about six units behind the player and collides
    // only with the ground, so a return point four paces from the portal put
    // the camera *inside* it — the player walked out of a cave into a
    // screenful of flat purple. Standing them back far enough that the camera
    // cannot reach the sheet is what fixes it, and it reads better anyway: you
    // come out looking at the mouth rather than pressed against it.
    const rx = spot.x - (spot.x / inward) * (PORTAL_OFFSET + RETURN_CLEARANCE);
    const rz = spot.z - (spot.z / inward) * (PORTAL_OFFSET + RETURN_CLEARANCE);
    mouths.push({ portal, returnX: rx, returnZ: rz });
  }

  return mouths;
}
