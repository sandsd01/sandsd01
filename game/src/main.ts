import * as THREE from "three";
import "./style.css";

import { createScene } from "./core/scene";
import { createRenderer } from "./core/renderer";
import { ThirdPersonCamera } from "./core/camera";
import { GameLoop } from "./core/loop";
import { GameClock } from "./core/clock";
import { InputManager } from "./input/input-manager";

import { PlayerController } from "./player/player-controller";
import { damagePlayer, isPlayerDead, respawnPlayer } from "./player/player-state";

import { Terrain } from "./world/terrain";
import { scatterResourceNodes, addNodesToScene } from "./world/world-objects";

import { getInteractionPrompt, tryGather } from "./systems/gathering";
import { BuildingSystem } from "./systems/building";
import { FarmingSystem } from "./systems/farming";
import { EnemyManager } from "./systems/enemy-ai";
import { PlayerCombat } from "./systems/combat";
import { DayNightSystem, DAY_LENGTH_MS } from "./systems/day-night";
import { saveGame, loadGame } from "./systems/save-load";

import { createInitialState, type GameState } from "./state/game-state";

import { Hud } from "./ui/hud";
import { InventoryPanel } from "./ui/inventory-panel";
import { CraftingPanel } from "./ui/crafting-panel";
import { BuildingPanel } from "./ui/building-panel";
import { AudioHooks } from "./systems/audio-hooks";
import { sound } from "./utils/audio";
import type { Collidable } from "./utils/collision";

const canvas = document.getElementById("game-canvas") as HTMLCanvasElement;
const uiRoot = document.getElementById("ui-root") as HTMLElement;

const state = loadGame() ?? createInitialState();

const sceneRig = createScene();
const { scene } = sceneRig;
const terrain = new Terrain(state.seed);
scene.add(terrain.mesh);

const renderer = createRenderer(canvas);
const camera = new ThirdPersonCamera();
const input = new InputManager(canvas);
const clock = new GameClock(state.elapsedMs);
const dayNight = new DayNightSystem(sceneRig);

const player = new PlayerController(state, terrain);
scene.add(player.object);

const resourceNodes = scatterResourceNodes(terrain, state.seed);
addNodesToScene(scene, resourceNodes);

const buildingSystem = new BuildingSystem(scene, terrain, state);
const farmingSystem = new FarmingSystem(scene, terrain, state);
const enemyManager = new EnemyManager(scene, terrain, state.seed);
const playerCombat = new PlayerCombat();

const hud = new Hud(uiRoot, state);
new AudioHooks();
let selectedSeedItemId: string | null = null;
const inventoryPanel = new InventoryPanel(
  uiRoot,
  state,
  (id) => {
    selectedSeedItemId = id;
  },
  () => selectedSeedItemId,
);
const craftingPanel = new CraftingPanel(uiRoot, state);
const buildingPanel = new BuildingPanel(uiRoot, buildingSystem, canvas);

let currentNowMs = 0;
let respawnScheduled = false;

function scheduleRespawnIfDead(): void {
  if (!isPlayerDead(state) || respawnScheduled) return;
  respawnScheduled = true;
  window.setTimeout(() => {
    respawnPlayer(state);
    respawnScheduled = false;
  }, 2000);
}

function performPrimaryAction(): void {
  if (isPlayerDead(state)) return;
  const feet = player.getFeetPosition();
  const forward = camera.getForward();
  player.triggerSwing(currentNowMs);
  if (buildingSystem.getSelectedBuildingId()) {
    buildingSystem.tryPlace(feet, forward, currentNowMs);
  } else {
    playerCombat.tryAttack(state, enemyManager, feet.x, feet.z, currentNowMs);
  }
}

canvas.addEventListener("mousedown", (e) => {
  if (e.button !== 0) return;
  if (!input.isPointerLocked()) return;
  performPrimaryAction();
});

// Browsers block audio until a user gesture; the same click that requests
// pointer lock doubles as that gesture.
canvas.addEventListener("click", () => sound.unlock());

function getCollidables(): Collidable[] {
  const nodeCollidables: Collidable[] = resourceNodes
    .filter((n) => !n.depleted)
    .map((n) => ({ x: n.object.position.x, z: n.object.position.z, radius: 0.5 }));
  return [...nodeCollidables, ...buildingSystem.getCollidables()];
}

