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

import { PlayerController, PLAYER_RADIUS } from "./player/player-controller";
import { damagePlayer, isPlayerDead, respawnPlayer } from "./player/player-state";

import { Terrain } from "./world/terrain";
import { getZone } from "./world/zones";
import { scatterResourceNodes, addNodesToScene } from "./world/world-objects";
import { createGrass } from "./world/grass";
import { Water, WATER_LEVEL } from "./world/water";
import { loadModels } from "./world/models";
import { createLandmarks } from "./world/landmarks";
import { createPointsOfInterest } from "./world/pois";
import { createComposer } from "./core/postprocessing";

import {
  aimedNode,
  canGather,
  gatherTimeFor,
  getInteractionPrompt,
  nearestNode,
  tryGather,
} from "./systems/gathering";
import { Targeting, type Target } from "./systems/targeting";
import { TargetOutline } from "./world/target-outline";
import { addItem, consumeItem } from "./systems/inventory";
import { getItem } from "./data/items";
import { getBuilding } from "./data/buildings";
import { RECIPES } from "./data/recipes";
import {
  assignFromInventory,
  assignToSlot,
  autoAssign,
  cycleSlot,
  equippedItemId,
  pruneHotbar,
  selectSlot,
} from "./systems/equipment";
import {
  canCraft,
  craftMany,
  discoverFrom,
  discoverFromInventory,
  listKnownRecipes,
} from "./systems/crafting";
import { BuildingSystem } from "./systems/building";
import { FarmingSystem } from "./systems/farming";
import { EnemyManager } from "./systems/enemy-ai";
import { PlayerCombat } from "./systems/combat";
import { DayNightSystem, DAY_LENGTH_MS } from "./systems/day-night";
import { saveGame, loadGame } from "./systems/save-load";
import { deposit, withdraw } from "./systems/containers";
import { heldDamage } from "./data/tools";

import { createInitialState, type GameState } from "./state/game-state";
import { mulberry32 } from "./utils/rng";
import { DroppedItems } from "./world/dropped-item";
import { rollLoot } from "./data/loot";
import { loadSettings } from "./state/settings";
import { loadBindings, saveBindings } from "./state/keybindings";

import { Hud, type CrosshairState } from "./ui/hud";
import { InventoryPanel } from "./ui/inventory-panel";
import { CraftingPanel } from "./ui/crafting-panel";
import { BuildingPanel } from "./ui/building-panel";
import { ContainerPanel } from "./ui/container-panel";
import { ItemHotbar, HOTBAR_ACTIONS } from "./ui/item-hotbar";
import { SettingsPanel } from "./ui/settings-panel";
import { Minimap } from "./ui/minimap";
import { AudioHooks } from "./systems/audio-hooks";
import { events } from "./utils/events";
import { sound } from "./utils/audio";
import { resolveCollisions, type Collidable } from "./utils/collision";

const canvas = document.getElementById("game-canvas") as HTMLCanvasElement;
const uiRoot = document.getElementById("ui-root") as HTMLElement;

const state = loadGame() ?? createInitialState();
// A fresh world starts knowing only what its starting kit implies; everything
// else is learned by picking the ingredient up. A loaded save has already had
// its known set backfilled by save-load.
discoverFromInventory(state);
// A fresh world fills its bar from the starting kit; a loaded save already had
// this done by save-load's backfill.
assignFromInventory(state);
// Input preferences live outside the save, so they survive a new world.
const settings = loadSettings();
const bindings = loadBindings();

// Models are fetched before anything is built, so props and the player are
// created with their real meshes rather than being swapped mid-scene. A model
// that fails to load leaves its slot empty and the procedural fallback stands
// in, which is why this never rejects.
const models = await loadModels();

const sceneRig = createScene();
const { scene } = sceneRig;
const terrain = new Terrain(state.seed);
scene.add(terrain.mesh);

const renderer = createRenderer(canvas);
const camera = new ThirdPersonCamera(settings);
const input = new InputManager(canvas, bindings);
const clock = new GameClock(state.elapsedMs);
const dayNight = new DayNightSystem(sceneRig);

const player = new PlayerController(state, terrain, models);
scene.add(player.object);

// One runtime randomness stream, seeded from the world so a given save feels
// consistent, but deliberately NOT reproducible across a reload: it advances
// with every roll and its position is not saved. That is the same bargain
// EnemyManager already makes with its spawn stream — runtime rolls are not
// world generation, and pretending otherwise would mean persisting a cursor
// nothing else needs.
const runtimeRand = mulberry32(state.seed ^ 0x5eed10a7);

const resourceNodes = scatterResourceNodes(terrain, state.seed, models);
addNodesToScene(scene, resourceNodes);

