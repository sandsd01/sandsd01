import * as THREE from "three";

const MIN_PITCH = -0.65;
const MAX_PITCH = 1.1;
const MIN_DISTANCE = 3;
const MAX_DISTANCE = 10;
const ZOOM_SPEED = 0.0015;

// Third-person follow camera: orbits a target position at a given yaw/pitch/distance,
// with a simple raycast-based pullback so it doesn't clip through terrain/objects.
export class ThirdPersonCamera {
  readonly camera: THREE.PerspectiveCamera;
  yaw = 0;
  pitch = 0.28;
  distance = 8;

  private raycaster = new THREE.Raycaster();

  constructor() {
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

    window.addEventListener(
      "wheel",
      (e) => {
        this.distance = THREE.MathUtils.clamp(
          this.distance + e.deltaY * ZOOM_SPEED * this.distance,
          MIN_DISTANCE,
          MAX_DISTANCE,
        );
      },
      { passive: true },
    );
  }

  addYawPitch(deltaYaw: number, deltaPitch: number): void {
    this.yaw -= deltaYaw;
    this.pitch = THREE.MathUtils.clamp(this.pitch - deltaPitch, MIN_PITCH, MAX_PITCH);
  }

  update(target: THREE.Vector3, collidables: THREE.Object3D[]): void {
    const offset = new THREE.Vector3(
      Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      Math.cos(this.yaw) * Math.cos(this.pitch),
    );

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
    this.camera.lookAt(target.clone().add(new THREE.Vector3(0, 1, 0)));
  }

  getForward(): THREE.Vector3 {
    return new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).normalize();
  }

  getRight(): THREE.Vector3 {
    return new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw)).normalize();
  }
}