const loop = new GameLoop((dt) => {
  clock.tick(dt);
  currentNowMs = clock.now();
  state.elapsedMs = currentNowMs;
  dayNight.update(currentNowMs);
  hud.setTimeOfDay(dayNight.getTimeOfDay(currentNowMs));

  if (!isPlayerDead(state)) {
    const collidables = getCollidables();
    player.update(dt, currentNowMs, input, camera, collidables);
  }

  const feet = player.getFeetPosition();
  camera.update(feet.clone().add(new THREE.Vector3(0, 1.3, 0)), [terrain.mesh]);

  for (const node of resourceNodes) node.update(currentNowMs);
  farmingSystem.update(currentNowMs);

  if (!isPlayerDead(state)) {
    enemyManager.update(dt, currentNowMs, feet, (damage) => {
      damagePlayer(state, damage);
      scheduleRespawnIfDead();
    });
  }

  const forward = camera.getForward();
  buildingSystem.update(feet, forward, currentNowMs);

  if (input.wasJustPressed("KeyE") && !isPlayerDead(state)) {
    tryGather(state, resourceNodes, feet.x, feet.z, currentNowMs);
  }
  if (input.wasJustPressed("KeyF") && !isPlayerDead(state)) {
    farmingSystem.tryInteract(feet.x, feet.z, selectedSeedItemId, currentNowMs);
  }
  // Pointer Lock captures all mouse events on the canvas regardless of where
  // the (hidden, non-moving) cursor visually is, so panel buttons are
  // unclickable while locked — release the lock whenever a panel is toggled.
  if (input.wasJustPressed("KeyC")) {
    document.exitPointerLock();
    craftingPanel.toggle();
  }
  if (input.wasJustPressed("KeyB")) {
    document.exitPointerLock();
    buildingPanel.toggle();
  }
  if (input.wasJustPressed("KeyI")) {
    document.exitPointerLock();
    inventoryPanel.toggle();
  }
  if (input.wasJustPressed("KeyQ")) buildingSystem.selectBuilding(null);

  const gatherPrompt = getInteractionPrompt(state, resourceNodes, feet.x, feet.z);
  const farmPrompt = farmingSystem.getPrompt(feet.x, feet.z, selectedSeedItemId, currentNowMs);
  const placementPrompt = buildingSystem.getPlacementPrompt();
  hud.setPrompt(placementPrompt ?? gatherPrompt ?? farmPrompt);

  renderer.render(scene, camera.camera);
  input.endFrame();
});

loop.start();

window.setInterval(() => saveGame(state), 10_000);
window.addEventListener("beforeunload", () => saveGame(state));

// Exposed for headless smoke-testing (see game/README.md verification section).
declare global {
  interface Window {
    __gameDebug?: {
      getPlayerPosition: () => { x: number; y: number; z: number };
      getInventory: () => { itemId: string; qty: number }[];
      getEnemyPositions: () => { id: string; x: number; z: number; health: number }[];
      getPlots: () => GameState["plots"];
      getPlacedBuildings: () => GameState["placedBuildings"];
      teleportPlayer: (x: number, z: number) => void;
      isPointerLocked: () => boolean;
      getResourceNodes: () => { id: string; kind: string; x: number; z: number; depleted: boolean }[];
      getTimeOfDay: () => number;
      setTimeOfDayFraction: (fraction: number) => void;
      getCameraPitch: () => number;
      getCameraDistance: () => number;
    };
  }
}
window.__gameDebug = {
  getPlayerPosition: () => ({ x: state.player.x, y: state.player.y, z: state.player.z }),
  getInventory: () => state.inventory.map((s) => ({ ...s })),
  getEnemyPositions: () =>
    enemyManager
      .getEnemies()
      .map((e) => ({ id: e.id, x: e.object.position.x, z: e.object.position.z, health: e.health })),
  getPlots: () => state.plots.map((p) => ({ ...p })),
  getPlacedBuildings: () => state.placedBuildings.map((b) => ({ ...b })),
  teleportPlayer: (x, z) => player.teleport(x, z),
  isPointerLocked: () => input.isPointerLocked(),
  getResourceNodes: () =>
    resourceNodes.map((n) => ({
      id: n.id,
      kind: n.config.kind,
      x: n.object.position.x,
      z: n.object.position.z,
      depleted: n.depleted,
    })),
  getTimeOfDay: () => dayNight.getTimeOfDay(currentNowMs),
  setTimeOfDayFraction: (fraction) => clock.setElapsed(DAY_LENGTH_MS * fraction),
  getCameraPitch: () => camera.pitch,
  getCameraDistance: () => camera.distance,
};
