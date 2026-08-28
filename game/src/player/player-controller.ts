import * as THREE from "three";
import type { GameState } from "../state/game-state";
import type { InputManager } from "../input/input-manager";
import type { ThirdPersonCamera } from "../core/camera";
import type { Terrain } from "../world/terrain";
import { resolveCollisions, type Collidable } from "../utils/collision";
import { events } from "../utils/events";
import { buildFigureGeometry, createFigureMaterial } from "../world/figures";
import { merge, paint, placed } from "../world/geometry";
import { instantiate, type ModelLibrary } from "../world/models";

const MOVE_SPEED = 5;
const SPRINT_MULTIPLIER = 1.6;
const PLAYER_RADIUS = 0.4;
const MOUSE_SENSITIVITY = 0.0025;
const PLAYER_HEIGHT = 1.7;
const BOB_FREQUENCY = 9; // cycles/sec while moving at full speed
const BOB_AMPLITUDE = 0.06;
const SWING_DURATION_MS = 220;
// Tuned so a jump clears roughly two thirds of the player's height and lands
// in a little under half a second — the snappy, low-float arc this genre uses,
// rather than a floaty moon-jump.
const GRAVITY = 22;
const JUMP_SPEED = 7;
// Stamina: a full bar buys roughly five seconds of sprinting or six jumps, and
// refills in about seven seconds once you stop. Long enough that sprinting is
// a decision, short enough that it never strands you.
const SPRINT_DRAIN_PER_SEC = 20;
const JUMP_COST = 15;
const REGEN_PER_SEC = 14;
const REGEN_DELAY_MS = 700;
// Once emptied, stamina must climb back to this before sprinting is available
// again — without it, running on empty degenerates into stutter-sprinting one
// frame at a time.
const SPRINT_RECOVERY_THRESHOLD = 25;
// Animation clips shipped with the character model, mapped to states the game
// already tracks. Anything missing simply never plays, so a model without a
// given clip degrades rather than throwing.
const CLIP_IDLE = "idle";
const CLIP_WALK = "walk";
const CLIP_SPRINT = "sprint";
const CLIP_JUMP = "jump";
const CLIP_FALL = "fall";
const CLIP_ATTACK = "attack-melee-right";
const CLIP_DIE = "die";
const CROSSFADE_SECONDS = 0.16;

export class PlayerController {
  readonly object: THREE.Group;
  /** Present only when falling back to the procedural figure. */
  private readonly body: THREE.Mesh | null = null;
  private readonly weapon: THREE.Mesh | null = null;
  private readonly mixer: THREE.AnimationMixer | null = null;
  private readonly actions = new Map<string, THREE.AnimationAction>();
  private currentClip = "";
  private oneShotUntilMs = -Infinity;
  private sprintingNow = false;
  private bobPhase = 0;
  private swingStartMs = -Infinity;
  private velocityY = 0;
  private grounded = true;
  private lastStaminaSpendMs = -Infinity;
  private sprintLocked = false;
  private lastStepIndex = -1;
  private lastKnownNowMs = 0;

  constructor(
    private readonly state: GameState,
    private readonly terrain: Terrain,
    models: ModelLibrary = {},
  ) {
    this.object = new THREE.Group();

    const character = models["character-archer"];
    if (character) {
      const rig = instantiate(character);
      this.object.add(rig);
      // The mixer drives the model's own rig, so the head-bob and the hand-made
      // weapon prop below are not created at all — the animations already carry
      // the gait and the swing, and layering ours on top would fight them.
      this.mixer = new THREE.AnimationMixer(rig);
      for (const clip of character.animations) {
        this.actions.set(clip.name, this.mixer.clipAction(clip));
      }
      this.playClip(CLIP_IDLE);
      this.bindDeathAnimations();
      this.syncObjectFromState();
      return;
    }

    this.body = new THREE.Mesh(
      buildFigureGeometry({
        height: PLAYER_HEIGHT,
        palette: { skin: 0xe0a878, torso: 0xc26a3c, legs: 0x574232, accent: 0x8a5a2b },
      }),
      createFigureMaterial(),
    );
    this.body.castShadow = true;
    this.body.receiveShadow = true;
    this.object.add(this.body);

    // A simple held-item indicator that swings on attack/place — purely
    // cosmetic feedback, independent of the range-based hit logic.
    this.weapon = new THREE.Mesh(
      merge([
        placed(paint(new THREE.BoxGeometry(0.05, 0.05, 0.62), 0x6b4a32), 0, 0, 0.05),
        placed(paint(new THREE.BoxGeometry(0.13, 0.05, 0.2), 0xcfd4dc), 0, 0, 0.42),
      ]),
      createFigureMaterial(),
    );
    this.weapon.castShadow = true;
    this.weapon.position.set(0.3, PLAYER_HEIGHT * 0.55, 0.16);
    this.object.add(this.weapon);

    this.syncObjectFromState();
  }

