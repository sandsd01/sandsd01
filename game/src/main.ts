import * as THREE from "three";

// Fonts are self-hosted via @fontsource (OFL-1.1) rather than linked from a
// CDN: a blocked font URL fails silently, and the whole HUD would quietly drop
// back to system-ui without anything in the console to say why.
import "@fontsource/cinzel/latin-600.css";
import "@fontsource/cinzel/latin-700.css";
import "@fontsource/rubik/latin-400.css";
import "@fontsource/rubik/latin-500.css";
import "./style.css";

import { createScene, updateSunTarget } from "./core/scene";
import { createRenderer } from "./core/renderer";
import { ThirdPersonCamera } from "./core/camera";
import { GameLoop } from "./core/loop";
import { GameClock } from "./core/clock";
import { InputManager } from "./input/input-manager";

import { PlayerController } from "./player/player-controller";
import { damagePlayer, isPlayerDead, respawnPlayer } from "./player/player-state";

import { Terrain } from "./world/terrain";
import { scatterResourceNodes, addNodesToScene } from "./world/world-objects";
import { createGrass } from "./world/grass";
import { Water, WATER_LEVEL } from "./world/water";
import { createComposer } from "./core/postprocessing";

import { getInteractionPrompt, tryGather } from "./systems/gathering";
import { BuildingSystem } from "./systems/building";
import { FarmingSystem } from "./systems/farming";
import { EnemyManager } from "./systems/enemy-ai";
import { PlayerCombat } from "./systems/combat";
import { DayNightSystem, DAY_LENGTH_MS } from "./systems/day-night";
import { saveGame, loadGame } from "./systems/save-load";

import { createInitialState, type GameState } from "./state/game-state";
import { loadSettings } from "./state/settings";

import { Hud } from "./ui/hud";
import { InventoryPanel } from "./ui/inventory-panel";
import { CraftingPanel } from "./ui/crafting-panel";
import { BuildingPanel } from "./ui/building-panel";
import { BuildHotbar, HOTBAR_KEYS } from "./ui/build-hotbar";
import { SettingsPanel } from "./ui/settings-panel";
import { AudioHooks } from "./systems/audio-hooks";
import { sound } from "./utils/audio";
import type { Collidable } from "./utils/collision";

const canvas = document.getElementById("game-canvas") as HTMLCanvasElement;
const uiRoot = document.getElementById("ui-root") as HTMLElement;

const state = loadGame() ?? createInitialState();
// Input preferences live outside the save, so they survive a new world.
const settings = loadSettings();

const sceneRig = createScene();
const { scene } = sceneRig;
const terrain = new Terrain(state.seed);
scene.add(terrain.mesh);

const renderer = createRenderer(canvas);
const camera = new ThirdPersonCamera(settings);
const input = new InputManager(canvas);
const clock = new GameClock(state.elapsedMs);
const dayNight = new DayNightSystem(sceneRig);

const player = new PlayerController(state, terrain);
scene.add(player.object);

const resourceNodes = scatterResourceNodes(terrain, state.seed);
addNodesToScene(scene, resourceNodes);
scene.add(createGrass(terrain, state.seed));

const water = new Water();
scene.add(water.mesh);

const composer = createComposer(renderer, scene, camera.camera);

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
const buildingPanel = new BuildingPanel(uiRoot, buildingSystem, canvas, state);
const buildHotbar = new BuildHotbar(uiRoot, buildingSystem, canvas, state);
const settingsPanel = new SettingsPanel(uiRoot, settings);

// Menus are mutually exclusive and Escape closes whatever is open — the
// convention every game in this genre follows. Opening one also releases
// pointer lock, since a locked pointer swallows every click on the page.
interface TogglablePanel {
  toggle(): void;
  close(): void;
  isVisible(): boolean;
}
const panels: TogglablePanel[] = [craftingPanel, buildingPanel, inventoryPanel, settingsPanel];

function anyPanelOpen(): boolean {
  return panels.some((panel) => panel.isVisible());
}

