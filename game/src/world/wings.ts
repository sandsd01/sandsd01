import * as THREE from "three";
import { merge, paint, placed } from "./geometry";

/**
 * The wings on the character's back.
 *
 * Attached to the character *root*, not to a bone, for the reason
 * `held-item.ts` records at length: the rig (`character-archer.glb`) carries
 * seven joints — root, both legs, torso, both arms, head — and parenting props
 * to any of them was tried and abandoned. The same trade applies here and is
 * more forgiving than it was for the held item: wings that do not counter-rotate
 * with the torso through the walk cycle read as wings that are simply stiff,
 * whereas a sword that did it swung inside the body.
 *
 * Built from primitives rather than a model, like everything else the world
 * draws. Four tapered panels a side, fanned and swept back, so the silhouette
 * reads as feathered at the distance the third-person camera actually sits.
 */

/** Where the pair sits in the character's own space: behind and above centre. */
const MOUNT = new THREE.Vector3(0, 1.05, -0.2);

/**
 * Five feathers a side, spanning a little over a body-width each way.
 *
 * The first attempt was half this and swept flat out to the sides: on screen
 * it read as two dark stubs at shoulder height, not as wings. What fixed it
 * was size and *angle* — a fan that opens upward stands against the sky
 * instead of disappearing into the character's own silhouette.
 */
const FEATHERS = 5;
const SPAN = 1.15;
const ROOT_CHORD = 0.3;

const FEATHER_COLOR = 0xfdf6e6;
const EDGE_COLOR = 0xe8d9a8;

function buildWing(side: 1 | -1): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < FEATHERS; i++) {
    const t = i / (FEATHERS - 1);
    // Outer feathers are longer and narrower — the taper that says "wing"
    // rather than "fin" at a glance.
    const length = SPAN * (0.6 + t * 0.65);
    const chord = ROOT_CHORD * (1 - t * 0.5);
    const feather = new THREE.BoxGeometry(length, chord, 0.07);
    // The fan opens upward and back: the innermost feather sits near
    // horizontal, the outermost rakes up and sweeps behind.
    const lift = 0.15 + t * 0.75;
    const sweep = 0.5 + t * 0.35;
    // Each one starts further out along the span, so the roots stack into a
    // shoulder rather than all radiating from one point.
    const rootOut = 0.1 + t * 0.12;
    parts.push(
      placed(
        paint(feather, i >= FEATHERS - 2 ? EDGE_COLOR : FEATHER_COLOR),
        side * (rootOut + Math.cos(lift) * length * 0.5),
        Math.sin(lift) * length * 0.5 - 0.1,
        -0.06 - t * 0.16,
        { rotY: side * -sweep * 0.35, rotZ: side * lift },
      ),
    );
  }
  return merge(parts);
}

export class Wings {
  readonly object = new THREE.Group();
  private mesh: THREE.Mesh | null = null;

  constructor() {
    this.object.position.copy(MOUNT);
    this.object.visible = false;
  }

  /** Parents the wings to the character. Called once, at construction. */
  attachTo(parent: THREE.Object3D): void {
    parent.add(this.object);
  }

  /**
   * Shows or hides the pair. Built lazily on first use so a player who never
   * finds them never pays for the geometry.
   */
  setVisible(visible: boolean): void {
    if (visible && !this.mesh) {
      const material = new THREE.MeshStandardMaterial({
        vertexColors: true,
        flatShading: true,
        roughness: 0.6,
        metalness: 0,
        // A faint glow of their own. Thin panels edge-on to the sun came out
        // near-black against the grass however pale the albedo was — this is
        // what makes them read as feathers rather than as shadow, and it suits
        // a thing called Divine Wings.
        emissive: 0xfff3d0,
        emissiveIntensity: 0.35,
        // Lit from both sides: a thin panel seen from behind would otherwise
        // go black as the character turns.
        side: THREE.DoubleSide,
      });
      this.mesh = new THREE.Mesh(merge([buildWing(1), buildWing(-1)]), material);
      this.mesh.castShadow = true;
      this.object.add(this.mesh);
    }
    this.object.visible = visible;
  }

  isVisible(): boolean {
    return this.object.visible;
  }

  /**
   * A slow idle breath, and a faster beat while flying.
   *
   * The whole pair rocks rather than each feather animating: the fan is one
   * merged mesh, and one mesh is what keeps this free. It is enough — what
   * reads at camera distance is the rhythm, not the articulation.
   */
  update(nowMs: number, flying: boolean): void {
    if (!this.object.visible) return;
    const speed = flying ? 0.009 : 0.0018;
    const depth = flying ? 0.34 : 0.06;
    const beat = Math.sin(nowMs * speed);
    this.object.rotation.z = beat * depth;
    // Sweeping forward slightly on the downstroke sells it as pushing air
    // rather than waving.
    this.object.rotation.x = flying ? -0.12 + beat * 0.1 : 0;
  }
}
