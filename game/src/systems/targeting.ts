import * as THREE from "three";
import type { ResourceNode } from "../world/resource-node";
import type { Enemy } from "./enemy-ai";
import type { GameState, PlotState } from "../state/game-state";
import type { BuildingSystem } from "./building";
import { getBuilding } from "../data/buildings";

// One answer to one question — "what is the player looking at?" — shared by
// gathering, combat, farming and building placement.
//
// Before this, every system searched for the nearest thing within a radius on
// the x/z plane, so where the camera pointed had no bearing on what you acted
// on: you could fell a tree while facing away from it. Raycasting through the
// crosshair is what this genre does, and it is what makes the mouse mean
// something.

export type TargetKind =
  | "node"
  | "enemy"
  | "plot"
  | "container"
  | "building"
  | "ground"
  | "none";

export interface Target {
  kind: TargetKind;
  node?: ResourceNode;
  enemy?: Enemy;
  plot?: PlotState;
  /** Placed building id of an aimed container. */
  containerId?: string;
  /** Placed building id of any aimed building — set for containers too. */
  buildingId?: string;
  /** Where the ray met the world. Meaningless when kind is "none". */
  point: THREE.Vector3;
  /** Distance from the *player*, not the camera — see REACH below. */
  distance: number;
  /** Scene root of whatever was hit, for drawing the selection outline. */
  object?: THREE.Object3D;
}

// Minecraft reaches 4.5 blocks in survival; 5 units here is the same feel at
// this world's scale.
export const REACH = 5;

// How far off the line of sight a target may sit and still be picked when the
// ray misses it outright, in world units. A tree trunk is thin enough that
// pixel-exact aiming would feel broken rather than precise.
//
// Deliberately a distance and not an angle: in third person the camera sits
// several units behind the player, so a fixed cone is unforgivingly narrow far
// away and — worse — misses things standing right at the player's feet, which
// subtend a large angle from back there. A lateral tolerance tightens with
// distance on its own, which is the behaviour that actually feels right.
const AIM_ASSIST_RADIUS = 1;

const NONE: Target = { kind: "none", point: new THREE.Vector3(), distance: Infinity };

export interface TargetCandidates {
  nodes: ResourceNode[];
  enemies: Enemy[];
  terrain: THREE.Object3D;
  buildings: BuildingSystem;
  state: GameState;
}

export class Targeting {
  private readonly raycaster = new THREE.Raycaster();
  private readonly screenCentre = new THREE.Vector2(0, 0);
  private readonly roots = new Map<THREE.Object3D, Target>();
  private readonly rootList: THREE.Object3D[] = [];
  private current: Target = NONE;
  // Where the crosshair meets the ground, at any distance. Kept separately
  // from the target because building cares where you're pointing even when
  // that spot is out of reach — the ghost still has to go somewhere.
  private ground: THREE.Vector3 | null = null;

  getTarget(): Target {
    return this.current;
  }

  update(camera: THREE.Camera, playerFeet: THREE.Vector3, candidates: TargetCandidates): Target {
    this.collectRoots(candidates);

    // The camera was just moved this frame and three only refreshes matrices
    // at render time; raycasting off a stale matrixWorld would aim from where
    // the camera was one frame ago.
    camera.updateMatrixWorld();
    // The crosshair sits dead centre, so NDC (0, 0) is exactly what it covers.
    this.raycaster.setFromCamera(this.screenCentre, camera);

    const groundHits = this.raycaster.intersectObject(candidates.terrain, true);
    this.ground = groundHits.length > 0 ? groundHits[0].point.clone() : null;

    // Precedence matters: terrain is nearly always somewhere under the
    // crosshair, so treating any ray hit as the answer would let the ground
    // win over a tree standing a hand's width off the line and leave aim
    // assist dead code. Something you can act on beats bare ground.
    const hit = this.rayHit(playerFeet);
    this.current =
      hit && hit.kind !== "ground" ? hit : (this.aimAssist(playerFeet) ?? hit ?? NONE);
    return this.current;
  }

  // The grid cell a piece would be placed in: where the crosshair meets the
  // ground, pulled in to arm's length when that spot is further than the
  // player can reach.
  //
  // In third person the camera sits behind and above, so looking level puts
  // the crosshair on ground a dozen units away — clamping along the aimed
  // direction is what makes "look down, build at your feet; look ahead, build
  // in front of you" work, instead of the old fixed distance that ignored
  // aiming altogether.
  aimPoint(playerFeet: THREE.Vector3, forward: THREE.Vector3): { x: number; z: number } {
    if (!this.ground) {
      // Aimed at the sky: keep the ghost a sensible distance ahead rather than
      // letting it vanish.
      return { x: playerFeet.x + forward.x * REACH * 0.6, z: playerFeet.z + forward.z * REACH * 0.6 };
    }
    const dx = this.ground.x - playerFeet.x;
    const dz = this.ground.z - playerFeet.z;
    const distance = Math.hypot(dx, dz);
    if (distance <= REACH || distance < 0.0001) {
      return { x: this.ground.x, z: this.ground.z };
    }
    const scale = REACH / distance;
    return { x: playerFeet.x + dx * scale, z: playerFeet.z + dz * scale };
  }

