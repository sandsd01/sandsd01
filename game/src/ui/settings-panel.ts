import {
  SENSITIVITY_MAX,
  SENSITIVITY_MIN,
  saveSettings,
  type Settings,
} from "../state/settings";
import {
  ACTIONS,
  ACTION_LABELS,
  DEFAULT_BINDINGS,
  keyLabel,
  rebind,
  type Action,
  type Bindings,
} from "../state/keybindings";
import type { InputManager } from "../input/input-manager";
import { el } from "./dom";
import { clearSave } from "../systems/save-load";

const NEW_GAME_LABEL = "Start a new game";
const NEW_GAME_CONFIRM = "Erase this world? Click again";
/** How long the armed state lasts before it disarms itself. */
const NEW_GAME_ARM_MS = 4000;

// The options screen every game in this genre ships: look sensitivity, an
// invert-Y toggle, and a full rebindable control list. Reached with the Options
// key when nothing else is open, which is where players expect a pause screen.
export class SettingsPanel {
  private readonly panel: HTMLDivElement;
  private readonly controls: HTMLDivElement;
  private visible = false;
  // Which slot is currently listening for a key, if any. Held as state rather
  // than as a class poked onto a button, because renderControls() rebuilds the
  // buttons — styling the clicked one directly would decorate a node that has
  // already been replaced.
  private capturing: { action: Action; slot: number } | null = null;
  private readonly newGame: HTMLButtonElement;
  private newGameArmed = false;
  private newGameTimeout = 0;

  constructor(
    root: HTMLElement,
    private readonly settings: Settings,
    private readonly bindings: Bindings,
    private readonly input: InputManager,
    private readonly onBindingsChanged: () => void,
    /** Called just before the wipe, so the caller can stop the exit save. */
    private readonly onNewGame: () => void = () => {},
  ) {
    this.panel = el("div", "panel");
    this.panel.appendChild(el("h2", undefined, "Options"));

    this.panel.appendChild(this.sensitivityRow());
    this.panel.appendChild(this.invertRow());

    const heading = el("h2", "panel-subheading", "Controls");
    this.panel.appendChild(heading);
    this.controls = el("div");
    this.panel.appendChild(this.controls);
    this.renderControls();

    const reset = el("button", "panel-reset", "Reset controls to defaults");
    reset.addEventListener("click", () => {
      for (const action of ACTIONS) this.bindings[action] = DEFAULT_BINDINGS[action].slice();
      this.onBindingsChanged();
      this.renderControls();
    });
    this.panel.appendChild(reset);

    // Starting over. `clearSave()` has existed since save/load shipped and
    // nothing has ever called it, so the only way to begin a second character
    // was to know what localStorage is. Two clicks rather than a confirm()
    // dialog: the second click is the confirmation, and it reverts on its own
    // if the player walks away from it.
    this.newGame = el("button", "panel-reset panel-danger", NEW_GAME_LABEL);
    this.newGame.addEventListener("click", () => this.pressNewGame());
    this.panel.appendChild(this.newGame);

    this.panel.appendChild(
      el(
        "p",
        "panel-hint",
        "Click a key to rebind it, then press the new one. Escape cancels a rebind, " +
          "and closes this screen otherwise. Settings are kept between sessions.",
      ),
    );
    root.appendChild(this.panel);
  }

  private sensitivityRow(): HTMLDivElement {
    const row = el("div", "panel-row");
    const info = el("div", "panel-row-info");
    info.appendChild(el("span", "panel-row-title", "Look sensitivity"));
    const value = el("span", "panel-row-sub", this.settings.mouseSensitivity.toFixed(2) + "x");
    info.appendChild(value);
    row.appendChild(info);

    const slider = el("input", "panel-slider") as HTMLInputElement;
    slider.type = "range";
    slider.min = String(SENSITIVITY_MIN);
    slider.max = String(SENSITIVITY_MAX);
    slider.step = "0.05";
    slider.value = String(this.settings.mouseSensitivity);
    slider.addEventListener("input", () => {
      this.settings.mouseSensitivity = Number(slider.value);
      value.textContent = this.settings.mouseSensitivity.toFixed(2) + "x";
      saveSettings(this.settings);
    });
    row.appendChild(slider);
    return row;
  }

