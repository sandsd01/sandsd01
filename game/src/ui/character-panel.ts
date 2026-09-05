import type { GameState } from "../state/game-state";
import { STATS, STAT_IDS, type StatId } from "../data/stats";
import { expToNext } from "../data/levels";
import { allocateStat } from "../systems/progression";
import { takeOff } from "../systems/equipment";
import { SLOT_NAMES, WORN, WORN_SLOTS, wornInSlot, type WornSlot } from "../data/worn";
import { getItem } from "../data/items";
import {
  attackSpeedScale,
  bonusMaxHealth,
  bonusYieldChance,
  damageScale,
  gatherSpeedScale,
  rareDropScale,
  speedScale,
  staminaRegenScale,
  vigourReduction,
} from "../data/stats";
import { events } from "../utils/events";
import { clear, el } from "./dom";
import { icon, type IconName } from "./icons";

// One glyph each, and none of them shared with the resource chips or the
// crafting categories. A panel where two rows draw the same picture is a panel
// where the picture has stopped carrying information — the mistake this
// project has now made three times, and the reason `uicheck` reads rendered
// path geometry rather than trusting the names.
/**
 * One glyph per slot, none shared with the stats below or the resource chips.
 * `shield` is the armour slot's rather than Vigour's for the same reason the
 * chip row cannot reuse a glyph: two rows drawing the same picture is two rows
 * whose picture has stopped carrying information.
 */
const SLOT_ICONS: Record<WornSlot, IconName> = {
  armour: "shirt",
  back: "feather",
  // Not `gem` — that is the iron-ore chip's, and the check that reads rendered
  // path geometry exists because this project has picked a duplicate glyph
  // three times before. A ring of orbit is also the plainest picture of "a
  // small thing you wear that changes how you work".
  trinket: "orbit",
};

const STAT_ICONS: Record<StatId, IconName> = {
  might: "bicepsFlexed",
  vigour: "shield",
  swiftness: "wind",
  craft: "anvil",
  fortune: "clover",
};

/**
 * What each stat is worth right now, in the units the player actually feels.
 *
 * Percentages of a live number rather than the raw point count: "Might 4" says
 * nothing, "+24% damage" is the thing being bought. Every line here reads the
 * same function the game reads at the chokepoint, so the panel cannot drift
 * from what the swing actually does — it is not a second copy of the maths.
 */
function effectLines(state: GameState, id: StatId): string[] {
  const pct = (n: number) => `${n >= 0 ? "+" : ""}${Math.round(n * 100)}%`;
  switch (id) {
    case "might":
      return [`${pct(damageScale(state) - 1)} damage`];
    case "vigour":
      return [`+${bonusMaxHealth(state)} max health`, `${pct(vigourReduction(state))} damage resisted`];
    case "swiftness":
      return [
        `${pct(speedScale(state) - 1)} speed`,
        `${pct(1 / attackSpeedScale(state) - 1)} attack rate`,
        `${pct(staminaRegenScale(state) - 1)} stamina`,
      ];
    case "craft":
      return [
        `${pct(1 / gatherSpeedScale(state) - 1)} gather speed`,
        `${pct(bonusYieldChance(state))} extra yield`,
      ];
    case "fortune":
      return [`${pct(rareDropScale(state) - 1)} drop chance`];
  }
}

export class CharacterPanel {
  private readonly panel: HTMLDivElement;
  private readonly summary: HTMLDivElement;
  private readonly pointsLabel: HTMLDivElement;
  private readonly list: HTMLDivElement;
  private readonly worn: HTMLDivElement;
  private readonly hint: HTMLParagraphElement;
  private visible = false;

  constructor(
    root: HTMLElement,
    private readonly state: GameState,
    private readonly closeKeyLabel: () => string,
  ) {
    // Wide, and two columns. Three worn slots stacked on top of five stat rows
    // does not fit a 720p screen — measured, not guessed: the last stat row
    // ended 162px below the panel's own bottom edge. Side by side they do fit,
    // and `panel-wide` is the width the barrel already established for a panel
    // that needs two lists.
    this.panel = el("div", "panel panel-wide");
    this.panel.appendChild(el("h2", undefined, "Character"));

    // Level and the bar span both columns: it is the one line about the whole
    // character rather than about either half of it.
    this.summary = el("div", "character-summary");
    this.panel.appendChild(this.summary);

    const columns = el("div", "character-columns");

    // What is on the body. It answers "what am I" before "what am I spending",
    // and it is the half of this screen that changes when something drops
    // rather than when a level lands.
    const gear = el("div", "character-column");
    gear.appendChild(el("h3", "character-column-title", "Worn"));
    this.worn = el("div", "character-worn");
    gear.appendChild(this.worn);

    const stats = el("div", "character-column");
    stats.appendChild(el("h3", "character-column-title", "Stats"));
    // Above its own column rather than the whole panel: an unspent point is an
    // instruction about the list directly beneath it.
    this.pointsLabel = el("div", "character-points");
    stats.appendChild(this.pointsLabel);
    this.list = el("div", "character-stats");
    stats.appendChild(this.list);

    columns.append(gear, stats);
    this.panel.appendChild(columns);

    this.hint = el("p", "panel-hint", "");
    this.panel.appendChild(this.hint);
    root.appendChild(this.panel);

    // Rebuilt on anything that can move a number on this screen, so a level
    // gained with the panel open is visible without closing and reopening it.
    events.on("player-levelled-up", () => this.render());
    events.on("player-exp-changed", () => this.render());
    events.on("stats-changed", () => this.render());
    events.on("worn-changed", () => this.render());
    // A piece picked up while the sheet is open should appear in the bag count
    // behind it — and taking one off puts it back, which is an inventory change.
    events.on("inventory-changed", () => {
      if (this.visible) this.render();
    });

    this.render();
  }