// Put back how far each node had been worked. Node ids come from a counter
// that restarts at 0 on every page load and `scatterResourceNodes` is
// deterministic from the seed, so the same node gets the same id each boot —
// this depends on scattering exactly once per page, which is the case here.
// Unknown ids are skipped so a save from a different seed or an older node mix
// degrades to "untouched" rather than throwing.
for (const node of resourceNodes) {
  const saved = state.nodes[node.id];
  if (saved) node.restore(saved);
}

/**
 * Saves the game, first copying live node progress into the state object.
 * Nodes are the one system whose state lives on scene objects rather than in
 * `state`, so it has to be collected at the moment of saving — routing every
 * save through here is what stops one of the three call sites forgetting to.
 */
function persist(): void {
  const nodes: GameState["nodes"] = {};
  for (const node of resourceNodes) {
    const saved = node.serialise();
    if (saved) nodes[node.id] = saved;
  }
  state.nodes = nodes;
  saveGame(state);
}
scene.add(createGrass(terrain, state.seed));

const water = new Water();
scene.add(water.mesh);

const composer = createComposer(renderer, scene, camera.camera);

// Landmarks first: the caches below are placed relative to them.
const landmarks = createLandmarks(scene, terrain, state.seed, models);
createPointsOfInterest(state, landmarks, state.seed);

const buildingSystem = new BuildingSystem(scene, terrain, state, models);
const farmingSystem = new FarmingSystem(scene, terrain, state);

// Loot on the floor. Not saved, on purpose and for the same reason enemies
// are not: it belongs to the fight that just happened, and a reload has
// already thrown that fight away.
const droppedItems = new DroppedItems(scene, terrain);

events.on("enemy-killed", ({ enemyId, x, z }) => {
  droppedItems.spawnAll(rollLoot(enemyId, runtimeRand), x, z, currentNowMs);
});

events.on("item-picked-up", ({ itemId, qty }) => {
  events.emit("notification", { message: `Picked up ${qty}x ${getItem(itemId).name}` });
});
const enemyManager = new EnemyManager(scene, terrain, state.seed);
const playerCombat = new PlayerCombat();

// What the crosshair is on, resolved once a frame and shared by every system
// that used to run its own "nearest thing within a radius" search.
const targeting = new Targeting();
const targetOutline = new TargetOutline();
scene.add(targetOutline.object);
let target: Target = targeting.getTarget();

const hud = new Hud(uiRoot, state);
new AudioHooks();

// Discovery rides on the inventory rather than on gathering specifically, so a
// crafted, harvested or granted item all teach equally. One toast per batch of
// unlocks: the HUD has a single toast element, so announcing each recipe would
// leave only the last one readable — the exact complaint players have about
// how Valheim does this. The panel's NEW badge is the durable half.
events.on("inventory-changed", ({ itemId }) => {
  // A newly acquired kind of item takes the first free quick slot, so the bag
  // never has to be arranged before anything can be used.
  autoAssign(state, itemId);
  pruneHotbar(state);

  const learned = discoverFrom(state, itemId);
  if (learned.length === 0) return;
  events.emit("notification", {
    message:
      learned.length === 1
        ? `New recipe: ${learned[0].name}`
        : `${learned.length} new recipes`,
  });
});
let selectedSeedItemId: string | null = null;
const inventoryPanel = new InventoryPanel(
  uiRoot,
  state,
  (id) => {
    selectedSeedItemId = id;
  },
  () => selectedSeedItemId,
);
// Station checks run against wherever the player is standing. Movement is
// blocked while a menu is open, so the answer can't go stale mid-panel.
const STATION_RANGE = 5;
const stationCheck = (buildingId: string) =>
  buildingSystem.hasNearby(buildingId, state.player.x, state.player.z, STATION_RANGE);
const craftingPanel = new CraftingPanel(uiRoot, state, stationCheck);
const buildingPanel = new BuildingPanel(uiRoot, buildingSystem, canvas, state);
const itemHotbar = new ItemHotbar(uiRoot, state, canvas, bindings);
const settingsPanel = new SettingsPanel(uiRoot, settings, bindings, input, () => {
  // One place fans a rebind out to everything that displays or consumes keys,
  // so nothing is left advertising a binding that no longer exists.
  saveBindings(bindings);
  input.setBindings(bindings);
  itemHotbar.setBindings(bindings);
  hud.setKeybinds(bindings);
});
hud.setKeybinds(bindings);
const containerPanel = new ContainerPanel(uiRoot, state);
const minimap = new Minimap(uiRoot);

// One place keeps the character's hand in step with the quick bar. Driven by
// the event rather than polled per frame, so swapping slots is what changes
// the mesh and nothing else has to remember to.
function syncHeldItem(): void {
  player.setHeldItem(equippedItemId(state));
}
events.on("equipped-changed", syncHeldItem);
events.on("inventory-changed", syncHeldItem);
syncHeldItem();

