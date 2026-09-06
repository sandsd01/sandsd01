import * as THREE from "three";
import type { GroundSurface } from "./terrain";
import { getItem } from "../data/items";
import { addItem } from "../systems/inventory";
import type { GameState } from "../state/game-state";
import { events } from "../utils/events";

// Loot lying on the ground, waiting to be walked over.
//
// Handing a kill's rewards straight to the inventory would have been less
// code, but then nothing happens where the fight happened — no reason to step
// back into the space you just cleared, and no moment of seeing what you got.
// A thing on the floor is the whole point.

const PICKUP_RADIUS = 1.4;
/**
 * How far off the ground you can be and still scoop something up.
 *
 * Above a jump's apex, because walking over a drop while mid-hop has always
 * picked it up and should keep doing so.
 */
const PICKUP_HEIGHT = 2.5;
const DESPAWN_MS = 60_000;
const BOB_HEIGHT = 0.12;
const BOB_SPEED = 0.0028;
const SPIN_SPEED = 0.0016;
const REST_HEIGHT = 0.35;
/** Fade over the last stretch, so a drop about to vanish says so. */
const FADE_MS = 6_000;

const GEOMETRY = new THREE.BoxGeometry(0.26, 0.26, 0.26);

export interface DroppedItem {
  itemId: string;
  qty: number;
  object: THREE.Mesh;
  spawnedAtMs: number;
  /** Randomised so a pile of drops doesn't bob and spin in lockstep. */
  phase: number;
}

export class DroppedItems {
  private readonly items: DroppedItem[] = [];

  constructor(
    private readonly scene: THREE.Scene,
    private readonly terrain: GroundSurface,
  ) {}

  /**
   * Drops a stack at a spot. `spread` scatters several drops from one death so
   * they do not stack into a single unreadable cube.
   */
  spawn(itemId: string, qty: number, x: number, z: number, nowMs: number, spread = 0.5): void {
    if (qty <= 0) return;
    // An unknown id would throw out of getItem and take the frame with it;
    // loot tables are data, so treat a bad row as "no drop" rather than fatal.
    let colour: number;
    try {
      colour = getItem(itemId).color;
    } catch {
      return;
    }

    const material = new THREE.MeshStandardMaterial({
      color: colour,
      roughness: 0.7,
      transparent: true,
      opacity: 1,
    });
    const mesh = new THREE.Mesh(GEOMETRY, material);
    const dx = (Math.random() - 0.5) * spread * 2;
    const dz = (Math.random() - 0.5) * spread * 2;
    mesh.position.set(x + dx, this.terrain.heightAt(x + dx, z + dz) + REST_HEIGHT, z + dz);
    mesh.castShadow = true;
    this.scene.add(mesh);

    this.items.push({ itemId, qty, object: mesh, spawnedAtMs: nowMs, phase: Math.random() * 10 });
  }

  /** Spawns every roll of a table at one spot. */
  spawnAll(
    drops: readonly { itemId: string; qty: number }[],
    x: number,
    z: number,
    nowMs: number,
  ): void {
    for (const drop of drops) this.spawn(drop.itemId, drop.qty, x, z, nowMs);
  }

  update(
    nowMs: number,
    state: GameState,
    playerX: number,
    playerZ: number,
    playerHeightAboveGround = 0,
  ): void {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const item = this.items[i];
      const age = nowMs - item.spawnedAtMs;

      if (age >= DESPAWN_MS) {
        this.remove(i);
        continue;
      }

      const bob = Math.sin(nowMs * BOB_SPEED + item.phase) * BOB_HEIGHT;
      item.object.position.y =
        this.terrain.heightAt(item.object.position.x, item.object.position.z) + REST_HEIGHT + bob;
      item.object.rotation.y = nowMs * SPIN_SPEED + item.phase;

      const remaining = DESPAWN_MS - age;
      const material = item.object.material as THREE.MeshStandardMaterial;
      material.opacity = remaining < FADE_MS ? Math.max(0.15, remaining / FADE_MS) : 1;

      // Height counts. The radius was two-dimensional, which was fine while
      // the only way to be above a drop was mid-jump — flight turns it into a
      // vacuum cleaner that hoovers up a battlefield from altitude.
      const dx = item.object.position.x - playerX;
      const dz = item.object.position.z - playerZ;
      const withinReach = playerHeightAboveGround <= PICKUP_HEIGHT;
      if (withinReach && dx * dx + dz * dz <= PICKUP_RADIUS * PICKUP_RADIUS) {
        addItem(state, item.itemId, item.qty);
        events.emit("item-picked-up", { itemId: item.itemId, qty: item.qty });
        this.remove(i);
      }
    }
  }

  /**
   * Sweeps the floor. Used when the player changes region — loot lying in a
   * cave is not loot lying on the homestead, and the drops themselves are
   * already understood to belong to the fight that produced them (nothing here
   * is ever saved).
   */
  clear(): void {
    for (let i = this.items.length - 1; i >= 0; i--) this.remove(i);
  }

  /** For tests and the debug surface: what is currently on the floor. */
  list(): { itemId: string; qty: number; x: number; z: number }[] {
    return this.items.map((item) => ({
      itemId: item.itemId,
      qty: item.qty,
      x: item.object.position.x,
      z: item.object.position.z,
    }));
  }

  private remove(index: number): void {
    const item = this.items[index];
    this.scene.remove(item.object);
    // The geometry is shared across every drop, so only the per-drop material
    // is ours to release.
    (item.object.material as THREE.Material).dispose();
    this.items.splice(index, 1);
  }
}
