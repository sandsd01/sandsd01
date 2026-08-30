import * as THREE from "three";
import { getBuilding } from "../data/buildings";
import { getCrop, CROPS } from "../data/crops";
import { getItem } from "../data/items";
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
  private unsubscribeRemoved: () => void;

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

    // A plot's record has to go when the plot does. `state.plots` only ever
    // grew before, because nothing could be taken down — a stale row would
    // leave a crop mesh floating over bare ground and hand the next plot that
    // reused the id a crop it never planted.
    this.unsubscribeRemoved = events.on("building-removed", ({ id }) => {
      const index = this.state.plots.findIndex((p) => p.buildingId === id);
      if (index === -1) return;
      this.removeCropMesh(this.state.plots[index]);
      this.state.plots.splice(index, 1);
    });

    for (const plot of state.plots) {
      if (plot.cropId) this.spawnCropMesh(plot);
    }
  }

  dispose(): void {
    this.unsubscribe();
    this.unsubscribeRemoved();
  }

  // The fallback for the farm *key*, mirroring gathering: the crosshair is the
  // primary way to pick a bed, but F while standing on one should still work.
  nearestPlot(x: number, z: number): PlotState | null {
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

  getPrompt(plot: PlotState | null, selectedSeedItemId: string | null, nowMs: number): string | null {
    if (!plot) return null;
    if (plot.cropId === null) {
      if (!selectedSeedItemId) return "Select a seed to plant here";
      return `Right-click to plant ${selectedSeedItemId}`;
    }
    if (this.isReadyToHarvest(plot, nowMs)) return "Right-click to harvest";
    return "Growing...";
  }

  tryInteract(plot: PlotState | null, selectedSeedItemId: string | null, nowMs: number): void {
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
      events.emit("notification", {
        message: `Harvested ${crop.yield.qty}x ${getItem(crop.yield.itemId).name}`,
      });
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
