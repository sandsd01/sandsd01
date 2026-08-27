import * as THREE from "three";
import type { GameState } from "../state/game-state";
import type { InputManager } from "../input/input-manager";
import type { ThirdPersonCamera } from "../core/camera";
import type { Terrain } from "../world/terrain";
import { resolveCollisions, type Collidable } from "../utils/collision";

const MOVE_SPEED = 5;
const PLAYER_RADIUS = 0.4;
const MOUSE_SENSITIVITY = 0.0025;
const PLAYER_HEIGHT = 1.7;

export class PlayerController {
  readonly object: THREE.Group;

  constructor(
    private readonly state: GameState,
    private readonly terrain: Terrain,
  ) {
    this.object = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(PLAYER_RADIUS, 1, 4, 8),
      new THREE.MeshStandardMaterial({ color: 0xcc6b3a }),
    );
    body.position.y = PLAYER_HEIGHT / 2;
    this.object.add(body);
    this.syncObjectFromState();
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
    input: InputManager,
    camera: ThirdPersonCamera,
    collidables: Collidable[],
  ): void {
    if (input.isControlsActive()) {
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
    // Clamp to unit length rather than always normalizing, so an analog
    // touch-joystick push shorter than full deflection moves proportionally
    // slower — keyboard input (each axis exactly -1/0/1) is unaffected since
    // it already never exceeds length 1 except on diagonals, which this
    // clamps to the same full speed as before.
    if (move.lengthSq() > 1) move.normalize();

    let { x, z } = this.state.player;
    if (move.lengthSq() > 0.0001) {
      x += move.x * MOVE_SPEED * dt;
      z += move.z * MOVE_SPEED * dt;
      this.state.player.yaw = Math.atan2(move.x, move.z);
    }

    const resolved = resolveCollisions(x, z, PLAYER_RADIUS, collidables);
    this.state.player.x = resolved.x;
    this.state.player.z = resolved.z;
    this.state.player.y = this.terrain.heightAt(resolved.x, resolved.z);

    this.syncObjectFromState();
  }
}