  isVisible(): boolean {
    return this.visible;
  }

  toggle(): void {
    this.visible = !this.visible;
    this.panel.classList.toggle("visible", this.visible);
    if (this.visible) this.render();
  }

  close(): void {
    if (!this.visible) return;
    this.visible = false;
    this.panel.classList.remove("visible");
  }

  private render(): void {
    const state = this.state;
    const toNext = expToNext(state.player.level);

    clear(this.summary);
    const level = el("div", "character-level");
    // The numbers share the line with the level rather than sitting under the
    // bar. A bar alone cannot answer "is one more kill enough", which is the
    // only question anybody asks of an exp bar — but it does not need a row of
    // its own to answer it.
    level.append(
      icon("chevronsUp", "icon character-level-icon"),
      el("span", undefined, `Level ${state.player.level}`),
      el("span", "character-exp-text", `${state.player.exp} / ${toNext} EXP`),
    );
    const barBg = el("div", "character-exp-bar-bg");
    const fill = el("div", "character-exp-bar-fill");
    fill.style.width = `${Math.min(100, (state.player.exp / toNext) * 100)}%`;
    barBg.appendChild(fill);
    this.summary.append(level, barBg);

    const points = state.statPoints;
    this.pointsLabel.textContent =
      points > 0
        ? `${points} point${points === 1 ? "" : "s"} to spend`
        : "No points to spend — kill things.";
    this.pointsLabel.classList.toggle("has-points", points > 0);

    clear(this.worn);
    for (const slot of WORN_SLOTS) {
      const id = wornInSlot(state, slot);
      const row = el("div", "character-worn-slot");
      if (!id) row.classList.add("empty");
      row.append(icon(SLOT_ICONS[slot], "icon character-worn-icon"));

      const text = el("div", "character-worn-text");
      text.append(el("div", "character-worn-label", SLOT_NAMES[slot]));
      // An empty slot says so in words. A row that was simply blank reads as a
      // rendering fault rather than as an invitation.
      text.append(
        el("div", "character-worn-name", id ? getItem(id).name : "Empty"),
      );
      if (id) {
        text.append(el("div", "character-worn-effect", WORN[id]?.blurb ?? ""));
      }
      row.append(text);

      if (id) {
        const off = el("button", "character-worn-off", "Take off");
        off.type = "button";
        off.setAttribute("aria-label", `Take off ${getItem(id).name}`);
        // Through `takeOff`, which is the one place a slot is emptied — it puts
        // the piece back in the bag and emits what this panel redraws from.
        off.addEventListener("click", () => takeOff(state, slot));
        row.append(off);
      }
      this.worn.appendChild(row);
    }

    clear(this.list);
    for (const id of STAT_IDS) {
      const def = STATS[id];
      const row = el("div", "character-stat");
      const glyph = icon(STAT_ICONS[id], "icon character-stat-icon");
      const text = el("div", "character-stat-text");
      const name = el("div", "character-stat-name", `${def.name} ${state.stats[id] ?? 0}`);
      // The blurb is the tooltip, not the row. Five rows each carrying a
      // sentence *and* its numbers pushed Fortune below the fold entirely —
      // and a stat a player never scrolls to is a stat that does not exist.
      // The concrete line stays, because "+12% damage" says more than "harder
      // hits" ever did.
      name.title = def.blurb;
      const effect = el("div", "character-stat-effect", effectLines(state, id).join(" · "));
      text.append(name, effect);

      const add = el("button", "character-stat-add", "+");
      add.type = "button";
      add.setAttribute("aria-label", `Raise ${def.name}`);
      add.disabled = points <= 0;
      add.addEventListener("click", () => {
        // The panel does not touch the state itself. `allocateStat` is the one
        // place a point is spent, and it emits what everything else redraws
        // from — including this list.
        allocateStat(state, id);
      });

      row.append(glyph, text, add);
      this.list.appendChild(row);
    }

    this.hint.textContent = `Press ${this.closeKeyLabel()} to close.`;
  }
}
