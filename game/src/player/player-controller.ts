import * as THREE from "three";
import type { GameState } from "../state/game-state";
import type { InputManager } from "../input/input-manager";
import type { ThirdPersonCamera } from "../core/camera";
import type { BoundedGround } from "../world/terrain";
import { resolveCollisions, type Collidable } from "../utils/collision";
import { clampToExtent } from "../world/terrain";
import { events } from "../utils/events";
import { buildFigureGeometry, createFigureMaterial } from "../world/figures";
import { HeldItem } from "../world/held-item";
import { Wings } from "../world/wings";
import { Lantern } from "../world/lantern";
import { merge, paint, placed } from "../world/geometry";
import { instantiate, type ModelLibrary } from "../world/models";
import { speedScale, staminaRegenScale } from "../data/stats";
import { canFly, flightCeiling } from "../data/worn";

const MOVE_SPEED = 5;
const SPRINT_MULTIPLIER = 1.6;
export const PLAYER_RADIUS = 0.4;
/**
 * How far inside the terrain's own edge the player is stopped.
 *
 * Wider than `PLAYER_RADIUS`, which is only what the collision circle needs:
 * the drawn body is broader than its collision circle, and standing with the
 * mesh's last quad under your heels reads as teetering on a lip rather than as
 * having reached the end of the world. Picked by walking to the edge and
 * looking at it, not by arithmetic.
 */
const PLAYER_EDGE_MARGIN = 3;
const MOUSE_SENSITIVITY = 0.0025;
const PLAYER_HEIGHT = 1.7;
const BOB_FREQUENCY = 9; // cycles/sec while moving at full speed
const BOB_AMPLITUDE = 0.06;
const SWING_DURATION_MS = 220;
// Tuned so a jump clears roughly two thirds of the player's height and lands
// in a little under half a second — the snappy, low-float arc this genre uses,
// rather than a floaty moon-jump.
/**
 * How far the ground can drop under your feet before you are falling.
 *
 * Generous on purpose. The overworld's steepest hills fall about a unit per
 * unit travelled, and a sprinting player covers 0.8 units in the loop's
 * longest frame — so anything much under this would have the player
 * "stepping off" a hillside. Anything a rampart or a floating island's edge
 * drops is far past it.
 */
const STEP_DOWN = 1.5;

const GRAVITY = 22;
const JUMP_SPEED = 7;
/**
 * Flight, in the creative-mode idiom: double-tap jump to toggle, jump to rise,
 * sprint to sink, and no gravity in between.
 *
 * `FLY_SPEED` is a little under a sprint so that going up never outruns going
 * along — climbing should feel like part of the same movement, not a separate
 * and faster one. The tap window is the usual double-click sort of interval:
 * short enough that two deliberate jumps in a row do not trip it, long enough
 * to hit on purpose.
 */
const FLY_SPEED = 7;
const FLY_TAP_WINDOW_MS = 300;
/**
 * How close to the ground counts as having landed, and so as having stopped
 * flying. A hair above the floor rather than exactly on it: settling to
 * *exactly* groundY while still airborne is the state that fires the landing
 * sound every frame.
 */
const FLY_LAND_EPSILON = 0.05;
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

/**
 * Anything the player can stand on that is not the ground itself.
 *
 * One method, because that is the whole of what the movement code needs to
 * know: given a point, how high is the surface here, or null for open ground.
 * `BuildingSystem` is the only implementer today.
 */
