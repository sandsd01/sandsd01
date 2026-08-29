import type { GameState } from "../state/game-state";
import { hasQty } from "../systems/inventory";

// What a tool is for, and how fast it works. Kept as data next to the items
// rather than as a string match in the gathering system, so a new tool tier is
// a row here and nothing else.
export type ToolKind = "axe" | "pickaxe";

export interface ToolDef {
  kind: ToolKind;
  /**
   * Multiplier on the time a swing takes — lower is faster. This is what makes
   * an iron tool worth the iron; a tier that only reads better in the
   * inventory is not a reward.
   */
  speed: number;
}

export const TOOLS: Record<string, ToolDef> = {
  axe: { kind: "axe", speed: 1 },
  pickaxe: { kind: "pickaxe", speed: 1 },
  iron_axe: { kind: "axe", speed: 0.6 },
  iron_pickaxe: { kind: "pickaxe", speed: 0.6 },
};

/**
 * The best speed multiplier the player can bring to this kind of work, or null
 * when they hold no tool of that kind at all. Callers use null to mean "you
 * need one of these first" and the number to pace the swing.
 */
export function bestToolSpeed(state: GameState, kind: ToolKind): number | null {
  let best: number | null = null;
  for (const [itemId, tool] of Object.entries(TOOLS)) {
    if (tool.kind !== kind) continue;
    if (!hasQty(state, itemId, 1)) continue;
    if (best === null || tool.speed < best) best = tool.speed;
  }
  return best;
}

// For the "you need an axe for this" message: the plainest name of the tier
// the player is missing, not the fanciest one they could eventually hold.
export const TOOL_KIND_NAMES: Record<ToolKind, string> = {
  axe: "axe",
  pickaxe: "pickaxe",
};
