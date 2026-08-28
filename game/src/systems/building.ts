import * as THREE from "three";
import { getBuilding, type BuildingDef } from "../data/buildings";
import { getZone } from "../world/zones";
import type { Terrain } from "../world/terrain";
import type { GameState, PlacedBuilding } from "../state/game-state";
import { hasQty, removeItem } from "./inventory";
import { GRID_CELL_SIZE, cellKey, worldToCell, type Cell } from "../utils/grid";
import type { Collidable } from "../utils/collision";
import { events } from "../utils/events";
import { merge, paint, placed } from "../world/geometry";

const PLACEMENT_DISTANCE = 3;
const VALID_COLOR = 0x4caf50;
const INVALID_COLOR = 0xe53935;
const POP_IN_MS = 220;

// Placed buildings share one flat-shaded material and carry their colours in
// vertex data, same as the world props (see world/geometry.ts).
const BUILDING_MATERIAL = new THREE.MeshStandardMaterial({
  vertexColors: true,
  flatShading: true,
  roughness: 0.85,
  metalness: 0,
});

const W = GRID_CELL_SIZE * 0.95;

// A box per building was readable but lifeless. These keep the same footprint
// and height the placement grid and collision assume, and spend their detail
// on the silhouette: posts and rails on walls, a framed soil bed on a plot.
function buildBuildingGeometry(def: BuildingDef): THREE.BufferGeometry {
  const h = def.height;

  if (def.isPlot) {
    const soil = 0x5b4028;
    const frame = 0x8a6134;
    const parts: THREE.BufferGeometry[] = [
      placed(paint(new THREE.BoxGeometry(W * 0.92, h * 0.8, W * 0.92), soil), 0, h * 0.4, 0),
    ];
    // Timber frame around the bed.
    for (const [dx, dz, sx, sz] of [
      [0, -W / 2, W, 0.09],
      [0, W / 2, W, 0.09],
      [-W / 2, 0, 0.09, W],
      [W / 2, 0, 0.09, W],
    ]) {
      parts.push(placed(paint(new THREE.BoxGeometry(sx, h, sz), frame), dx, h * 0.5, dz));
    }
    // Furrows, so a planted bed reads as tilled ground.
    for (let i = -1; i <= 1; i++) {
      parts.push(
        placed(paint(new THREE.BoxGeometry(W * 0.82, h * 0.3, 0.06), 0x46311e), 0, h * 0.82, i * 0.24),
      );
    }
    return merge(parts);
  }

  if (h < 0.6) {
    // Foundation: a slab with a slightly inset cap, which catches the light
    // differently from the base and gives the flat top an edge.
    return merge([
      placed(paint(new THREE.BoxGeometry(W, h * 0.7, W), 0x8d8b86), 0, h * 0.35, 0),
      placed(paint(new THREE.BoxGeometry(W * 0.86, h * 0.45, W * 0.86), 0xa5a29b), 0, h * 0.78, 0),
    ]);
  }

  // Walls: corner posts plus an infill panel and a mid rail.
  const post = def.id === "brick_wall" ? 0x8a4a30 : 0x6f4c2e;
  const panel = def.color;
  const parts: THREE.BufferGeometry[] = [
    placed(paint(new THREE.BoxGeometry(W * 0.78, h, W * 0.5), panel), 0, h / 2, 0),
    placed(paint(new THREE.BoxGeometry(W * 0.96, h * 0.12, W * 0.56), post), 0, h * 0.55, 0),
  ];
  for (const dx of [-1, 1]) {
    parts.push(
      placed(paint(new THREE.BoxGeometry(0.15, h, 0.18), post), (dx * W) / 2.3, h / 2, 0),
    );
  }
  return merge(parts);
}

let nextBuildingInstanceId = 0;

type InvalidReason = "occupied" | "zone";

