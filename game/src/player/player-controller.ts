import * as THREE from "three";
import type { GameState } from "../state/game-state";
import type { InputManager } from "../input/input-manager";
import type { ThirdPersonCamera } from "../core/camera";
import type { Terrain } from "../world/terrain";
import { resolveCollisions, type Collidable } from "../utils/collision";

const MOVE_SPEED = 5;
const SPRINT_MULTIPLIER = 1.6;
const PLAYER_RADIUS = 0.4;
const MOUSE_SENSITIVITY = 0.0025;
const PLAYER_HEIGHT = 1.7;
const BOB_FREQUENCY = 9; // cycles/sec while moving at full speed
const BOB_AMPLITUDE = 0.06;
const SWING_DURATION_MS = 220;

export class PlayerController {
  readonly object: THREE.Group;
  private readonly body: THREE.Mesh;
  private readonly weapon: THREE.Mesh;
  private bobPhase = 0;
  private swingStartMs = -Infinity;

  constructor(
    private readonly state: GameState,
    private readonly terrain: Terrain,
  ) {
    this.object = new THREE.Group();
    this.body = new THREE.Mesh(
      new THREE.CapsuleGeometry(PLAYER_RADIUS, 1, 4, 8),
      new THREE.MeshStandardMaterial({ color: 0xcc6b3a }),
    );
    this.body.position.y = PLAYER_HEIGHT / 2;
    this.object.add(this.body);

    // A simple held-item indicator that swings on attack/place — purely
    // cosmetic feedback, independent of the range-based hit logic.
    this.weapon = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.12, 0.8),
      new THREE.MeshStandardMaterial({ color: 0xb0b0b0 }),
    );
    this.weapon.position.set(0.35, PLAYER_HEIGHT * 0.6, 0.3);
    this.object.add(this.weapon);

    this.syncObjectFromState();
  }

  // Kicks off the cosmetic swing animation; called by main.ts whenever the
  // player attacks or places a building.
  triggerSwing(nowMs: number): void {
    this.swingStartMs = nowMs;
  }

  private syncObjectFromState(): void {
    this.object.position.set(this.state.player.x, this.state.player.y, this.state.player.z);
    this.object.rotation.y = this.state.player.yaw;
  }

  getFeetPosition(): THREE.Vector3 {
    return new THREE.Vector3(this.state.player.x, this.state.player.y, this.state.player.z);
  }

  // Debug/testing-only teleport (see window.__gameDebug in main.ts) — not used
  // by normal gameplay input handling.
  teleport(x: number, z: number): void {
    this.state.player.x = x;
    this.state.player.z = z;
    this.state.player.y = this.terrain.heightAt(x, z);
    this.syncObjectFromState();
  }

  update(
    dt: number,
    nowMs: number,
    input: InputManager,
    camera: ThirdPersonCamera,
    collidables: Collidable[],
  ): void {
    if (input.isPointerLocked()) {
      camera.addYawPitch(
        input.mouseDeltaX * MOUSE_SENSITIVITY,
        input.mouseDeltaY * MOUSE_SENSITIVITY,
      );
    }

    const forward = camera.getForward();
    const right = camera.getRight();
    const { x: mx, y: my } = input.getMoveVector();
    const move = new THREE.Vector3();
    move.addScaledVector(forward, my);
    move.addScaledVector(right, mx);
    // Clamp to unit length rather than always normalizing so diagonal
    // keyboard input (both axes at once) doesn't move faster than a single
    // direction — each axis alone is already exactly -1/0/1.
    if (move.lengthSq() > 1) move.normalize();

    const speed = MOVE_SPEED * (input.isSprinting() ? SPRINT_MULTIPLIER : 1);
    let { x, z } = this.state.player;
    const isMoving = move.lengthSq() > 0.0001;
    if (isMoving) {
      x += move.x * speed * dt;
      z += move.z * speed * dt;
      this.state.player.yaw = Math.atan2(move.x, move.z);
    }

    const resolved = resolveCollisions(x, z, PLAYER_RADIUS, collidables);
    this.state.player.x = resolved.x;
    this.state.player.z = resolved.z;
    this.state.player.y = this.terrain.heightAt(resolved.x, resolved.z);

    this.syncObjectFromState();
    this.updateBob(dt, isMoving);
    this.updateSwing(nowMs);
  }

  // Cosmetic head-bob while walking — offsets the body mesh only, never the
  // group position the rest of the game reads as the player's actual
  // location, so it can't perturb collision/gathering/combat ranges.
  private updateBob(dt: number, isMoving: boolean): void {
    if (isMoving) {
      this.bobPhase += dt * BOB_FREQUENCY * Math.PI * 2;
    } else {
      this.bobPhase = 0;
    }
    const bob = isMoving ? Math.abs(Math.sin(this.bobPhase)) * BOB_AMPLITUDE : 0;
    this.body.position.y = PLAYER_HEIGHT / 2 + bob;
  }

  private updateSwing(nowMs: number): void {
    const elapsed = nowMs - this.swingStartMs;
    if (elapsed < 0 || elapsed >= SWING_DURATION_MS) {
      this.weapon.rotation.x = 0;
      return;
    }
    const t = elapsed / SWING_DURATION_MS;
    // A quick out-and-back swing arc (sine easing peaking mid-swing).
    this.weapon.rotation.x = -Math.sin(t * Math.PI) * 1.8;
  }
}
