import { events } from "../utils/events";
import type { GameState } from "../state/game-state";
import type { EnemyManager } from "./enemy-ai";
import { RAID_DURATION_MS, raidStartAfter } from "./day-night";

/**
 * How long before a raid the player is told one is coming.
 *
 * There is always a warning. A night that kills you without having said
 * anything reads as the game cheating rather than as tension, and the whole
 * point of a raid is that it is the night you prepared for.
 */
const WARNING_LEAD_MS = 60_000;
const WAVE_INTERVAL_MS = 40_000;

/**
 * Waves escalate in *composition*, not only in headcount: the last wave is
 * mostly the same size as the second but carries three brutes, which hit
 * harder, take longer to put down, and drop the better loot. More zombies is
 * a longer night; more brutes is a harder one.
 */
const WAVES: { count: number; brutes: number }[] = [
  { count: 4, brutes: 0 },
  { count: 6, brutes: 1 },
  { count: 8, brutes: 3 },
];

export class RaidSystem {
  /** Runtime only: a reload releases a fresh wave and re-times from there. */
  private nextWaveAtMs = Infinity;
  private warned = false;

  constructor(
    private readonly state: GameState,
    private readonly enemies: EnemyManager,
  ) {}

  isActive(): boolean {
    return this.state.raid.active;
  }

  /** Waves released tonight — 0 when no raid is running. */
  getWave(): number {
    return this.state.raid.active ? this.state.raid.wave : 0;
  }

  /** Total waves a raid runs, so the HUD can say "2 of 3". */
  getTotalWaves(): number {
    return WAVES.length;
  }

  raidersAlive(): number {
    return this.enemies.raidersAlive();
  }

  /** Milliseconds until the next raid, or 0 while one is running. */
  msUntilRaid(nowMs: number): number {
    if (this.state.raid.active) return 0;
    return Math.max(0, this.state.raid.nextRaidAtMs - nowMs);
  }

  /**
   * Picks a saved raid back up at boot.
   *
   * A raid that was running when the tab closed continues, and a fresh wave is
   * released immediately. Enemies are not saved — the field comes back empty —
   * so without this, reloading would be the cheapest way to skip a raid in the
   * game. A raid whose night has already passed while the tab was shut is
   * simply closed out, quietly: nobody wants a "you survived!" banner for a
   * night they were not present for.
   */
  resume(nowMs: number, playerX: number, playerZ: number): void {
    if (!this.state.raid.active) return;
    if (nowMs >= this.state.raid.endsAtMs) {
      this.finish(nowMs, false);
      return;
    }
    this.enemies.setRaiding(true);
    events.emit("raid-started", {});
    this.releaseWave(nowMs, playerX, playerZ);
  }

  update(nowMs: number, playerX: number, playerZ: number): void {
    const raid = this.state.raid;

    if (!raid.active) {
      if (nowMs >= raid.nextRaidAtMs) {
        this.start(nowMs, playerX, playerZ);
      } else if (nowMs >= raid.nextRaidAtMs - WARNING_LEAD_MS) {
        if (!this.warned) {
          this.warned = true;
          events.emit("raid-warning", {
            secondsAway: Math.round((raid.nextRaidAtMs - nowMs) / 1000),
          });
        }
      } else {
        // Rearm. The debug clock can be wound back behind the warning window,
        // and a warning that only ever fires once per page load would leave a
        // test-driven raid arriving in silence.
        this.warned = false;
      }
      return;
    }

    // Dawn ends it whatever is still standing. Without this backstop a single
    // raider wedged behind a boulder on the far side of the map would hold the
    // player in a raid that never finishes.
    if (nowMs >= raid.endsAtMs) {
      this.finish(nowMs, true);
      return;
    }
    if (raid.wave < WAVES.length) {
      if (nowMs >= this.nextWaveAtMs) this.releaseWave(nowMs, playerX, playerZ);
    } else if (this.enemies.raidersAlive() === 0) {
      this.finish(nowMs, true);
    }
  }

  /** Begins a raid now. Also the debug entry point, so tests skip the wait. */
  start(nowMs: number, playerX: number, playerZ: number): void {
    const raid = this.state.raid;
    raid.active = true;
    raid.wave = 0;
    raid.endsAtMs = nowMs + RAID_DURATION_MS;
    this.warned = false;
    this.enemies.setRaiding(true);
    events.emit("raid-started", {});
    this.releaseWave(nowMs, playerX, playerZ);
  }

  /** Ends a running raid and books the next one. */
  finish(nowMs: number, announce = true): void {
    const raid = this.state.raid;
    raid.active = false;
    raid.wave = 0;
    raid.endsAtMs = 0;
    raid.nextRaidAtMs = raidStartAfter(nowMs);
    this.nextWaveAtMs = Infinity;
    this.warned = false;
    this.enemies.setRaiding(false);
    if (announce) events.emit("raid-ended", { survived: true });
  }

  private releaseWave(nowMs: number, playerX: number, playerZ: number): void {
    // A resumed raid can be past the last scripted wave; it still gets one,
    // built to the toughest recipe rather than to none.
    const plan = WAVES[Math.min(this.state.raid.wave, WAVES.length - 1)];
    const spawned = this.enemies.spawnWave(plan.count, plan.brutes, playerX, playerZ);
    this.state.raid.wave++;
    this.nextWaveAtMs = nowMs + WAVE_INTERVAL_MS;
    events.emit("raid-wave", { wave: this.state.raid.wave, count: spawned });
  }
}
