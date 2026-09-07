import * as THREE from "three";
import { merge, paint, placed } from "./geometry";

/**
 * The lantern on the character's hip, and the light it throws.
 *
 * Attached to the character root for the same reason `wings.ts` and
 * `held-item.ts` are: the pack's rig (`character-archer.glb`) has seven joints
 * and no hand, so there is nothing to hang a prop from. A lamp at the hip is
 * the forgiving case — it is meant to hang and sway rather than to be gripped,
 * so not counter-rotating with the torso costs nothing legible.
 *
 * The `PointLight` is the part that does the work; the little crystal cage is
 * so the ability is visible on the character rather than only in the lighting.
 * Both go on and off together — a lamp that lit the world while invisible on
 * the wearer would read as a bug in the renderer.
 */

/** Where the lamp hangs in the character's own space: hip height, off to one side. */
const MOUNT = new THREE.Vector3(0.28, 0.95, 0.05);

const CAGE_COLOR = 0x6a6f78;
/** The stone itself. Saturated, because this is the thing you are looking at. */
const CRYSTAL_COLOR = 0x9fe8ff;
/**
 * What it throws, which is *not* the same colour.
 *
 * The brazier learned this first and wrote it down: a cyan light falling on
 * grass comes back green, and the base ends up lit like a radioactive spill.
 * The first build of this lantern ignored that note and used the crystal's own
 * colour for the `PointLight` — the midnight screenshot came back with the
 * pool measuring green at 2.24x red, which is exactly the spill the brazier
 * was warning about. The tint belongs on the crystal; what it *shines* is
 * near-white, the same value the brazier settled on.
 */
const LIGHT_COLOR = 0xdcecff;

/**
 * Brightness per unit of radius.
 *
 * The brazier is the reference: intensity 10 over distance 22, so a shade
 * under half. Deriving it means a lantern retuned to reach further gets
 * brighter to match, instead of reaching into the dark with a light too weak
 * to show anything at the far edge.
 */
const INTENSITY_PER_UNIT = 0.45;

/**
 * How fast the lamp swings, and how far.
 *
 * Small. A hanging light that swung properly would drag its whole pool of
 * light across the ground every step, which is nauseating at a walking pace
 * and was the first thing a screenshot sequence showed. This is enough to say
 * "it hangs" and not enough to move the pool.
 */
const SWAY_HZ = 1.1;
const SWAY_RADIANS = 0.12;

function buildCage(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  // A ring at top and bottom with four uprights between them: the smallest
  // shape that still reads as a cage rather than as a block at the distance
  // the chase camera sits.
  parts.push(placed(paint(new THREE.TorusGeometry(0.09, 0.015, 6, 10), CAGE_COLOR), 0, 0.11, 0, { rotX: Math.PI / 2 }));
  parts.push(placed(paint(new THREE.TorusGeometry(0.09, 0.015, 6, 10), CAGE_COLOR), 0, -0.11, 0, { rotX: Math.PI / 2 }));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    parts.push(
      placed(
        paint(new THREE.BoxGeometry(0.02, 0.24, 0.02), CAGE_COLOR),
        Math.cos(a) * 0.085,
        0,
        Math.sin(a) * 0.085,
      ),
    );
  }
  // The hook it hangs from.
  parts.push(placed(paint(new THREE.BoxGeometry(0.02, 0.07, 0.02), CAGE_COLOR), 0, 0.16, 0));
  return merge(parts);
}

export class Lantern {
  readonly object = new THREE.Group();
  private readonly light: THREE.PointLight;
  private readonly crystal: THREE.Mesh;
  private radius = 0;

  constructor() {
    this.object.position.copy(MOUNT);

    const cage = new THREE.Mesh(
      buildCage(),
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.35 }),
    );
    cage.castShadow = true;
    this.object.add(cage);

    // Unlit material: the crystal is the source, so shading it by the scene's
    // own light would have it go dark exactly when it is meant to be the only
    // bright thing on screen.
    this.crystal = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.06, 0),
      new THREE.MeshBasicMaterial({ color: CRYSTAL_COLOR }),
    );
    this.object.add(this.crystal);

    this.light = new THREE.PointLight(LIGHT_COLOR, 0, 0, 1.4);
    this.object.add(this.light);

    this.object.visible = false;
  }

  attachTo(parent: THREE.Object3D): void {
    parent.add(this.object);
  }

  /**
   * Sets how far the light reaches. Zero takes the lamp off entirely.
   *
   * One entry point rather than a `setVisible` beside a `setRadius`, because
   * the two can never legitimately disagree: a lamp with no reach is a lamp
   * that is not being worn.
   */
  setRadius(radius: number): void {
    this.radius = radius;
    const lit = radius > 0;
    this.object.visible = lit;
    this.light.distance = radius;
    this.light.intensity = lit ? radius * INTENSITY_PER_UNIT : 0;
  }

  /** How far it currently reaches. 0 when not worn. */
  getRadius(): number {
    return this.radius;
  }

  isLit(): boolean {
    return this.radius > 0 && this.object.visible;
  }

  update(nowMs: number): void {
    if (!this.object.visible) return;
    this.object.rotation.z = Math.sin((nowMs / 1000) * SWAY_HZ * Math.PI * 2) * SWAY_RADIANS;
  }
}