  private invertRow(): HTMLDivElement {
    const row = el("div", "panel-row");
    const info = el("div", "panel-row-info");
    info.appendChild(el("span", "panel-row-title", "Invert vertical look"));
    info.appendChild(el("span", "panel-row-sub", "Mouse down looks up"));
    row.appendChild(info);

    const button = el("button");
    const paint = () => {
      button.textContent = this.settings.invertY ? "On" : "Off";
      button.classList.toggle("selected", this.settings.invertY);
      // The label carries the state on its own; the highlight only reinforces
      // it, so the setting is readable without relying on colour.
      button.setAttribute("aria-pressed", String(this.settings.invertY));
    };
    paint();
    button.addEventListener("click", () => {
      this.settings.invertY = !this.settings.invertY;
      saveSettings(this.settings);
      paint();
    });
    row.appendChild(button);
    return row;
  }

  private renderControls(): void {
    this.controls.replaceChildren(
      ...ACTIONS.map((action) => {
        const row = el("div", "panel-row");
        const info = el("div", "panel-row-info");
        info.appendChild(el("span", "panel-row-title", ACTION_LABELS[action]));
        row.appendChild(info);

        const keys = el("div", "panel-keys");
        // Two slots per action, so a genre split like Tab/I for the inventory
        // survives rebinding instead of forcing a choice.
        for (let slot = 0; slot < 2; slot++) {
          keys.appendChild(this.keyButton(action, slot));
        }
        row.appendChild(keys);
        return row;
      }),
    );
  }

  private keyButton(action: Action, slot: number): HTMLButtonElement {
    const code = this.bindings[action][slot];
    const isCapturing = this.capturing?.action === action && this.capturing.slot === slot;
    const label = isCapturing ? "Press a key" : code ? keyLabel(code) : "—";
    const button = el("button", "panel-key", label);
    if (isCapturing) button.classList.add("listening");
    else if (!code) button.classList.add("empty");

    button.addEventListener("click", () => {
      // Only one capture can be pending; starting another cancels the first.
      this.input.cancelCapture();
      this.capturing = { action, slot };
      this.renderControls();
      this.input.captureNextKey((pressed) => {
        this.capturing = null;
        // Escape cancels rather than binding: it is the way out of this screen,
        // and a player who bound it to something else would have no way back.
        if (pressed !== "Escape") {
          rebind(this.bindings, action, slot, pressed);
          this.onBindingsChanged();
        }
        this.renderControls();
      });
    });
    return button;
  }

  /**
   * First click arms, second wipes. Deliberately not `confirm()`: this game
   * runs under pointer lock, and a native dialog raised from a locked page is
   * exactly the sort of thing browsers are entitled to suppress.
   */
  private pressNewGame(): void {
    if (!this.newGameArmed) {
      this.newGameArmed = true;
      this.newGame.textContent = NEW_GAME_CONFIRM;
      this.newGame.classList.add("armed");
      window.clearTimeout(this.newGameTimeout);
      this.newGameTimeout = window.setTimeout(() => this.disarmNewGame(), NEW_GAME_ARM_MS);
      return;
    }
    this.disarmNewGame();
    this.onNewGame();
    clearSave();
    // Reload rather than rebuild the world in place: every system holds a
    // reference to the state object it was constructed with, and swapping that
    // out underneath them is a much larger change than starting over is worth.
    // The reload *does* fire `beforeunload`, and that handler saves — which is
    // what `onNewGame` above is for: it switches saving off first, so the world
    // just erased is not written straight back on the way out.
    window.location.reload();
  }

  private disarmNewGame(): void {
    window.clearTimeout(this.newGameTimeout);
    this.newGameArmed = false;
    this.newGame.textContent = NEW_GAME_LABEL;
    this.newGame.classList.remove("armed");
  }

  toggle(): void {
    this.visible = !this.visible;
    this.panel.classList.toggle("visible", this.visible);
    if (this.visible) this.renderControls();
    if (!this.visible) this.disarmNewGame();
  }

  close(): void {
    this.visible = false;
    this.disarmNewGame();
    // Leaving with a capture pending would swallow the next keystroke in game.
    this.input.cancelCapture();
    this.capturing = null;
    this.panel.classList.remove("visible");
  }

  isVisible(): boolean {
    return this.visible;
  }
}