export class BuildingSystem {
  private selectedBuildingId: string | null = null;
  private ghost: THREE.Mesh | null = null;
  private ghostValid = false;
  private invalidReason: InvalidReason | null = null;
  private readonly meshes = new Map<string, THREE.Object3D>();
  private readonly occupancy = new Map<string, string>(); // cell key -> placedBuilding.id
  private readonly popIns: { mesh: THREE.Object3D; startMs: number }[] = [];

  constructor(
    private readonly scene: THREE.Scene,
    private readonly terrain: Terrain,
    private readonly state: GameState,
  ) {
    // Rehydrate any buildings restored from a save.
    for (const placed of state.placedBuildings) {
      this.occupyCells(placed);
      this.spawnMesh(placed);
    }
  }

  selectBuilding(buildingId: string | null): void {
    this.selectedBuildingId = buildingId;
    events.emit("building-selection-changed", { buildingId });
    if (this.ghost) {
      this.scene.remove(this.ghost);
      this.ghost = null;
    }
    if (buildingId) this.createGhost(getBuilding(buildingId));
  }

  getSelectedBuildingId(): string | null {
    return this.selectedBuildingId;
  }

  private createGhost(def: BuildingDef): void {
    const geometry = new THREE.BoxGeometry(
      GRID_CELL_SIZE * 0.9,
      def.height,
      GRID_CELL_SIZE * 0.9,
    );
    const material = new THREE.MeshStandardMaterial({
      color: VALID_COLOR,
      transparent: true,
      opacity: 0.55,
    });
    this.ghost = new THREE.Mesh(geometry, material);
    this.scene.add(this.ghost);
  }

  private anchorCellFor(playerPos: THREE.Vector3, forward: THREE.Vector3): Cell {
    const targetX = playerPos.x + forward.x * PLACEMENT_DISTANCE;
    const targetZ = playerPos.z + forward.z * PLACEMENT_DISTANCE;
    return worldToCell(targetX, targetZ);
  }

  // Returns null when valid, or the reason it isn't — used both to color the
  // ghost and to explain the block to the player via getPlacementPrompt().
  private placementInvalidReason(def: BuildingDef, anchor: Cell): InvalidReason | null {
    for (const offset of def.footprintCells) {
      const cell = { x: anchor.x + offset.x, z: anchor.z + offset.z };
      if (this.occupancy.has(cellKey(cell))) return "occupied";
      const worldX = cell.x * GRID_CELL_SIZE;
      const worldZ = cell.z * GRID_CELL_SIZE;
      if (getZone(worldX, worldZ) !== "open") return "zone";
    }
    return null; // inventory cost is checked separately at place-time
  }

  private isPlacementValid(def: BuildingDef, anchor: Cell): boolean {
    return this.placementInvalidReason(def, anchor) === null;
  }

  // A short HUD prompt while a building is selected: what to do, or why the
  // current spot won't work — shown instead of leaving the player to guess
  // why the ghost turned red.
  getPlacementPrompt(): string | null {
    if (!this.selectedBuildingId) return null;
    const def = getBuilding(this.selectedBuildingId);
    if (this.ghostValid) {
      const costText = def.cost.map((c) => `${c.qty} ${c.itemId}`).join(", ");
      return `Left-click to place ${def.name} (${costText})`;
    }
    if (this.invalidReason === "occupied") return "Can't place here — space is occupied";
    return "Can only build in the open area near spawn";
  }

  update(playerPos: THREE.Vector3, forward: THREE.Vector3, nowMs: number): void {
    this.updatePopIns(nowMs);

    if (!this.selectedBuildingId || !this.ghost) return;
    const def = getBuilding(this.selectedBuildingId);
    const anchor = this.anchorCellFor(playerPos, forward);
    const worldX = anchor.x * GRID_CELL_SIZE;
    const worldZ = anchor.z * GRID_CELL_SIZE;
    const y = this.terrain.heightAt(worldX, worldZ);

    this.ghost.position.set(worldX, y + def.height / 2, worldZ);
    this.invalidReason = this.placementInvalidReason(def, anchor);
    this.ghostValid = this.invalidReason === null;
    (this.ghost.material as THREE.MeshStandardMaterial).color.setHex(
      this.ghostValid ? VALID_COLOR : INVALID_COLOR,
    );
  }

