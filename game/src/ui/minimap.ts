import type * as THREE from "three";
import type { GameState } from "../state/game-state";
import type { ResourceNode } from "../world/resource-node";
import type { Enemy } from "../systems/enemy-ai";
import { getZone, ZONE_GROUND_COLOR } from "../world/zones";
import { GRID_CELL_SIZE } from "../utils/grid";
import { colorToCss, el } from "./dom";
import { iconSvg, type IconName } from "./icons";

// Smaller and square. A circle wastes its corners and, at the old 168px, the
// map was the largest single thing on the HUD after the hotbar — for something
// consulted at a glance.
const SIZE = 132; // css pixels
const RANGE = 70; // world units from the centre to the edge
/**
 * How close an enemy has to be to appear at all.
 *
 * Every enemy within the full range used to be drawn, which during a raid is a
 * screenful of red that says "danger" without saying where. Half the range is
 * near enough to be the player's problem now.
 */
const ENEMY_RANGE = RANGE / 2;
/** Drawn size of the pin icons, in css pixels. */
const ICON_SIZE = 13;
// The map is a glance, not a study: redrawing it every frame would spend real
// time on canvas work nobody can perceive between refreshes.
const REDRAW_INTERVAL_MS = 120;
// The ground is sampled on a coarse grid rather than per pixel — biome edges
// are soft and this runs on the CPU.
const GROUND_STEP = 12;
// How far inside the edge an off-map pin sits, so it is drawn whole rather
// than clipped in half.
const EDGE_INSET = 7;

/**
 * The pin icons, rasterised once from the same lucide set the rest of the UI
 * uses.
 *
 * Canvas cannot draw an inline SVG string directly, so each one becomes an
 * Image backed by a data URL. They decode asynchronously, and the map draws
 * several times a second forever — so a pin simply does not appear until its
 * image is ready, rather than the map waiting on anything.
 *
 * `currentColor` is substituted at build time here: an SVG in an Image has no
 * document to inherit colour from, so leaving it would draw nothing at all.
 */
function rasterise(name: IconName, color: string): HTMLImageElement {
  // Only the colour is substituted. The first version also injected
  // width/height by prepending them to the `<svg` tag — but lucide's files
  // already carry both, so that produced duplicate attributes, which is
  // invalid XML. An SVG inside an Image is parsed strictly, so it failed to
  // decode, `naturalWidth` stayed 0, and every pin silently drew nothing while
  // the map itself looked perfectly fine. `drawImage` scales to whatever size
  // is asked for, so there was never anything to gain by setting them.
  const svg = iconSvg(name).replace(/currentColor/g, color);
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  return img;
}

// Red is reserved for enemies. Berries are crimson in the world, but on a map
// dense with bushes a field of red dots reads as being surrounded — so they
// take a violet here instead, which no threat marker uses.
const NODE_COLORS: Record<string, string> = {
  tree: "#3f7d33",
  rock: "#9a968c",
  berry_bush: "#8e4fa8",
  clay_pit: "#9c6642",
  iron_vein: "#c87a44",
  ancient_stone: "#c9c3dc",
  glow_crystal: "#63d9ff",
  cloud_iron: "#bcd8e8",
};

// North-up, player-centred. North-up rather than rotating the whole map with
// the camera: a map that spins is much harder to build a mental picture from,
// which is the entire reason to have one.
export class Minimap {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly coords: HTMLDivElement;
  private lastDrawMs = -Infinity;
  /**
   * What the last redraw actually put on the map, by kind.
   *
   * Recorded rather than inferred: the map is a canvas, so the only other way
   * to ask "is that enemy shown?" is to read pixels and guess at what a red
   * blob means. This counts the pins as they are drawn, which is the same
   * question asked of the code that answers it.
   */
  private readonly drawn: Record<string, number> = {
    building: 0,
    portal: 0,
    enemy: 0,
    landmark: 0,
  };
  /** Pin art, decoded once. See `rasterise`. */
  private readonly pins = {
    player: rasterise("smile", "#f4eee2"),
    building: rasterise("house", "#d8b45a"),
    portal: rasterise("doorOpen", "#b58cf0"),
    enemy: rasterise("skull", "#e2402c"),
  };

