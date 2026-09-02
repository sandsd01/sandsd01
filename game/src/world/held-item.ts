import * as THREE from "three";
import { getItem } from "../data/items";
import { createFigureMaterial } from "./figures";
import { merge, paint, placed } from "./geometry";

// The thing in the player's hand.
//
// The character rig has no hand bone. `character-archer.glb` carries seven
// joints — root, both legs, torso, both arms, head — and `arm-right` is a
// *leaf* whose origin sits at the shoulder. Parenting to it was tried first
// and abandoned: an offset far enough down the arm to clear the torso rides an
// arc as the arm animates and swings straight back inside the body. A sweep of
// offsets against the real model (camera-ray occlusion test, four angles)
// found no position that stays visible.
//
// So the item hangs off the character root at a fixed spot beside the body and
// swings on attack under its own power. It does not track the arm through the
// walk cycle — the honest trade for something you can actually see, on a chibi
// model whose arms are stubs. This is also what the codebase's original
// fallback prop did; `updateSwing` was written for it and had gone dead.

// All measurements below are in **world units**, on a character 1.7 tall.
// The rig is normalised by ~2.07x (models.ts#normalise), so authoring in the
// bone's own units silently multiplied every size — a 0.44 haft came out 0.9
// long, over half the character's height. The grip undoes that scale once so
// everything here can be read against the character.

// Where the item rides, in the character's own space: out beside the right
// hand, at hand height, held a little forward of the chest. Solved against the
// model with the occlusion sweep rather than guessed.
const FIST = new THREE.Vector3(-0.38, 0.55, 0.34);
const fist = FIST.clone();

// Tilt of the haft: down and forward, a carried-ready pose rather than
// shouldered.
const REST_PITCH = Math.PI * 0.28;

// The attack arc, reusing the shape the original prop swung through.
const SWING_MS = 260;

type Shape = "axe" | "pickaxe" | "sword" | "bow";

const SHAPES: Record<string, Shape> = {
  axe: "axe",
  iron_axe: "axe",
  pickaxe: "pickaxe",
  iron_pickaxe: "pickaxe",
  sword: "sword",
  iron_sword: "sword",
  bow: "bow",
};

const HAFT = 0x6b4a32;

// Silhouette is what reads at this size — a wedge, a spike, a blade — with the
// item's own colour from data/items.ts carrying the tier.
function buildGeometry(shape: Shape, head: number): THREE.BufferGeometry {
  switch (shape) {
    case "axe":
      return merge([
        placed(paint(new THREE.BoxGeometry(0.045, 0.045, 0.42), HAFT), 0, 0, 0.1),
        placed(paint(new THREE.BoxGeometry(0.16, 0.045, 0.17), head), 0.06, 0, 0.29),
      ]);
    case "pickaxe":
      return merge([
        placed(paint(new THREE.BoxGeometry(0.045, 0.045, 0.42), HAFT), 0, 0, 0.1),
        placed(paint(new THREE.BoxGeometry(0.38, 0.045, 0.055), head), 0, 0, 0.31),
      ]);
    case "sword":
      return merge([
        placed(paint(new THREE.BoxGeometry(0.045, 0.045, 0.14), HAFT), 0, 0, -0.02),
        placed(paint(new THREE.BoxGeometry(0.17, 0.04, 0.045), head), 0, 0, 0.07),
        placed(paint(new THREE.BoxGeometry(0.07, 0.028, 0.46), head), 0, 0, 0.32),
      ]);
    case "bow": {
      // A stave stepped into a shallow arc plus a pale string across the ends.
      // A curve is what tells a bow apart from a staff at this size, and three
      // straight segments read as one from any distance the game is played at.
      const string = 0xe8e0cc;
      return merge([
        placed(paint(new THREE.BoxGeometry(0.05, 0.05, 0.34), head), 0.05, 0, 0),
        placed(paint(new THREE.BoxGeometry(0.045, 0.045, 0.2), head), 0.02, 0, 0.24),
        placed(paint(new THREE.BoxGeometry(0.045, 0.045, 0.2), head), 0.02, 0, -0.24),
        placed(paint(new THREE.BoxGeometry(0.012, 0.012, 0.66), string), -0.04, 0, 0),
      ]);
    }
  }
}

