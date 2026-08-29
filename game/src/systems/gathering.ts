import type { GameState } from "../state/game-state";
import type { ResourceNode } from "../world/resource-node";
import type { Target } from "./targeting";
import { addItem } from "./inventory";
import { bestToolSpeed, TOOL_KIND_NAMES, type ToolKind } from "../data/tools";
import { indefinite } from "../utils/text";
import { events } from "../utils/events";

// How long the primary button must be held to land one hit. Gathering used to
// be instant per key press; a wind-up gives the progress ring something to
// show and matches how this genre paces a swing.
export const GATHER_TIME_MS = 450;

// Only used by the keyboard fallback below, never by the crosshair.
const INTERACT_RANGE = 2.5;

// Which *kind* of tool a node needs, not which item. An iron axe has to fell
// a tree as well as a plain one does — matching on the item id would have made
// the upgrade a downgrade.
const REQUIRED_TOOL: Partial<Record<string, ToolKind>> = {
  tree: "axe",
  rock: "pickaxe",
  iron_vein: "pickaxe",
};
const GATHER_VERB: Record<string, string> = {
  tree: "chop",
  rock: "mine",
  iron_vein: "mine",
  berry_bush: "pick",
  clay_pit: "dig",
};

// What the crosshair is on, if it's a gatherable node. Aiming replaced the old
// "nearest within a radius" search, which ignored where the camera pointed and
// would happily fell a tree standing behind the player.
export function aimedNode(target: Target): ResourceNode | null {
  if (target.kind !== "node" || !target.node || target.node.depleted) return null;
  return target.node;
}

// The fallback for the gather *key*: aiming is what the mouse is for, but a
// player who reaches for E while standing in a thicket should still get the
// tree they're standing next to rather than nothing.
export function nearestNode(nodes: ResourceNode[], x: number, z: number): ResourceNode | null {
  let nearest: ResourceNode | null = null;
  let nearestDist = INTERACT_RANGE;
  for (const node of nodes) {
    if (node.depleted) continue;
    const dist = Math.hypot(node.object.position.x - x, node.object.position.z - z);
    if (dist < nearestDist) {
      nearest = node;
      nearestDist = dist;
    }
  }
  return nearest;
}

// How long one swing at this node takes, given the best tool the player is
// carrying. Better tools are the whole payoff of the iron tier, and the
// progress ring reads the difference for free.
export function gatherTimeFor(state: GameState, node: ResourceNode | null): number {
  if (!node) return GATHER_TIME_MS;
  const kind = REQUIRED_TOOL[node.config.kind];
  if (!kind) return GATHER_TIME_MS;
  const speed = bestToolSpeed(state, kind);
  return GATHER_TIME_MS * (speed ?? 1);
}

// A short prompt for the aimed node ("Hold left click to chop"), or null when
// there's nothing to act on — used by the HUD.
export function getInteractionPrompt(state: GameState, node: ResourceNode | null): string | null {
  if (!node) return null;
  const verb = GATHER_VERB[node.config.kind] ?? "gather";
  const kind = REQUIRED_TOOL[node.config.kind];
  if (kind && bestToolSpeed(state, kind) === null) {
    return `Need ${indefinite(TOOL_KIND_NAMES[kind])} to ${verb} this`;
  }
  return `Hold left click to ${verb}`;
}

// Whether this node can be worked at all — checked before any progress is
// accumulated, so a missing tool never fills a ring that then yields nothing.
export function canGather(state: GameState, node: ResourceNode | null): boolean {
  if (!node) return false;
  const kind = REQUIRED_TOOL[node.config.kind];
  return !kind || bestToolSpeed(state, kind) !== null;
}

export function tryGather(state: GameState, node: ResourceNode | null, nowMs: number): void {
  if (!node) return;

  const kind = REQUIRED_TOOL[node.config.kind];
  if (kind && bestToolSpeed(state, kind) === null) {
    events.emit("notification", {
      message: `You need ${indefinite(TOOL_KIND_NAMES[kind])} for this`,
    });
    return;
  }

  const result = node.hit(nowMs);
  if (!result) return;
  addItem(state, result.itemId, result.qty);
  events.emit("resource-gathered", { ...result, kind: node.config.kind });
}
