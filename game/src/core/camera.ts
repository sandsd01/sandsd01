import * as THREE from "three";
import type { Settings } from "../state/settings";

const MIN_PITCH = -0.65;
const MAX_PITCH = 1.1;
// First person can look much further up and down: there is no character body
// in the way, and craning at the sky or straight down at a plot is normal.
const FP_MIN_PITCH = -1.45;
const FP_MAX_PITCH = 1.45;
const MIN_DISTANCE = 2.5;
const MAX_DISTANCE = 16;
const ZOOM_SPEED = 0.0015;

// Follow camera: orbits a target position at a given yaw/pitch/distance, with a
// simple raycast-based pullback so it doesn't clip through terrain/objects, and
// a first-person mode that drops the orbit and sits at the target instead.
export class ThirdPersonCamera {
  readonly camera: THREE.PerspectiveCamera;
  yaw = 0;
  pitch = 0.28;
  distance = 8;
  firstPerson = false;

  private raycaster = new THREE.Raycaster();

  constructor(private readonly settings: Settings) {
    this.camera = new THREE.PerspectiveCamera(
      65,
      window.innerWidth / window.innerHeight,
      0.1,
      500,
    );
    window.addEventListener("resize", () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
    });
  }

  // Driven by main.ts from the wheel (behind Ctrl, since a bare scroll cycles
  // the build hotbar as it does in Minecraft).
  zoomBy(deltaY: number): void {
    this.distance = THREE.MathUtils.clamp(
      this.distance + deltaY * ZOOM_SPEED * this.distance,
      MIN_DISTANCE,
      MAX_DISTANCE,
    );
  }

  toggleFirstPerson(): boolean {
    this.firstPerson = !this.firstPerson;
    // Re-clamp: a pitch valid in first person can be outside the third-person
    // range, which would otherwise snap the view on the way back.
    this.pitch = THREE.MathUtils.clamp(this.pitch, this.minPitch(), this.maxPitch());
    return this.firstPerson;
  }

  private minPitch(): number {
    return this.firstPerson ? FP_MIN_PITCH : MIN_PITCH;
  }

  private maxPitch(): number {
    return this.firstPerson ? FP_MAX_PITCH : MAX_PITCH;
  }

  addYawPitch(deltaYaw: number, deltaPitch: number): void {
    // Both axes scale by the player's sensitivity setting; only pitch can be
    // inverted, matching how every game in this genre offers the option.
    const gain = this.settings.mouseSensitivity;
    this.yaw -= deltaYaw * gain;
    // Moving the mouse down should look down (non-inverted convention):
    // deltaPitch is positive when the mouse moves down, and increasing
    // pitch raises the camera above the target so it tilts its view
    // downward to keep looking at it — so pitch must increase, not decrease,
    // when the mouse moves down.
    const pitchDelta = (this.settings.invertY ? -deltaPitch : deltaPitch) * gain;
    this.pitch = THREE.MathUtils.clamp(
      this.pitch + pitchDelta,
      this.minPitch(),
      this.maxPitch(),
    );
  }

  update(target: THREE.Vector3, collidables: THREE.Object3D[]): void {
    const offset = new THREE.Vector3(
      Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      Math.cos(this.yaw) * Math.cos(this.pitch),
    );

    if (this.firstPerson) {
      // Sit at the eye point and look the way the orbit would have looked from,
      // so yaw and pitch mean exactly the same thing in both modes and toggling
      // never swings the view.
      this.camera.position.copy(target);
      this.camera.lookAt(target.clone().sub(offset));
      return;
    }

    let distance = this.distance;
    if (collidables.length > 0) {
      this.raycaster.set(target, offset.clone().negate().normalize());
      const hits = this.raycaster.intersectObjects(collidables, false);
      if (hits.length > 0 && hits[0].distance < distance) {
        distance = Math.max(MIN_DISTANCE, hits[0].distance - 0.3);
      }
    }
    distance = THREE.MathUtils.clamp(distance, MIN_DISTANCE, MAX_DISTANCE);

    const camPos = target.clone().addScaledVector(offset, distance);
    this.camera.position.copy(camPos);
    // Look at the orbit centre itself, not a point above it. Aiming the camera
    // higher than it orbits framed the character nicely but put the crosshair
    // off the player's own line of sight — it pointed over their head and
    // landed on ground a dozen units away, so nothing nearby could ever be
    // targeted. The crosshair has to mean "along the way you're facing".
    this.camera.lookAt(target);
  }

  getForward(): THREE.Vector3 {
    return new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).normalize();
  }

  getRight(): THREE.Vector3 {
    return new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw)).normalize();
  }
}