  // Kicks off the cosmetic swing animation; called by main.ts whenever the
  // player attacks or places a building.
  triggerSwing(nowMs: number): void {
    this.swingStartMs = nowMs;
    this.playOneShot(CLIP_ATTACK, nowMs);
  }

  // Exposed for headless verification (see window.__gameDebug in main.ts):
  // which clip is playing is otherwise invisible from outside.
  getAnimationState(): { clip: string; clips: number; skinned: number } {
    let skinned = 0;
    this.object.traverse((child) => {
      if ((child as THREE.SkinnedMesh).isSkinnedMesh) skinned++;
    });
    return { clip: this.currentClip, clips: this.actions.size, skinned };
  }

  // A scalar fingerprint of every bone's local position. Verification uses it
  // to prove the rig is genuinely being animated: the clip name alone only
  // says what this class *intended* to play, which would still look right if
  // the skeleton were mis-bound and the mesh never moved.
  getRigFingerprint(): number {
    let sum = 0;
    this.object.traverse((child) => {
      if ((child as THREE.Bone).isBone) {
        sum += child.position.x + child.position.y + child.position.z;
      }
    });
    return sum;
  }

  // Crossfades to a looping clip. A no-op if it's already playing or the model
  // doesn't ship that clip.
  private playClip(name: string): void {
    if (this.currentClip === name) return;
    const next = this.actions.get(name);
    if (!next) return;
    const previous = this.actions.get(this.currentClip);
    next.reset().setLoop(THREE.LoopRepeat, Infinity).fadeIn(CROSSFADE_SECONDS).play();
    if (previous) previous.fadeOut(CROSSFADE_SECONDS);
    this.currentClip = name;
  }

  // Plays a clip once and holds the state machine off until it finishes, so an
  // attack isn't cut short by a single frame of standing still.
  private playOneShot(name: string, nowMs: number): void {
    const action = this.actions.get(name);
    if (!action) return;
    const previous = this.actions.get(this.currentClip);
    action.reset().setLoop(THREE.LoopOnce, 1).play();
    action.clampWhenFinished = true;
    action.fadeIn(0.05);
    if (previous && previous !== action) previous.fadeOut(0.05);
    this.currentClip = name;
    this.oneShotUntilMs = nowMs + action.getClip().duration * 1000;
  }

  private bindDeathAnimations(): void {
    events.on("player-died", () => {
      this.playOneShot(CLIP_DIE, this.lastKnownNowMs);
      // Hold the death pose until respawn rather than for the clip's length.
      this.oneShotUntilMs = Infinity;
    });
    events.on("player-respawned", () => {
      this.oneShotUntilMs = -Infinity;
      this.currentClip = "";
      this.playClip(CLIP_IDLE);
    });
  }

  // Picks the looping clip that matches what the player is actually doing.
  private updateAnimation(dt: number, nowMs: number, isMoving: boolean): void {
    if (!this.mixer) return;
    this.mixer.update(dt);
    if (nowMs < this.oneShotUntilMs) return;

    if (!this.grounded) {
      this.playClip(this.velocityY > 0 ? CLIP_JUMP : CLIP_FALL);
    } else if (isMoving) {
      this.playClip(this.sprintingNow ? CLIP_SPRINT : CLIP_WALK);
    } else {
      this.playClip(CLIP_IDLE);
    }
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

    this.lastKnownNowMs = nowMs;
    const isMoving = move.lengthSq() > 0.0001;
    const sprinting = this.updateSprintState(dt, nowMs, input.isSprinting() && isMoving);
    this.sprintingNow = sprinting;
    const speed = MOVE_SPEED * (sprinting ? SPRINT_MULTIPLIER : 1);
    let { x, z } = this.state.player;
    if (isMoving) {
      x += move.x * speed * dt;
      z += move.z * speed * dt;
      this.state.player.yaw = Math.atan2(move.x, move.z);
    }

    const resolved = resolveCollisions(x, z, PLAYER_RADIUS, collidables);
    this.state.player.x = resolved.x;
    this.state.player.z = resolved.z;
    this.updateVertical(dt, nowMs, input, this.terrain.heightAt(resolved.x, resolved.z));

    this.regenStamina(dt, nowMs);
    this.syncObjectFromState();
    // The bob phase always advances because footsteps are derived from it;
    // whether it also moves the mesh depends on which body is in use.
    this.updateBob(dt, isMoving && this.grounded);
    this.updateSwing(nowMs);
    this.updateAnimation(dt, nowMs, isMoving);
  }

