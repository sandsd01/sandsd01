import * as THREE from "three";
import { getBuilding } from "../data/buildings";
import { getCrop, CROPS } from "../data/crops";
import type { GameState, PlotState } from "../state/game-state";
import type { Terrain } from "../world/terrain";
import { GRID_CELL_SIZE } from "../utils/grid";
import { addItem, hasQty, removeItem } from "./inventory";
import { events } from "../utils/events";

const INTERACT_RANGE = 2.5;

function plotWorldPos(state: GameState, plot: PlotState): { x: number; z: number } | null {
  const placed = state.placedBuildings.find((pb) => pb.id === plot.buildingId);
  if (!placed) return null;
  return { x: placed.cellX * GRID_CELL_SIZE, z: placed.cellZ * GRID_CELL_SIZE };
}

export class FarmingSystem {
  private readonly cropMeshes = new Map<string, THREE.Mesh>();
  private unsubscribe: () => void;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly terrain: Terrain,
    private readonly state: GameState,
  ) {
    this.unsubscribe = events.on("building-placed", ({ id, buildingId }) => {
      if (getBuilding(buildingId).isPlot) {
        this.state.plots.push({ buildingId: id, cropId: null, plantedAtMs: null });
      }
    });

    for (const plot of state.plots) {
      if (plot.cropId) this.spawnCropMesh(plot);
    }
  }

  dispose(): void {
    this.unsubscribe();
  }

  private findNearestPlot(x: number, z: number): PlotState | null {
    let nearest: PlotState | null = null;
    let nearestDist = INTERACT_RANGE;
    for (const plot of this.state.plots) {
      const pos = plotWorldPos(this.state, plot);
      if (!pos) continue;
      const dist = Math.hypot(pos.x - x, pos.z - z);
      if (dist < nearestDist) {
        nearest = plot;
        nearestDist = dist;
      }
    }
    return nearest;
  }

  private growthProgress(plot: PlotState, nowMs: number): number {
    if (!plot.cropId || plot.plantedAtMs === null) return 0;
    const crop = getCrop(plot.cropId);
    const totalDuration = crop.growthStages * crop.stageDurationMs;
    return Math.min(1, (nowMs - plot.plantedAtMs) / totalDuration);
  }

  isReadyToHarvest(plot: PlotState, nowMs: number): boolean {
    return plot.cropId !== null && this.growthProgress(plot, nowMs) >= 1;
  }

  getPrompt(x: number, z: number, selectedSeedItemId: string | null, nowMs: number): string | null {
    const plot = this.findNearestPlot(x, z);
    if (!plot) return null;
    if (plot.cropId === null) {
      if (!selectedSeedItemId) return "Select a seed to plant here";
      return `Press F to plant ${selectedSeedItemId}`;
    }
    if (this.isReadyToHarvest(plot, nowMs)) return "Press F to harvest";
    return "Growing...";
  }

  tryInteract(x: number, z: number, selectedSeedItemId: string | null, nowMs: number): void {
    const plot = this.findNearestPlot(x, z);
    if (!plot) return;

    if (plot.cropId === null) {
      if (!selectedSeedItemId) return;
      const crop = Object.values(CROPS).find((c) => c.seedItemId === selectedSeedItemId);
      if (!crop) return;
      if (!hasQty(this.state, selectedSeedItemId, 1)) return;
      removeItem(this.state, selectedSeedItemId, 1);
      plot.cropId = crop.id;
      plot.plantedAtMs = nowMs;
      this.spawnCropMesh(plot);
      events.emit("crop-planted", { plotId: plot.buildingId, cropId: crop.id });
      return;
    }

    if (this.isReadyToHarvest(plot, nowMs)) {
      const crop = getCrop(plot.cropId);
      addItem(this.state, crop.yield.itemId, crop.yield.qty);
      events.emit("crop-harvested", { plotId: plot.buildingId, cropId: crop.id });
      plot.cropId = null;
      plot.plantedAtMs = null;
      this.removeCropMesh(plot);
    }
  }

  private spawnCropMesh(plot: PlotState): void {
    const pos = plotWorldPos(this.state, plot);
    if (!pos) return;
    const y = this.terrain.heightAt(pos.x, pos.z);
    const mesh = new THREE.Mesh(
      new THREE.ConeGeometry(0.25, 0.1, 6),
      new THREE.MeshStandardMaterial({ color: 0x4a7a2a }),
    );
    mesh.position.set(pos.x, y + 0.2, pos.z);
    this.scene.add(mesh);
    this.cropMeshes.set(plot.buildingId, mesh);
  }

  private removeCropMesh(plot: PlotState): void {
    const mesh = this.cropMeshes.get(plot.buildingId);
    if (mesh) {
      this.scene.remove(mesh);
      this.cropMeshes.delete(plot.buildingId);
    }
  }

  update(nowMs: number): void {
    for (const plot of this.state.plots) {
      if (!plot.cropId) continue;
      const mesh = this.cropMeshes.get(plot.buildingId);
      if (!mesh) continue;
      const progress = this.growthProgress(plot, nowMs);
      const scale = 0.3 + progress * 1.2;
      mesh.scale.set(scale, scale, scale);
      const crop = getCrop(plot.cropId);
      (mesh.material as THREE.MeshStandardMaterial).color.setHex(
        progress >= 1 ? crop.color : 0x4a7a2a,
      );
    }
  }
}