function togglePanel(target: TogglablePanel): void {
  const wasOpen = target.isVisible();
  for (const panel of panels) panel.close();
  if (wasOpen) return;
  document.exitPointerLock();
  target.toggle();
}

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
  sound.updateAmbient(dayNight.getDaylight());

  const menuOpen = anyPanelOpen();
  if (!isPlayerDead(state) && !menuOpen) {
    const collidables = getCollidables();
    player.update(dt, currentNowMs, input, camera, collidables);
  }

  const feet = player.getFeetPosition();
  // Re-centre the sun's shadow frustum on the player before anything renders.
  updateSunTarget(sceneRig, dayNight.getSunDirection(), feet);
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

  const canAct = !isPlayerDead(state) && !menuOpen;
  if (input.wasJustPressed("KeyE") && canAct) {
    tryGather(state, resourceNodes, feet.x, feet.z, currentNowMs);
  }
  if (input.wasJustPressed("KeyF") && canAct) {
    farmingSystem.tryInteract(feet.x, feet.z, selectedSeedItemId, currentNowMs);
  }
  if (input.wasJustPressed("KeyC")) togglePanel(craftingPanel);
  if (input.wasJustPressed("KeyB")) togglePanel(buildingPanel);
  // Tab alongside I: this genre is split between the two, so accept both.
  if (input.wasJustPressed("KeyI") || input.wasJustPressed("Tab")) {
    togglePanel(inventoryPanel);
  }
  // Escape backs out of whatever is open, and opens Options when nothing is —
  // the pause-menu convention players arrive with.
  if (input.wasJustPressed("Escape")) {
    if (anyPanelOpen()) {
      for (const panel of panels) panel.close();
    } else {
      togglePanel(settingsPanel);
    }
  }
  if (input.wasJustPressed("KeyQ") && canAct) buildingSystem.selectBuilding(null);
  // Number keys pick a build piece without opening anything.
  const hotbarSlot = HOTBAR_KEYS.findIndex((code) => input.wasJustPressed(code));
  if (hotbarSlot >= 0 && canAct) buildHotbar.selectSlot(hotbarSlot);

  const gatherPrompt = getInteractionPrompt(state, resourceNodes, feet.x, feet.z);
  const farmPrompt = farmingSystem.getPrompt(feet.x, feet.z, selectedSeedItemId, currentNowMs);
  const placementPrompt = buildingSystem.getPlacementPrompt();
  hud.setPrompt(placementPrompt ?? gatherPrompt ?? farmPrompt);

  water.update(currentNowMs);
  // Reset per-frame counters ourselves: the composer issues several render
  // calls per frame, and three's auto-reset would leave the stats reflecting
  // only the final fullscreen pass.
  renderer.info.reset();
  composer.render();
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
      getRenderStats: () => Record<string, unknown>;
      terrainHeightAt: (x: number, z: number) => number;
      getWaterLevel: () => number;
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
  terrainHeightAt: (x, z) => terrain.heightAt(x, z),
  getWaterLevel: () => WATER_LEVEL,
  // Lighting/shadow state, for checking that a visual change actually took
  // effect rather than inferring it from a screenshot.
  getRenderStats: () => {
    let casters = 0;
    let receivers = 0;
    scene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        if (o.castShadow) casters++;
        if (o.receiveShadow) receivers++;
      }
    });
    const shadowCam = sceneRig.sunLight.shadow.camera;
    return {
      shadowMapEnabled: renderer.shadowMap.enabled,
      toneMappingExposure: renderer.toneMappingExposure,
      sunCastShadow: sceneRig.sunLight.castShadow,
      sunIntensity: Number(sceneRig.sunLight.intensity.toFixed(2)),
      hemiIntensity: Number(sceneRig.hemiLight.intensity.toFixed(2)),
      sunPosition: sceneRig.sunLight.position.toArray().map((n) => Number(n.toFixed(1))),
      shadowExtent: [shadowCam.left, shadowCam.right, shadowCam.top, shadowCam.bottom],
      shadowFrustumWidth: Number(
        (2 / shadowCam.projectionMatrix.elements[0]).toFixed(1),
      ),
      casters,
      receivers,
      drawCalls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
    };
  },
};
