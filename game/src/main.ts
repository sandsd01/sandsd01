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
import { saveGame, loadGame } from "./systems/save-load";

import { createInitialState } from "./state/game-state";

import { Hud } from "./ui/hud";
import { InventoryPanel } from "./ui/inventory-panel";
import { CraftingPanel } from "./ui/crafting-panel";
import { BuildingPanel } from "./ui/building-panel";
import type { Collidable } from "./utils/collision";

const canvas = document.getElementById("game-canvas") as HTMLCanvasElement;
const uiRoot = document.getElementById("ui-root") as HTMLElement;

const state = loadGame() ?? createInitialState();

const scene = createScene();
const terrain = new Terrain(state.seed);
scene.add(terrain.mesh);

const renderer = createRenderer(canvas);
const camera = new ThirdPersonCamera();
const input = new InputManager(canvas);
const clock = new GameClock();

const player = new PlayerController(state, terrain);
scene.add(player.object);

const resourceNodes = scatterResourceNodes(terrain, state.seed);
addNodesToScene(scene, resourceNodes);

const buildingSystem = new BuildingSystem(scene, terrain, state);
const farmingSystem = new FarmingSystem(scene, terrain, state);
const enemyManager = new EnemyManager(scene, terrain, state.seed);
const playerCombat = new PlayerCombat();

const hud = new Hud(uiRoot, state);
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
const buildingPanel = new BuildingPanel(uiRoot, buildingSystem);

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

canvas.addEventListener("mousedown", (e) => {
  if (e.button !== 0) return;
  if (!input.isPointerLocked()) return;
  if (isPlayerDead(state)) return;

  const feet = player.getFeetPosition();
  const forward = camera.getForward();
  if (buildingSystem.getSelectedBuildingId()) {
    buildingSystem.tryPlace(feet, forward);
  } else {
    playerCombat.tryAttack(state, enemyManager, feet.x, feet.z, currentNowMs);
  }
});

function getCollidables(): Collidable[] {
  const nodeCollidables: Collidable[] = resourceNodes
    .filter((n) => !n.depleted)
    .map((n) => ({ x: n.object.position.x, z: n.object.position.z, radius: 0.5 }));
  return [...nodeCollidables, ...buildingSystem.getCollidables()];
}

const loop = new GameLoop((dt) => {
  clock.tick(dt);
  currentNowMs = clock.now();

  if (!isPlayerDead(state)) {
    const collidables = getCollidables();
    player.update(dt, input, camera, collidables);
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
  buildingSystem.update(feet, forward);

  if (input.wasJustPressed("KeyE") && !isPlayerDead(state)) {
    tryGather(state, resourceNodes, feet.x, feet.z, currentNowMs);
  }
  if (input.wasJustPressed("KeyF") && !isPlayerDead(state)) {
    farmingSystem.tryInteract(feet.x, feet.z, selectedSeedItemId, currentNowMs);
  }
  if (input.wasJustPressed("KeyC")) craftingPanel.toggle();
  if (input.wasJustPressed("KeyB")) buildingPanel.toggle();
  if (input.wasJustPressed("KeyI")) inventoryPanel.toggle();
  if (input.wasJustPressed("KeyQ")) buildingSystem.selectBuilding(null);

  const gatherPrompt = getInteractionPrompt(state, resourceNodes, feet.x, feet.z);
  const farmPrompt = farmingSystem.getPrompt(feet.x, feet.z, selectedSeedItemId, currentNowMs);
  hud.setPrompt(gatherPrompt ?? farmPrompt);

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
    };
  }
}
window.__gameDebug = {
  getPlayerPosition: () => ({ x: state.player.x, y: state.player.y, z: state.player.z }),
  getInventory: () => state.inventory.map((s) => ({ ...s })),
};
