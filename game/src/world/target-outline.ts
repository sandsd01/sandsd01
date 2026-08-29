import * as THREE from "three";

// The wireframe box drawn around whatever the crosshair is on — the same
// affordance Minecraft uses for the targeted block, and the clearest way to
// say "this is what you would act on" without a post-processing outline pass.
//
// One reusable object that is moved and rescaled each frame rather than one
// per candidate: only ever a single thing is targeted.
export class TargetOutline {
  readonly object: THREE.LineSegments;
  private readonly box = new THREE.Box3();
  private readonly size = new THREE.Vector3();
  private readonly centre = new THREE.Vector3();

  constructor() {
    // A unit cube's edges, scaled to the target's bounding box each frame.
    const geometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
    const material = new THREE.LineBasicMaterial({
      color: 0x0a0a0a,
      transparent: true,
      opacity: 0.85,
      // Drawn over the target rather than z-fighting with its surface.
      depthTest: false,
    });
    this.object = new THREE.LineSegments(geometry, material);
    this.object.visible = false;
    this.object.renderOrder = 10;
    // Purely a UI overlay: casting or receiving shadows would put a cage of
    // dark lines on the ground.
    this.object.castShadow = false;
    this.object.receiveShadow = false;
    this.object.frustumCulled = false;
  }

  hide(): void {
    this.object.visible = false;
  }

  // Wraps the object's world-space bounding box, padded slightly so the lines
  // sit just clear of the surface instead of inside it.
  surround(target: THREE.Object3D): void {
    this.box.setFromObject(target);
    if (this.box.isEmpty()) {
      this.hide();
      return;
    }
    this.box.getSize(this.size);
    this.box.getCenter(this.centre);
    this.object.position.copy(this.centre);
    this.object.scale.set(this.size.x + 0.06, this.size.y + 0.06, this.size.z + 0.06);
    this.object.visible = true;
  }
}
