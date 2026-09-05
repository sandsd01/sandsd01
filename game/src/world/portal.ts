import * as THREE from "three";
import type { RegionId } from "./region";

/**
 * A way through.
 *
 * Stepped into rather than pressed: the player walks at it and arrives
 * somewhere else. That is what was asked for, and it is also the only kind of
 * transition that needs no new control and no prompt to explain it.
 */
export interface Portal {
  id: string;
  x: number;
  z: number;
  /** Where it leads. */
  target: RegionId;
  /** How close counts as having stepped in. */
  radius: number;
  object: THREE.Object3D;
  /**
   * Whether this portal is currently able to fire.
   *
   * A portal is created **disarmed** and only arms once the player has walked
   * clear of it. Without that, arriving beside the way back means standing in
   * its trigger on the very first frame: you would be sent straight back,
   * arrive inside the first portal again, and bounce between the two forever.
   * Landing a few paces away is not enough on its own — one stumble backwards
   * would do it — so the rule is about having left, not about distance at the
   * moment of arrival.
   */
  armed: boolean;
}

/**
 * A way into somewhere, and where walking back out of it puts you.
 *
 * Both the cave mouths and the giant tree produce these, so `main.ts` keeps
 * one list rather than one per kind of destination — which is what stops the
 * "which way did they come in" bookkeeping being written twice.
 */
export interface PortalSite {
  portal: Portal;
  /** Where the player lands on returning — well clear of the portal itself. */
  returnX: number;
  returnZ: number;
}

/** How far the player must get from a portal before it will fire. */
const ARM_DISTANCE = 6;

/**
 * How close counts as stepping in.
 *
 * A little wider than the ring itself, so walking at a doorway goes through it
 * rather than clipping the frame.
 */
const PORTAL_RADIUS = 2.6;
/** The ring's own radius. Sized for a doorway, not a hoop. */
const RING_RADIUS = 2.2;
/** Centre height, so the ring stands from ankle to well over head height. */
const RING_HEIGHT = 2.5;

let nextPortalId = 0;

/**
 * A standing ring, lit from within.
 *
 * Emissive rather than lit: a portal at the back of a cave with no sun on it
 * still has to read as a way out, and the one thing every other object in the
 * game shares is that it goes dark when nothing is shining on it.
 */
function buildPortalMesh(tint: number): THREE.Object3D {
  const group = new THREE.Group();

  const ringMaterial = new THREE.MeshStandardMaterial({
    color: 0x2a2440,
    emissive: tint,
    emissiveIntensity: 1.3,
    roughness: 0.4,
    metalness: 0.1,
  });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(RING_RADIUS, 0.28, 8, 22), ringMaterial);
  ring.position.y = RING_HEIGHT;
  ring.castShadow = true;
  group.add(ring);

  // The sheet inside it. Double-sided and see-through, so walking round the
  // back does not make it vanish and the shape behind still reads.
  const sheet = new THREE.Mesh(
    new THREE.CircleGeometry(RING_RADIUS - 0.1, 22),
    new THREE.MeshBasicMaterial({
      color: tint,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  sheet.position.y = RING_HEIGHT;
  group.add(sheet);

  // Two feet, so it stands on the ground rather than hovering over it.
  for (const dx of [-1, 1]) {
    const foot = new THREE.Mesh(
      new THREE.BoxGeometry(0.34, 0.7, 0.38),
      new THREE.MeshStandardMaterial({ color: 0x3a3350, roughness: 0.8 }),
    );
    foot.position.set(dx * (RING_RADIUS - 0.5), 0.35, 0);
    foot.castShadow = true;
    group.add(foot);
  }

  return group;
}

export function createPortal(
  x: number,
  y: number,
  z: number,
  target: RegionId,
  tint: number,
): Portal {
  const object = buildPortalMesh(tint);
  object.position.set(x, y, z);
  return {
    id: `portal-${nextPortalId++}`,
    x,
    z,
    target,
    radius: PORTAL_RADIUS,
    object,
    armed: false,
  };
}

/**
 * Arms portals the player has walked clear of, and reports the one they have
 * just stepped into.
 *
 * Both halves in one pass because they are the same question asked at two
 * distances, and splitting them is how the arming half gets forgotten.
 */
export function portalSteppedInto(
  portals: Portal[],
  playerX: number,
  playerZ: number,
): Portal | null {
  let entered: Portal | null = null;
  for (const portal of portals) {
    const distance = Math.hypot(portal.x - playerX, portal.z - playerZ);
    if (!portal.armed) {
      if (distance > ARM_DISTANCE) portal.armed = true;
      continue;
    }
    if (distance <= portal.radius && !entered) entered = portal;
  }
  return entered;
}

/** Spins the ring slowly, so it reads as active rather than as scenery. */
export function updatePortals(portals: Portal[], nowMs: number): void {
  for (const portal of portals) {
    portal.object.rotation.y = (nowMs / 2600) % (Math.PI * 2);
  }
}
