import type { GameState } from "../state/game-state";
import { getQty } from "../systems/inventory";
import { events } from "../utils/events";
import { colorToCss, el } from "./dom";
import { keyLabel, type Action, type Bindings } from "../state/keybindings";
import { icon, iconSvg, type IconName } from "./icons";

const TRACKED_ITEMS = ["wood", "stone", "berry", "clay", "iron_ore", "plank", "wheat_seed", "wheat"];
// Each tracked resource gets a glyph as well as a colour: the icon says what
// it is, the tint only reinforces it.
const ITEM_ICONS: Record<string, IconName> = {
  wood: "trees",
  stone: "mountain",
  berry: "grape",
  clay: "layers",
  iron_ore: "gem",
  plank: "squareStack",
  wheat_seed: "sprout",
  wheat: "wheat",
};
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
  private readonly staminaFill: HTMLDivElement;
  private readonly resourceRow: HTMLDivElement;
  private readonly prompt: HTMLDivElement;
  private readonly toast: HTMLDivElement;
  private readonly deathOverlay: HTMLDivElement;
  private readonly damageFlash: HTMLDivElement;
  private readonly timeIcon: HTMLSpanElement;
  private readonly timeLabel: HTMLSpanElement;
  private readonly keybinds: HTMLDivElement;
  private timePhase: IconName = "sun";
  private toastTimeout = 0;
  private damageFlashTimeout = 0;

  constructor(root: HTMLElement, state: GameState) {
    const healthWrap = el("div", "hud-health");
    const healthBg = el("div", "hud-health-bar-bg");
    this.healthFill = el("div", "hud-health-bar-fill");
    healthBg.appendChild(this.healthFill);
    healthWrap.appendChild(healthBg);

    // Stamina sits directly under health and is deliberately the thinner of
    // the two: it recovers on its own, so it should never compete with the
    // bar that doesn't.
    const staminaBg = el("div", "hud-stamina-bar-bg");
    this.staminaFill = el("div", "hud-stamina-bar-fill");
    staminaBg.appendChild(this.staminaFill);
    healthWrap.appendChild(staminaBg);

    const timeWrap = el("div", "hud-time");
    this.timeIcon = el("span", "hud-time-icon icon");
    this.timeIcon.innerHTML = iconSvg("sun");
    this.timeLabel = el("span", "hud-time-label", "06:00");
    timeWrap.append(this.timeIcon, this.timeLabel);

    this.resourceRow = el("div", "hud-resources");

    this.prompt = el("div", "hud-prompt");
    this.prompt.style.display = "none";

    const crosshair = el("div", "hud-crosshair");

    this.keybinds = el("div", "hud-keybinds");

    this.toast = el("div", "hud-toast");
    this.damageFlash = el("div", "hud-damage-flash");

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
      this.keybinds,
      this.toast,
      this.damageFlash,
      this.deathOverlay,
    );

    this.renderHealth(state);
    this.renderStamina(state);
    this.renderResources(state);

    events.on("player-health-changed", () => this.renderHealth(state));
    events.on("player-stamina-changed", () => this.renderStamina(state));
    events.on("inventory-changed", () => this.renderResources(state));
    events.on("notification", ({ message }) => this.showToast(message));
    events.on("player-damaged", () => this.flashDamage());
    events.on("player-died", () => this.deathOverlay.classList.add("visible"));
    events.on("player-respawned", () => this.deathOverlay.classList.remove("visible"));
  }

  private renderHealth(state: GameState): void {
    const pct = Math.max(0, (state.player.health / state.player.maxHealth) * 100);
    this.healthFill.style.width = `${pct}%`;
  }

  // Rebuilt from the live binding map rather than hard-coded, so the on-screen
  // help can never advertise a key that no longer does anything. Keycaps rather
  // than prose: the bindings are the thing being scanned for.
  setKeybinds(bindings: Bindings): void {
    const cap = (action: Action) => `<kbd>${keyLabel(bindings[action][0] ?? "")}</kbd>`;
    this.keybinds.innerHTML =
      `<div>${cap("moveForward")}${cap("moveLeft")}${cap("moveBack")}${cap("moveRight")} move · ` +
      `${cap("sprint")} sprint · ${cap("jump")} jump</div>` +
      "<div>Mouse look (click to lock) · Scroll to zoom</div>" +
      `<div>${cap("gather")} gather · ${cap("farm")} plant/harvest · <kbd>Click</kbd> attack</div>` +
      `<div>${cap("hotbar1")}–${cap("hotbar4")} pick a build piece · ${cap("cancelBuild")} cancel</div>` +
      `<div>${cap("crafting")} craft · ${cap("building")} build · ` +
      `${cap("inventory")} inventory · ${cap("options")} options</div>`;
  }

  private renderStamina(state: GameState): void {
    const { stamina, maxStamina } = state.player;
    const pct = Math.max(0, (stamina / maxStamina) * 100);
    this.staminaFill.style.width = `${pct}%`;
    // Emptied out, the bar dims rather than just vanishing, so "you cannot
    // sprint yet" is visible as a state and not only as an absence.
    this.staminaFill.classList.toggle("spent", stamina <= 0);
  }

  private renderResources(state: GameState): void {
    this.resourceRow.replaceChildren(
      ...TRACKED_ITEMS.map((itemId) => {
        const chip = el("div", "hud-resource-chip");
        const glyph = icon(ITEM_ICONS[itemId]);
        glyph.style.color = colorToCss(ITEM_COLORS[itemId]);
        const count = el("span", undefined, String(getQty(state, itemId)));
        chip.append(glyph, count);
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
    const phase: IconName = t < 0.22 || t > 0.78 ? "moon" : t < 0.3 || t > 0.7 ? "sunrise" : "sun";
    if (this.timePhase !== phase) {
      this.timePhase = phase;
      this.timeIcon.innerHTML = iconSvg(phase);
    }
  }

  setPrompt(text: string | null): void {
    if (text) {
      this.prompt.textContent = text;
      this.prompt.style.display = "block";
    } else {
      this.prompt.style.display = "none";
    }
  }

  private flashDamage(): void {
    this.damageFlash.classList.add("visible");
    window.clearTimeout(this.damageFlashTimeout);
    this.damageFlashTimeout = window.setTimeout(() => {
      this.damageFlash.classList.remove("visible");
    }, 300);
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