/**
 * Holds whichever item mesh belongs in the hand, swapping it as the player
 * changes what they carry. Meshes are built once per item and reused, since
 * cycling the hotbar would otherwise rebuild geometry every keypress.
 */
export class HeldItem {
  private readonly cache = new Map<string, THREE.Object3D>();
  private grip: THREE.Object3D | null = null;
  private currentId: string | null = null;

  /**
   * Hangs the grip off the character root. Unlike a bone attachment this is in
   * the character's own space, so the offsets above read directly against a
   * 1.7-unit character and nothing has to undo the rig's normalisation.
   */
  attachTo(root: THREE.Object3D): boolean {
    const grip = new THREE.Group();
    grip.position.copy(fist);
    grip.rotation.x = REST_PITCH;
    root.add(grip);
    this.grip = grip;
    return true;
  }

  /** Drives the attack arc. `startMs` is when the swing began. */
  update(nowMs: number, swingStartMs: number): void {
    if (!this.grip) return;
    const elapsed = nowMs - swingStartMs;
    if (elapsed < 0 || elapsed >= SWING_MS) {
      this.grip.rotation.x = REST_PITCH;
      return;
    }
    // Out and back, peaking mid-swing.
    this.grip.rotation.x = REST_PITCH - Math.sin((elapsed / SWING_MS) * Math.PI) * 1.9;
  }

  isAttached(): boolean {
    return this.grip !== null;
  }

  /**
   * Whether there is actually a mesh in the hand. Distinct from isAttached:
   * the grip stays mounted on the character for the whole session and simply
   * empties, so "attached" alone never means the player is holding something.
   */
  hasMesh(): boolean {
    return this.grip !== null && this.grip.children.length > 0;
  }

  /** Moves where the item rides. Used to solve the offset against the model. */
  setFist(x: number, y: number, z: number): void {
    fist.set(x, y, z);
    if (this.grip) this.grip.position.copy(fist);
  }

  /** Shows the item for this id, or empties the hand for null/unknown ids. */
  show(itemId: string | null): void {
    if (!this.grip || itemId === this.currentId) return;
    this.grip.clear();
    this.currentId = itemId;
    if (itemId === null) return;
    const mesh = this.meshFor(itemId);
    if (mesh) this.grip.add(mesh);
  }

  /** What is currently in the hand — exposed so a test can assert on it. */
  heldId(): string | null {
    return this.currentId;
  }

  /** World position of the grip, for measuring where the hand actually is. */
  worldPosition(out: THREE.Vector3): THREE.Vector3 {
    if (!this.grip) return out.set(NaN, NaN, NaN);
    return this.grip.getWorldPosition(out);
  }

  /** The grip node itself, so a caller can test what occludes it. */
  gripObject(): THREE.Object3D | null {
    return this.grip;
  }

  /** World direction the haft points (the grip's +Z), for aiming the pose. */
  worldAxis(out: THREE.Vector3): THREE.Vector3 {
    if (!this.grip) return out.set(NaN, NaN, NaN);
    this.grip.updateWorldMatrix(true, false);
    return out.set(0, 0, 1).transformDirection(this.grip.matrixWorld);
  }

  private meshFor(itemId: string): THREE.Object3D | null {
    const shape = SHAPES[itemId];
    // Only tools and weapons are held visibly. A fistful of wood has no
    // silhouette worth drawing, and inventing one would read as a bug.
    if (!shape) return null;

    const cached = this.cache.get(itemId);
    if (cached) return cached;

    const mesh = new THREE.Mesh(
      buildGeometry(shape, getItem(itemId).color),
      createFigureMaterial(),
    );
    mesh.castShadow = true;
    this.cache.set(itemId, mesh);
    return mesh;
  }
}
