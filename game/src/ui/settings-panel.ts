import {
  SENSITIVITY_MAX,
  SENSITIVITY_MIN,
  saveSettings,
  type Settings,
} from "../state/settings";
import { el } from "./dom";

// The options screen every game in this genre ships: look sensitivity and an
// invert-Y toggle. Reached with Escape when nothing else is open, which is
// where players already expect a pause/options screen to live.
export class SettingsPanel {
  private readonly panel: HTMLDivElement;
  private visible = false;

  constructor(
    root: HTMLElement,
    private readonly settings: Settings,
  ) {
    this.panel = el("div", "panel");
    this.panel.appendChild(el("h2", undefined, "Options"));

    this.panel.appendChild(this.sensitivityRow());
    this.panel.appendChild(this.invertRow());
    this.panel.appendChild(
      el("p", "panel-hint", "Escape closes this. Settings are kept between sessions."),
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

  toggle(): void {
    this.visible = !this.visible;
    this.panel.classList.toggle("visible", this.visible);
  }

  close(): void {
    this.visible = false;
    this.panel.classList.remove("visible");
  }

  isVisible(): boolean {
    return this.visible;
  }
}
