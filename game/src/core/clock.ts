// Tracks total elapsed game time in milliseconds, used by respawn timers,
// crop growth, and enemy spawn scaling. Independent of wall-clock/real time
// so pausing (if ever added) would not desync gameplay timers.
export class GameClock {
  private elapsedMs = 0;

  tick(deltaSeconds: number): void {
    this.elapsedMs += deltaSeconds * 1000;
  }

  now(): number {
    return this.elapsedMs;
  }
}