// Menus are mutually exclusive and Escape closes whatever is open — the
// convention every game in this genre follows. Opening one also releases
// pointer lock, since a locked pointer swallows every click on the page.
interface TogglablePanel {
  toggle(): void;
  close(): void;
  isVisible(): boolean;
}
const panels: TogglablePanel[] = [
  craftingPanel,
  buildingPanel,
  inventoryPanel,
  settingsPanel,
  containerPanel,
];

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

// Where the camera pivots and, in first person, where it sits.
const EYE_HEIGHT = 1.85;

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

// Held-button gathering. Progress is tracked per node, so drifting the
// crosshair onto a different tree restarts the swing instead of carrying the
// first tree's progress over to it.
let gatherNodeId: string | null = null;
let gatherProgressMs = 0;

// Taking a building back down works the same way, tracked separately so
// drifting between a wall and a tree cannot carry progress across.
const DEMOLISH_MS = 900;
let demolishBuildingId: string | null = null;
let demolishProgressMs = 0;

function resetGather(): void {
  gatherNodeId = null;
  gatherProgressMs = 0;
}

function resetDemolish(): void {
  demolishBuildingId = null;
  demolishProgressMs = 0;
}

/**
 * How full the crosshair ring is, 0..1. One definition for both the HUD and
 * the debug surface, so a test can never be told a different story from the
 * one the player is being shown.
 */
function actionProgress(): number {
  if (demolishBuildingId) return Math.min(1, demolishProgressMs / DEMOLISH_MS);
  if (gatherNodeId) return gatherProgressMs / gatherTimeFor(state, aimedNode(target));
  return 0;
}

/**
 * Takes down the aimed building and hands back everything it cost. A barrel's
 * contents are tipped onto the floor rather than deleted or force-fed to the
 * player — the drop system already exists for exactly this, and it means
 * demolishing a full barrel can never quietly destroy what was in it.
 */
function demolishAimed(placedId: string): void {
  const stored = (state.containers[placedId] ?? []).map((slot) => ({ ...slot }));
  // Where the piece stood, captured before it is removed — dropping at the
  // player's feet instead would put the contents straight back in the bag,
  // which is the same as handing them over with extra steps.
  const site = state.placedBuildings.find((p) => p.id === placedId);
  const dropX = site ? site.cellX : 0;
  const dropZ = site ? site.cellZ : 0;

  const result = buildingSystem.demolish(placedId);
  if (!result) return;

  for (const slot of stored) {
    droppedItems.spawn(slot.itemId, slot.qty, dropX, dropZ, currentNowMs, 0.6);
  }
  delete state.containers[placedId];

  const def = getBuilding(result.buildingId);
  const parts = result.refunded.map((c) => `${c.qty}x ${getItem(c.itemId).name}`).join(", ");
  events.emit("notification", {
    message: parts ? `Removed ${def.name} (+${parts})` : `Removed ${def.name}`,
  });
}

// Left mouse, held: work the aimed node, or swing at whatever is there. One
// hit lands per full ring, matching the node's own hits-to-deplete model —
// four rings on a tree, four wood.
function updatePrimaryAction(dtSeconds: number): void {
  // A building under the crosshair is taken down, not hit. Checked before
  // gathering so a wall standing in front of a tree is what you act on —
  // which is also what the ray now reports.
  if (
    (target.kind === "building" || target.kind === "container") &&
    target.buildingId !== undefined &&
    buildingSystem.getSelectedBuildingId() === null
  ) {
    const id = target.buildingId;
    if (demolishBuildingId !== id) {
      demolishBuildingId = id;
      demolishProgressMs = 0;
      player.triggerSwing(currentNowMs);
    }
    demolishProgressMs += dtSeconds * 1000;
    if (demolishProgressMs >= DEMOLISH_MS) {
      demolishAimed(id);
      resetDemolish();
    }
    return;
  }
  resetDemolish();

  const node = aimedNode(target);
  if (node && canGather(state, node)) {
    if (gatherNodeId !== node.id) {
      gatherNodeId = node.id;
      gatherProgressMs = 0;
      player.triggerSwing(currentNowMs);
    }
    gatherProgressMs += dtSeconds * 1000;
    // The swing length depends on the tool in hand, so an iron axe visibly
    // fills the ring faster than a plain one.
    if (gatherProgressMs >= gatherTimeFor(state, node)) {
      tryGather(state, node, currentNowMs, runtimeRand);
      gatherProgressMs = 0;
      // Straight into the next swing, so holding the button reads as a
      // continuous action rather than a stutter between hits.
      player.triggerSwing(currentNowMs);
    }
    return;
  }

  resetGather();
  // Nothing to gather: swing. The swing plays whether or not it connects —
  // a miss should look like a miss, not like a dead button.
  if (playerCombat.canAttack(currentNowMs)) {
    player.triggerSwing(currentNowMs);
    playerCombat.tryAttack(state, enemyManager, target, currentNowMs);
  }
}

