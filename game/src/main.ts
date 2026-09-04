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

import { Terrain, WORLD_SIZE } from "./world/terrain";
import { getZone } from "./world/zones";
import { scatterResourceNodes, addNodesToScene } from "./world/world-objects";
import { createGrass } from "./world/grass";
import { Water, WATER_LEVEL } from "./world/water";
import { loadModels } from "./world/models";
import { createLandmarks } from "./world/landmarks";
import { createPointsOfInterest, updatePointsOfInterest } from "./world/pois";
import { RegionManager, type Region, type RegionId } from "./world/region";
import { portalSteppedInto, updatePortals } from "./world/portal";
import { CAVE_ARRIVAL, createCaveMouths, createCaveRegion, type CaveMouth } from "./world/cave";
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
import { addItem, consumeItem, hasQty, removeItem } from "./systems/inventory";
import { getItem } from "./data/items";
import { BUILDINGS, getBuilding } from "./data/buildings";
import { RECIPES } from "./data/recipes";
import {
  assignFromInventory,
  assignToSlot,
  autoAssign,
  cycleSlot,
  equippedItemId,
  pruneHotbar,
  selectSlot,
  takeOffArmour,
  wearArmour,
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
import { RaidSystem } from "./systems/raid";
import { TrapSystem } from "./systems/traps";
import { PlayerCombat } from "./systems/combat";
import { DayNightSystem, DAY_LENGTH_MS } from "./systems/day-night";
import { saveGame, loadGame } from "./systems/save-load";
import { deposit, withdraw } from "./systems/containers";
import { ARROW_DAMAGE, BOW_ID, heldDamage } from "./data/tools";

import { createInitialState, type GameState } from "./state/game-state";
import { mulberry32 } from "./utils/rng";
import { DroppedItems } from "./world/dropped-item";
import { Projectiles } from "./world/projectile";
import { rollLoot } from "./data/loot";
import { loadSettings } from "./state/settings";
import { keyLabel, loadBindings, saveBindings } from "./state/keybindings";

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

/**
 * Everything the overworld is made of, in one object.
 *
 * The point is the last line of `RegionManager.enter`: going underground has
 * to take the overworld off screen, and the overworld is several thousand
 * props, a homestead the player built and a hundred-thousand-blade grass
 * field. Hiding that is one `scene.remove` only because it all hangs off a
 * single group — added piece by piece to the scene, as it used to be, it would
 * be a list of removals that a later feature would forget to extend.
 */
const surfaceGroup = new THREE.Group();
surfaceGroup.add(terrain.mesh);

const renderer = createRenderer(canvas);
const camera = new ThirdPersonCamera(settings);
const input = new InputManager(canvas, bindings);
const clock = new GameClock(state.elapsedMs);
const dayNight = new DayNightSystem(sceneRig);

// One runtime randomness stream, seeded from the world so a given save feels
// consistent, but deliberately NOT reproducible across a reload: it advances
// with every roll and its position is not saved. That is the same bargain
// EnemyManager already makes with its spawn stream — runtime rolls are not
// world generation, and pretending otherwise would mean persisting a cursor
// nothing else needs.
const runtimeRand = mulberry32(state.seed ^ 0x5eed10a7);

const resourceNodes = scatterResourceNodes(terrain, state.seed, models);
addNodesToScene(surfaceGroup, resourceNodes);

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
surfaceGroup.add(createGrass(terrain, state.seed));

const water = new Water();
surfaceGroup.add(water.mesh);

const composer = createComposer(renderer, scene, camera.camera);

// Landmarks first: the caches below are placed relative to them.
const landmarks = createLandmarks(surfaceGroup, terrain, state.seed, models);
const poiSites = createPointsOfInterest(state, landmarks, state.seed);

// The ways down, and the portals standing in front of them.
const caveMouths = createCaveMouths(surfaceGroup, terrain, state.seed, models, resourceNodes);

const surfaceRegion: Region = {
  id: "surface",
  name: "Homestead",
  surface: terrain,
  group: surfaceGroup,
  ground: terrain.mesh,
  halfExtent: terrain.halfExtent,
  nodes: resourceNodes,
  portals: caveMouths.map((mouth) => mouth.portal),
  mapGround: null,
  // The overworld's light is the day/night cycle's, not a fixed setting.
  ambience: null,
  // Likewise its enemies: the ambient trickle and the raid schedule already
  // own that, and a second opinion here would fight them.
  enemies: null,
};

const regions = new RegionManager(scene, surfaceRegion);

/** The nodes of wherever the player is standing. */
function activeNodes() {
  return regions.active.nodes;
}

const player = new PlayerController(state, regions, models);
scene.add(player.object);

// Buildings and crops go in the surface group rather than straight into the
// scene: they are the player's homestead, they can only exist up here, and
// they have to disappear along with the rest of the overworld when the player
// goes underground.
const buildingSystem = new BuildingSystem(surfaceGroup, terrain, state, models);
const farmingSystem = new FarmingSystem(surfaceGroup, terrain, state);

// Loot on the floor. Not saved, on purpose and for the same reason enemies
// are not: it belongs to the fight that just happened, and a reload has
// already thrown that fight away.
const droppedItems = new DroppedItems(scene, regions);
// Arrows in flight. Not saved, same as the enemies they are aimed at and the
// loot they turn into when they land.
const projectiles = new Projectiles(scene, regions);

events.on("enemy-killed", ({ enemyId, x, z }) => {
  droppedItems.spawnAll(rollLoot(enemyId, runtimeRand), x, z, currentNowMs);
});

events.on("item-picked-up", ({ itemId, qty }) => {
  events.emit("notification", { message: `Picked up ${qty}x ${getItem(itemId).name}` });
});
const enemyManager = new EnemyManager(scene, regions, state.seed);
const raid = new RaidSystem(state, enemyManager);
const traps = new TrapSystem(buildingSystem, enemyManager);
// A trap taken down should not leave its cooldown behind under an id that a
// later piece could be issued — the same class of leak as the barrel-contents
// bug, just cheaper.
events.on("building-removed", ({ id }) => traps.forget(id));
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

// Seeded from the clock rather than from zero, so the first frame's step is a
// frame and not "the whole of the save's elapsed time".
let currentNowMs = clock.now();

// ---------------------------------------------------------------------------
// Moving between places
// ---------------------------------------------------------------------------

// The overworld's fog distances, kept because DayNightSystem re-tints the fog
// colour every frame but never touches its near and far — so a cave, which
// pulls them in to six and forty-four, would leave the whole overworld shrouded
// after the player walked back out.
const SURFACE_FOG_NEAR = (scene.fog as THREE.Fog).near;
const SURFACE_FOG_FAR = (scene.fog as THREE.Fog).far;

/** Which mouth the player went down, so walking back out returns them to it. */
let usedMouth: CaveMouth | null = null;

/**
 * Puts the scene's lighting into whatever the region asks for, or hands it
 * back to the day/night cycle.
 *
 * A region with no ambience of its own says nothing here beyond restoring the
 * sky and the fog distances: the very next `dayNight.update` overwrites the
 * colours and intensities, which is exactly the handover wanted.
 */
function applyAmbience(region: Region): void {
  const fog = scene.fog as THREE.Fog;
  const ambience = region.ambience;
  sceneRig.sky.visible = ambience ? ambience.showSky : true;
  if (!ambience) {
    fog.near = SURFACE_FOG_NEAR;
    fog.far = SURFACE_FOG_FAR;
    return;
  }
  fog.color.setHex(ambience.fogColor);
  fog.near = ambience.fogNear;
  fog.far = ambience.fogFar;
  sceneRig.hemiLight.color.setHex(ambience.hemiSky);
  sceneRig.hemiLight.groundColor.setHex(ambience.hemiGround);
  sceneRig.hemiLight.intensity = ambience.hemiIntensity;
  sceneRig.sunLight.color.setHex(ambience.sunColor);
  sceneRig.sunLight.intensity = ambience.sunIntensity;
}

/**
 * Walks the player through a portal.
 *
 * Everything that belongs to the fight or the floor of the place being left —
 * enemies, dropped loot, arrows in flight — is cleared rather than carried,
 * because none of it means anything on the other side and a brute that
 * followed you out of a cave would be a monster from a place that has since
 * been deleted.
 */
function enterRegion(target: RegionId, arrival: { x: number; z: number }): void {
  if (target === regions.activeRegionId) return;

  enemyManager.clearAll(currentNowMs);
  droppedItems.clear();
  projectiles.clear();

  if (target === "surface") {
    regions.enter(surfaceRegion);
    enemyManager.setDungeonRules(null, currentNowMs);
    // A raid that was running when the player went under is still running, and
    // its field was emptied on the way in — so it picks up with a fresh wave,
    // exactly as it does after a reload.
    raid.resume(currentNowMs, arrival.x, arrival.z);
  } else {
    // A seed that moves with the clock: the player chose a dungeon that
    // resets, so two trips down the same hole are two different caves.
    const cave = createCaveRegion((state.seed ^ 0x0dee9) + Math.floor(currentNowMs), models);
    regions.enter(cave);
    enemyManager.setDungeonRules(cave.enemies, currentNowMs);
    // The raid is held rather than fought while they are down here, so the
    // spawner has to be told the night is off — otherwise `raiding` stays true
    // and suppresses the cave's own trickle, leaving an empty dungeon.
    enemyManager.setRaiding(false);
  }

  state.region = regions.activeRegionId;
  applyAmbience(regions.active);
  player.teleport(arrival.x, arrival.z);

  // The homestead is a surface thing. Turning both systems off wholesale —
  // rather than hiding the Build panel and hoping — is what makes "you cannot
  // build down here" true of the debug hooks and of any call site added later,
  // not only of the two that exist today.
  const onSurface = regions.isSurface();
  buildingSystem.setEnabled(onSurface);
  farmingSystem.setEnabled(onSurface);
}

/** Steps through whichever portal the player has just walked into, if any. */
function updateRegionTransitions(): void {
  const portal = portalSteppedInto(regions.active.portals, state.player.x, state.player.z);
  if (!portal) return;

  if (portal.target === "surface") {
    // The mouth they came down, or — if this session never saw them go down,
    // which a reload could do — whatever the save recorded.
    const arrival = usedMouth
      ? { x: usedMouth.returnX, z: usedMouth.returnZ }
      : { x: state.regionReturn?.x ?? 0, z: state.regionReturn?.z ?? 0 };
    enterRegion("surface", arrival);
    return;
  }

  usedMouth = caveMouths.find((mouth) => mouth.portal === portal) ?? null;
  // Recorded before the move, so a player who quits underground is put back
  // here on their next load rather than at coordinates inside a cave that no
  // longer exists.
  state.regionReturn = usedMouth
    ? { x: usedMouth.returnX, z: usedMouth.returnZ }
    : { x: state.player.x, z: state.player.z };
  enterRegion(portal.target, CAVE_ARRIVAL);
}

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

// Patching a wall up is its own held action on its own key, tracked the same
// way. It could not share the left mouse button with demolishing: the pieces
// worth repairing are exactly the pieces you would be furious to accidentally
// pull down, and a raid is no time to be reading a modifier hint.
const REPAIR_MS = 1100;
let repairBuildingId: string | null = null;
let repairProgressMs = 0;

function resetRepair(): void {
  repairBuildingId = null;
  repairProgressMs = 0;
}

/** Hold the repair key on a damaged piece to put it back together. */
function updateRepairAction(dtSeconds: number, aimedBuildingId: string | null): void {
  const cost = aimedBuildingId ? buildingSystem.repairCost(aimedBuildingId) : null;
  if (!aimedBuildingId || !cost || cost.length === 0) {
    resetRepair();
    return;
  }
  if (repairBuildingId !== aimedBuildingId) {
    repairBuildingId = aimedBuildingId;
    repairProgressMs = 0;
    player.triggerSwing(currentNowMs);
  }
  repairProgressMs += dtSeconds * 1000;
  if (repairProgressMs < REPAIR_MS) return;

  if (buildingSystem.repair(aimedBuildingId)) {
    const parts = cost.map((c) => `${c.qty}x ${getItem(c.itemId).name}`).join(", ");
    events.emit("notification", { message: `Repaired (-${parts})` });
  }
  // Reset either way. A failed repair that kept its progress would re-fire
  // its "not enough planks" toast every frame the key stayed down.
  resetRepair();
}

/**
 * How full the crosshair ring is, 0..1. One definition for both the HUD and
 * the debug surface, so a test can never be told a different story from the
 * one the player is being shown.
 */
function actionProgress(): number {
  if (repairBuildingId) return Math.min(1, repairProgressMs / REPAIR_MS);
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
/**
 * Tips a container's contents onto the ground where it stood and forgets them.
 *
 * Shared by taking a barrel down and by having one smashed: whichever way it
 * goes, what was inside has to end up somewhere the player can pick it back
 * up. Dropping at the player's feet instead would put it straight back in the
 * bag, which is the same as handing it over with extra steps — and on a raid
 * night that would make a broken barrel a *reward*.
 */
function spillContainer(placedId: string, x: number, z: number): void {
  const stored = state.containers[placedId];
  delete state.containers[placedId];
  if (!stored) return;
  for (const slot of stored) {
    droppedItems.spawn(slot.itemId, slot.qty, x, z, currentNowMs, 0.6);
  }
}

/** Where a placed piece stands. Must be read before it is removed. */
function siteOf(placedId: string): { x: number; z: number } {
  const site = state.placedBuildings.find((p) => p.id === placedId);
  return { x: site ? site.cellX : 0, z: site ? site.cellZ : 0 };
}

function demolishAimed(placedId: string): void {
  const site = siteOf(placedId);
  const result = buildingSystem.demolish(placedId);
  if (!result) return;
  spillContainer(placedId, site.x, site.z);

  const def = getBuilding(result.buildingId);
  const parts = result.refunded.map((c) => `${c.qty}x ${getItem(c.itemId).name}`).join(", ");
  events.emit("notification", {
    message: parts ? `Removed ${def.name} (+${parts})` : `Removed ${def.name}`,
  });
}

// Drawing a bow is slower than a sword swing, which is the trade for reaching
// past the end of one.
const DRAW_MS = 700;
let lastShotMs = -Infinity;

/**
 * Looses an arrow along the camera's line, spending one from the bag.
 *
 * Returns whether the bow was what the player was holding — the caller uses
 * that to decide whether this replaced the melee swing, so a bow never both
 * shoots and slashes.
 */
function tryShoot(): boolean {
  if (equippedItemId(state) !== BOW_ID) return false;
  if (currentNowMs - lastShotMs < DRAW_MS) return true;
  if (!hasQty(state, "arrow", 1)) {
    events.emit("notification", { message: `Out of ${getItem("arrow").name}s` });
    lastShotMs = currentNowMs;
    return true;
  }
  removeItem(state, "arrow", 1);
  lastShotMs = currentNowMs;
  player.triggerSwing(currentNowMs);
  projectiles.fire(player.getFeetPosition(), camera.getForward(), currentNowMs);
  events.emit("arrow-fired", {});
  return true;
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

  // After demolition so that aiming at your own wall still takes it down, and
  // before gathering so that a bow is never quietly used as an axe.
  if (tryShoot()) return;

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
  // A gate outranks everything else you could be doing with the right button:
  // if you are looking at one, you meant to go through it. Left-click still
  // takes it down, so the two verbs stay where the game already put them.
  if (target.kind === "building" && target.buildingId !== undefined) {
    if (buildingSystem.toggleDoor(target.buildingId) !== null) return;
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

/**
 * A blocked enemy takes a swing at whatever is in its way.
 *
 * Returns whether there was in fact something breakable there. A boulder or a
 * tree answers false and the enemy keeps sliding along it as it always did —
 * only things the player built can be broken down, and only because they are
 * standing between the raider and the player. Nothing here targets a base.
 */
function attackBuildingAt(x: number, z: number, damage: number): boolean {
  const placedId = buildingSystem.buildingIdAt(x, z);
  if (!placedId) return false;
  const site = siteOf(placedId);
  const result = buildingSystem.damageBuilding(placedId, damage, currentNowMs);
  if (!result) return false;
  if (result.destroyed) {
    const removed = buildingSystem.destroy(placedId);
    spillContainer(placedId, site.x, site.z);
    if (removed) {
      events.emit("notification", {
        message: `${getBuilding(removed.buildingId).name} destroyed!`,
      });
    }
  }
  return true;
}

/**
 * What the aimed building has to say: how to work its door, and what putting
 * it back together would cost once something has been chewing on it.
 *
 * One prompt rather than two, because the HUD only has one line — and a gate
 * that has been hit needs to say both things at once, which is exactly the
 * moment the player most needs to be told.
 */
function buildingPrompt(placedId: string | null): string | null {
  if (!placedId) return null;
  const site = state.placedBuildings.find((p) => p.id === placedId);
  if (!site) return null;
  const name = getBuilding(site.buildingId).name;
  const parts: string[] = [];

  const door = buildingSystem.doorStateOf(placedId);
  if (door) parts.push(`${name} (${door.open ? "open" : "shut"}) — right-click to ${door.open ? "close" : "open"}`);

  const health = buildingSystem.healthOf(placedId);
  const cost = buildingSystem.repairCost(placedId);
  // Undamaged says nothing, so the repair half appearing is itself the news
  // that something is chewing on the base.
  if (health && health.damage > 0 && cost && cost.length > 0) {
    const price = cost.map((c) => `${c.qty}x ${getItem(c.itemId).name}`).join(", ");
    const remaining = health.maxHealth - health.damage;
    const key = keyLabel(bindings.repair[0] ?? "");
    parts.push(
      door
        ? `hold ${key} to repair ${remaining}/${health.maxHealth} (${price})`
        : `${name} ${remaining}/${health.maxHealth} — hold ${key} to repair (${price})`,
    );
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

function getCollidables(): Collidable[] {
  const nodeCollidables: Collidable[] = activeNodes()
    .filter((n) => !n.depleted)
    .map((n) => ({ x: n.object.position.x, z: n.object.position.z, radius: 0.5 }));
  // `getCollidables` is empty off the surface — see BuildingSystem.setEnabled.
  return [...nodeCollidables, ...buildingSystem.getCollidables()];
}

const loop = new GameLoop((dt) => {
  clock.tick(dt);
  // How far the world clock actually moved, which is NOT `dt * 1000`: the loop
  // clamps dt, and the debug clock can jump forward by minutes at once.
  // Anything holding a deadline against this clock has to be pushed by the
  // clock's own step or it silently falls behind.
  const stepMs = Math.max(0, clock.now() - currentNowMs);
  currentNowMs = clock.now();
  state.elapsedMs = currentNowMs;
  // The sun does not reach a cave: while the player is in one, the region's
  // own ambience owns the lights and this is skipped. It resumes on the frame
  // they walk back out, which is what puts the sky, the fog tint and the time
  // of day back without anything having to remember what they were.
  if (regions.isSurface()) dayNight.update(currentNowMs);
  // Day 1 is the first day, not day 0. Derived from the world clock rather
  // than counted, so it needs no state of its own — and unlike the raid
  // schedule it decides nothing, so the debug clock winding back only rewinds
  // a label.
  hud.setTimeOfDay(
    dayNight.getTimeOfDay(currentNowMs),
    Math.floor(currentNowMs / DAY_LENGTH_MS) + 1,
  );
  sound.updateAmbient(dayNight.getDaylight());

  const menuOpen = anyPanelOpen();
  if (!isPlayerDead(state) && !menuOpen) {
    const collidables = getCollidables();
    player.update(dt, currentNowMs, input, camera, collidables);
  }

  // Resolved the instant the player has finished moving and before anything
  // else reads where they are, so a frame happens entirely in one region or
  // entirely in the other — never half in each.
  updateRegionTransitions();
  updatePortals(regions.active.portals, currentNowMs);

  const feet = player.getFeetPosition();
  // Re-centre the sun's shadow frustum on the player before anything renders.
  updateSunTarget(sceneRig, dayNight.getSunDirection(), feet);
  // The pivot sits just above the character's head (they are 1.70 tall), not
  // at chest height. The crosshair ray passes through this point, so a pivot
  // inside the body put the character between the camera and whatever was
  // being aimed at — the placement ghost was hidden behind their own head.
  camera.update(feet.clone().add(new THREE.Vector3(0, EYE_HEIGHT, 0)), [regions.active.ground]);

  for (const node of activeNodes()) node.update(currentNowMs);
  farmingSystem.update(currentNowMs);
  droppedItems.update(currentNowMs, state, feet.x, feet.z);

  // Arrows fly on regardless of panels and death: one already loosed is in the
  // air, and freezing it mid-flight behind an open inventory would be stranger
  // than letting it land.
  for (const hit of projectiles.update(dt, currentNowMs, enemyManager.getEnemies(), getCollidables())) {
    if (hit.enemy) {
      // The same path a sword swing takes, rather than a second way to hurt
      // something: one place decides what a killed enemy does.
      const dead = hit.enemy.takeDamage(ARROW_DAMAGE, currentNowMs);
      events.emit("enemy-hit", { id: hit.enemy.id, damage: ARROW_DAMAGE });
      if (dead) enemyManager.removeEnemy(hit.enemy.id, currentNowMs);
    } else {
      // A spent arrow is just loot on the floor — the pickup, the despawn and
      // the fade all come free from the drop system.
      droppedItems.spawn("arrow", 1, hit.x, hit.z, currentNowMs, 0.2);
    }
  }

  // Traps work whether or not the player is up: they are part of the ground,
  // not something the player is doing.
  // Only where the traps are. A cave enemy standing at (5, 5) is nowhere near
  // a spike trap laid on the homestead's cell (5, 5), but the trap has no way
  // to know that — it compares coordinates, and both places use the same ones.
  if (regions.isSurface()) traps.update(currentNowMs, enemyManager.getEnemies());

  // The raid runs whether or not the player is on their feet: it is a stretch
  // of the night, not a fight that pauses while they are down.
  //
  // It does pause while they are somewhere it cannot reach. Underground the
  // whole schedule is pushed forward instead of advanced, so a trip into a
  // cave neither skips a raid nor banks one — and, deliberately, only the raid
  // is held: crops keep growing, nodes keep respawning and caches keep
  // restocking, because "the raid clock stops" is what was asked for and
  // freezing the world clock would quietly stop all of those too.
  if (regions.isSurface()) raid.update(currentNowMs, feet.x, feet.z);
  else raid.defer(stepMs);
  hud.setRaid(
    regions.isSurface() && raid.isActive()
      ? {
          raid: raid.getRaidNumber(),
          wave: raid.getWave(),
          totalWaves: raid.getTotalWaves(),
          remaining: raid.raidersAlive(),
        }
      : null,
  );

  if (!isPlayerDead(state)) {
    enemyManager.update(
      dt,
      currentNowMs,
      feet,
      (damage) => {
        damagePlayer(state, damage);
        scheduleRespawnIfDead();
      },
      // The same list the player was resolved against a few lines up, so
      // neither side gets a world the other cannot see.
      getCollidables(),
      attackBuildingAt,
    );
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
    nodes: activeNodes(),
    enemies: enemyManager.getEnemies(),
    terrain: regions.active.ground,
    buildings: buildingSystem,
    state,
  });

  const canAct = !isPlayerDead(state) && !menuOpen;
  const aim = targeting.aimPoint(feet, camera.getForward());
  // The ghost only belongs on screen while the player can actually place: it
  // used to keep tracking and glowing behind an open panel and over a corpse.
  buildingSystem.update(aim, currentNowMs, canAct && regions.isSurface());

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

  const aimedBuildingId =
    (target.kind === "building" || target.kind === "container") && target.buildingId !== undefined
      ? target.buildingId
      : null;
  if (canAct && input.isActionDown("repair")) updateRepairAction(dt, aimedBuildingId);
  else resetRepair();

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
  const keyNode = aimedNode(target) ?? nearestNode(activeNodes(), feet.x, feet.z);
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
  hud.setPrompt(placementPrompt ?? buildingPrompt(aimedBuildingId) ?? gatherPrompt ?? farmPrompt);

  // The outline says which object an action would hit; the crosshair shape
  // says what kind of thing it is. Neither relies on colour to be read.
  if (target.object && target.kind !== "ground") targetOutline.surround(target.object);
  else targetOutline.hide();
  hud.setCrosshairState(crosshairStateFor(target));

  // Restock timers and landmark discovery. Cheap — a handful of distance
  // checks over six sites — so it runs with everything else rather than on a
  // timer of its own.
  // Same reasoning as the traps: discovery and restocking are distance
  // questions asked in overworld coordinates, and a player standing at (0, 24)
  // in a cave would otherwise "walk up to" whatever landmark happens to sit at
  // (0, 24) on the surface without ever having been there.
  if (regions.isSurface()) {
    updatePointsOfInterest(state, poiSites, currentNowMs, state.player.x, state.player.z);
  }

  const onSurface = regions.isSurface();
  hud.setPlace(onSurface ? null : regions.active.name);
  minimap.update(
    currentNowMs,
    state,
    activeNodes(),
    enemyManager.getEnemies(),
    (id) => buildingSystem.getMesh(id),
    onSurface ? landmarks : [],
    regions.active.mapGround,
  );

  water.update(currentNowMs);
  // Reset per-frame counters ourselves: the composer issues several render
  // calls per frame, and three's auto-reset would leave the stats reflecting
  // only the final fullscreen pass.
  renderer.info.reset();
  composer.render();
  input.endFrame();
});

// A raid interrupted by a reload picks up where it left off, with a fresh wave
// — enemies are never saved, so without this the field would come back empty
// and reloading would be the cheapest way in the game to skip a raid.
raid.resume(clock.now(), state.player.x, state.player.z);

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
      getEnemyPositions: () => {
        id: string;
        enemyId: string;
        x: number;
        z: number;
        health: number;
      }[];
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
      getBuildingHealth: (placedId: string) => { damage: number; maxHealth: number } | null;
      getRepairCost: (placedId: string) => { itemId: string; qty: number }[] | null;
      repairBuilding: (placedId: string) => boolean;
      enemyAttackAt: (x: number, z: number, damage: number) => boolean;
      spawnEnemyAt: (enemyId: string, x: number, z: number) => string;
      clearEnemies: () => number;
      getBuildingDef: (buildingId: string) => {
        id: string;
        name: string;
        maxHealth: number;
        height: number;
        cost: { itemId: string; qty: number }[];
      } | null;
      getArmour: () => string | null;
      wearArmour: (itemId: string) => boolean;
      takeOffArmour: () => string | null;
      hurtPlayer: (amount: number) => void;
      setRaidCount: (count: number) => void;
      getRaidState: () => {
        active: boolean;
        raid: number;
        count: number;
        wave: number;
        totalWaves: number;
        raidersAlive: number;
        nextRaidAtMs: number;
        endsAtMs: number;
        msUntilRaid: number;
      };
      startRaid: () => void;
      endRaid: () => void;
      toggleDoor: (placedId: string) => boolean | null;
      shootArrow: () => boolean;
      getArrowsInFlight: () => number;
      getDoorState: (placedId: string) => { open: boolean } | null;
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
        far: boolean;
        x: number;
        z: number;
        height: number;
      }[];
      getPois: () => {
        id: string;
        landmarkId: string;
        far: boolean;
        restockAtMs: number | null;
      }[];
      getDiscovered: () => string[];
      getWorldSize: () => number;
      getZoneAt: (x: number, z: number) => string;
      getRegion: () => {
        id: string;
        name: string;
        halfExtent: number;
        nodeCount: number;
        portals: { id: string; target: string; x: number; z: number; armed: boolean }[];
      };
      getCaveMouths: () => { x: number; z: number; returnX: number; returnZ: number }[];
      /** Walks the player into a portal the way their own feet would. */
      enterPortal: (index: number) => string;
      /**
       * Sets a portal's armed flag. The arming rule is a guard against a body
       * appearing inside a portal, which the current layout happens to make
       * unreachable — so this is how a check drives the real
       * `portalSteppedInto` path rather than proving the layout instead.
       */
      setPortalArmed: (index: number, armed: boolean) => boolean;
    };
  }
}
window.__gameDebug = {
  getPlayerPosition: () => ({ x: state.player.x, y: state.player.y, z: state.player.z }),
  getInventory: () => state.inventory.map((s) => ({ ...s })),
  getEnemyPositions: () =>
    enemyManager
      .getEnemies()
      .map((e) => ({
        id: e.id,
        // Which kind, not only which instance: a wave's difficulty is in its
        // mix of zombies and brutes, and there was no way to read that.
        enemyId: e.def.id,
        x: e.object.position.x,
        z: e.object.position.z,
        health: e.health,
      })),
  getPlots: () => state.plots.map((p) => ({ ...p })),
  getPlacedBuildings: () => state.placedBuildings.map((b) => ({ ...b })),
  teleportPlayer: (x, z) => player.teleport(x, z),
  isPointerLocked: () => input.isPointerLocked(),
  getResourceNodes: () =>
    activeNodes().map((n) => ({
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
    const node = activeNodes().find((n) => n.id === nodeId);
    if (!node) return null;
    while (!node.depleted) node.hit(clock.now(), runtimeRand);
    return { hits: node.hitsRemaining, depleted: node.depleted };
  },
  getNodeState: (nodeId) => {
    const node = activeNodes().find((n) => n.id === nodeId);
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
    const node = activeNodes().find((n) => n.id === nodeId);
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
      player.teleport(solved.x, solved.z);
      // Read the body back rather than trusting the running total. `teleport`
      // clamps to the world's edge, so at the boundary the two disagree — and
      // a total that kept marching outward would both walk the next step from
      // somewhere the player is not, and hand the caller a final position the
      // player never occupied. That is the difference between a check that
      // asks "where did the body end up" and one that asks "what did I add up".
      const at = player.getFeetPosition();
      cx = at.x;
      cz = at.z;
    }
    return { x: cx, z: cz };
  },
  demolishBuilding: (placedId) => {
    const existed = state.placedBuildings.some((p) => p.id === placedId);
    if (existed) demolishAimed(placedId);
    return existed;
  },
  getBuildingHealth: (placedId) => buildingSystem.healthOf(placedId),
  getRepairCost: (placedId) => buildingSystem.repairCost(placedId),
  repairBuilding: (placedId) => buildingSystem.repair(placedId),
  // The real handler an enemy calls when something blocks it, destruction and
  // spilled barrels and all — not `BuildingSystem.damageBuilding` on its own,
  // which knows nothing about what was inside.
  enemyAttackAt: (x, z, damage) => attackBuildingAt(x, z, damage),
  spawnEnemyAt: (enemyId, x, z) => enemyManager.spawnEnemyAt(enemyId, x, z),
  // Sweeps the field so a spawn test measures the *next* batch rather than
  // whatever was already standing about. Goes through removeEnemy, so loot and
  // the kill event fire exactly as they would in play.
  clearEnemies: () => {
    const living = enemyManager.getEnemies();
    for (const enemy of living) enemyManager.removeEnemy(enemy.id, clock.now());
    return living.length;
  },
  // The piece table as data. A test comparing what a wall withstands should
  // read the game's own number rather than restate it and go stale the first
  // time it is tuned.
  getBuildingDef: (buildingId) => {
    const def = BUILDINGS[buildingId];
    if (!def) return null;
    return {
      id: def.id,
      name: def.name,
      maxHealth: def.maxHealth,
      height: def.height,
      cost: def.cost.map((c) => ({ ...c })),
    };
  },
  getArmour: () => state.armour,
  wearArmour: (itemId) => wearArmour(state, itemId),
  takeOffArmour: () => takeOffArmour(state),
  // The real damage path, so the armour reduction under test is the one the
  // game applies — not a second copy of the arithmetic living in the suite.
  hurtPlayer: (amount) => damagePlayer(state, amount),
  // Jumps the difficulty dial. Playing ten raids to see what raid ten looks
  // like is twenty minutes of waiting per assertion.
  setRaidCount: (count) => {
    state.raid.count = Math.max(0, Math.floor(count));
  },
  getRaidState: () => ({
    active: raid.isActive(),
    raid: raid.getRaidNumber(),
    count: raid.getRaidsSurvived(),
    wave: raid.getWave(),
    totalWaves: raid.getTotalWaves(),
    raidersAlive: raid.raidersAlive(),
    nextRaidAtMs: state.raid.nextRaidAtMs,
    endsAtMs: state.raid.endsAtMs,
    msUntilRaid: raid.msUntilRaid(clock.now()),
  }),
  toggleDoor: (placedId) => buildingSystem.toggleDoor(placedId),
  // The real firing path, cooldown and ammunition check and all — driving the
  // mouse through a pointer lock under software rendering is slow and flaky,
  // and what is under test is the arrow, not the click.
  shootArrow: () => tryShoot(),
  getArrowsInFlight: () => projectiles.count(),
  getDoorState: (placedId) => buildingSystem.doorStateOf(placedId),
  startRaid: () => raid.start(clock.now(), state.player.x, state.player.z),
  endRaid: () => raid.finish(clock.now()),
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
  // The ground of wherever the player is, not always the overworld's.
  terrainHeightAt: (x, z) => regions.heightAt(x, z),
  getWaterLevel: () => WATER_LEVEL,
  getLandmarks: () =>
    landmarks.map((l) => ({
      id: l.id,
      name: l.name,
      zone: l.zone,
      far: l.far,
      x: Number(l.x.toFixed(1)),
      z: Number(l.z.toFixed(1)),
      height: Number(l.height.toFixed(2)),
    })),
  // Which caches exist and when each is due to refill. A restock timer has no
  // DOM of its own, so without this a test could only observe it by standing
  // in the world for two in-game days and looking in a barrel.
  getPois: () =>
    poiSites.map((site) => ({
      id: site.id,
      landmarkId: site.landmark.id,
      far: site.landmark.far,
      restockAtMs: state.pois[site.id]?.restockAtMs ?? null,
    })),
  getDiscovered: () => [...state.discovered],
  getWorldSize: () => WORLD_SIZE,
  getZoneAt: (x, z) => getZone(x, z),
  getRegion: () => ({
    id: regions.activeRegionId,
    name: regions.active.name,
    halfExtent: regions.active.halfExtent,
    nodeCount: regions.active.nodes.filter((n) => !n.depleted).length,
    portals: regions.active.portals.map((p) => ({
      id: p.id,
      target: p.target,
      x: p.x,
      z: p.z,
      armed: p.armed,
    })),
  }),
  getCaveMouths: () =>
    caveMouths.map((m) => ({ x: m.portal.x, z: m.portal.z, returnX: m.returnX, returnZ: m.returnZ })),
  // Teleports onto the portal and lets the ordinary per-frame check fire, so a
  // test exercises the real trigger — including the arming rule — rather than
  // a second, kinder way to change region that only tests have.
  setPortalArmed: (index, armed) => {
    const portal = regions.active.portals[index];
    if (!portal) return false;
    portal.armed = armed;
    return true;
  },
  enterPortal: (index) => {
    const portal = regions.active.portals[index];
    if (!portal) return regions.activeRegionId;
    portal.armed = true;
    player.teleport(portal.x, portal.z);
    updateRegionTransitions();
    return regions.activeRegionId;
  },
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
