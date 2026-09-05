import type { GameState } from "../state/game-state";
import { STATS, STAT_IDS, type StatId } from "../data/stats";
import { expToNext } from "../data/levels";
import { allocateStat } from "../systems/progression";
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
        `${pct(speedScale(state) - 1)} move speed`,
        `${pct(1 / attackSpeedScale(state) - 1)} attack speed`,
        `${pct(staminaRegenScale(state) - 1)} stamina regen`,
      ];
    case "craft":
      return [
        `${pct(1 / gatherSpeedScale(state) - 1)} gather speed`,
        `${pct(bonusYieldChance(state))} bonus yield chance`,
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
  private readonly hint: HTMLParagraphElement;
  private visible = false;

  constructor(
    root: HTMLElement,
    private readonly state: GameState,
    private readonly closeKeyLabel: () => string,
  ) {
    this.panel = el("div", "panel");
    this.panel.appendChild(el("h2", undefined, "Character"));

    this.summary = el("div", "character-summary");
    this.panel.appendChild(this.summary);

    // Its own line above the list rather than a number tucked into a corner:
    // an unspent point is the one thing on this screen that is asking to be
    // acted on, and it should be the first thing read.
    this.pointsLabel = el("div", "character-points");
    this.panel.appendChild(this.pointsLabel);

    this.list = el("div", "character-stats");
    this.panel.appendChild(this.list);

    this.hint = el("p", "panel-hint", "");
    this.panel.appendChild(this.hint);
    root.appendChild(this.panel);

    // Rebuilt on anything that can move a number on this screen, so a level
    // gained with the panel open is visible without closing and reopening it.
    events.on("player-levelled-up", () => this.render());
    events.on("player-exp-changed", () => this.render());
    events.on("stats-changed", () => this.render());

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
