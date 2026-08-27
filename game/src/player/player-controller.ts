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

  update(
    dt: number,
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
    const move = new THREE.Vector3();
    if (input.isDown("KeyW")) move.add(forward);
    if (input.isDown("KeyS")) move.sub(forward);
    if (input.isDown("KeyD")) move.add(right);
    if (input.isDown("KeyA")) move.sub(right);

    let { x, z } = this.state.player;
    if (move.lengthSq() > 0) {
      move.normalize().multiplyScalar(MOVE_SPEED * dt);
      x += move.x;
      z += move.z;
      this.state.player.yaw = Math.atan2(move.x, move.z);
    }

    const resolved = resolveCollisions(x, z, PLAYER_RADIUS, collidables);
    this.state.player.x = resolved.x;
    this.state.player.z = resolved.z;
    this.state.player.y = this.terrain.heightAt(resolved.x, resolved.z);

    this.syncObjectFromState();
  }
}
