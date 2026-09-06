import * as THREE from "three";
import type { GroundSurface } from "./terrain";
import type { Enemy } from "../systems/enemy-ai";
import type { Collidable } from "../utils/collision";

/**
 * Arrows in flight.
 *
 * Not saved, deliberately and for the same reason enemies and ground loot are
 * not: an arrow belongs to the second it was loosed in, and a reload has
 * already thrown that second away. What it turns into when it lands — an
 * ordinary drop — is what survives, and that is handled by the caller.
 */

/** Metres per second. Fast enough to feel like an arrow, slow enough to lead. */
const SPEED = 30;
/** Gentle: enough drop to have to aim high at range, not a mortar. */
const GRAVITY = 9;
/** Arrows that hit nothing give up rather than flying to the world's edge. */
const MAX_LIFE_MS = 4000;
/** How close the line of flight has to pass an enemy's centre to hit it. */
const ENEMY_RADIUS = 0.55;
/** Chest height on a 1.7-unit character — where an arrow leaves the bow. */
const MUZZLE_HEIGHT = 1.15;
/** Clear of the shooter's own body before the first collision test. */
const MUZZLE_FORWARD = 0.7;

const GEOMETRY = new THREE.BoxGeometry(0.05, 0.05, 0.6);
const MATERIAL = new THREE.MeshStandardMaterial({
  color: 0xcfc3a8,
  roughness: 0.9,
  metalness: 0,
});

export interface ArrowHit {
  /** The enemy struck, or null when the arrow simply came to rest. */
  enemy: Enemy | null;
  x: number;
  z: number;
}

interface Arrow {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  bornMs: number;
}

/**
 * Segment-vs-sphere: does the path travelled this frame pass within `radius`
 * of `centre`, and if so how far along it?
 *
 * A point test would not do. `GameLoop` clamps dt to 0.1s, so under software
 * rendering an arrow covers three units in a single step — several times an
 * enemy's width. Testing only where it *ended up* would let arrows pass
 * cleanly through everything they were aimed at, and the miss would look like
 * bad aim rather than a bug.
 */
export function segmentHitsSphere(
  from: THREE.Vector3,
  to: THREE.Vector3,
  centre: THREE.Vector3,
  radius: number,
): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const lengthSq = dx * dx + dy * dy + dz * dz;
  if (lengthSq < 1e-8) return from.distanceToSquared(centre) <= radius * radius;
  // Closest approach, clamped to the segment's ends.
  let t =
    ((centre.x - from.x) * dx + (centre.y - from.y) * dy + (centre.z - from.z) * dz) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  const nx = from.x + dx * t - centre.x;
  const ny = from.y + dy * t - centre.y;
  const nz = from.z + dz * t - centre.z;
  return nx * nx + ny * ny + nz * nz <= radius * radius;
}

/** The same idea against a building's box, on the x/z plane. */
export function segmentHitsBox(from: THREE.Vector3, to: THREE.Vector3, c: Collidable): boolean {
  const half = c.halfExtent ?? c.radius;
  // Sampled along the segment rather than solved: the boxes are one grid cell
  // across and the samples are far finer than that, and this keeps the test
  // honest about a wall the arrow only clips the corner of.
  const steps = Math.max(2, Math.ceil(from.distanceTo(to) / (half * 0.5)));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = from.x + (to.x - from.x) * t;
    const z = from.z + (to.z - from.z) * t;
    if (Math.abs(x - c.x) <= half && Math.abs(z - c.z) <= half) return true;
  }
  return false;
}

export class Projectiles {
  private readonly arrows: Arrow[] = [];

  constructor(
    private readonly scene: THREE.Scene,
    private readonly terrain: GroundSurface,
  ) {}

  /** Looses an arrow from the shooter's chest along `direction`. */
  fire(from: THREE.Vector3, direction: THREE.Vector3, nowMs: number): void {
    const dir = direction.clone().normalize();
    const mesh = new THREE.Mesh(GEOMETRY, MATERIAL);
    mesh.castShadow = true;
    mesh.position.set(
      from.x + dir.x * MUZZLE_FORWARD,
      from.y + MUZZLE_HEIGHT,
      from.z + dir.z * MUZZLE_FORWARD,
    );
    this.scene.add(mesh);
    this.arrows.push({
      mesh,
      velocity: dir.multiplyScalar(SPEED),
      bornMs: nowMs,
    });
  }

  /**
   * Takes every arrow out of the air without landing it.
   *
   * Only for a change of region: an arrow loosed on the surface has nowhere to
   * land in a cave, and dropping it as loot would post an arrow through the
   * floor of a place it was never fired in.
   */
  clear(): void {
    for (const arrow of this.arrows) this.scene.remove(arrow.mesh);
    this.arrows.length = 0;
  }

  /** How many arrows are in the air. For tests, and for nothing else. */
  count(): number {
    return this.arrows.length;
  }

  /**
   * Advances every arrow and reports what each one hit as it stopped. The
   * caller decides what a hit means — damage goes through the same path a
   * sword swing takes, and a spent arrow becomes an ordinary ground drop.
   */
  update(
    dt: number,
    nowMs: number,
    enemies: Enemy[],
    collidables: Collidable[],
  ): ArrowHit[] {
    const hits: ArrowHit[] = [];
    for (let i = this.arrows.length - 1; i >= 0; i--) {
      const arrow = this.arrows[i];
      const from = arrow.mesh.position.clone();
      arrow.velocity.y -= GRAVITY * dt;
      const to = from.clone().addScaledVector(arrow.velocity, dt);

      let struck: Enemy | null = null;
      for (const enemy of enemies) {
        if (enemy.dying) continue;
        // Aimed at the middle of the body, not at its feet: `object.position`
        // sits on the ground.
        const centre = enemy.object.position.clone();
        centre.y += 0.9;
        if (segmentHitsSphere(from, to, centre, ENEMY_RADIUS)) {
          struck = enemy;
          break;
        }
      }

      const groundY = this.terrain.heightAt(to.x, to.z);
      const blocked =
        !struck && collidables.some((c) => c.halfExtent !== undefined && segmentHitsBox(from, to, c));
      const landed = !struck && (blocked || to.y <= groundY);
      const spent = nowMs - arrow.bornMs >= MAX_LIFE_MS;

      if (struck || landed || spent) {
        this.scene.remove(arrow.mesh);
        this.arrows.splice(i, 1);
        hits.push({ enemy: struck, x: to.x, z: to.z });
        continue;
      }

      arrow.mesh.position.copy(to);
      // Point the shaft along the flight path, so the arc is visible in the
      // arrow's own attitude and not only in its position.
      arrow.mesh.lookAt(to.clone().add(arrow.velocity));
    }
    return hits;
  }
}
