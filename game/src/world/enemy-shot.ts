import * as THREE from "three";
import type { GroundSurface } from "./terrain";
import type { Collidable } from "../utils/collision";
import { segmentHitsBox, segmentHitsSphere } from "./projectile";

/**
 * Stones thrown at the player.
 *
 * The mirror of `Projectiles`, and deliberately not the same class: that one
 * tests its flight against enemies and turns into ground loot, this one tests
 * against the player and against walls. Sharing them would mean a system that
 * asks "did this hit an enemy or the person who fired it" on every arrow.
 *
 * What they *do* share is `segmentHitsSphere`, imported rather than rewritten.
 * A second copy of that test would be the `ARMOUR`/`WORN` trap again: two
 * implementations that agree until one of them is fixed.
 *
 * Buildings stop stones. That is the whole point of the enemy that throws
 * them — a wall was a thing that blocked walking, and now it is also a thing
 * to stand behind.
 */

/** Slower than an arrow: you are meant to see it coming and be able to move. */
const SPEED = 16;
const GRAVITY = 9;
const MAX_LIFE_MS = 5000;
/** How close the line of flight has to pass the player's centre to hit. */
const PLAYER_RADIUS = 0.6;
/** Chest height on a 1.7-unit character. */
const MUZZLE_HEIGHT = 1.15;
const MUZZLE_FORWARD = 0.6;

const GEOMETRY = new THREE.BoxGeometry(0.16, 0.16, 0.16);
const MATERIAL = new THREE.MeshStandardMaterial({
  color: 0x8a8375,
  roughness: 1,
  metalness: 0,
});

export interface ShotOutcome {
  /** Damage to apply to the player, or 0 when the stone hit something else. */
  playerDamage: number;
  /** Where it stopped — a building there should take the hit. */
  x: number;
  z: number;
  /** True when it stopped against a building rather than the player or ground. */
  hitBuilding: boolean;
}

interface Stone {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  damage: number;
  bornMs: number;
}

export class EnemyShots {
  private readonly stones: Stone[] = [];

  constructor(
    private readonly scene: THREE.Scene,
    private readonly terrain: GroundSurface,
  ) {}

  /**
   * Throws one stone from `from` so that it arrives at `target`.
   *
   * The elevation is solved here rather than by the caller because the numbers
   * it needs — `SPEED`, `GRAVITY` — are this file's. The first version let the
   * caller aim, and the caller did the obvious thing and pointed straight at
   * the player's chest: over the ten units a slinger stands off, that is
   * 0.63 seconds of flight and 1.76 units of drop, so every stone in the game
   * landed short and the whole enemy did nothing. Nobody would have seen that
   * by reading it.
   */
  fireAt(from: THREE.Vector3, target: THREE.Vector3, damage: number, nowMs: number): void {
    const muzzleY = from.y + MUZZLE_HEIGHT;
    const dx = target.x - from.x;
    const dz = target.z - from.z;
    const flat = Math.hypot(dx, dz);
    if (flat < 1e-3) return;
    const time = flat / SPEED;
    // Straight-line rise, plus back exactly what gravity will take away.
    const vy = (target.y + MUZZLE_HEIGHT - muzzleY) / time + 0.5 * GRAVITY * time;
    const mesh = new THREE.Mesh(GEOMETRY, MATERIAL);
    mesh.castShadow = true;
    mesh.position.set(
      from.x + (dx / flat) * MUZZLE_FORWARD,
      muzzleY,
      from.z + (dz / flat) * MUZZLE_FORWARD,
    );
    this.scene.add(mesh);
    this.stones.push({
      mesh,
      velocity: new THREE.Vector3((dx / flat) * SPEED, vy, (dz / flat) * SPEED),
      damage,
      bornMs: nowMs,
    });
  }

  /** Throws one stone from `from` along `direction`, unaimed. */
  fire(from: THREE.Vector3, direction: THREE.Vector3, damage: number, nowMs: number): void {
    const dir = direction.clone().normalize();
    const mesh = new THREE.Mesh(GEOMETRY, MATERIAL);
    mesh.castShadow = true;
    mesh.position.set(
      from.x + dir.x * MUZZLE_FORWARD,
      from.y + MUZZLE_HEIGHT,
      from.z + dir.z * MUZZLE_FORWARD,
    );
    this.scene.add(mesh);
    this.stones.push({ mesh, velocity: dir.multiplyScalar(SPEED), damage, bornMs: nowMs });
  }

  /** Takes every stone out of the air. For a change of region, as with arrows. */
  clear(): void {
    for (const stone of this.stones) this.scene.remove(stone.mesh);
    this.stones.length = 0;
  }

  /** How many stones are in the air. For tests. */
  count(): number {
    return this.stones.length;
  }

  /**
   * Advances every stone and reports the ones that stopped.
   *
   * The caller applies the damage, for the same reason the arrow system does
   * not apply its own: `damagePlayer` is the single place health is lost, and
   * a projectile system that reached in and set health would be a second one.
   */
  update(
    dt: number,
    nowMs: number,
    playerPos: THREE.Vector3,
    collidables: Collidable[],
  ): ShotOutcome[] {
    const out: ShotOutcome[] = [];
    const target = new THREE.Vector3(playerPos.x, playerPos.y + MUZZLE_HEIGHT, playerPos.z);

    for (let i = this.stones.length - 1; i >= 0; i--) {
      const stone = this.stones[i];
      const from = stone.mesh.position.clone();
      stone.velocity.y -= GRAVITY * dt;
      const to = from.clone().addScaledVector(stone.velocity, dt);

      // Cover wins ties. Both tests are against the same one-frame step, so
      // when a stone would cross a wall *and* reach the player in it, the wall
      // is the honest answer — a defensive structure should not lose a coin
      // flip against the thing it was built to stop.
      const wall = collidables.find((c) => segmentHitsBox(from, to, c));
      if (wall) {
        this.remove(i);
        out.push({ playerDamage: 0, x: wall.x, z: wall.z, hitBuilding: true });
        continue;
      }
      if (segmentHitsSphere(from, to, target, PLAYER_RADIUS)) {
        this.remove(i);
        out.push({ playerDamage: stone.damage, x: to.x, z: to.z, hitBuilding: false });
        continue;
      }

      const ground = this.terrain.heightAt(to.x, to.z);
      if (to.y <= ground || nowMs - stone.bornMs > MAX_LIFE_MS) {
        this.remove(i);
        out.push({ playerDamage: 0, x: to.x, z: to.z, hitBuilding: false });
        continue;
      }

      stone.mesh.position.copy(to);
      stone.mesh.rotation.x += dt * 6;
      stone.mesh.rotation.y += dt * 4;
    }
    return out;
  }

  private remove(index: number): void {
    this.scene.remove(this.stones[index].mesh);
    this.stones.splice(index, 1);
  }
}
