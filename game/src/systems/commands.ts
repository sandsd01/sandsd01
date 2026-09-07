import type { GameState } from "../state/game-state";
import { isGodMode, toggleGodMode } from "./godmode";

/**
 * What the chat box does with a line beginning `/`.
 *
 * Kept apart from the chat UI on purpose: the UI's job is text in and lines
 * out, and this one's is deciding what a command means. That split is what
 * lets the checks drive commands without a keyboard, and what will let a
 * second command be a row in the table below rather than another branch in a
 * DOM handler.
 */

export interface CommandResult {
  text: string;
  kind: "system" | "error";
}

interface CommandDef {
  /** One line for `/help`, which is the only reason anyone finds a command. */
  blurb: string;
  run: (state: GameState, args: string[]) => CommandResult;
}

const COMMANDS: Record<string, CommandDef> = {
  godmode: {
    blurb: "Toggle creative mode: fly, no damage, free building, instant gathering",
    run: (state) => ({
      text: toggleGodMode(state)
        ? "Godmode ON — fly with double-tap jump, nothing can hurt you"
        : "Godmode OFF",
      kind: "system",
    }),
  },
  help: {
    blurb: "List the commands",
    run: () => ({
      text: Object.entries(COMMANDS)
        .map(([name, def]) => `/${name} — ${def.blurb}`)
        .join("\n"),
      kind: "system",
    }),
  },
};

/** Whether a typed line is a command rather than something to say. */
export function isCommand(line: string): boolean {
  return line.trimStart().startsWith("/");
}

/**
 * Runs a command line and says what to print.
 *
 * An unknown command is an error line rather than silence: typing `/godmod`
 * and getting nothing back is indistinguishable from a command that ran and
 * did nothing, and the second is much worse to debug from the outside.
 */
export function runCommand(state: GameState, line: string): CommandResult {
  const [name, ...args] = line.trim().replace(/^\//, "").split(/\s+/);
  if (!name) return { text: "Type a command after the slash", kind: "error" };
  const def = COMMANDS[name.toLowerCase()];
  if (!def) return { text: `Unknown command: /${name}`, kind: "error" };
  return def.run(state, args);
}

/** For the HUD badge and the checks. */
export function godModeOn(state: GameState): boolean {
  return isGodMode(state);
}
