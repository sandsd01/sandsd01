import * as THREE from "three";
import { getBuilding, type BuildingDef } from "../data/buildings";
import type { ItemStack } from "../data/recipes";
import { getItem } from "../data/items";
import { getZone } from "../world/zones";
import type { Terrain } from "../world/terrain";
import type { GameState, PlacedBuilding } from "../state/game-state";
import { addItem, hasQty, removeItem } from "./inventory";
import { GRID_CELL_SIZE, cellKey, worldToCell, type Cell } from "../utils/grid";
import type { Collidable } from "../utils/collision";
import { events } from "../utils/events";
import { merge, paint, placed } from "../world/geometry";
import { instantiate, type ModelLibrary, type ModelName } from "../world/models";

const VALID_COLOR = 0x4caf50;
const INVALID_COLOR = 0xe53935;
const POP_IN_MS = 220;
const SHAKE_MS = 260;
/** A quarter turn, so an open leaf stands side-on to the gap it was closing. */
const DOOR_OPEN_TURN = Math.PI / 2;
/** And hugs one side of the cell rather than pivoting about its middle. */
const DOOR_OPEN_SHIFT = 0.34;
/**
 * Anything declared this low is a floor, not an obstacle — step over it.
 *
 * Measured against `def.height`, which is design intent, NOT the height of the
 * model that gets placed. Those differ a lot: the fence standing in for a Wall
 * is really 0.35 units tall against a declared 2. Intent is the right source
 * here — a low fence model still means "this is a wall, it stops you" — but
 * swapping this to the measured height would silently make every wall in the
 * game walkable.
 */