  // Returns whether the player is actually sprinting this frame, which is only
  // true when they asked for it and have the stamina to pay.
  private updateSprintState(dt: number, nowMs: number, wants: boolean): boolean {
    const player = this.state.player;
    if (this.sprintLocked && player.stamina >= SPRINT_RECOVERY_THRESHOLD) {
      this.sprintLocked = false;
    }
    if (!wants || this.sprintLocked || player.stamina <= 0) return false;

    this.spendStamina(SPRINT_DRAIN_PER_SEC * dt, nowMs);
    if (player.stamina <= 0) {
      this.sprintLocked = true;
      events.emit("player-exhausted", {});
    }
    return true;
  }

  private spendStamina(amount: number, nowMs: number): void {
    const player = this.state.player;
    player.stamina = Math.max(0, player.stamina - amount);
    this.lastStaminaSpendMs = nowMs;
    events.emit("player-stamina-changed", { current: player.stamina, max: player.maxStamina });
  }

  // Regen holds off briefly after the last exertion, so tapping sprint doesn't
  // top the bar straight back up.
  private regenStamina(dt: number, nowMs: number): void {
    const player = this.state.player;
    if (player.stamina >= player.maxStamina) return;
    if (nowMs - this.lastStaminaSpendMs < REGEN_DELAY_MS) return;
    player.stamina = Math.min(player.maxStamina, player.stamina + REGEN_PER_SEC * dt);
    events.emit("player-stamina-changed", { current: player.stamina, max: player.maxStamina });
  }

  // Space jumps, gravity brings you back, and the terrain height is the floor.
  // Only the visual/camera height moves: gathering, building and combat all
  // test x/z distance, so being mid-air never changes what you can reach.
  private updateVertical(dt: number, nowMs: number, input: InputManager, groundY: number): void {
    if (this.grounded && input.wasActionPressed("jump")) {
      // A jump you can't pay for simply doesn't happen — no half-height hop.
      if (this.state.player.stamina >= JUMP_COST) {
        this.spendStamina(JUMP_COST, nowMs);
        this.velocityY = JUMP_SPEED;
        this.grounded = false;
        events.emit("player-jumped", {});
      } else {
        events.emit("player-exhausted", {});
      }
    }

    if (this.grounded) {
      // Walking over uneven ground follows the surface directly; applying
      // gravity here would leave the player permanently falling down slopes.
      this.state.player.y = groundY;
      return;
    }

    this.velocityY -= GRAVITY * dt;
    const y = this.state.player.y + this.velocityY * dt;
    if (y <= groundY) {
      this.state.player.y = groundY;
      this.velocityY = 0;
      this.grounded = true;
      events.emit("player-landed", {});
    } else {
      this.state.player.y = y;
    }
  }

  // Cosmetic head-bob while walking — offsets the body mesh only, never the
  // group position the rest of the game reads as the player's actual
  // location, so it can't perturb collision/gathering/combat ranges.
  private updateBob(dt: number, isMoving: boolean): void {
    if (isMoving) {
      this.bobPhase += dt * BOB_FREQUENCY * Math.PI * 2;
      // One footstep per half bob cycle — the bob already models the gait, so
      // deriving steps from it keeps sound and motion in phase by construction
      // rather than by two timers that drift apart.
      const step = Math.floor(this.bobPhase / Math.PI);
      if (step !== this.lastStepIndex) {
        this.lastStepIndex = step;
        events.emit("player-footstep", {});
      }
    } else {
      this.bobPhase = 0;
      this.lastStepIndex = -1;
    }
    // The figure geometry is modelled feet-up from y=0, so the bob is the
    // body's whole vertical offset rather than an adjustment to a centre. The
    // rigged model animates its own gait, so it is left alone.
    if (!this.body) return;
    const bob = isMoving ? Math.abs(Math.sin(this.bobPhase)) * BOB_AMPLITUDE : 0;
    this.body.position.y = bob;
  }

  private updateSwing(nowMs: number): void {
    if (!this.weapon) return;
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