  constructor(root: HTMLElement) {
    const wrap = el("div", "hud-minimap");
    this.canvas = document.createElement("canvas");
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = SIZE * dpr;
    this.canvas.height = SIZE * dpr;
    this.canvas.style.width = `${SIZE}px`;
    this.canvas.style.height = `${SIZE}px`;
    wrap.appendChild(this.canvas);
    // Where you are, in words. The map shows the shape of the ground around
    // the player and nothing about where that ground *is*; a number is what
    // lets someone say "meet me at 40, -120" or walk back to a spot they wrote
    // down. Small and dim on purpose — it is a reference, not a readout to
    // watch.
    this.coords = el("div", "hud-minimap-coords", "0, 0");
    wrap.appendChild(this.coords);
    root.appendChild(wrap);

    this.ctx = this.canvas.getContext("2d");
    this.ctx?.scale(dpr, dpr);
  }

  /** What the last redraw drew, by kind. For the checks. */
  getDrawnCounts(): Record<string, number> {
    return { ...this.drawn };
  }

  /** The map's own size and how far it reaches, so a check need not hardcode. */
  getGeometry(): { size: number; range: number; enemyRange: number } {
    return { size: SIZE, range: RANGE, enemyRange: ENEMY_RANGE };
  }

  update(
    nowMs: number,
    state: GameState,
    nodes: ResourceNode[],
    enemies: Enemy[],
    buildingMesh: (id: string) => THREE.Object3D | undefined,
    landmarks: { id: string; x: number; z: number }[] = [],
    /**
     * Ways into another region. Always drawn, near or far — a portal is a
     * destination rather than scenery, and one you cannot find is one you
     * cannot use.
     */
    portals: { x: number; z: number }[] = [],
    /**
     * A flat ground colour for a place with no biomes, or null for the
     * overworld's sampled zones. Underground the zone map is still perfectly
     * happy to answer — with the colour of the forest a hundred metres above
     * the player's head, which is worse than no map at all.
     */
    enclosedGround: number | null = null,
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

    /** Draws a pin centred on a map point, or nothing if it has not decoded. */
    const pin = (img: HTMLImageElement, x: number, y: number, size = ICON_SIZE) => {
      if (!img.complete || img.naturalWidth === 0) return;
      ctx.drawImage(img, x - size / 2, y - size / 2, size, size);
    };

    for (const key of Object.keys(this.drawn)) this.drawn[key] = 0;

    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, SIZE, SIZE);
    ctx.clip();

    this.coords.textContent = `${Math.round(px)}, ${Math.round(pz)}`;