  tryPlace(playerPos: THREE.Vector3, forward: THREE.Vector3, nowMs: number): boolean {
    if (!this.selectedBuildingId) return false;
    const def = getBuilding(this.selectedBuildingId);
    const anchor = this.anchorCellFor(playerPos, forward);
    if (!this.isPlacementValid(def, anchor)) return false;

    for (const cost of def.cost) {
      if (!hasQty(this.state, cost.itemId, cost.qty)) {
        events.emit("notification", { message: `Not enough ${cost.itemId}` });
        return false;
      }
    }
    for (const cost of def.cost) removeItem(this.state, cost.itemId, cost.qty);

    const placed: PlacedBuilding = {
      id: `building-${nextBuildingInstanceId++}`,
      buildingId: def.id,
      cellX: anchor.x,
      cellZ: anchor.z,
    };
    this.state.placedBuildings.push(placed);
    this.occupyCells(placed);
    this.spawnMesh(placed, nowMs);
    events.emit("building-placed", { id: placed.id, buildingId: def.id });
    return true;
  }

  private updatePopIns(nowMs: number): void {
    for (let i = this.popIns.length - 1; i >= 0; i--) {
      const tween = this.popIns[i];
      const elapsed = nowMs - tween.startMs;
      if (elapsed >= POP_IN_MS) {
        tween.mesh.scale.setScalar(1);
        this.popIns.splice(i, 1);
        continue;
      }
      const t = elapsed / POP_IN_MS;
      // Ease-out-back: overshoots past 1 slightly before settling, so a
      // placed building feels like it "pops" into place.
      const c1 = 1.70158;
      const c3 = c1 + 1;
      const eased = 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
      tween.mesh.scale.setScalar(Math.max(0.05, eased));
    }
  }

  private occupyCells(placed: PlacedBuilding): void {
    const def = getBuilding(placed.buildingId);
    for (const offset of def.footprintCells) {
      const cell = { x: placed.cellX + offset.x, z: placed.cellZ + offset.z };
      this.occupancy.set(cellKey(cell), placed.id);
    }
  }

  // nowMs is only passed for a freshly-placed building, which pop-in
  // animates; buildings rehydrated from a save appear at full scale
  // immediately, since animating them on page load would be misleading.
  private spawnMesh(placed: PlacedBuilding, nowMs?: number): void {
    const def = getBuilding(placed.buildingId);
    const worldX = placed.cellX * GRID_CELL_SIZE;
    const worldZ = placed.cellZ * GRID_CELL_SIZE;
    const y = this.terrain.heightAt(worldX, worldZ);

    const mesh = new THREE.Mesh(buildBuildingGeometry(def), BUILDING_MATERIAL);
    // Building geometry is modelled from its base up, so it sits on the
    // terrain rather than being centred on it.
    mesh.position.set(worldX, y, worldZ);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = placed.id;
    if (nowMs !== undefined) {
      mesh.scale.setScalar(0.05);
      this.popIns.push({ mesh, startMs: nowMs });
    }
    this.scene.add(mesh);
    this.meshes.set(placed.id, mesh);
  }

  getMesh(placedId: string): THREE.Object3D | undefined {
    return this.meshes.get(placedId);
  }

  // Only non-plot buildings block movement (walls, foundations) — plots are
  // walkable low platforms the player stands on to plant/harvest.
  getCollidables(): Collidable[] {
    const result: Collidable[] = [];
    for (const placed of this.state.placedBuildings) {
      const def = getBuilding(placed.buildingId);
      if (def.isPlot) continue;
      result.push({
        x: placed.cellX * GRID_CELL_SIZE,
        z: placed.cellZ * GRID_CELL_SIZE,
        radius: GRID_CELL_SIZE * 0.5,
      });
    }
    return result;
  }
}
