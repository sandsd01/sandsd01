import type { GameState } from "../state/game-state";
import { getQty } from "../systems/inventory";
import { getItem } from "../data/items";
import { ARMOUR } from "../data/armour";
import { events } from "../utils/events";
import { colorToCss, el } from "./dom";
import { keyLabel, type Action, type Bindings } from "../state/keybindings";
import { icon, iconSvg, type IconName } from "./icons";
import { expToNext } from "../data/levels";

// The staples, plus the two things only the dead drop — a bar that never
// showed loot would leave the player checking the inventory panel to find out
// whether a fight paid.
const TRACKED_ITEMS = [
  "wood",
  "stone",
  "berry",
  "clay",
  "iron_ore",
  "plank",
  "wheat_seed",
  "wheat",
  "bone",
  "hide",
  // Ammunition you cannot see the count of is not ammunition.
  "arrow",
  // The frontier material, and the only one whose count tells the player
  // whether the trip they are planning is worth making.
  "ancient_stone",
  // The cave material, for the same reason: the count is what tells you
  // whether the next trip down is worth taking.
  "glow_crystal",
  // And the sky's, for the same reason.
  "cloud_iron",
];
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
  bone: "bone",
  // Not "layers" — clay already has it, and clay and hide are both brown, so
  // the row was showing two chips a player could not tell apart at all. Found
  // by a check that no two chips in the row share a glyph, added after the
  // same mistake was made twice.
  hide: "footprints",
  arrow: "navigation",
  // NOT "gem" — that is iron ore's, and two materials sharing one glyph is
  // the same as neither having one. The columned-ruin shape also says where
  // this came from: the frontier, not a vein near the door.
  ancient_stone: "landmark",
  // Not "gem" (iron ore) and not "flame" (broth in the hotbar) — the check
  // that no two chips share a glyph is there because this mistake has now been
  // made three times.
  glow_crystal: "sparkles",
  // Not "gem", "sparkles" or "mountain" — all taken. The check that no two
  // chips share a glyph exists because this has been got wrong three times.
  cloud_iron: "cloud",
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
  bone: 0xe6e0cc,
  hide: 0x7a5238,
  arrow: 0xcfc3a8,
  ancient_stone: 0x8d88a0,
  glow_crystal: 0x63d9ff,
  cloud_iron: 0xbcd8e8,
};

const SVG_NS = "http://www.w3.org/2000/svg";
const RING_RADIUS = 15;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

// Crosshair states, in the order the HUD prefers them. "none" is the resting
// dot; the rest each get their own shape in style.css.
export type CrosshairState = "none" | "node" | "enemy" | "plot" | "place";

export class Hud {
  private readonly placeBanner: HTMLDivElement;
  private readonly placeLabel: HTMLSpanElement;
  private readonly crosshair: HTMLDivElement;
  private readonly crosshairRing: SVGSVGElement;
  private readonly crosshairProgress: SVGCircleElement;
  private crosshairState: CrosshairState = "none";
  /** Last rendered count per tracked item, to spot a rise. */
  private readonly lastCounts = new Map<string, number>();
  private readonly healthFill: HTMLDivElement;
  private readonly levelLabel: HTMLSpanElement;
  private readonly expFill: HTMLDivElement;
  private readonly pointsPip: HTMLSpanElement;
  private readonly armourChip: HTMLDivElement;
  private readonly staminaFill: HTMLDivElement;
  private readonly resourceRow: HTMLDivElement;
  private readonly prompt: HTMLDivElement;
  private readonly toast: HTMLDivElement;
  private readonly deathOverlay: HTMLDivElement;
  private readonly damageFlash: HTMLDivElement;
  private readonly raidBanner: HTMLDivElement;
  private readonly raidLabel: HTMLSpanElement;
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

    // The third bar, and deliberately the thinnest and last: health is what
    // you are about to lose, stamina is what you are spending, and this is the
    // only one of the three that never goes down. It sits with them rather
    // than in a corner of its own because it is read in the same glance —
    // "am I about to level" is a question asked mid-fight.
    const levelRow = el("div", "hud-level");
    const levelIcon = el("span", "hud-level-icon icon");
    levelIcon.innerHTML = iconSvg("chevronsUp");
    this.levelLabel = el("span", "hud-level-label", "Lv 1");
    // A dot, not a colour change: an unspent point has to be noticeable to a
    // player who cannot tell the bar has gone gold.
    this.pointsPip = el("span", "hud-level-pip", "+");
    this.pointsPip.hidden = true;
    this.pointsPip.title = "Unspent stat points";
    const expBg = el("div", "hud-exp-bar-bg");
    this.expFill = el("div", "hud-exp-bar-fill");
    expBg.appendChild(this.expFill);
    levelRow.append(levelIcon, this.levelLabel, expBg, this.pointsPip);
    healthWrap.appendChild(levelRow);

