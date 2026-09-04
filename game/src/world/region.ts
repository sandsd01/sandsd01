import * as THREE from "three";
import type { BoundedGround, GroundSurface } from "./terrain";
import type { ResourceNode } from "./resource-node";
import type { Portal } from "./portal";

/**
 * Somewhere the player can be.
 *
 * The game was written on the assumption that there is exactly one place —
 * `heightAt` is reached for from eleven files, and terrain, grass, water,
 * nodes, landmarks, buildings and farming are all built once at boot and
 * held by reference forever. Introducing a second place could have meant
 * threading "which one" through all of that.
 *
 * It does not, because of one move: `RegionManager` below is itself a
 * `GroundSurface`. Every system keeps the single reference it was built with
 * and never learns that a switch happened.
 */
export interface Region {
  id: RegionId;
  /** Human name, for the HUD. */
  name: string;
  /** The ground of this place. */
  surface: GroundSurface;
  /** Everything drawn for it, so showing and hiding is one flag. */
  group: THREE.Group;
  /** What the crosshair and camera collide against. */
  ground: THREE.Object3D;
  /** Half-extent of the walkable area, for clamping to its edge. */
  halfExtent: number;
  /** Live nodes here. The overworld's are permanent; a dungeon's are rebuilt
   * on every entry, because a dungeon resets each time it is entered. */
  nodes: ResourceNode[];
  /** Ways out (and, on the surface, ways in). */
  portals: Portal[];
  /**
   * A flat colour for this place on the minimap, or null to sample the
   * overworld's biomes. Somewhere with no biomes has to say so: `getZone` will
   * answer for any coordinate, including one under a hundred metres of rock,
   * and would happily paint a cave floor forest-green.
   */
  mapGround: number | null;
  /** How the place is lit. `null` on the surface, which the day/night cycle
   * owns instead. */
  ambience: RegionAmbience | null;
  /** Enemy kinds that belong here, and how thickly. */
  enemies: { kinds: string[]; maxAlive: number; intervalMs: number } | null;
  /** Called when the player leaves, so a resetting region can drop its own
   * meshes rather than leaking one copy per visit. */
  dispose?: () => void;
}

export type RegionId = "surface" | "cave" | "sky";

/** Fixed lighting for a place the sun does not reach (or reaches too well). */
export interface RegionAmbience {
  fogColor: number;
  fogNear: number;
  fogFar: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  sunColor: number;
  sunIntensity: number;
  /** Whether the sky dome is drawn at all — a cave has no sky. */
  showSky: boolean;
}

/**
 * Holds the regions and answers as whichever one is active.
 *
 * The delegation is the entire point. `PlayerController`, `EnemyManager`,
 * `BuildingSystem`, `FarmingSystem`, `Projectiles` and `DroppedItems` are all
 * constructed with this once and call `heightAt` forever; swapping regions
 * changes what that returns and nothing else has to be told.
 */
export class RegionManager implements BoundedGround {
  private readonly regions = new Map<RegionId, Region>();
  private activeId: RegionId;

  constructor(
    private readonly scene: THREE.Scene,
    surface: Region,
  ) {
    this.regions.set(surface.id, surface);
    this.activeId = surface.id;
    scene.add(surface.group);
  }

  heightAt(x: number, z: number): number {
    return this.active.surface.heightAt(x, z);
  }

  /**
   * Where the ground stops here — the overworld's 200, or a cave's 33.
   *
   * A getter rather than a stored number, because the whole point of this
   * class is that the systems holding a reference to it never re-read
   * anything: they ask, and the answer has already changed.
   */
  get halfExtent(): number {
    return this.active.halfExtent;
  }

  get active(): Region {
    const region = this.regions.get(this.activeId);
    if (!region) throw new Error(`No active region: ${this.activeId}`);
    return region;
  }

  get activeRegionId(): RegionId {
    return this.activeId;
  }

  isSurface(): boolean {
    return this.activeId === "surface";
  }

  /**
   * Puts a freshly built region in play and takes the old one out of the
   * scene graph.
   *
   * The outgoing region is **hidden, not destroyed**, when it is the surface:
   * the overworld holds thousands of props and a homestead the player built,
   * and rebuilding that on every trip out of a cave would be both slow and a
   * good way to lose their base. A dungeon is the other way round — it is
   * disposed, because it resets on every entry and keeping it would leak one
   * copy per visit.
   */
  enter(region: Region): void {
    const leaving = this.active;
    if (leaving.id === region.id) return;

    this.scene.remove(leaving.group);
    if (leaving.id !== "surface") {
      leaving.dispose?.();
      this.regions.delete(leaving.id);
    }

    this.regions.set(region.id, region);
    this.activeId = region.id;
    this.scene.add(region.group);

    // Every portal where the player is about to appear starts disarmed.
    //
    // Today's arrival points all stand well clear of their portals — the cave
    // floor's by eleven units, the surface's by eighteen — so nothing
    // currently depends on this line, and a check written against it passes
    // whether or not it is here. It stays because the alternative is that the
    // only thing standing between the game and an infinite portal loop is two
    // distance constants in `cave.ts`, and the person who next moves an
    // arrival point will not know that.
    for (const portal of region.portals) portal.armed = false;
  }
}

/**
 * Frees the geometry and materials a disposable region built.
 *
 * Three.js does not reference-count either, so dropping the group only stops
 * it being drawn — the GPU buffers stay until told otherwise. A dungeon is
 * rebuilt on every entry, so without this a long session would climb.
 */
export function disposeGroup(group: THREE.Object3D): void {
  group.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry?.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) material.forEach((m) => m.dispose());
    else material?.dispose();
  });
}
