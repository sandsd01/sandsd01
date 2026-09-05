import type { GameState } from "../state/game-state";
import type { ResourceNode } from "../world/resource-node";
import type { Target } from "./targeting";
import { addItem } from "./inventory";
import { heldToolSpeed, heldYieldBonus, TOOL_KIND_NAMES, type ToolKind } from "../data/tools";
import { bonusYieldChance, gatherSpeedScale } from "../data/stats";
import { gatherReach } from "../data/worn";
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
  ancient_stone: "pickaxe",
};
const GATHER_VERB: Record<string, string> = {
  tree: "chop",
  rock: "mine",
  iron_vein: "mine",
  ancient_stone: "mine",
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
  // Craft applies to every node, tool or not: it is a fact about the person
  // swinging, and a stat that quietly did nothing at a berry bush would be a
  // stat the panel lies about.
  const craft = gatherSpeedScale(state);
  if (!node) return GATHER_TIME_MS * craft;
  const kind = REQUIRED_TOOL[node.config.kind];
  if (!kind) return GATHER_TIME_MS * craft;
  const speed = heldToolSpeed(state, kind);
  return GATHER_TIME_MS * (speed ?? 1) * craft;
}

// A short prompt for the aimed node ("Hold left click to chop"), or null when
// there's nothing to act on — used by the HUD.
export function getInteractionPrompt(state: GameState, node: ResourceNode | null): string | null {
  if (!node) return null;
  const verb = GATHER_VERB[node.config.kind] ?? "gather";
  const kind = REQUIRED_TOOL[node.config.kind];
  if (kind && heldToolSpeed(state, kind) === null) {
    // "Hold", not "Need": the player may well own an axe and simply have a
    // sword in hand, and the prompt should name the thing to do about it.
    return `Hold ${indefinite(TOOL_KIND_NAMES[kind])} to ${verb} this`;
  }
  return `Hold left click to ${verb}`;
}

// Whether this node can be worked at all — checked before any progress is
// accumulated, so a missing tool never fills a ring that then yields nothing.
export function canGather(state: GameState, node: ResourceNode | null): boolean {
  if (!node) return false;
  const kind = REQUIRED_TOOL[node.config.kind];
  return !kind || heldToolSpeed(state, kind) !== null;
}

/**
 * Nodes a single swing also works, given what is on the trinket slot.
 *
 * Same kind only, and within the charm's reach of the node actually struck —
 * not of the player. Swinging at a tree and coming away with stone would read
 * as a bug however generous it was, and measuring from the struck node is what
 * makes "that clump of trees" the unit rather than "everything around me".
 *
 * Returns an empty list when nothing is worn, which is the ordinary case and
 * the reason this costs nothing when it does not apply.
 */
export function neighboursFor(
  state: GameState,
  node: ResourceNode,
  candidates: ResourceNode[],
): ResourceNode[] {
  const reach = gatherReach(state);
  if (reach <= 0) return [];
  return candidates.filter(
    (other) =>
      other !== node &&
      !other.depleted &&
      other.config.kind === node.config.kind &&
      Math.hypot(
        other.object.position.x - node.object.position.x,
        other.object.position.z - node.object.position.z,
      ) <= reach,
  );
}

export function tryGather(
  state: GameState,
  node: ResourceNode | null,
  nowMs: number,
  rand: () => number,
  neighbours: ResourceNode[] = [],
): void {
  if (!node) return;

  const kind = REQUIRED_TOOL[node.config.kind];
  if (kind && heldToolSpeed(state, kind) === null) {
    events.emit("notification", {
      message: `Hold ${indefinite(TOOL_KIND_NAMES[kind])} to do this`,
    });
    return;
  }

  // A better tool pays out more, not just sooner. Nodes that need no tool at
  // all (berries, clay) get no bonus, which is what keeps a pickaxe from
  // quietly improving berry picking.
  // The tool's bonus needs the right tool; Craft's does not, for the same
  // reason as the timing above.
  const yieldChance = (kind ? heldYieldBonus(state, kind) : 0) + bonusYieldChance(state);
  const result = node.hit(nowMs, rand, yieldChance);
  if (!result) return;
  addItem(state, result.itemId, result.qty);
  if (result.bonus) addItem(state, result.bonus.itemId, result.bonus.qty);
  events.emit("resource-gathered", {
    itemId: result.itemId,
    qty: result.qty,
    kind: node.config.kind,
    finalHit: result.finalHit,
  });

  // The charm's extra nodes, each taking a full swing of its own. They roll
  // their own yield rather than copying the first node's: two trees felled
  // together should pay what two trees pay, and sharing one roll would make
  // the charm a way to get the same wood from more nodes.
  //
  // Guarded by the same tool check, not just the aimed node's — the kinds are
  // identical by construction, so this is belt and braces rather than a real
  // second case, and it stays correct if `neighboursFor` ever loosens.
  for (const other of neighbours) {
    if (other.depleted) continue;
    const otherKind = REQUIRED_TOOL[other.config.kind];
    if (otherKind && heldToolSpeed(state, otherKind) === null) continue;
    const extra = other.hit(nowMs, rand, yieldChance);
    if (!extra) continue;
    addItem(state, extra.itemId, extra.qty);
    if (extra.bonus) addItem(state, extra.bonus.itemId, extra.bonus.qty);
    events.emit("resource-gathered", {
      itemId: extra.itemId,
      qty: extra.qty,
      kind: other.config.kind,
      finalHit: extra.finalHit,
    });
  }
}