    // Under the bars, because what it changes is how fast the top one
    // empties. Words and a number, never a colour on its own.
    this.armourChip = el("div", "hud-armour");
    this.armourChip.hidden = true;
    healthWrap.appendChild(this.armourChip);

    const timeWrap = el("div", "hud-time");
    this.timeIcon = el("span", "hud-time-icon icon");
    this.timeIcon.innerHTML = iconSvg("sun");
    this.timeLabel = el("span", "hud-time-label", "06:00");
    timeWrap.append(this.timeIcon, this.timeLabel);

    this.resourceRow = el("div", "hud-resources");

    // Top centre, directly under the clock — the one part of the HUD that was
    // empty. It is emphatically NOT part of `.hud-time`: `.hud-resources` sizes
    // itself with `calc(50vw - 80px)` against the clock's width, and widening
    // that pill drops the resource row onto the clock below 1280px.
    //
    // Icon and words, never colour alone: a red bar says nothing to a player
    // who cannot see red, and this is the one state where being wrong about
    // what is happening costs the base.
    this.raidBanner = el("div", "hud-raid");
    const raidIcon = el("span", "hud-raid-icon icon");
    raidIcon.innerHTML = iconSvg("swords");
    this.raidLabel = el("span", "hud-raid-label", "Raid");
    this.raidBanner.append(raidIcon, this.raidLabel);
    this.raidBanner.hidden = true;

    // Where you are, shown only when that is not the obvious answer. It sits in
    // the raid banner's slot on purpose: the two can never be on screen at
    // once, because a raid is a thing that happens to the homestead and this
    // only appears when the player is not at it.
    this.placeBanner = el("div", "hud-place");
    const placeIcon = el("span", "hud-place-icon icon");
    placeIcon.innerHTML = iconSvg("mountain");
    this.placeLabel = el("span", "hud-place-label", "");
    this.placeBanner.append(placeIcon, this.placeLabel);
    this.placeBanner.hidden = true;

    this.prompt = el("div", "hud-prompt");
    this.prompt.style.display = "none";

    // The crosshair is the game's main affordance now that aiming decides what
    // you act on: it changes shape by target kind, and carries the gather
    // progress ring. Shape and the ring do the work — colour only reinforces
    // them, so nothing here is readable by colour alone.
    this.crosshair = el("div", "hud-crosshair");
    this.crosshairRing = document.createElementNS(SVG_NS, "svg");
    this.crosshairRing.setAttribute("class", "hud-crosshair-ring");
    this.crosshairRing.setAttribute("viewBox", "0 0 40 40");
    const track = document.createElementNS(SVG_NS, "circle");
    track.setAttribute("class", "hud-crosshair-ring-track");
    const progress = document.createElementNS(SVG_NS, "circle");
    progress.setAttribute("class", "hud-crosshair-ring-progress");
    for (const circle of [track, progress]) {
      circle.setAttribute("cx", "20");
      circle.setAttribute("cy", "20");
      circle.setAttribute("r", String(RING_RADIUS));
    }
    progress.setAttribute("stroke-dasharray", String(RING_CIRCUMFERENCE));
    progress.setAttribute("stroke-dashoffset", String(RING_CIRCUMFERENCE));
    this.crosshairRing.append(track, progress);
    this.crosshairProgress = progress;
    this.crosshair.appendChild(this.crosshairRing);
    const crosshair = this.crosshair;

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
      this.raidBanner,
      this.placeBanner,
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
    this.renderLevel(state);
    this.renderResources(state);