export interface Standables {
  topAt(x: number, z: number): number | null;
}

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
  /** In creative-style flight: no gravity, jump rises, sprint sinks. */
  private flying = false;
  /** When jump was last tapped, so a second tap inside the window toggles. */
  private lastJumpTapMs = -Infinity;
  private lastStaminaSpendMs = -Infinity;
  private sprintLocked = false;
  private lastStepIndex = -1;
  private lastKnownNowMs = 0;
  private readonly heldItem = new HeldItem();
  private readonly wings = new Wings();
  private readonly lantern = new Lantern();

  constructor(
    private readonly state: GameState,
    private readonly terrain: BoundedGround,
    models: ModelLibrary = {},
    /** Surfaces built on top of the ground. Absent in tests that only walk. */
    private readonly standables: Standables | null = null,
  ) {
    this.object = new THREE.Group();
    // The held item rides the character root, not a bone: the pack's rig has
    // no hand. See world/held-item.ts for why that turned out to matter.
    this.heldItem.attachTo(this.object);
    this.wings.attachTo(this.object);
    this.lantern.attachTo(this.object);

    const character = models["character-archer"];
    if (character) {
      const rig = instantiate(character);
      this.object.add(rig);

      // The mixer drives the model's own rig, so the head-bob below is not
      // applied — the animations already carry the gait, and layering ours on
      // top would fight them.
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

    // The un-rigged fallback body has no arm bone to hang anything from, so it
    // keeps the old generic prop: better a stand-in that swings than an empty
    // fist, on a path that only runs when the model failed to load at all.
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

  /** Puts an item in the character's hand, or empties it for null. */
  /** Puts the wings on the character's back, or takes them off. */
  setWingsVisible(visible: boolean): void {
    this.wings.setVisible(visible);
  }

  /** Whether the wings are actually on the mesh, for tests. */
  areWingsVisible(): boolean {
    return this.wings.isVisible();
  }

  /**
   * Sets how far the worn lamp reaches. Zero takes it off.
   *
   * Mirrors `setWingsVisible`: the back slot decides whether wings are on the
   * character, and the trinket slot decides whether the lamp is.
   */
  setLanternRadius(radius: number): void {
    this.lantern.setRadius(radius);
  }

  /** What the lamp on the mesh actually reaches, for tests. 0 when unlit. */
  getLanternRadius(): number {
    return this.lantern.getRadius();
  }

  /** Whether the lamp is really on the character, not merely in the save. */
  isLanternLit(): boolean {
    return this.lantern.isLit();
  }

  setHeldItem(itemId: string | null): void {
    this.heldItem.show(itemId);
  }

  /** Retunes where the fist sits; the offset is re-solved next frame. */
  setFistOffset(x: number, y: number, z: number): void {
    this.heldItem.setFist(x, y, z);
  }

  /** The grip node, for testing whether the body occludes what it holds. */
  getGripObject(): THREE.Object3D | null {
    return this.heldItem.gripObject();
  }

  /** What the hand is actually showing — for headless verification. */
  getHeldItem(): {
    itemId: string | null;
    attached: boolean;
    hasMesh: boolean;
    world: [number, number, number];
    aboveFeet: number;
    axis: [number, number, number];
  } {
    const world = this.heldItem.worldPosition(new THREE.Vector3());
    const axis = this.heldItem.worldAxis(new THREE.Vector3());
    return {
      itemId: this.heldItem.heldId(),
      attached: this.heldItem.isAttached(),
      hasMesh: this.heldItem.hasMesh(),
      world: [world.x, world.y, world.z],
      aboveFeet: world.y - this.state.player.y,
      axis: [axis.x, axis.y, axis.z],
    };
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

    if (this.flying) {
      // Not `fall`. A player who is flying is not falling, and the falling
      // clip played for as long as they stayed up — which is most of the time
      // the wings are worn. `jump` is the rig's other airborne pose and reads
      // as held rather than as plummeting; picked by looking at both in the
      // browser, not by reading the clip names.
      this.playClip(CLIP_JUMP);
    } else if (!this.grounded) {
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

  /**
   * The one place the player's ground position is written.
   *
   * Both callers — the movement step and the debug teleport — go through here
   * so the world's edge is enforced on the path everything takes, rather than
   * sprinkled at each call site where the next one added would quietly miss
   * it. Returns where the body actually ended up, because that is not always
   * where the caller asked for.
   *
   * `y` is deliberately not set here: the movement path owns it through
   * `updateVertical` (jumping, falling), and teleport wants the ground.
   */
  private setGroundPosition(x: number, z: number): { x: number; z: number } {
    // The edge asked for is whichever place the player is standing in — the
    // overworld's, or the wall of the cave they walked into.
    const extent = this.terrain.halfExtent;
    this.state.player.x = clampToExtent(x, extent, PLAYER_EDGE_MARGIN);
    this.state.player.z = clampToExtent(z, extent, PLAYER_EDGE_MARGIN);
    return { x: this.state.player.x, z: this.state.player.z };
  }

  /**
   * The height of whatever is underfoot: the ground, or something standing on
   * it. Taking the higher of the two is all "you can walk up a rampart" needs
   * — walking *up* already worked, because a grounded body follows its floor;
   * walking back off it is what `STEP_DOWN` above had to be taught.
   */
  private surfaceAt(x: number, z: number): number {
    const ground = this.terrain.heightAt(x, z);
    const top = this.standables?.topAt(x, z) ?? null;
    return top !== null && top > ground ? top : ground;
  }

  // Debug/testing-only teleport (see window.__gameDebug in main.ts) — not used
  // by normal gameplay input handling. Clamped like any other move: a debug
  // hook that could put the player somewhere the game cannot is a hook that
  // tests things the game will never do.
  teleport(x: number, z: number): void {
    const at = this.setGroundPosition(x, z);
    this.state.player.y = this.surfaceAt(at.x, at.z);
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
    // Sprint is the "descend" key while flying, so it must not also be read as
    // a sprint: left in, holding it to come down would drain the bar and, once
    // the bar emptied, fire the exhausted sound on the way to the ground.
    const sprinting = this.updateSprintState(
      dt,
      nowMs,
      input.isSprinting() && isMoving && !this.flying,
    );
    this.sprintingNow = sprinting;
    const speed = MOVE_SPEED * (sprinting ? SPRINT_MULTIPLIER : 1) * speedScale(this.state);
    let { x, z } = this.state.player;
    if (isMoving) {
      x += move.x * speed * dt;
      z += move.z * speed * dt;
      this.state.player.yaw = Math.atan2(move.x, move.z);
    }

    const resolved = resolveCollisions(x, z, PLAYER_RADIUS, collidables);
    const at = this.setGroundPosition(resolved.x, resolved.z);
    this.updateVertical(dt, nowMs, input, this.surfaceAt(at.x, at.z));

    this.regenStamina(dt, nowMs);
    this.syncObjectFromState();
    // The bob phase always advances because footsteps are derived from it;
    // whether it also moves the mesh depends on which body is in use.
    this.updateBob(dt, isMoving && this.grounded);
    this.updateSwing(nowMs);
    this.wings.update(nowMs, this.flying);
    this.lantern.update(nowMs);
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
    player.stamina = Math.min(
      player.maxStamina,
      player.stamina + REGEN_PER_SEC * staminaRegenScale(this.state) * dt,
    );
    events.emit("player-stamina-changed", { current: player.stamina, max: player.maxStamina });
  }

  // Space jumps, gravity brings you back, and the terrain height is the floor.
  // Only the visual/camera height moves: gathering, building and combat all
  // test x/z distance, so being mid-air never changes what you can reach.
  private updateVertical(dt: number, nowMs: number, input: InputManager, groundY: number): void {
    // Wings taken off in mid-air drop you. Checked before anything else so
    // there is no frame in which the player is flying without the thing that
    // lets them — including after a load, where `flying` starts false anyway.
    if (this.flying && !canFly(this.state)) this.flying = false;

    if (input.wasActionPressed("jump") && canFly(this.state)) {
      // Double-tap toggles, the way the creative mode this borrows from does
      // it. Deliberately *before* the ordinary jump below, but not instead of
      // it: the first tap still jumps, so a player who taps twice slowly gets
      // two normal jumps rather than nothing.
      if (nowMs - this.lastJumpTapMs <= FLY_TAP_WINDOW_MS) {
        this.flying = !this.flying;
        this.lastJumpTapMs = -Infinity;
        if (this.flying) {
          this.grounded = false;
          this.velocityY = 0;
        }
      } else {
        this.lastJumpTapMs = nowMs;
      }
    }

    if (this.flying) {
      this.updateFlight(dt, input, groundY);
      return;
    }

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
      // Ground that has dropped away by more than a step is not ground you
      // are standing on — it is a ledge you have just walked off.
      //
      // Without this, `player.y = groundY` teleports the body down the drop,
      // whatever its size. That was invisible while the only surface was
      // terrain, which never falls away faster than you can walk. It is the
      // same bug at the edge of a floating island and at the side of a
      // rampart, and this is the one line that answers both.
      if (this.state.player.y - groundY > STEP_DOWN) {
        this.grounded = false;
        this.velocityY = 0;
      } else {
        // Walking over uneven ground follows the surface directly; applying
        // gravity here would leave the player permanently falling down slopes.
        this.state.player.y = groundY;
        return;
      }
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

  /**
   * One frame of flight: no gravity, jump rises, sprint sinks.
   *
   * The ceiling is measured from the ground underfoot rather than from a fixed
   * altitude, and that is the whole reason it is computed here from `groundY`
   * rather than stored: flying over a hill should carry you over it, not into
   * it, and a fixed altitude would put the ceiling somewhere different
   * depending on where you took off.
   */
  private updateFlight(dt: number, input: InputManager, groundY: number): void {
    const ceiling = groundY + flightCeiling(this.state);
    let y = this.state.player.y;
    if (input.isActionDown("jump")) y += FLY_SPEED * dt;
    // Sprint means "down" while flying. It costs no stamina here — see
    // `updateSprintState`, which is told not to treat it as a sprint at all.
    if (input.isSprinting()) y -= FLY_SPEED * dt;

    if (y <= groundY + FLY_LAND_EPSILON) {
      // Touching down ends flight, as it does in the mode this borrows from.
      // Going through the same landing path as a fall keeps `grounded`, the
      // animation and the sound all in agreement — and the epsilon above is
      // what stops a player hovering at exactly ground level from re-landing,
      // and re-playing the landing sound, on every frame.
      this.state.player.y = groundY;
      this.velocityY = 0;
      this.flying = false;
      if (!this.grounded) {
        this.grounded = true;
        events.emit("player-landed", {});
      }
      return;
    }

    this.state.player.y = Math.min(y, ceiling);
    this.velocityY = 0;
    this.grounded = false;
  }

  /** Whether the player is currently flying, for the HUD and for tests. */
  isFlying(): boolean {
    return this.flying;
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

  // Swings whatever is in hand. This was dead for as long as the rigged model
  // loaded — it only ever drove the fallback prop — and now carries the real
  // held item, which the rig cannot swing for us.
  private updateSwing(nowMs: number): void {
    this.heldItem.update(nowMs, this.swingStartMs);
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