// Right mouse: place the selected piece where the crosshair points, or work
// the aimed plot. Left destroys/collects, right places/uses — the split every
// player of this genre already has in their hands.
function performSecondaryAction(): void {
  const feet = player.getFeetPosition();
  if (buildingSystem.getSelectedBuildingId()) {
    buildingSystem.tryPlace(targeting.aimPoint(feet, camera.getForward()), currentNowMs);
    return;
  }
  // A barrel outranks eating: if you are looking into one, that is what you
  // meant, whatever happens to be in your hand.
  if (target.kind === "container" && target.containerId) {
    document.exitPointerLock();
    for (const panel of panels) panel.close();
    containerPanel.open(target.containerId);
    return;
  }
  // Holding food and right-clicking eats it, the way this genre has taught
  // everyone to expect. The Eat button in the bag still works too.
  const held = equippedItemId(state);
  if (held !== null && getItem(held).heals !== undefined) {
    consumeItem(state, held);
    return;
  }
  if (target.kind === "plot" && target.plot) {
    farmingSystem.tryInteract(target.plot, selectedSeedItemId, currentNowMs);
  }
}

// Browsers block audio until a user gesture; the same click that requests
// pointer lock doubles as that gesture.
canvas.addEventListener("click", () => sound.unlock());

// A selected build piece outranks whatever is under the crosshair: while
// placing, what matters is where the piece lands, not what is standing there.
function crosshairStateFor(current: Target): CrosshairState {
  if (buildingSystem.getSelectedBuildingId()) return "place";
  if (current.kind === "node" || current.kind === "enemy" || current.kind === "plot") {
    return current.kind;
  }
  // A barrel reads as somewhere to reach into, so it borrows the plot bracket.
  if (current.kind === "container") return "plot";
  // Anything else you built reads as workable — it can be taken back down.
  if (current.kind === "building") return "node";
  return "none";
}

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
  // The pivot sits just above the character's head (they are 1.70 tall), not
  // at chest height. The crosshair ray passes through this point, so a pivot
  // inside the body put the character between the camera and whatever was
  // being aimed at — the placement ghost was hidden behind their own head.
  camera.update(feet.clone().add(new THREE.Vector3(0, EYE_HEIGHT, 0)), [terrain.mesh]);

  for (const node of resourceNodes) node.update(currentNowMs);
  farmingSystem.update(currentNowMs);
  droppedItems.update(currentNowMs, state, feet.x, feet.z);

  if (!isPlayerDead(state)) {
    enemyManager.update(dt, currentNowMs, feet, (damage) => {
      damagePlayer(state, damage);
      scheduleRespawnIfDead();
    });
  }

  // Also checked here, every frame, and deliberately outside the guard above.
  // The enemy callback used to be the only caller, but it sits inside a branch
  // that is skipped precisely when the player is dead — so a save written at
  // 0 HP (autosave runs every 10s, and the respawn window is only 2s) loaded
  // with nothing able to revive it, and no way out from inside the game. The
  // function early-returns unless the player is dead and no respawn is pending.
  scheduleRespawnIfDead();

  // Aiming is resolved after the camera has moved and before anything reads
  // it, so every system sees the same answer for this frame.
  target = targeting.update(camera.camera, feet, {
    nodes: resourceNodes,
    enemies: enemyManager.getEnemies(),
    terrain: terrain.mesh,
    buildings: buildingSystem,
    state,
  });

  const canAct = !isPlayerDead(state) && !menuOpen;
  const aim = targeting.aimPoint(feet, camera.getForward());
  // The ghost only belongs on screen while the player can actually place: it
  // used to keep tracking and glowing behind an open panel and over a corpse.
  buildingSystem.update(aim, currentNowMs, canAct);

  // Mouse: left held works the target, right places/uses. Both are ignored
  // behind a menu and while dead.
  // A short click can begin and end between two frames, so the press event
  // counts as well as the held state — otherwise a quick click to attack would
  // do nothing at all on a slow machine.
  const primaryHeld = input.isMouseDown(0) || input.wasMousePressed(0);
  if (canAct && primaryHeld && input.isPointerLocked()) {
    updatePrimaryAction(dt);
  } else {
    resetGather();
    resetDemolish();
  }
  if (canAct && input.wasMousePressed(2)) performSecondaryAction();
  hud.setActionProgress(actionProgress());

  // The wheel changes what is in hand, as it does in Minecraft; zoom stayed
  // behind Ctrl so the bare scroll means the thing players reach for.
  const wheel = input.takeWheel();
  if (wheel.delta !== 0) {
    if (wheel.withCtrl) camera.zoomBy(wheel.delta);
    else if (canAct) cycleSlot(state, wheel.delta > 0 ? 1 : -1);
  }

  if (input.wasActionPressed("toggleView")) {
    // The model is doubleSided, so leaving it visible in first person puts the
    // inside of the character's head across the screen.
    player.object.visible = !camera.toggleFirstPerson();
  }

  // The keys keep working, and now prefer whatever is aimed at — aiming is
  // added on top of what players already knew, not swapped in for it.
  const keyNode = aimedNode(target) ?? nearestNode(resourceNodes, feet.x, feet.z);
  const keyPlot = target.kind === "plot" && target.plot
    ? target.plot
    : farmingSystem.nearestPlot(feet.x, feet.z);
  if (input.wasActionPressed("gather") && canAct) {
    player.triggerSwing(currentNowMs);
    tryGather(state, keyNode, currentNowMs, runtimeRand);
  }
  if (input.wasActionPressed("farm") && canAct) {
    farmingSystem.tryInteract(keyPlot, selectedSeedItemId, currentNowMs);
  }
  if (input.wasActionPressed("crafting")) togglePanel(craftingPanel);
  if (input.wasActionPressed("building")) togglePanel(buildingPanel);
  if (input.wasActionPressed("inventory")) togglePanel(inventoryPanel);
  // Options backs out of whatever is open, and opens the Options screen when
  // nothing is — the pause-menu convention players arrive with.
  if (input.wasActionPressed("options")) {
    if (anyPanelOpen()) {
      for (const panel of panels) panel.close();
    } else {
      togglePanel(settingsPanel);
    }
  }
  if (input.wasActionPressed("cancelBuild") && canAct) buildingSystem.selectBuilding(null);
  if (input.wasActionPressed("rotateBuild") && canAct) buildingSystem.rotateSelection();
  // Hotbar keys put an item in hand.
  const hotbarSlot = HOTBAR_ACTIONS.findIndex((action) => input.wasActionPressed(action));
  if (hotbarSlot >= 0 && canAct) selectSlot(state, hotbarSlot);

  const gatherPrompt = getInteractionPrompt(state, keyNode);
  const farmPrompt = farmingSystem.getPrompt(keyPlot, selectedSeedItemId, currentNowMs);
  const placementPrompt = buildingSystem.getPlacementPrompt();
  hud.setPrompt(placementPrompt ?? gatherPrompt ?? farmPrompt);

  // The outline says which object an action would hit; the crosshair shape
  // says what kind of thing it is. Neither relies on colour to be read.
  if (target.object && target.kind !== "ground") targetOutline.surround(target.object);
  else targetOutline.hide();
  hud.setCrosshairState(crosshairStateFor(target));

  minimap.update(
    currentNowMs,
    state,
    resourceNodes,
    enemyManager.getEnemies(),
    (id) => buildingSystem.getMesh(id),
    landmarks,
  );

  water.update(currentNowMs);
  // Reset per-frame counters ourselves: the composer issues several render
  // calls per frame, and three's auto-reset would leave the stats reflecting
  // only the final fullscreen pass.
  renderer.info.reset();
  composer.render();
  input.endFrame();
});

