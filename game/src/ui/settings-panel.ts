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

  constructor(
    root: HTMLElement,
    private readonly settings: Settings,
    private readonly bindings: Bindings,
    private readonly input: InputManager,
    private readonly onBindingsChanged: () => void,
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

  toggle(): void {
    this.visible = !this.visible;
    this.panel.classList.toggle("visible", this.visible);
    if (this.visible) this.renderControls();
  }

  close(): void {
    this.visible = false;
    // Leaving with a capture pending would swallow the next keystroke in game.
    this.input.cancelCapture();
    this.capturing = null;
    this.panel.classList.remove("visible");
  }

  isVisible(): boolean {
    return this.visible;
  }
}