    if (enclosedGround !== null) {
      ctx.fillStyle = colorToCss(enclosedGround);
      ctx.fillRect(0, 0, SIZE, SIZE);
    } else {
      // Biomes, sampled on a coarse grid.
      for (let sx = 0; sx < SIZE; sx += GROUND_STEP) {
        for (let sy = 0; sy < SIZE; sy += GROUND_STEP) {
          const wx = px + (sx + GROUND_STEP / 2 - half) / scale;
          const wz = pz + (sy + GROUND_STEP / 2 - half) / scale;
          ctx.fillStyle = colorToCss(ZONE_GROUND_COLOR[getZone(wx, wz)]);
          ctx.fillRect(sx, sy, GROUND_STEP, GROUND_STEP);
        }
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
      // Nothing the player built is anywhere near them underground, and a
      // homestead drawn over a cave floor would be a map of somewhere else.
      if (enclosedGround !== null) break;
      if (!buildingMesh(placed.id)) continue;
      // Only what the player built. The world seeds its points of interest
      // with barrels and the like, and those sit at exactly the spots the
      // landmark markers already cover — so drawing them put a house icon
      // underneath a landmark triangle at half the POIs on screen. Two
      // markers for one place is worse than either alone, and of the two the
      // landmark is the one that carries the discovery.
      if (placed.id.startsWith("poi-")) continue;
      const p = toMap(placed.cellX * GRID_CELL_SIZE, placed.cellZ * GRID_CELL_SIZE);
      pin(this.pins.building, p.x, p.y, 11);
      this.drawn.building++;
    }

    // Enemies read as the one urgent thing on the map, so they get the only
    // outlined marker as well as the only red.
    // Landmarks get an outlined triangle: a shape nothing else on the map
    // uses, so which blip is which never depends on telling two tints apart.
    //
    // A landmark the player has walked up to is never dropped, however far
    // behind them it is: it is pinned to the rim of the map in the direction
    // it lies, as a hollow diamond. The outer ring stands past the fog, so
    // without this, finding one a second time would be exactly as hard as
    // finding it the first — and the pin has to be a different *shape* from
    // the in-range triangle, not a different tint, or "there" and "that way"
    // would be the same marker.
    for (const landmark of landmarks) {
      const dx = landmark.x - px;
      const dz = landmark.z - pz;
      const distance = Math.hypot(dx, dz);
      const inRange = distance <= RANGE;
      if (!inRange && !state.discovered.includes(landmark.id)) continue;

      if (inRange) {
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
        this.drawn.landmark++;
        continue;
      }

      // Clamped to just inside the rim, so the pin sits on the map rather than
      // half off the clipped edge.
      const edge = half - EDGE_INSET;
      const cx = half + (dx / distance) * edge;
      const cy = half + (dz / distance) * edge;
      ctx.beginPath();
      ctx.moveTo(cx, cy - 4.5);
      ctx.lineTo(cx + 4.5, cy);
      ctx.lineTo(cx, cy + 4.5);
      ctx.lineTo(cx - 4.5, cy);
      ctx.closePath();
      ctx.fillStyle = "rgba(20, 17, 14, 0.55)";
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "#f4eee2";
      ctx.stroke();
    }

    // Portals, pinned to the edge when they are out of range rather than
    // dropped, for the same reason discovered landmarks are: the point of the
    // marker is finding the thing a second time.
    for (const portal of portals) {
      const dx = portal.x - px;
      const dz = portal.z - pz;
      const distance = Math.hypot(dx, dz);
      if (distance <= RANGE) {
        const p = toMap(portal.x, portal.z);
        pin(this.pins.portal, p.x, p.y, 13);
        this.drawn.portal++;
        continue;
      }
      const edge = half - EDGE_INSET;
      pin(
        this.pins.portal,
        half + (dx / distance) * edge,
        half + (dz / distance) * edge,
        11,
      );
      this.drawn.portal++;
    }

    // Only the ones close enough to matter. Drawing every enemy in the full
    // range fills the map with red during a raid, which reads as "danger
    // everywhere" and so tells the player nothing about where to look.
    for (const enemy of enemies) {
      const ex = enemy.object.position.x;
      const ez = enemy.object.position.z;
      if (Math.hypot(ex - px, ez - pz) > ENEMY_RANGE) continue;
      const p = toMap(ex, ez);
      pin(this.pins.enemy, p.x, p.y, 12);
      this.drawn.enemy++;
    }

    // The player is a triangle rather than a dot so the map shows facing as
    // well as position — without it, north-up is disorienting.
    // The player is a face, and the face stays upright — a rotating face reads
    // as a head lying on its side rather than as a heading. The facing that
    // the old triangle carried is not thrown away though: it moves to a small
    // wedge that orbits the face, so north-up still tells you which way you
    // are pointed.
    //
    // Player forward in world terms is (sin yaw, cos yaw) on (x, z), and the
    // map puts +z downward. Rotating an up-pointing shape by θ sends it to
    // (sin θ, −cos θ), so matching the two gives θ = π − yaw. (Plain −yaw looks
    // plausible and is 180° out at every heading.)
    ctx.save();
    ctx.translate(half, half);
    ctx.rotate(Math.PI - yaw);
    ctx.beginPath();
    ctx.moveTo(0, -11);
    ctx.lineTo(3.5, -6);
    ctx.lineTo(-3.5, -6);
    ctx.closePath();
    ctx.fillStyle = "#f4eee2";
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.7)";
    ctx.stroke();
    ctx.restore();

    pin(this.pins.player, half, half, 15);

    ctx.restore();
  }
}
