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

export interface WavePlan {
  count: number;
  brutes: number;
}

/**
 * How long between waves on raid `n` (1-based).
 *
 * Shrinks as the raids get longer, because the *night* does not: a raid runs
 * for a fixed `RAID_DURATION_MS` and ends at dawn whatever is still standing.
 * Left at a flat forty seconds, the later waves of raid twelve would simply
 * never be released before sunrise — and raid twelve would come out *easier*
 * than raid six with nobody having decided that.
 */
function intervalOn(n: number): number {
  return Math.max(10_000, 40_000 - 1_500 * (n - 1));
}

/** How many waves raid `n` sends, and every one of them fits before dawn. */
export function wavesOn(n: number): number {
  return Math.min(3 + Math.floor((n - 1) / 2), Math.floor(RAID_DURATION_MS / intervalOn(n)));
}

/**
 * The `w`-th wave (1-based) of raid `n`.
 *
 * Escalation is in **numbers and composition only**. An enemy that looks
 * identical but quietly carries more health on raid ten is the game lying to
 * the player about what it is showing them: a brute is a brute, and a harder
 * night is more of them.
 */
export function waveOn(n: number, w: number): WavePlan {
  // Later waves within a raid are bigger, and later raids open bigger.
  const count = 3 + w + Math.floor((n - 1) / 3);
  // Brutes hit harder, take longer to put down, and drop the better loot.
  // None at all in the first wave of the first raid; up to half a wave once
  // the player is deep in.
  const share = Math.min(0.5, 0.06 * (n - 1) + 0.12 * (w - 1));
  return { count, brutes: Math.min(count, Math.round(count * share)) };
}

export class RaidSystem {
  /** Runtime only: a reload releases a fresh wave and re-times from there. */
  private nextWaveAtMs = Infinity;
  private warned = false;
  /**
   * Raiders a wave wanted to send but could not, because the field was
   * already at `RAID_MAX_ENEMIES`.
   *
   * That cap exists to keep the frame rate honest and it stays. Without this
   * queue the surplus would simply evaporate, and past the point where the
   * field saturates every raid would be identical however far the schedule
   * had escalated — the difficulty would silently stop climbing. Carried
   * forward instead, the pressure keeps rising as a field that never empties.
   * Runtime only: a reload releases a fresh wave anyway.
   */
  private backlog = 0;

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

  /** Which raid this is, 1-based — the one being fought, or the one next. */
  getRaidNumber(): number {
    return this.state.raid.count + 1;
  }

  /** Raids seen through to the end. The score. */
  getRaidsSurvived(): number {
    return this.state.raid.count;
  }

  /** Total waves this raid runs, so the HUD can say "2 of 5". */
  getTotalWaves(): number {
    return wavesOn(this.getRaidNumber());
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

  /**
   * Pushes the whole schedule forward by `deltaMs`.
   *
   * Called every frame the player is somewhere the raid cannot reach — a
   * dungeon — which is what "the raid clock stops while you are underground"
   * actually means. Done a frame at a time rather than settled up in one lump
   * on the way out, so the schedule in the save file is correct at every
   * instant: a player who quits underground and comes back an hour later
   * should not be met by a raid they owe.
   *
   * Note what this does *not* stop: the world clock, crops, node respawns and
   * cache restocks all carry on. Only the raid is held.
   */
  defer(deltaMs: number): void {
    const raid = this.state.raid;
    raid.nextRaidAtMs += deltaMs;
    if (raid.active) {
      raid.endsAtMs += deltaMs;
      if (Number.isFinite(this.nextWaveAtMs)) this.nextWaveAtMs += deltaMs;
    }
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
    if (raid.wave < this.getTotalWaves()) {
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
    this.backlog = 0;
    this.warned = false;
    this.enemies.setRaiding(true);
    events.emit("raid-started", {});
    this.releaseWave(nowMs, playerX, playerZ);
  }

  /**
   * Ends a running raid and books the next one.
   *
   * The count goes up either way, including on the quiet path taken when a
   * raid's night passed while the tab was shut. The night did happen and the
   * base was standing when the player came back; docking them for having
   * closed the tab would be a stranger rule than crediting them.
   */
  finish(nowMs: number, announce = true): void {
    const raid = this.state.raid;
    raid.count++;
    raid.active = false;
    raid.wave = 0;
    raid.endsAtMs = 0;
    raid.nextRaidAtMs = raidStartAfter(nowMs);
    this.nextWaveAtMs = Infinity;
    this.backlog = 0;
    this.warned = false;
    this.enemies.setRaiding(false);
    if (announce) events.emit("raid-ended", { survived: true, raidsSurvived: raid.count });
  }

  private releaseWave(nowMs: number, playerX: number, playerZ: number): void {
    const n = this.getRaidNumber();
    // A resumed raid can be past its last scheduled wave; it still gets one,
    // built to that raid's toughest recipe rather than to none.
    const plan = waveOn(n, Math.min(this.state.raid.wave + 1, this.getTotalWaves()));
    const wanted = plan.count + this.backlog;
    const spawned = this.enemies.spawnWave(wanted, plan.brutes, playerX, playerZ);
    this.backlog = Math.max(0, wanted - spawned);
    this.state.raid.wave++;
    this.nextWaveAtMs = nowMs + intervalOn(n);
    events.emit("raid-wave", { wave: this.state.raid.wave, count: spawned });
  }
}
