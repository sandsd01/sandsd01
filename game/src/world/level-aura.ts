import * as THREE from "three";

/**
 * The level-up flourish: rings off the ground and a ring of light rising
 * through the character.
 *
 * Built entirely from primitives, because this game has no particle system and
 * one level-up is not a reason to start one — three rings and eight thin
 * cylinders is the whole effect, allocated once at startup and re-used for
 * every level after.
 *
 * It glows because the composer already has an `UnrealBloomPass` in it. That
 * pass thresholds at 1.7 in *linear HDR*, sampled before tone mapping, which
 * is the one thing to know about the colours below: a normal cyan tops out at
 * 1.0 per channel and would come out flat and matte. These are set in linear
 * space, deliberately above the threshold, and that is what turns them into
 * light rather than plastic.
 */

const RING_COUNT = 3;
const BEAM_COUNT = 8;
const RING_LIFE_MS = 900;
const BEAM_LIFE_MS = 620;
/** How far apart the three rings start, so they read as a pulse not a blob. */
const RING_STAGGER_MS = 150;
const RING_START_RADIUS = 0.35;
const RING_END_RADIUS = 2.3;
const RING_RISE = 1.1;
const BEAM_HEIGHT = 2.6;
const BEAM_RADIUS = 0.055;
const BEAM_RING_RADIUS = 0.85;

// Above the bloom threshold on purpose — see the note above. Set with an
// explicit linear colour space so three.js does not "helpfully" convert them
// out of the range that makes them glow.
const RING_COLOR = new THREE.Color().setRGB(0.4, 2.7, 3.4, THREE.LinearSRGBColorSpace);
const BEAM_COLOR = new THREE.Color().setRGB(1.7, 3.1, 3.7, THREE.LinearSRGBColorSpace);

interface Piece {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
}

export class LevelAura {
  readonly object = new THREE.Group();
  private readonly rings: Piece[] = [];
  private readonly beams: Piece[] = [];
  private startMs = -Infinity;
  private playing = false;

  constructor() {
    // Never occludes and never writes depth: an effect that could hide the
    // thing it is celebrating is worse than no effect, and additive geometry
    // that sorts against itself flickers.
    const base = {
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
      fog: false,
    } as const;

    for (let i = 0; i < RING_COUNT; i++) {
      // Unit radius, scaled per frame — a RingGeometry cannot change its
      // radius after construction, and rebuilding one every frame for 900ms
      // would allocate a geometry per frame for a cosmetic.
      const geometry = new THREE.RingGeometry(0.82, 1, 40);
      geometry.rotateX(-Math.PI / 2);
      const material = new THREE.MeshBasicMaterial({ ...base, color: RING_COLOR.clone() });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.visible = false;
      // Cosmetic geometry has no business in the shadow pass.
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      this.rings.push({ mesh, material });
      this.object.add(mesh);
    }

    for (let i = 0; i < BEAM_COUNT; i++) {
      // Open-ended: the caps would read as bright discs at eye level.
      const geometry = new THREE.CylinderGeometry(BEAM_RADIUS, BEAM_RADIUS, BEAM_HEIGHT, 6, 1, true);
      const material = new THREE.MeshBasicMaterial({ ...base, color: BEAM_COLOR.clone() });
      const mesh = new THREE.Mesh(geometry, material);
      const angle = (i / BEAM_COUNT) * Math.PI * 2;
      mesh.position.set(Math.cos(angle) * BEAM_RING_RADIUS, 0, Math.sin(angle) * BEAM_RING_RADIUS);
      mesh.visible = false;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      this.beams.push({ mesh, material });
      this.object.add(mesh);
    }

    this.object.visible = false;
  }

  /** Restarts the effect from the top, however far through it was. */
  trigger(nowMs: number): void {
    this.startMs = nowMs;
    this.playing = true;
    this.object.visible = true;
  }

  isPlaying(): boolean {
    return this.playing;
  }

  /**
   * Follows the feet rather than staying where it started, so a player who
   * levels mid-run keeps the light under them — which is the whole point of it
   * being under the feet.
   */
  update(nowMs: number, feetX: number, feetY: number, feetZ: number): void {
    if (!this.playing) return;
    this.object.position.set(feetX, feetY, feetZ);
    const elapsed = nowMs - this.startMs;

    let anyVisible = false;

    for (let i = 0; i < this.rings.length; i++) {
      const { mesh, material } = this.rings[i];
      const t = (elapsed - i * RING_STAGGER_MS) / RING_LIFE_MS;
      if (t < 0 || t > 1) {
        mesh.visible = false;
        continue;
      }
      anyVisible = true;
      mesh.visible = true;
      // Fast at first and slowing: a ring that expands linearly reads as a
      // shape moving, not as something bursting.
      const eased = 1 - Math.pow(1 - t, 3);
      const radius = RING_START_RADIUS + (RING_END_RADIUS - RING_START_RADIUS) * eased;
      mesh.scale.set(radius, 1, radius);
      mesh.position.y = 0.06 + RING_RISE * eased;
      // Holds full brightness for the first fifth, then goes. Fading from the
      // very first frame makes the brightest moment the one nobody sees.
      material.opacity = t < 0.2 ? 1 : 1 - (t - 0.2) / 0.8;
    }

    for (const { mesh, material } of this.beams) {
      const t = elapsed / BEAM_LIFE_MS;
      if (t < 0 || t > 1) {
        mesh.visible = false;
        continue;
      }
      anyVisible = true;
      mesh.visible = true;
      // Grows up out of the ground rather than appearing at full height: the
      // cylinder's origin is its middle, so the base has to be pushed down by
      // half of whatever it currently is.
      const grow = Math.min(1, t / 0.35);
      mesh.scale.y = grow;
      mesh.position.y = (BEAM_HEIGHT * grow) / 2;
      material.opacity = 1 - t;
    }

    if (!anyVisible && elapsed > Math.max(RING_LIFE_MS + RING_STAGGER_MS * RING_COUNT, BEAM_LIFE_MS)) {
      this.playing = false;
      this.object.visible = false;
    }
  }
}