loop.start();

// Fade the splash out only once a frame has actually been drawn, so the world
// is on screen behind it rather than a black canvas.
requestAnimationFrame(() => {
  const splash = document.getElementById("loading");
  if (!splash) return;
  splash.classList.add("done");
  window.setTimeout(() => splash.remove(), 500);
});

window.setInterval(persist, 10_000);
window.addEventListener("beforeunload", persist);

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
      advanceClockMs: (ms: number) => void;
      depleteNode: (nodeId: string) => { hits: number; depleted: boolean } | null;
      getNodeState: (nodeId: string) => { hits: number; depleted: boolean } | null;
      getDroppedItems: () => { itemId: string; qty: number; x: number; z: number }[];
      rollLootFor: (enemyId: string) => { itemId: string; qty: number }[];
      spawnDropAt: (itemId: string, qty: number, x: number, z: number) => void;
      hitNodeOnce: (
        nodeId: string,
      ) => { itemId: string; qty: number; finalHit: boolean; bonus?: { itemId: string; qty: number } } | null;
      killNearestEnemy: () => { id: string; enemyId: string; x: number; z: number } | null;
      getPlayerRig: () => { clip: string; clips: number; skinned: number };
      getStamina: () => { current: number; max: number };
      getRigFingerprint: () => number;
      getPlayerBounds: () => { height: number; minY: number; feetY: number };
      grantItems: (items: Record<string, number>) => void;
      getBuildingBounds: (
        buildingId: string,
      ) => { height: number; minY: number; terrainY: number } | null;
      getCameraPitch: () => number;
      getCameraDistance: () => number;
      getCameraYaw: () => number;
      setCameraYaw: (yaw: number) => void;
      getAimPoint: () => { x: number; z: number };
      isFirstPerson: () => boolean;
      isPlayerVisible: () => boolean;
      getTarget: () => {
        kind: string;
        id: string | null;
        distance: number;
        x: number;
        z: number;
      };
      getCrosshairState: () => string;
      getOutline: () => { visible: boolean; size: [number, number, number] };
      getSelectedBuilding: () => string | null;
      getBuildRotation: () => number;
      getOccupiedCells: () => Record<string, string>;
      demolishBuilding: (placedId: string) => boolean;
      placeBuildingAt: (
        buildingId: string,
        cellX: number,
        cellZ: number,
        rotation: number,
      ) => string | null;
      probeMoveTo: (x: number, z: number, steps?: number) => { x: number; z: number };
      getHotbar: () => (string | null)[];
      getContainer: (buildingId: string) => { itemId: string; qty: number }[];
      getContainerPanelOpen: () => boolean;
      getEquippedSlot: () => number;
      getEquippedItem: () => string | null;
      selectHotbarSlot: (index: number) => void;
      holdItem: (itemId: string) => void;
      getHeldDamage: () => number;
      depositToContainer: (buildingId: string, itemId: string, qty: number) => number;
      withdrawFromContainer: (buildingId: string, itemId: string, qty: number) => number;
      saveNow: () => void;
      setFistOffset: (x: number, y: number, z: number) => void;
      isHeldItemVisible: () => {
        visible: boolean;
        onScreen: boolean;
        ndc: [number, number];
        firstHit: string;
      };
      getHeldItemMesh: () => {
        itemId: string | null;
        attached: boolean;
        hasMesh: boolean;
        world: [number, number, number];
        aboveFeet: number;
        axis: [number, number, number];
      };
      getActionProgress: () => number;
      getGatherTime: () => number;
      getHealth: () => { current: number; max: number };
      damagePlayer: (amount: number) => void;
      getKnownRecipes: () => string[];
      getAllRecipes: () => { id: string; name: string; category: string }[];
      getUnseenRecipes: () => string[];
      getCraftableRecipes: () => string[];
      craftRecipe: (recipeId: string, count?: number) => number;
      getRenderStats: () => Record<string, unknown>;
      terrainHeightAt: (x: number, z: number) => number;
      getWaterLevel: () => number;
      getLandmarks: () => {
        id: string;
        name: string;
        zone: string;
        x: number;
        z: number;
        height: number;
      }[];
      getZoneAt: (x: number, z: number) => string;
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
  // Push the world clock forward without waiting it out. Respawn timers run on
  // this clock, so a test can check one without a 35-second sleep.
  advanceClockMs: (ms) => clock.setElapsed(clock.now() + ms),
  // Chop a node out from under the test rather than driving the mouse for it:
  // software rendering makes a real hold-to-gather take most of a minute.
  depleteNode: (nodeId) => {
    const node = resourceNodes.find((n) => n.id === nodeId);
    if (!node) return null;
    while (!node.depleted) node.hit(clock.now(), runtimeRand);
    return { hits: node.hitsRemaining, depleted: node.depleted };
  },
  getNodeState: (nodeId) => {
    const node = resourceNodes.find((n) => n.id === nodeId);
    return node ? { hits: node.hitsRemaining, depleted: node.depleted } : null;
  },
  getDroppedItems: () => droppedItems.list(),
  // Rolls a table without needing an enemy to die, so a test can average over
  // hundreds of rolls — a probabilistic table tells you nothing from one kill.
  rollLootFor: (enemyId) => rollLoot(enemyId, runtimeRand),
  spawnDropAt: (itemId, qty, x, z) => droppedItems.spawn(itemId, qty, x, z, clock.now(), 0),
  // One swing's worth, through the real gathering path so the tool in hand and
  // the yield roll both count — measuring per-hit yield by holding the mouse
  // takes most of a minute under software rendering.
  hitNodeOnce: (nodeId) => {
    const node = resourceNodes.find((n) => n.id === nodeId);
    if (!node || node.depleted) return null;
    const before = state.inventory.map((slot) => ({ ...slot }));
    tryGather(state, node, clock.now(), runtimeRand);
    // Summed across slots, not read off the first one. An item can occupy
    // several stacks (stackSize caps each at 99), so `find` reports whichever
    // slot happens to come first and misses an addition that landed in a
    // later one — which reads as a yield of zero.
    const totalOf = (slots: { itemId: string; qty: number }[], itemId: string) =>
      slots.reduce((sum, slot) => (slot.itemId === itemId ? sum + slot.qty : sum), 0);
    const gained = (itemId: string) => totalOf(state.inventory, itemId) - totalOf(before, itemId);
    const staple = node.config.yieldItemId;
    const bonusId = node.config.bonus?.itemId;
    const bonusQty = bonusId && bonusId !== staple ? gained(bonusId) : 0;
    return {
      itemId: staple,
      qty: gained(staple),
      finalHit: node.depleted,
      ...(bonusQty > 0 ? { bonus: { itemId: bonusId!, qty: bonusQty } } : {}),
    };
  },
  // Kills outright rather than swinging at it: landing a real melee hit under
  // software rendering takes long enough to time a suite out.
  killNearestEnemy: () => {
    const feetNow = player.getFeetPosition();
    let best: { enemy: ReturnType<typeof enemyManager.getEnemies>[number]; d: number } | null = null;
    for (const enemy of enemyManager.getEnemies()) {
      const d = enemy.object.position.distanceTo(feetNow);
      if (!best || d < best.d) best = { enemy, d };
    }
    if (!best) return null;
    const { id, def, object } = best.enemy;
    const out = { id, enemyId: def.id, x: object.position.x, z: object.position.z };
    enemyManager.removeEnemy(id, clock.now());
    return out;
  },
  getPlayerRig: () => player.getAnimationState(),
  getStamina: () => ({ current: state.player.stamina, max: state.player.maxStamina }),
  getRigFingerprint: () => player.getRigFingerprint(),
  grantItems: (items) => {
    for (const [itemId, qty] of Object.entries(items)) addItem(state, itemId, qty);
  },
  getBuildingBounds: (buildingId) => {
    const placed = state.placedBuildings.find((b) => b.buildingId === buildingId);
    if (!placed) return null;
    const mesh = buildingSystem.getMesh(placed.id);
    if (!mesh) return null;
    const box = new THREE.Box3().setFromObject(mesh);
    return {
      height: box.max.y - box.min.y,
      minY: box.min.y,
      terrainY: terrain.heightAt(placed.cellX, placed.cellZ),
    };
  },
  // Measured from the rendered object rather than from state, so a model that
  // loaded at the wrong scale or sank into the terrain is caught.
  getPlayerBounds: () => {
    const box = new THREE.Box3().setFromObject(player.object);
    return { height: box.max.y - box.min.y, minY: box.min.y, feetY: state.player.y };
  },
  getCameraPitch: () => camera.pitch,
  getCameraDistance: () => camera.distance,
  getCameraYaw: () => camera.yaw,
  setCameraYaw: (yaw) => {
    camera.yaw = yaw;
  },
  getAimPoint: () => {
    const point = targeting.aimPoint(player.getFeetPosition(), camera.getForward());
    return { x: Number(point.x.toFixed(2)), z: Number(point.z.toFixed(2)) };
  },
  isFirstPerson: () => camera.firstPerson,
  isPlayerVisible: () => player.object.visible,
  // Aiming state, read straight off what the frame actually resolved rather
  // than recomputed — a test that recomputes it can agree with itself while
  // the game does something else.
  getTarget: () => ({
    kind: target.kind,
    id:
      target.node?.id ??
      target.enemy?.id ??
      target.plot?.buildingId ??
      target.containerId ??
      null,
    distance: Number.isFinite(target.distance) ? Number(target.distance.toFixed(2)) : -1,
    x: Number(target.point.x.toFixed(2)),
    z: Number(target.point.z.toFixed(2)),
  }),
  getCrosshairState: () => crosshairStateFor(target),
  getOutline: () => ({
    visible: targetOutline.object.visible,
    size: targetOutline.object.scale.toArray().map((n) => Number(n.toFixed(2))) as [
      number,
      number,
      number,
    ],
  }),
  getSelectedBuilding: () => buildingSystem.getSelectedBuildingId(),
  getBuildRotation: () => buildingSystem.getRotation(),
  getOccupiedCells: () => buildingSystem.occupiedCells(),
  // The same path the hold-to-demolish action takes, so a test exercises the
  // real refund and cleanup rather than BuildingSystem.demolish in isolation.
  placeBuildingAt: (buildingId, cellX, cellZ, rotation) =>
    buildingSystem.placeAt(buildingId, cellX, cellZ, rotation, clock.now()),
  // Walks the player toward a point in small steps, resolving collision at
  // each one, and reports where they actually ended up. A single teleport
  // would pass straight through anything, which is the opposite of the
  // question being asked.
  probeMoveTo: (x, z, steps = 120) => {
    const start = player.getFeetPosition();
    let cx = start.x;
    let cz = start.z;
    // Each step advances from where the body actually IS toward the target,
    // and keeps the correction. Interpolating from the start instead would
    // walk the sample point straight through a wall and hand back the far
    // side, since a point beyond the wall overlaps nothing.
    const stepX = (x - start.x) / steps;
    const stepZ = (z - start.z) / steps;
    for (let i = 0; i < steps; i++) {
      const solved = resolveCollisions(cx + stepX, cz + stepZ, PLAYER_RADIUS, getCollidables());
      cx = solved.x;
      cz = solved.z;
      player.teleport(cx, cz);
    }
    return { x: cx, z: cz };
  },
  demolishBuilding: (placedId) => {
    const existed = state.placedBuildings.some((p) => p.id === placedId);
    if (existed) demolishAimed(placedId);
    return existed;
  },
  getHotbar: () => [...state.hotbar],
  getContainer: (buildingId) => (state.containers[buildingId] ?? []).map((s) => ({ ...s })),
  getContainerPanelOpen: () => containerPanel.isVisible(),
  getEquippedSlot: () => state.equippedSlot,
  getEquippedItem: () => equippedItemId(state),
  selectHotbarSlot: (index) => selectSlot(state, index),
  // What the inventory panel's Hold button does: put this item in the slot
  // currently in hand.
  holdItem: (itemId) => assignToSlot(state, state.equippedSlot, itemId),
  getHeldDamage: () => heldDamage(state),
  depositToContainer: (buildingId, itemId, qty) => deposit(state, buildingId, itemId, qty),
  withdrawFromContainer: (buildingId, itemId, qty) => withdraw(state, buildingId, itemId, qty),
  saveNow: () => persist(),
  // Read off the rendered hand rather than off state, so a test can tell
  // "the game thinks you hold an axe" from "an axe is actually on the arm".
  getHeldItemMesh: () => player.getHeldItem(),
  setFistOffset: (x, y, z) => player.setFistOffset(x, y, z),
  // Whether the thing in the hand is actually *visible* rather than buried in
  // the torso: raycast from the camera at it and see what comes back first.
  // Eyeballing a chibi model against its own quiver strap proved unreliable.
  isHeldItemVisible: () => {
    const grip = player.getGripObject();
    const miss = { onScreen: false, ndc: [0, 0] as [number, number] };
    if (!grip) return { ...miss, visible: false, firstHit: "no-grip" };
    // three only refreshes matrices at render time, so both the camera and the
    // grip have to be brought up to date before projecting — the same stale
    // matrix trap targeting.ts documents. Without this the projected point can
    // land on the head, or off screen entirely, and the answer is noise.
    camera.camera.updateMatrixWorld(true);
    player.object.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(grip);
    if (box.isEmpty()) return { ...miss, visible: false, firstHit: "empty-hand" };
    const centre = box.getCenter(new THREE.Vector3());
    const ndc = centre.clone().project(camera.camera);
    // Is the item inside the frame at all, and in front of the camera? This
    // part is reliable, so it is what a test should lean on.
    const onScreen =
      ndc.z > -1 && ndc.z < 1 && Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1;

    // The occlusion answer below is best-effort only. Raycasting a SkinnedMesh
    // uses its bind-pose bounds, so the ray can slip past an animated limb and
    // report "nothing" for an item that is plainly on screen — treat a miss as
    // "could not tell", never as proof the item is hidden.
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), camera.camera);
    const hits = ray.intersectObject(player.object, true);
    const out = { onScreen, ndc: [ndc.x, ndc.y] as [number, number] };
    if (hits.length === 0) return { ...out, visible: onScreen, firstHit: "no-ray-hit" };
    let node: THREE.Object3D | null = hits[0].object;
    while (node) {
      if (node === grip) return { ...out, visible: true, firstHit: "held-item" };
      node = node.parent;
    }
    return { ...out, visible: false, firstHit: hits[0].object.name || hits[0].object.type };
  },
  getActionProgress: () => actionProgress(),
  // The swing length for whatever is aimed at, so a test can prove an iron
  // tool is actually faster rather than inferring it from the tier name.
  getGatherTime: () => gatherTimeFor(state, aimedNode(target)),
  // Crafting had no debug surface at all, so every crafting test had to drive
  // the DOM and none could check discovery, which has no DOM of its own.
  getHealth: () => ({ current: state.player.health, max: state.player.maxHealth }),
  damagePlayer: (amount) => damagePlayer(state, amount),
  getKnownRecipes: () => listKnownRecipes(state).map((recipe) => recipe.id),
  // The recipe book as data, so a test can ask what a category contains
  // instead of hardcoding a list that every new recipe invalidates.
  getAllRecipes: () => RECIPES.map((r) => ({ id: r.id, name: r.name, category: r.category })),
  getUnseenRecipes: () => [...state.unseenRecipes],
  getCraftableRecipes: () =>
    listKnownRecipes(state)
      .filter((recipe) => canCraft(state, recipe.id, stationCheck))
      .map((recipe) => recipe.id),
  craftRecipe: (recipeId, count = 1) => craftMany(state, recipeId, count, stationCheck),
  terrainHeightAt: (x, z) => terrain.heightAt(x, z),
  getWaterLevel: () => WATER_LEVEL,
  getLandmarks: () =>
    landmarks.map((l) => ({
      id: l.id,
      name: l.name,
      zone: l.zone,
      x: Number(l.x.toFixed(1)),
      z: Number(l.z.toFixed(1)),
      height: Number(l.height.toFixed(2)),
    })),
  getZoneAt: (x, z) => getZone(x, z),
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
