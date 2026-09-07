import { el } from "./dom";
import { events } from "../utils/events";
import type { GameState } from "../state/game-state";
import type { InputManager } from "../input/input-manager";
import { isCommand, runCommand } from "../systems/commands";

/**
 * The chat box, bottom-left, in the shape everyone already knows.
 *
 * Two jobs in one widget, exactly as the game this borrows from does it: a
 * place to type, and a log of what has been said. Closed, it is a few recent
 * lines fading over the world; open, it takes the keyboard and shows a field.
 *
 * Bottom-left rather than anywhere else because that corner is empty — the HUD
 * puts vitals top-left, resources top-right, the hotbar bottom-centre and the
 * minimap bottom-right. It is also where a player who has ever typed in a
 * survival game will look for it.
 */

/** How many lines the log keeps. Beyond this the oldest are dropped. */
const MAX_LINES = 60;
/** How many stay on screen once the box is closed. */
const IDLE_LINES = 6;
/** How long a line lingers after the box closes, in ms. */
const FADE_AFTER_MS = 9000;

interface Line {
  el: HTMLElement;
  atMs: number;
}

export class Chat {
  private readonly root: HTMLDivElement;
  private readonly log: HTMLDivElement;
  private readonly field: HTMLInputElement;
  private readonly lines: Line[] = [];
  private open = false;
  /** What has been typed before, newest last. Walked with the arrow keys. */
  private readonly history: string[] = [];
  private historyIndex = -1;

  constructor(
    parent: HTMLElement,
    private readonly state: GameState,
    private readonly input: InputManager,
  ) {
    this.root = el("div", "chat");
    this.log = el("div", "chat-log");
    this.field = document.createElement("input");
    this.field.className = "chat-field";
    this.field.type = "text";
    this.field.autocomplete = "off";
    this.field.spellcheck = false;
    // 256 like the game this copies. A cap belongs on the field rather than at
    // submit time, so the limit is felt while typing instead of silently
    // truncating something already sent.
    this.field.maxLength = 256;
    this.root.append(this.log, this.field);
    parent.appendChild(this.root);

    // Keys are handled here rather than through InputManager on purpose: while
    // this is open the InputManager is deliberately deaf, so it cannot be the
    // thing that closes the box again.
    this.field.addEventListener("keydown", (e) => {
      // Never let a keystroke meant for the field reach the window listeners
      // underneath, whatever else happens below.
      e.stopPropagation();
      if (e.key === "Enter") {
        e.preventDefault();
        this.submit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        this.close();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        this.recall(-1);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        this.recall(1);
      }
    });

    events.on("chat-line", ({ text, kind }) => {
      // A multi-line result (/help) becomes one row per line, so the log wraps
      // and scrolls the way every other line does.
      for (const part of text.split("\n")) this.push(part, kind);
    });

    this.render();
  }

  /** Opens the box. `prefill` is "/" when the player pressed slash. */
  openWith(prefill = ""): void {
    if (this.open) return;
    this.open = true;
    this.input.setTextEntry(true);
    // The mouse belongs to the cursor while typing, and the game must not keep
    // turning the camera under the box.
    document.exitPointerLock();
    this.root.classList.add("open");
    this.field.value = prefill;
    this.historyIndex = this.history.length;
    this.field.focus();
    // Caret after the prefilled slash rather than before it.
    this.field.setSelectionRange(prefill.length, prefill.length);
    this.render();
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.field.value = "";
    this.field.blur();
    this.root.classList.remove("open");
    this.input.setTextEntry(false);
    this.render();
  }

  isOpen(): boolean {
    return this.open;
  }

  /**
   * Runs a line as though it had been typed and submitted.
   *
   * The checks drive this rather than the keyboard: what a command *does* is
   * worth testing separately from whether the field can be focused, and going
   * through the same path as a real submit keeps the two from drifting.
   */
  submitLine(raw: string): void {
    const line = raw.trim();
    if (!line) return;
    this.history.push(line);
    if (isCommand(line)) {
      const result = runCommand(this.state, line);
      this.push(line, "say");
      events.emit("chat-line", { text: result.text, kind: result.kind });
      return;
    }
    this.push(line, "say");
  }

  private submit(): void {
    const value = this.field.value;
    this.field.value = "";
    this.close();
    this.submitLine(value);
  }

  private recall(direction: number): void {
    if (this.history.length === 0) return;
    this.historyIndex = Math.min(
      this.history.length,
      Math.max(0, this.historyIndex + direction),
    );
    const entry = this.history[this.historyIndex] ?? "";
    this.field.value = entry;
    this.field.setSelectionRange(entry.length, entry.length);
  }

  private push(text: string, kind: "say" | "system" | "error"): void {
    const node = el("div", `chat-line chat-${kind}`, text);
    this.log.appendChild(node);
    this.lines.push({ el: node, atMs: performance.now() });
    while (this.lines.length > MAX_LINES) {
      const dropped = this.lines.shift();
      dropped?.el.remove();
    }
    this.log.scrollTop = this.log.scrollHeight;
    this.render();
  }

  /**
   * Decides which lines are visible. Called on a change and once a frame.
   *
   * Open, everything is shown and the log scrolls. Closed, only the last few
   * recent ones are, and they age out — so the corner is a log while you are
   * reading it and nearly empty while you are playing.
   */
  render(nowMs = performance.now()): void {
    for (let i = 0; i < this.lines.length; i++) {
      const line = this.lines[i];
      const recent = nowMs - line.atMs < FADE_AFTER_MS;
      const nearEnd = i >= this.lines.length - IDLE_LINES;
      line.el.classList.toggle("faded", !this.open && !(recent && nearEnd));
    }
  }
}
