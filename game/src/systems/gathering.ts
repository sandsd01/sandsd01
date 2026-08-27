import type { GameState } from "../state/game-state";
import type { ResourceNode } from "../world/resource-node";
import { addItem, hasQty } from "./inventory";
import { events } from "../utils/events";

const INTERACT_RANGE = 2.5;
const REQUIRED_TOOL: Record<string, string> = { tree: "axe", rock: "pickaxe" };

function findNearestNode(
  nodes: ResourceNode[],
  x: number,
  z: number,
): ResourceNode | null {
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

// Returns a short prompt string ("Press E to chop") when a node is in range,
// or null when there's nothing to interact with — used by the HUD.
export function getInteractionPrompt(
  state: GameState,
  nodes: ResourceNode[],
  playerX: number,
  playerZ: number,
): string | null {
  const node = findNearestNode(nodes, playerX, playerZ);
  if (!node) return null;
  const verb = node.config.kind === "tree" ? "chop" : "mine";
  const tool = REQUIRED_TOOL[node.config.kind];
  if (!hasQty(state, tool, 1)) return `Need a ${tool} to ${verb} this`;
  return `Press E to ${verb}`;
}

export function tryGather(
  state: GameState,
  nodes: ResourceNode[],
  playerX: number,
  playerZ: number,
  nowMs: number,
): void {
  const node = findNearestNode(nodes, playerX, playerZ);
  if (!node) return;

  const tool = REQUIRED_TOOL[node.config.kind];
  if (!hasQty(state, tool, 1)) {
    events.emit("notification", { message: `You need a ${tool} for this` });
    return;
  }

  const result = node.hit(nowMs);
  if (!result) return;
  addItem(state, result.itemId, result.qty);
}