  private collectRoots(c: TargetCandidates): void {
    this.roots.clear();
    this.rootList.length = 0;

    for (const node of c.nodes) {
      if (node.depleted) continue;
      this.register(node.object, { kind: "node", node, point: new THREE.Vector3(), distance: 0 });
    }
    for (const enemy of c.enemies) {
      this.register(enemy.object, { kind: "enemy", enemy, point: new THREE.Vector3(), distance: 0 });
    }
    // Every placed building is aimable. Plots and containers have their own
    // verbs; the rest can at least be taken back down, and being in the ray's
    // path is what makes a wall actually block line of sight.
    for (const placed of c.state.placedBuildings) {
      const def = getBuilding(placed.buildingId);
      const mesh = c.buildings.getMesh(placed.id);
      if (!mesh) continue;
      if (def.isPlot) {
        const plot = c.state.plots.find((p) => p.buildingId === placed.id);
        if (plot) {
          this.register(mesh, { kind: "plot", plot, point: new THREE.Vector3(), distance: 0 });
        }
      } else if (def.isContainer) {
        this.register(mesh, {
          kind: "container",
          containerId: placed.id,
          buildingId: placed.id,
          point: new THREE.Vector3(),
          distance: 0,
        });
      } else {
        // Everything else — walls, floors, stations. These were left out
        // entirely on the grounds that "a wall has nothing to do when you
        // look at it", but that also meant the ray passed straight through
        // one: you could chop a tree from behind a brick wall. Now they can
        // be aimed at, which is both what demolition needs and what stops a
        // wall being transparent to every other interaction.
        this.register(mesh, {
          kind: "building",
          buildingId: placed.id,
          point: new THREE.Vector3(),
          distance: 0,
        });
      }
    }
    // Terrain last: it is the fallback everything else sits on top of.
    this.register(c.terrain, { kind: "ground", point: new THREE.Vector3(), distance: 0 });
  }

  private register(object: THREE.Object3D, target: Target): void {
    this.roots.set(object, target);
    this.rootList.push(object);
  }

  // Whether a world point is on the player's side of the camera rather than
  // between the two. In third person the ray starts several units behind the
  // character and passes through everything standing there on its way in;
  // without this, looking straight ahead can target a tree at your back.
  private inFrontOfPlayer(point: THREE.Vector3, playerFeet: THREE.Vector3): boolean {
    const ahead =
      (point.x - playerFeet.x) * this.raycaster.ray.direction.x +
      (point.z - playerFeet.z) * this.raycaster.ray.direction.z;
    // A small negative tolerance, so something the player is standing right up
    // against still counts.
    return ahead > -0.3;
  }

  private rayHit(playerFeet: THREE.Vector3): Target | null {
    const hits = this.raycaster.intersectObjects(this.rootList, true);
    for (const hit of hits) {
      const root = this.findRoot(hit.object);
      if (!root) continue;
      if (!this.inFrontOfPlayer(hit.point, playerFeet)) continue;
      // Reach is measured from the player, never from the camera — a
      // camera-relative reach would be several units short in third person.
      const distance = playerFeet.distanceTo(hit.point);
      if (distance > REACH) return null; // nearer hits are already exhausted
      const base = this.roots.get(root)!;
      return { ...base, point: hit.point.clone(), distance, object: root };
    }
    return null;
  }

  // Fallback for when the ray slips past a thin target: pick whichever
  // registered object sits closest to the ray's axis inside a narrow cone.
  // Ground is excluded — it is large enough to always be hit properly, and
  // letting it win here would suppress the very targets this is meant to catch.
  private aimAssist(playerFeet: THREE.Vector3): Target | null {
    const origin = this.raycaster.ray.origin;
    const direction = this.raycaster.ray.direction;
    const centre = new THREE.Vector3();
    const toTarget = new THREE.Vector3();
    let best: Target | null = null;
    let bestLateral = AIM_ASSIST_RADIUS;

    for (const [root, base] of this.roots) {
      if (base.kind === "ground") continue;
      new THREE.Box3().setFromObject(root).getCenter(centre);
      const distance = playerFeet.distanceTo(centre);
      if (distance > REACH) continue;
      if (!this.inFrontOfPlayer(centre, playerFeet)) continue;

      toTarget.copy(centre).sub(origin);
      const along = toTarget.dot(direction);
      // Behind the camera is never aimed at, however close it is.
      if (along <= 0) continue;
      const lateral = Math.sqrt(Math.max(0, toTarget.lengthSq() - along * along));
      if (lateral < bestLateral) {
        bestLateral = lateral;
        best = { ...base, point: centre.clone(), distance, object: root };
      }
    }
    return best;
  }

  private findRoot(object: THREE.Object3D): THREE.Object3D | null {
    let current: THREE.Object3D | null = object;
    while (current) {
      if (this.roots.has(current)) return current;
      current = current.parent;
    }
    return null;
  }
}
