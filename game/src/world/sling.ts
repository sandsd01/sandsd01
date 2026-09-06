import * as THREE from "three";
import { merge, paint, placed } from "./geometry";

/**
 * The stone a slinger whirls above its head.
 *
 * Two jobs, and the second is the one that matters.
 *
 * **It breaks the outline.** A raid was measured and photographed at fifteen
 * to twenty units, which is the range a slinger throws from, and at that
 * distance every raider is a handful of pixels: the per-kind tints added
 * alongside this help, but hue is the first thing to go when a figure is that
 * small. A shape held clear of the body against the sky is the last.
 *
 * **It tells you a throw is coming.** Before this the stone simply appeared,
 * and at nine units it crosses in a little over half a second. Dodging is the
 * entire counterplay the enemy was built around, and the player was being
 * asked to do it with no information. The whirl spins up through the last
 * stretch of the cooldown, so the warning is the wind-up rather than a symbol
 * bolted on next to it.
 */

/** How far above the slinger's own head the stone circles. */
const HEIGHT = 1.72;
const RADIUS = 0.34;
/** Slow enough to read as "carried" rather than "already throwing". */
const IDLE_TURNS_PER_SEC = 0.55;
const WOUND_TURNS_PER_SEC = 4.2;

const STONE_COLOR = 0x8a8375;
const CORD_COLOR = 0x6a5f52;

function buildSling(): THREE.BufferGeometry {
  return merge([
    // The stone, kept chunky: at range this is one or two pixels and a
    // slimmer one would simply vanish.
    placed(paint(new THREE.BoxGeometry(0.17, 0.17, 0.17), STONE_COLOR), RADIUS, 0, 0),
    // A cord back towards the hand, so the stone reads as swung rather than
    // as floating next to the head.
    placed(paint(new THREE.BoxGeometry(RADIUS, 0.03, 0.03), CORD_COLOR), RADIUS / 2, 0, 0),
  ]);
}

export class Sling {
  readonly object: THREE.Group;
  private angle = 0;

  constructor() {
    this.object = new THREE.Group();
    this.object.position.y = HEIGHT;
    const mesh = new THREE.Mesh(
      buildSling(),
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        flatShading: true,
        roughness: 0.9,
        metalness: 0,
        // Its own material rather than the body's: the body's is flashed white
        // on every hit and faded out on death, and a stone that strobed with
        // the figure would be noise exactly when the player is reading it.
        // A little self-light for the same reason the figures have it.
        emissive: 0x4a4436,
        emissiveIntensity: 0.5,
      }),
    );
    mesh.castShadow = true;
    this.object.add(mesh);
  }

  /**
   * Spins the stone. `charge` is 0 through most of the cooldown and climbs to
   * 1 as the throw arrives.
   */
  update(dt: number, charge: number): void {
    const turns = IDLE_TURNS_PER_SEC + (WOUND_TURNS_PER_SEC - IDLE_TURNS_PER_SEC) * charge;
    this.angle = (this.angle + turns * Math.PI * 2 * dt) % (Math.PI * 2);
    this.object.rotation.y = this.angle;
    // Tilts as it winds up, so the wind-up is legible even head-on where the
    // circle is edge-on and the spin alone would be hard to see.
    this.object.rotation.z = -0.5 * charge;
  }
}
