import * as THREE from "three";
import { getBuilding, type BuildingDef } from "../data/buildings";
import { getZone } from "../world/zones";
import type { Terrain } from "../world/terrain";
import type { GameState, PlacedBuilding } from "../state/game-state";
import { hasQty, removeItem } from "./inventory";
import { GRID_CELL_SIZE, cellKey, worldToCell, type Cell } from "../utils/grid";
import type { Collidable } from "../utils/collision";
import { events } from "../utils/events";

const PLACEMENT_DISTANCE = 3;
const VALID_COLOR = 0x4caf50;
const INVALID_COLOR = 0xe53935;

let nextBuildingInstanceId = 0;

export class BuildingSystem {
  private selectedBuildingId: string | null = null;
  private ghost: THREE.Mesh | null = null;
  private ghostValid = false;
  private readonly meshes = new Map<string, THREE.Object3D>();
  private readonly occupancy = new Map<string, string>(); // cell key -> placedBuilding.id

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

  private isPlacementValid(def: BuildingDef, anchor: Cell): boolean {
    for (const offset of def.footprintCells) {
      const cell = { x: anchor.x + offset.x, z: anchor.z + offset.z };
      if (this.occupancy.has(cellKey(cell))) return false;
      const worldX = cell.x * GRID_CELL_SIZE;
      const worldZ = cell.z * GRID_CELL_SIZE;
      if (getZone(worldX, worldZ) !== "open") return false;
    }
    return true; // inventory cost is checked separately at place-time
  }

  update(playerPos: THREE.Vector3, forward: THREE.Vector3): void {
    if (!this.selectedBuildingId || !this.ghost) return;
    const def = getBuilding(this.selectedBuildingId);
    const anchor = this.anchorCellFor(playerPos, forward);
    const worldX = anchor.x * GRID_CELL_SIZE;
    const worldZ = anchor.z * GRID_CELL_SIZE;
    const y = this.terrain.heightAt(worldX, worldZ);

    this.ghost.position.set(worldX, y + def.height / 2, worldZ);
    this.ghostValid = this.isPlacementValid(def, anchor);
    (this.ghost.material as THREE.MeshStandardMaterial).color.setHex(
      this.ghostValid ? VALID_COLOR : INVALID_COLOR,
    );
  }

  tryPlace(playerPos: THREE.Vector3, forward: THREE.Vector3): boolean {
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
    this.spawnMesh(placed);
    events.emit("building-placed", { id: placed.id, buildingId: def.id });
    return true;
  }

  private occupyCells(placed: PlacedBuilding): void {
    const def = getBuilding(placed.buildingId);
    for (const offset of def.footprintCells) {
      const cell = { x: placed.cellX + offset.x, z: placed.cellZ + offset.z };
      this.occupancy.set(cellKey(cell), placed.id);
    }
  }

  private spawnMesh(placed: PlacedBuilding): void {
    const def = getBuilding(placed.buildingId);
    const worldX = placed.cellX * GRID_CELL_SIZE;
    const worldZ = placed.cellZ * GRID_CELL_SIZE;
    const y = this.terrain.heightAt(worldX, worldZ);

    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(GRID_CELL_SIZE * 0.95, def.height, GRID_CELL_SIZE * 0.95),
      new THREE.MeshStandardMaterial({ color: def.color }),
    );
    mesh.position.set(worldX, y + def.height / 2, worldZ);
    mesh.name = placed.id;
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
