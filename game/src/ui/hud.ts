import type { GameState } from "../state/game-state";
import { getQty } from "../systems/inventory";
import { events } from "../utils/events";
import { colorToCss, el } from "./dom";

const TRACKED_ITEMS = ["wood", "stone", "berry", "clay", "iron_ore", "plank", "wheat_seed", "wheat"];
const ITEM_COLORS: Record<string, number> = {
  wood: 0x8b5a2b,
  stone: 0x8a8a8a,
  berry: 0x9a2a4a,
  clay: 0x8a5a42,
  iron_ore: 0x6a5a52,
  plank: 0xc19a6b,
  wheat_seed: 0xd4c26a,
  wheat: 0xe8c840,
};

export class Hud {
  private readonly healthFill: HTMLDivElement;
  private readonly resourceRow: HTMLDivElement;
  private readonly prompt: HTMLDivElement;
  private readonly toast: HTMLDivElement;
  private readonly deathOverlay: HTMLDivElement;
  private readonly timeIcon: HTMLSpanElement;
  private readonly timeLabel: HTMLSpanElement;
  private toastTimeout = 0;

  constructor(
    root: HTMLElement,
    state: GameState,
    private readonly isTouchDevice: boolean = false,
  ) {
    const healthWrap = el("div", "hud-health");
    const healthBg = el("div", "hud-health-bar-bg");
    this.healthFill = el("div", "hud-health-bar-fill");
    healthBg.appendChild(this.healthFill);
    healthWrap.appendChild(healthBg);

    const timeWrap = el("div", "hud-time");
    this.timeIcon = el("span", "hud-time-icon", "☀️");
    this.timeLabel = el("span", "hud-time-label", "06:00");
    timeWrap.append(this.timeIcon, this.timeLabel);

    this.resourceRow = el("div", "hud-resources");

    this.prompt = el("div", "hud-prompt");
    this.prompt.style.display = "none";

    const crosshair = el("div", "hud-crosshair");

    const keybinds = el("div", "hud-keybinds");
    keybinds.innerHTML =
      "WASD move · Mouse look (click to lock)<br>" +
      "E gather/interact · F plant/harvest<br>" +
      "Left-click attack · C craft · B build · I inventory";

    this.toast = el("div", "hud-toast");

    this.deathOverlay = el("div", "hud-death-overlay");
    const deathText = el("div", undefined, "You have fallen");
    const respawnHint = el("div", undefined, "Respawning...");
    respawnHint.style.fontSize = "14px";
    this.deathOverlay.appendChild(deathText);
    this.deathOverlay.appendChild(respawnHint);

    root.append(
      healthWrap,
      timeWrap,
      this.resourceRow,
      this.prompt,
      crosshair,
      keybinds,
      this.toast,
      this.deathOverlay,
    );

    this.renderHealth(state);
    this.renderResources(state);

    events.on("player-health-changed", () => this.renderHealth(state));
    events.on("inventory-changed", () => this.renderResources(state));
    events.on("notification", ({ message }) => this.showToast(message));
    events.on("player-died", () => this.deathOverlay.classList.add("visible"));
    events.on("player-respawned", () => this.deathOverlay.classList.remove("visible"));
  }

  private renderHealth(state: GameState): void {
    const pct = Math.max(0, (state.player.health / state.player.maxHealth) * 100);
    this.healthFill.style.width = `${pct}%`;
  }

  private renderResources(state: GameState): void {
    this.resourceRow.replaceChildren(
      ...TRACKED_ITEMS.map((itemId) => {
        const chip = el("div", "hud-resource-chip");
        const swatch = el("span", "hud-resource-swatch");
        swatch.style.background = colorToCss(ITEM_COLORS[itemId]);
        const count = el("span", undefined, String(getQty(state, itemId)));
        chip.append(swatch, count);
        return chip;
      }),
    );
  }

  // t is the day-night fraction in [0,1) from DayNightSystem.getTimeOfDay —
  // mapped to a 24h virtual clock purely for display.
  setTimeOfDay(t: number): void {
    const totalMinutes = Math.floor(t * 24 * 60);
    const hours = Math.floor(totalMinutes / 60)
      .toString()
      .padStart(2, "0");
    const minutes = (totalMinutes % 60).toString().padStart(2, "0");
    this.timeLabel.textContent = `${hours}:${minutes}`;
    this.timeIcon.textContent = t < 0.22 || t > 0.78 ? "🌙" : t < 0.3 || t > 0.7 ? "🌅" : "☀️";
  }

  setPrompt(text: string | null): void {
    if (text) {
      this.prompt.textContent = this.isTouchDevice ? this.touchifyPrompt(text) : text;
      this.prompt.style.display = "block";
    } else {
      this.prompt.style.display = "none";
    }
  }

  // Gathering/farming prompts are written for keyboard players ("Press E to
  // chop"); on touch there's no keyboard, so point at the matching button.
  private touchifyPrompt(text: string): string {
    return text.replace("Press E", "Tap ✋").replace("Press F", "Tap 🌱");
  }

  private showToast(message: string): void {
    this.toast.textContent = message;
    this.toast.classList.add("visible");
    window.clearTimeout(this.toastTimeout);
    this.toastTimeout = window.setTimeout(() => {
      this.toast.classList.remove("visible");
    }, 2000);
  }
}