const WALKABLE_HEIGHT = 0.35;

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

  if (def.isDoor) {
    // Two posts and a braced leaf between them. It has to read as a *gate* at
    // a glance and from the far side of the yard: sharing the wall's fence
    // model made a sealed base a wall with no findable door in it, which is
    // the exact problem this piece exists to solve.
    const post = 0x6f4c2e;
    const board = def.color;
    const parts: THREE.BufferGeometry[] = [];
    // Spans **z**, because that is the axis the fence model the walls use
    // spans. Built across x instead it stood edge-on inside its own wall run
    // and read as a single thin post — correct in the data, invisible as a
    // gate, and only findable by taking a screenshot of it.
    for (const dz of [-1, 1]) {
      parts.push(placed(paint(new THREE.BoxGeometry(0.2, h, 0.16), post), 0, h / 2, (dz * W) / 2.1));
    }
    for (const y of [0.28, 0.62, 0.9]) {
      parts.push(placed(paint(new THREE.BoxGeometry(0.12, 0.14, W * 0.82), board), 0, h * y, 0));
    }
    // The diagonal is what says "gate" rather than "three rails".
    const brace = placed(paint(new THREE.BoxGeometry(0.1, 0.11, W * 0.95), board), 0, h * 0.59, 0);
    brace.rotateX(0.62);
    parts.push(brace);
    return merge(parts);
  }

  if (def.id === "spike_trap" || def.id === "heavy_trap") {
    // A low bed with teeth. Sits under WALKABLE_HEIGHT so nothing walks around
    // it, and the foundation's plain slab — which is what this would otherwise
    // inherit — reads as a floor you are meant to stand on.
    //
    // The heavy one is told apart by its teeth, not by its tint: four long
    // blades instead of nine short ones. Two traps that differed only in
    // colour would leave a player unable to see which line they had laid.
    const heavy = def.id === "heavy_trap";
    const frame = heavy ? 0x413f4c : 0x5a5148;
    const spike = heavy ? 0xd6d0e2 : 0xb8b0a2;
    const parts: THREE.BufferGeometry[] = [
      placed(paint(new THREE.BoxGeometry(W, h * 0.35, W), frame), 0, h * 0.17, 0),
    ];
    const offsets = heavy ? [-0.22, 0.22] : [-0.3, 0, 0.3];
    const radius = heavy ? 0.12 : 0.07;
    const length = heavy ? 0.52 : 0.3;
    for (const dx of offsets) {
      for (const dz of offsets) {
        parts.push(
          placed(
            paint(new THREE.ConeGeometry(radius, length, 4), spike),
            dx * W,
            h * 0.35 + length / 2,
            dz * W,
          ),
        );
      }
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
  const WALL_POSTS: Record<string, number> = {
    brick_wall: 0x8a4a30,
    // Ancient stone is not timber-framed. Its posts read a shade darker than
    // its own panel, which is what keeps a wall of them from flattening into
    // one grey block at the distance a raid is watched from.
    reinforced_wall: 0x4c4a57,
  };
  const post = WALL_POSTS[def.id] ?? 0x6f4c2e;
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

// Pack models standing in for the procedural pieces. The footprint and height
// in data/buildings.ts still drive placement and collision — only the mesh
// changes — so a model that reads slightly differently can't desync what the
// grid thinks is occupied.
const BUILDING_MODELS: Record<string, ModelName> = {
  wall: "fence",
  foundation: "building-platform",
  farm_plot: "patch-dirt",
  brick_wall: "building-structure",
  forge: "forge",
  anvil: "anvil",
  workbench: "workbench",
  long_wall: "fence",
  barrel: "barrel",
};

type InvalidReason = "occupied" | "zone";

/** The four placements a piece can take, in degrees. */
export const ROTATION_STEPS = [0, 90, 180, 270] as const;

/**
 * A footprint turned by `rotation` degrees about the anchor cell. Cells are
 * integer offsets, so a quarter turn is an exact swap — no rounding, and a
 * rotated 2x1 covers exactly the two cells it looks like it covers.
 */
export function rotateFootprint(cells: readonly Cell[], rotation: number): Cell[] {
  const turns = (((rotation / 90) | 0) % 4 + 4) % 4;
  return cells.map((cell) => {
    switch (turns) {
      case 1:
        return { x: -cell.z, z: cell.x };
      case 2:
        return { x: -cell.x, z: -cell.z };
      case 3:
        return { x: cell.z, z: -cell.x };
      default:
        return { x: cell.x, z: cell.z };
    }
  });
}

export class BuildingSystem {
  private selectedBuildingId: string | null = null;
  private ghost: THREE.Object3D | null = null;
  /** Quarter turns applied to the piece being placed, in degrees. */
  private rotation = 0;
  private ghostValid = false;
  private invalidReason: InvalidReason | null = null;
  private readonly meshes = new Map<string, THREE.Object3D>();
  private readonly occupancy = new Map<string, string>(); // cell key -> placedBuilding.id
  private readonly popIns: { mesh: THREE.Object3D; startMs: number }[] = [];
  /**
   * Where each mesh stands when it is whole. The damage lean and the hit shake
   * both push the mesh off this, and each has to start from the untouched
   * transform rather than from wherever the other left it — reading the pose
   * back off the mesh would let a hundred small nudges accumulate into a wall
   * lying flat in the dirt.
   */
  private readonly baseTransforms = new Map<
    string,
    { x: number; y: number; z: number; yaw: number }
  >();
  private readonly shakes: { id: string; startMs: number }[] = [];
  // Seeded from the loaded save rather than starting at zero. This used to be a
  // module-level counter, which restarts at 0 on every page load while the save
  // still holds building-0..N — so the first piece placed after a reload reused
  // a live id. Ids key `state.containers`, `this.meshes`, `this.occupancy` and
  // the `.find()` in farming's plotWorldPos, so a collision handed a new barrel
  // an old barrel's contents and pinned a new plot to an old plot's cell.
  private nextInstanceId = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly terrain: Terrain,
    private readonly state: GameState,
    private readonly models: ModelLibrary = {},
  ) {
    // Rehydrate any buildings restored from a save, damage and all — a wall
    // that was half beaten down when the tab closed should not come back
    // standing straight.
    for (const placed of state.placedBuildings) {
      this.occupyCells(placed);
      this.spawnMesh(placed);
      this.applyPose(placed);
    }
    // Start issuing ids past whatever the save already used. Only this class's
    // own `building-N` ids matter here — the world's POI barrels carry a `poi-`
    // prefix and can never collide with these.
    for (const placed of state.placedBuildings) {
      const match = /^building-(\d+)$/.exec(placed.id);
      if (match) this.nextInstanceId = Math.max(this.nextInstanceId, Number(match[1]) + 1);
    }
  }

  selectBuilding(buildingId: string | null): void {
    this.selectedBuildingId = buildingId;
    this.rotation = 0;
    events.emit("building-selection-changed", { buildingId });
    this.disposeGhost();
    if (buildingId) this.createGhost(getBuilding(buildingId));
  }

  /** Turns the piece being placed a quarter turn. */
  rotateSelection(): void {
    if (!this.selectedBuildingId) return;
    this.rotation = (this.rotation + 90) % 360;
    this.disposeGhost();
    this.createGhost(getBuilding(this.selectedBuildingId));
  }

  getRotation(): number {
    return this.rotation;
  }

  private disposeGhost(): void {
    if (!this.ghost) return;
    this.scene.remove(this.ghost);
    // Each selection built a fresh geometry and material and dropped the old
    // pair on the floor; over a building session that is a real leak.
    this.ghost.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    });
    this.ghost = null;
  }

  getSelectedBuildingId(): string | null {
    return this.selectedBuildingId;
  }

  /** Every reserved cell, as "x,z" -> the placed id holding it. */
  occupiedCells(): Record<string, string> {
    return Object.fromEntries(this.occupancy);
  }

  /**
   * One translucent box per cell the piece will actually occupy, at the height
   * the piece will actually be.
   *
   * Both of those used to be wrong: the ghost was a single box regardless of
   * footprint, and `def.height` is the *procedural fallback's* height, while
   * the model that really gets placed is sized by its own spec — so a brick
   * wall previewed at 2.4 units and arrived at whatever the GLB happened to
   * be. A preview that lies about the thing it previews is worse than none.
   */
  private createGhost(def: BuildingDef): void {
    const group = new THREE.Group();
    const height = this.placedHeightOf(def);
    const material = new THREE.MeshStandardMaterial({
      color: VALID_COLOR,
      transparent: true,
      opacity: 0.55,
    });

    for (const cell of rotateFootprint(def.footprintCells, this.rotation)) {
      const geometry = new THREE.BoxGeometry(GRID_CELL_SIZE * 0.9, height, GRID_CELL_SIZE * 0.9);
      const box = new THREE.Mesh(geometry, material);
      box.position.set(cell.x * GRID_CELL_SIZE, height / 2, cell.z * GRID_CELL_SIZE);
      group.add(box);
    }

    this.ghost = group;
    this.scene.add(group);
  }

  /** How tall the piece will really stand, measured off the model when there is one. */
  private placedHeightOf(def: BuildingDef): number {
    const modelName = BUILDING_MODELS[def.id];
    const model = modelName ? this.models[modelName] : undefined;
    if (!model) return def.height;
    const box = new THREE.Box3().setFromObject(model.scene);
    const height = box.max.y - box.min.y;
    return Number.isFinite(height) && height > 0.05 ? height : def.height;
  }

  // The anchor is the grid cell under the crosshair, not a fixed distance
  // ahead of the player: aiming is how a piece gets put somewhere specific,
  // which is what made building awkward before.
  private anchorCellFor(aim: { x: number; z: number }): Cell {
    return worldToCell(aim.x, aim.z);
  }

  // Returns null when valid, or the reason it isn't — used both to color the
  // ghost and to explain the block to the player via getPlacementPrompt().
  private placementInvalidReason(def: BuildingDef, anchor: Cell): InvalidReason | null {
    for (const offset of rotateFootprint(def.footprintCells, this.rotation)) {
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
      const costText = def.cost.map((c) => `${c.qty} ${getItem(c.itemId).name}`).join(", ");
      return `Right-click to place ${def.name} (${costText})`;
    }
    if (this.invalidReason === "occupied") return "Can't place here — space is occupied";
    return "Can only build in the open area near spawn";
  }

  update(aim: { x: number; z: number }, nowMs: number, canPlace = true): void {
    this.updatePopIns(nowMs);
    this.updateShakes(nowMs);

    if (this.ghost) this.ghost.visible = canPlace;
    if (!this.selectedBuildingId || !this.ghost || !canPlace) return;
    const def = getBuilding(this.selectedBuildingId);
    const anchor = this.anchorCellFor(aim);
    const worldX = anchor.x * GRID_CELL_SIZE;
    const worldZ = anchor.z * GRID_CELL_SIZE;
    const y = this.terrain.heightAt(worldX, worldZ);

    this.ghost.position.set(worldX, y, worldZ);
    this.invalidReason = this.placementInvalidReason(def, anchor);
    this.ghostValid = this.invalidReason === null;
    // Every box in the group shares one material, so recolouring once does it.
    const first = this.ghost.children[0] as THREE.Mesh | undefined;
    if (first) {
      (first.material as THREE.MeshStandardMaterial).color.setHex(
        this.ghostValid ? VALID_COLOR : INVALID_COLOR,
      );
    }
  }

  /**
   * Places at an exact cell, bypassing aiming. For tests that need a known
   * layout — driving the mouse into a precise grid cell under software
   * rendering is slow and flaky, and the layout is the thing under test, not
   * the aiming.
   */
  placeAt(buildingId: string, cellX: number, cellZ: number, rotation: number, nowMs: number):
    string | null {
    const def = getBuilding(buildingId);
    const previous = this.rotation;
    this.rotation = rotation;
    const valid = this.isPlacementValid(def, { x: cellX, z: cellZ });
    this.rotation = previous;
    if (!valid) return null;

    const placed: PlacedBuilding = {
      id: `building-${this.nextInstanceId++}`,
      rotation,
      buildingId,
      cellX,
      cellZ,
    };
    this.state.placedBuildings.push(placed);
    this.occupyCells(placed);
    this.spawnMesh(placed, nowMs);
    events.emit("building-placed", { id: placed.id, buildingId });
    return placed.id;
  }

  tryPlace(aim: { x: number; z: number }, nowMs: number): boolean {
    if (!this.selectedBuildingId) return false;
    const def = getBuilding(this.selectedBuildingId);
    const anchor = this.anchorCellFor(aim);
    if (!this.isPlacementValid(def, anchor)) return false;

    for (const cost of def.cost) {
      if (!hasQty(this.state, cost.itemId, cost.qty)) {
        events.emit("notification", { message: `Not enough ${getItem(cost.itemId).name}` });
        return false;
      }
    }
    for (const cost of def.cost) removeItem(this.state, cost.itemId, cost.qty);

    const placed: PlacedBuilding = {
      id: `building-${this.nextInstanceId++}`,
      rotation: this.rotation,
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

  /**
   * A struck piece jolts for a moment. The flash the enemies use is off the
   * table here (shared materials — see `applyPose`), and a shake carries
   * further anyway: you can see which wall is being worked on from across the
   * yard without having to read its colour.
   */
  private updateShakes(nowMs: number): void {
    for (let i = this.shakes.length - 1; i >= 0; i--) {
      const shake = this.shakes[i];
      const mesh = this.meshes.get(shake.id);
      const base = this.baseTransforms.get(shake.id);
      const placed = this.state.placedBuildings.find((p) => p.id === shake.id);
      if (!mesh || !base) {
        this.shakes.splice(i, 1);
        continue;
      }
      // Added to where the piece *rests*, not to its raw cell centre: an open
      // gate rests off-centre, and shaking from the centre would snap it shut
      // for a quarter of a second every time something hit it.
      const rest = placed ? this.poseOffset(placed) : { x: 0, z: 0 };
      const elapsed = nowMs - shake.startMs;
      if (elapsed >= SHAKE_MS) {
        mesh.position.x = base.x + rest.x;
        mesh.position.z = base.z + rest.z;
        this.shakes.splice(i, 1);
        continue;
      }
      const decay = 1 - elapsed / SHAKE_MS;
      const jolt = Math.sin(elapsed * 0.06) * 0.07 * decay;
      mesh.position.x = base.x + rest.x + jolt;
      mesh.position.z = base.z + rest.z + jolt * 0.6;
    }
  }

  /**
   * Takes a placed piece back down and refunds what it cost, in full.
   *
   * Nothing could be removed before this: `occupancy` and `meshes` were only
   * ever written to, and `state.placedBuildings` only ever pushed, so a piece
   * put down in the wrong cell was wrong for the life of the save. Everything
   * keyed by the building's id has to be released here — a leftover entry in
   * any one of them is exactly the shape of the id-collision bug that let a
   * new barrel open holding an old barrel's contents.
   *
   * Returns what was refunded, or null when there is nothing there.
   */
  demolish(placedId: string): { buildingId: string; refunded: ItemStack[] } | null {
    return this.removePlaced(placedId, true);
  }

  /**
   * Beaten down rather than taken down: same teardown, no refund. Raiders
   * destroying a wall must not post the planks back through the letterbox.
   *
   * This goes through `removePlaced` rather than being a second teardown path
   * of its own. Five separate places key off a building's id, and the last
   * time one of them was missed a new barrel opened holding an old barrel's
   * contents.
   */
  destroy(placedId: string): { buildingId: string } | null {
    const result = this.removePlaced(placedId, false);
    return result && { buildingId: result.buildingId };
  }

  private removePlaced(
    placedId: string,
    refund: boolean,
  ): { buildingId: string; refunded: ItemStack[] } | null {
    const index = this.state.placedBuildings.findIndex((p) => p.id === placedId);
    if (index === -1) return null;
    const placed = this.state.placedBuildings[index];
    const def = getBuilding(placed.buildingId);

    this.state.placedBuildings.splice(index, 1);

    for (const offset of rotateFootprint(def.footprintCells, placed.rotation ?? 0)) {
      const cell = { x: placed.cellX + offset.x, z: placed.cellZ + offset.z };
      const key = cellKey(cell);
      // Only clear a cell this piece actually holds. Two pieces can share a
      // key when a POI barrel was scattered onto an occupied cell, and taking
      // one down must not free the other's ground.
      if (this.occupancy.get(key) === placedId) this.occupancy.delete(key);
    }

    const mesh = this.meshes.get(placedId);
    if (mesh) {
      this.scene.remove(mesh);
      this.meshes.delete(placedId);
      const popIn = this.popIns.findIndex((p) => p.mesh === mesh);
      if (popIn !== -1) this.popIns.splice(popIn, 1);
    }
    this.baseTransforms.delete(placedId);
    for (let i = this.shakes.length - 1; i >= 0; i--) {
      if (this.shakes[i].id === placedId) this.shakes.splice(i, 1);
    }

    const refunded = refund ? def.cost.map((stack) => ({ ...stack })) : [];
    for (const stack of refunded) addItem(this.state, stack.itemId, stack.qty);

    events.emit("building-removed", { id: placedId, buildingId: placed.buildingId });
    if (!refund) events.emit("building-destroyed", { id: placedId, buildingId: placed.buildingId });
    return { buildingId: placed.buildingId, refunded };
  }

  /** The piece holding the grid cell under a world position, if any. */
  buildingIdAt(worldX: number, worldZ: number): string | null {
    return this.occupancy.get(cellKey(worldToCell(worldX, worldZ))) ?? null;
  }

  /** What *kind* of piece stands on the cell under a world position. */
  buildingTypeAt(worldX: number, worldZ: number): string | null {
    const placedId = this.buildingIdAt(worldX, worldZ);
    if (!placedId) return null;
    return this.state.placedBuildings.find((p) => p.id === placedId)?.buildingId ?? null;
  }

  /** Damage taken and the total it can take, or null if there is no such piece. */
  healthOf(placedId: string): { damage: number; maxHealth: number } | null {
    const placed = this.state.placedBuildings.find((p) => p.id === placedId);
    if (!placed) return null;
    return { damage: placed.damage ?? 0, maxHealth: getBuilding(placed.buildingId).maxHealth };
  }

  /**
   * Lands a hit on a piece. Returns whether that hit destroyed it — the caller
   * needs to know, because a destroyed barrel has to spill what was inside it
   * and only `main.ts` owns the drop system.
   */
  damageBuilding(placedId: string, amount: number, nowMs: number): { destroyed: boolean } | null {
    const placed = this.state.placedBuildings.find((p) => p.id === placedId);
    if (!placed) return null;
    const def = getBuilding(placed.buildingId);
    placed.damage = Math.min(def.maxHealth, (placed.damage ?? 0) + amount);
    events.emit("building-damaged", {
      id: placedId,
      buildingId: placed.buildingId,
      damage: placed.damage,
      maxHealth: def.maxHealth,
    });
    if (placed.damage >= def.maxHealth) return { destroyed: true };
    this.shakes.push({ id: placedId, startMs: nowMs });
    this.applyPose(placed);
    return { destroyed: false };
  }

  /**
   * What putting a piece back in one piece costs: its build cost scaled by how
   * much of it is broken, so half a wall is half the planks. Rounded up, and
   * never free while any damage remains — a repair that cost nothing would
   * make walls immortal for the price of holding a key.
   *
   * Empty when the piece is whole; null when there is no such piece.
   */
  repairCost(placedId: string): ItemStack[] | null {
    const placed = this.state.placedBuildings.find((p) => p.id === placedId);
    if (!placed) return null;
    const def = getBuilding(placed.buildingId);
    const damage = placed.damage ?? 0;
    if (damage <= 0) return [];
    const fraction = Math.min(1, damage / def.maxHealth);
    return def.cost.map((stack) => ({
      itemId: stack.itemId,
      qty: Math.max(1, Math.ceil(stack.qty * fraction)),
    }));
  }

  /** Spends the repair cost and makes the piece whole. False if it can't be paid. */
  repair(placedId: string): boolean {
    const cost = this.repairCost(placedId);
    if (!cost || cost.length === 0) return false;
    for (const stack of cost) {
      if (!hasQty(this.state, stack.itemId, stack.qty)) {
        events.emit("notification", {
          message: `Not enough ${getItem(stack.itemId).name} to repair`,
        });
        return false;
      }
    }
    for (const stack of cost) removeItem(this.state, stack.itemId, stack.qty);

    const placed = this.state.placedBuildings.find((p) => p.id === placedId)!;
    placed.damage = 0;
    this.applyPose(placed);
    events.emit("building-repaired", { id: placedId, buildingId: placed.buildingId });
    return true;
  }

  /**
   * Where a piece stands once damage and, for a door, being open are both
   * accounted for. **One place computes the pose**: damage leans and sinks a
   * piece, an open gate turns and slides it, and both write the same
   * `rotation.y` — computed separately they would cancel, and a battered gate
   * would stand up straight the moment it was opened.
   *
   * Deliberately transform-only. `instantiate` uses `Object3D.clone(true)`,
   * which *shares* materials between instances, so tinting one battered wall
   * red would redden every wall in the world built from the same model.
   */
  private applyPose(placed: PlacedBuilding): void {
    const mesh = this.meshes.get(placed.id);
    const base = this.baseTransforms.get(placed.id);
    if (!mesh || !base) return;
    const def = getBuilding(placed.buildingId);
    const fraction = Math.min(1, (placed.damage ?? 0) / def.maxHealth);
    // Small numbers, and they have to stay small. A first pass sank a battered
    // piece by 0.18 of its height and leaned it 0.17rad; that reads well but
    // swings the top of the silhouette out of the crosshair's line, and a
    // nearly-destroyed brick wall became impossible to aim at from any
    // distance — so the one piece most in need of repair was the one piece
    // that could not be repaired. Measured, not guessed: see the note in
    // README on driving the real screens.
    // Neighbouring cells lean opposite ways. A whole run tipping the same way
    // by the same amount reads as "the fence was built like that"; the same
    // small angle alternating cell by cell reads as a line that has been
    // knocked about — which is the point, and costs no extra displacement.
    const lean = (placed.cellX + placed.cellZ) % 2 === 0 ? 1 : -1;
    const open = this.isOpenDoor(placed);
    mesh.position.y = base.y - fraction * 0.05 * def.height;
    mesh.rotation.y = base.yaw + (open ? DOOR_OPEN_TURN : 0) + fraction * 0.1 * lean;
    mesh.rotation.z = fraction * 0.07 * lean;
    const offset = this.poseOffset(placed);
    mesh.position.x = base.x + offset.x;
    mesh.position.z = base.z + offset.z;
  }

  /** How far a piece sits off its cell centre at rest. Only an open door does. */
  private poseOffset(placed: PlacedBuilding): { x: number; z: number } {
    if (!this.isOpenDoor(placed)) return { x: 0, z: 0 };
    const yaw = this.baseTransforms.get(placed.id)?.yaw ?? 0;
    return { x: Math.cos(yaw) * DOOR_OPEN_SHIFT, z: -Math.sin(yaw) * DOOR_OPEN_SHIFT };
  }

  private isOpenDoor(placed: PlacedBuilding): boolean {
    return getBuilding(placed.buildingId).isDoor === true && placed.open === true;
  }

  /**
   * Swings a door, and reports the state it landed in.
   *
   * Nothing in the enemy code knows what a door is, on purpose: shut, it is an
   * obstacle and they beat on it exactly as they beat on a wall; open, it is
   * not in the collidable list at all and they walk through the gap. They
   * still chase the player and nothing else.
   */
  toggleDoor(placedId: string): boolean | null {
    const placed = this.state.placedBuildings.find((p) => p.id === placedId);
    if (!placed || !getBuilding(placed.buildingId).isDoor) return null;
    placed.open = !placed.open;
    this.applyPose(placed);
    events.emit("door-toggled", { id: placedId, open: placed.open });
    return placed.open;
  }

  /** Whether the aimed piece is a door, and whether it stands open. */
  doorStateOf(placedId: string): { open: boolean } | null {
    const placed = this.state.placedBuildings.find((p) => p.id === placedId);
    if (!placed || !getBuilding(placed.buildingId).isDoor) return null;
    return { open: placed.open === true };
  }

  /** Whether a cell holds something that blocks movement. */
  private blocksAt(cellX: number, cellZ: number): boolean {
    const id = this.occupancy.get(cellKey({ x: cellX, z: cellZ }));
    if (!id) return false;
    const placed = this.state.placedBuildings.find((p) => p.id === id);
    if (!placed) return false;
    const def = getBuilding(placed.buildingId);
    if (this.isOpenDoor(placed)) return false;
    return !def.isPlot && def.height > WALKABLE_HEIGHT;
  }

  private occupyCells(placed: PlacedBuilding): void {
    const def = getBuilding(placed.buildingId);
    for (const offset of rotateFootprint(def.footprintCells, placed.rotation ?? 0)) {
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

    const modelName = BUILDING_MODELS[def.id];
    const model = modelName ? this.models[modelName] : undefined;
    let mesh: THREE.Object3D;
    if (model) {
      mesh = instantiate(model);
    } else {
      const fallback = new THREE.Mesh(buildBuildingGeometry(def), BUILDING_MATERIAL);
      fallback.castShadow = true;
      fallback.receiveShadow = true;
      mesh = fallback;
    }
    // Both the models and the procedural geometry are built from their base
    // up, so a piece sits on the terrain rather than being centred in it.
    //
    // A multi-cell piece is centred over the cells it occupies rather than
    // hanging off its anchor: the anchor is where the grid bookkeeping starts,
    // not where the object visually belongs.
    const cells = rotateFootprint(def.footprintCells, placed.rotation ?? 0);
    let offsetX = 0;
    let offsetZ = 0;
    for (const cell of cells) {
      offsetX += cell.x;
      offsetZ += cell.z;
    }
    offsetX = (offsetX / cells.length) * GRID_CELL_SIZE;
    offsetZ = (offsetZ / cells.length) * GRID_CELL_SIZE;

    const yaw = ((placed.rotation ?? 0) * Math.PI) / 180;
    mesh.position.set(worldX + offsetX, y, worldZ + offsetZ);
    mesh.rotation.y = yaw;
    mesh.name = placed.id;
    this.baseTransforms.set(placed.id, { x: worldX + offsetX, y, z: worldZ + offsetZ, yaw });
    if (nowMs !== undefined) {
      mesh.scale.setScalar(0.05);
      this.popIns.push({ mesh, startMs: nowMs });
    }
    this.scene.add(mesh);
    this.meshes.set(placed.id, mesh);
  }

  // Whether a given kind of building stands within reach of a point. Crafting
  // uses this for recipes that need a station.
  hasNearby(buildingId: string, x: number, z: number, radius: number): boolean {
    return this.state.placedBuildings.some((placed) => {
      if (placed.buildingId !== buildingId) return false;
      const dx = placed.cellX * GRID_CELL_SIZE - x;
      const dz = placed.cellZ * GRID_CELL_SIZE - z;
      return Math.hypot(dx, dz) <= radius;
    });
  }

  getMesh(placedId: string): THREE.Object3D | undefined {
    return this.meshes.get(placedId);
  }

  /**
   * What blocks movement, one box per occupied cell.
   *
   * Two things were wrong here. It emitted a single circle at the anchor, so a
   * multi-cell piece only blocked its first cell and a run of walls had a
   * diagonal gap at every join where the inscribed circles failed to meet the
   * cell corners. And `isPlot` was the only exemption, which meant a
   * foundation — a floor slab two tenths of a unit tall — stood in the
   * player's way like a wall.
   */
  getCollidables(): Collidable[] {
    const result: Collidable[] = [];
    for (const placed of this.state.placedBuildings) {
      const def = getBuilding(placed.buildingId);
      if (def.isPlot || def.height <= WALKABLE_HEIGHT) continue;
      // An open gate is a gap. This has to agree with `blocksAt` above, which
      // is what decides a neighbour's `openFaces`: leave one of the two out
      // and the walls beside a propped-open gate go back to having the
      // diagonal seam #46 closed.
      if (this.isOpenDoor(placed)) continue;
      for (const offset of rotateFootprint(def.footprintCells, placed.rotation ?? 0)) {
        const cx = placed.cellX + offset.x;
        const cz = placed.cellZ + offset.z;
        result.push({
          x: cx * GRID_CELL_SIZE,
          z: cz * GRID_CELL_SIZE,
          radius: GRID_CELL_SIZE * 0.5,
          halfExtent: GRID_CELL_SIZE * 0.5,
          // A face with a solid neighbour behind it is internal to the run —
          // see the note on Collidable.openFaces.
          openFaces: {
            xPos: !this.blocksAt(cx + 1, cz),
            xNeg: !this.blocksAt(cx - 1, cz),
            zPos: !this.blocksAt(cx, cz + 1),
            zNeg: !this.blocksAt(cx, cz - 1),
          },
        });
      }
    }
    return result;
  }
}