    this.renderArmour(state);
    events.on("armour-changed", () => this.renderArmour(state));
    events.on("player-health-changed", () => this.renderHealth(state));
    events.on("player-stamina-changed", () => this.renderStamina(state));
    events.on("player-exp-changed", () => this.renderLevel(state));
    events.on("stats-changed", () => this.renderLevel(state));
    events.on("player-levelled-up", ({ level }) => {
      this.renderLevel(state);
      this.showToast(`Level ${level}`);
    });
    events.on("inventory-changed", () => this.renderResources(state));
    events.on("notification", ({ message }) => this.showToast(message));
    // `secondsAway` was computed by the raid system and thrown away — the horn
    // sounded and nothing on screen said what it was for. A player who has not
    // yet learned what that noise means has no way to find out.
    events.on("raid-warning", ({ secondsAway }) => {
      const mins = Math.round(secondsAway / 60);
      this.showToast(
        mins >= 2 ? `Raid in about ${mins} minutes — get behind a wall` : "Raid incoming — get behind a wall",
      );
    });
    events.on("player-damaged", () => this.flashDamage());
    events.on("player-died", () => this.deathOverlay.classList.add("visible"));
    events.on("player-respawned", () => this.deathOverlay.classList.remove("visible"));
  }

  /** What is being worn, if anything. Hidden entirely when nothing is. */
  private renderArmour(state: GameState): void {
    const worn = state.armour;
    if (!worn) {
      this.armourChip.hidden = true;
      this.armourChip.textContent = "";
      return;
    }
    const pct = Math.round((ARMOUR[worn]?.reduction ?? 0) * 100);
    this.armourChip.hidden = false;
    this.armourChip.textContent = `${getItem(worn).name} · -${pct}% damage`;
  }

  /** Level, progress to the next, and whether there is anything to spend. */
  private renderLevel(state: GameState): void {
    this.levelLabel.textContent = `Lv ${state.player.level}`;
    const toNext = expToNext(state.player.level);
    const pct = toNext > 0 ? Math.min(100, (state.player.exp / toNext) * 100) : 0;
    this.expFill.style.width = `${pct}%`;
    this.pointsPip.hidden = state.statPoints <= 0;
    this.pointsPip.textContent = `+${state.statPoints}`;
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
      `<div>Mouse look (click to lock) · ${cap("toggleView")} view</div>` +
      "<div><kbd>LMB</kbd> gather/attack · <kbd>RMB</kbd> place/use</div>" +
      `<div>${cap("gather")} gather · ${cap("farm")} plant/harvest · ` +
      `${cap("repair")} repair</div>` +
      `<div>${cap("hotbar1")}–${cap("hotbar8")} or scroll to pick what you hold</div>` +
      `<div>${cap("building")} build menu · ${cap("cancelBuild")} cancel placement</div>` +
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
        const qty = getQty(state, itemId);
        const count = el("span", undefined, String(qty));
        chip.append(glyph, count);

        // A count that just rose gets a brief lift. Gathering yields vary now,
        // so "how much did that swing give me" is a real question — and the
        // toast is a single self-overwriting element, so announcing every
        // pickup there would bury crafting and recipe messages under a stream
        // of resource spam. The number says it where the number already is.
        const before = this.lastCounts.get(itemId);
        if (before !== undefined && qty > before) chip.classList.add("gained");
        this.lastCounts.set(itemId, qty);
        return chip;
      }),
    );
  }

  /**
   * The raid banner. Called every frame with the live figures, and kept
   * idempotent so it isn't rewriting the DOM sixty times a second while
   * nothing changes.
   *
   * `null` hides it — which is most of the time, and is why this is a banner
   * that appears rather than a permanent gauge reading "no raid".
   */
  setRaid(
    status: { raid: number; wave: number; totalWaves: number; remaining: number } | null,
  ): void {
    if (!status) {
      if (!this.raidBanner.hidden) {
        this.raidBanner.hidden = true;
        this.raidLabel.textContent = "";
      }
      return;
    }
    const text =
      `Raid ${status.raid} — wave ${status.wave}/${status.totalWaves} · ${status.remaining} left`;
    this.raidBanner.hidden = false;
    if (this.raidLabel.textContent !== text) this.raidLabel.textContent = text;
  }

  /**
   * Names the place, or hides the label when the player is on the surface.
   *
   * Underground the sky is gone, the clock keeps running and no raid ever
   * arrives — three things a player could reasonably read as the game having
   * broken. One line saying where they are is what makes all three read as
   * intended instead.
   */
  setPlace(name: string | null): void {
    this.placeBanner.hidden = name === null;
    if (name !== null && this.placeLabel.textContent !== name) {
      this.placeLabel.textContent = name;
    }
  }

  // t is the day-night fraction in [0,1) from DayNightSystem.getTimeOfDay —
  // mapped to a 24h virtual clock purely for display.
  setTimeOfDay(t: number, day: number): void {
    const totalMinutes = Math.floor(t * 24 * 60);
    const hours = Math.floor(totalMinutes / 60)
      .toString()
      .padStart(2, "0");
    const minutes = (totalMinutes % 60).toString().padStart(2, "0");
    // "Day 12 · 09:41". The day is the one number that always moves, and
    // without it nothing on screen says how long you have lasted.
    this.timeLabel.textContent = `Day ${day} · ${hours}:${minutes}`;
    const phase: IconName = t < 0.22 || t > 0.78 ? "moon" : t < 0.3 || t > 0.7 ? "sunrise" : "sun";
    if (this.timePhase !== phase) {
      this.timePhase = phase;
      this.timeIcon.innerHTML = iconSvg(phase);
    }
  }

  // Called every frame with what the crosshair is over. Kept idempotent so the
  // per-frame call doesn't thrash the class list.
  setCrosshairState(state: CrosshairState): void {
    if (this.crosshairState === state) return;
    this.crosshair.classList.remove(`on-${this.crosshairState}`);
    this.crosshairState = state;
    this.crosshair.classList.add(`on-${state}`);
  }

  // progress is 0..1; anything at or below 0 hides the ring entirely rather
  // than leaving an empty circle sitting under the crosshair.
  setActionProgress(progress: number): void {
    const clamped = Math.max(0, Math.min(1, progress));
    this.crosshairRing.classList.toggle("visible", clamped > 0);
    this.crosshairProgress.setAttribute(
      "stroke-dashoffset",
      String(RING_CIRCUMFERENCE * (1 - clamped)),
    );
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
