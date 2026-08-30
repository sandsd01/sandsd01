import type * as THREE from "three";
import type { GameState } from "../state/game-state";
import type { ResourceNode } from "../world/resource-node";
import type { Enemy } from "../systems/enemy-ai";
import { getZone, ZONE_GROUND_COLOR } from "../world/zones";
import { GRID_CELL_SIZE } from "../utils/grid";
import { colorToCss, el } from "./dom";

const SIZE = 168; // css pixels
const RANGE = 70; // world units from the centre to the edge
// The map is a glance, not a study: redrawing it every frame would spend real
// time on canvas work nobody can perceive between refreshes.
const REDRAW_INTERVAL_MS = 120;
// The ground is sampled on a coarse grid rather than per pixel — biome edges
// are soft and this runs on the CPU.
const GROUND_STEP = 12;

// Red is reserved for enemies. Berries are crimson in the world, but on a map
// dense with bushes a field of red dots reads as being surrounded — so they
// take a violet here instead, which no threat marker uses.
const NODE_COLORS: Record<string, string> = {
  tree: "#3f7d33",
  rock: "#9a968c",
  berry_bush: "#8e4fa8",
  clay_pit: "#9c6642",
  iron_vein: "#c87a44",
};

// North-up, player-centred. North-up rather than rotating the whole map with
// the camera: a map that spins is much harder to build a mental picture from,
// which is the entire reason to have one.
export class Minimap {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private lastDrawMs = -Infinity;

  constructor(root: HTMLElement) {
    const wrap = el("div", "hud-minimap");
    this.canvas = document.createElement("canvas");
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = SIZE * dpr;
    this.canvas.height = SIZE * dpr;
    this.canvas.style.width = `${SIZE}px`;
    this.canvas.style.height = `${SIZE}px`;
    wrap.appendChild(this.canvas);
    root.appendChild(wrap);

    this.ctx = this.canvas.getContext("2d");
    this.ctx?.scale(dpr, dpr);
  }

  update(
    nowMs: number,
    state: GameState,
    nodes: ResourceNode[],
    enemies: Enemy[],
    buildingMesh: (id: string) => THREE.Object3D | undefined,
    landmarks: { x: number; z: number }[] = [],
  ): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (nowMs - this.lastDrawMs < REDRAW_INTERVAL_MS) return;
    this.lastDrawMs = nowMs;

    const { x: px, z: pz, yaw } = state.player;
    const half = SIZE / 2;
    const scale = half / RANGE;
    // World +x is map +x; world +z is map +y, so north (−z) is up.
    const toMap = (wx: number, wz: number) => ({
      x: half + (wx - px) * scale,
      y: half + (wz - pz) * scale,
    });

    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.save();
    ctx.beginPath();
    ctx.arc(half, half, half, 0, Math.PI * 2);
    ctx.clip();

    // Biomes, sampled on a coarse grid.
    for (let sx = 0; sx < SIZE; sx += GROUND_STEP) {
      for (let sy = 0; sy < SIZE; sy += GROUND_STEP) {
        const wx = px + (sx + GROUND_STEP / 2 - half) / scale;
        const wz = pz + (sy + GROUND_STEP / 2 - half) / scale;
        ctx.fillStyle = colorToCss(ZONE_GROUND_COLOR[getZone(wx, wz)]);
        ctx.fillRect(sx, sy, GROUND_STEP, GROUND_STEP);
      }
    }
    // Knock the whole ground back so the markers on top stay the bright part.
    ctx.fillStyle = "rgba(20, 17, 14, 0.45)";
    ctx.fillRect(0, 0, SIZE, SIZE);

    for (const node of nodes) {
      if (node.depleted) continue;
      const p = toMap(node.object.position.x, node.object.position.z);
      ctx.fillStyle = NODE_COLORS[node.config.kind] ?? "#ffffff";
      // Small and slightly transparent: resources are context, not the thing
      // being looked for, and there are hundreds of them in range.
      ctx.globalAlpha = 0.75;
      ctx.fillRect(p.x - 1, p.y - 1, 2, 2);
      ctx.globalAlpha = 1;
    }

    for (const placed of state.placedBuildings) {
      if (!buildingMesh(placed.id)) continue;
      const p = toMap(placed.cellX * GRID_CELL_SIZE, placed.cellZ * GRID_CELL_SIZE);
      ctx.fillStyle = "#d8b45a";
      ctx.fillRect(p.x - 2.5, p.y - 2.5, 5, 5);
    }

    // Enemies read as the one urgent thing on the map, so they get the only
    // outlined marker as well as the only red.
    // Landmarks get an outlined triangle: a shape nothing else on the map
    // uses, so which blip is which never depends on telling two tints apart.
    for (const landmark of landmarks) {
      const p = toMap(landmark.x, landmark.z);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - 5);
      ctx.lineTo(p.x + 4.5, p.y + 3.5);
      ctx.lineTo(p.x - 4.5, p.y + 3.5);
      ctx.closePath();
      ctx.fillStyle = "#f4eee2";
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(20, 17, 14, 0.8)";
      ctx.stroke();
    }

    for (const enemy of enemies) {
      const p = toMap(enemy.object.position.x, enemy.object.position.z);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = "#e2402c";
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
      ctx.stroke();
    }

    // The player is a triangle rather than a dot so the map shows facing as
    // well as position — without it, north-up is disorienting.
    ctx.translate(half, half);
    // Player forward in world terms is (sin yaw, cos yaw) on (x, z), and the
    // map puts +z downward. Rotating the up-pointing triangle by θ sends it to
    // (sin θ, −cos θ), so matching the two gives θ = π − yaw. (Plain −yaw looks
    // plausible and is 180° out at every heading.)
    ctx.rotate(Math.PI - yaw);
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.lineTo(4.5, 5);
    ctx.lineTo(0, 2.5);
    ctx.lineTo(-4.5, 5);
    ctx.closePath();
    ctx.fillStyle = "#f4eee2";
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.7)";
    ctx.stroke();

    ctx.restore();
  }
}
