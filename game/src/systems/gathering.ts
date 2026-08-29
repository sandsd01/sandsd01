import type { GameState } from "../state/game-state";
import type { ResourceNode } from "../world/resource-node";
import type { Target } from "./targeting";
import { addItem, hasQty } from "./inventory";
import { events } from "../utils/events";

// How long the primary button must be held to land one hit. Gathering used to
// be instant per key press; a wind-up gives the progress ring something to
// show and matches how this genre paces a swing.
export const GATHER_TIME_MS = 450;

// Only used by the keyboard fallback below, never by the crosshair.
const INTERACT_RANGE = 2.5;

const REQUIRED_TOOL: Partial<Record<string, string>> = {
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

// A short prompt for the aimed node ("Hold left click to chop"), or null when
// there's nothing to act on — used by the HUD.
export function getInteractionPrompt(state: GameState, node: ResourceNode | null): string | null {
  if (!node) return null;
  const verb = GATHER_VERB[node.config.kind] ?? "gather";
  const tool = REQUIRED_TOOL[node.config.kind];
  if (tool && !hasQty(state, tool, 1)) return `Need a ${tool} to ${verb} this`;
  return `Hold left click to ${verb}`;
}

// Whether this node can be worked at all — checked before any progress is
// accumulated, so a missing tool never fills a ring that then yields nothing.
export function canGather(state: GameState, node: ResourceNode | null): boolean {
  if (!node) return false;
  const tool = REQUIRED_TOOL[node.config.kind];
  return !tool || hasQty(state, tool, 1);
}

export function tryGather(state: GameState, node: ResourceNode | null, nowMs: number): void {
  if (!node) return;

  const tool = REQUIRED_TOOL[node.config.kind];
  if (tool && !hasQty(state, tool, 1)) {
    events.emit("notification", { message: `You need a ${tool} for this` });
    return;
  }

  const result = node.hit(nowMs);
  if (!result) return;
  addItem(state, result.itemId, result.qty);
  events.emit("resource-gathered", { ...result, kind: node.config.kind });
}
