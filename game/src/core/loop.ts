// requestAnimationFrame loop with delta-time (seconds), clamped to avoid
// large jumps after tab-switch/pause.
export type UpdateFn = (deltaSeconds: number, elapsedSeconds: number) => void;

export class GameLoop {
  private running = false;
  private lastTime = 0;
  private elapsed = 0;
  private rafId = 0;

  constructor(private readonly update: UpdateFn) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.rafId = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  private tick = (now: number): void => {
    if (!this.running) return;
    const deltaSeconds = Math.min((now - this.lastTime) / 1000, 0.1);
    this.lastTime = now;
    this.elapsed += deltaSeconds;
    this.update(deltaSeconds, this.elapsed);
    this.rafId = requestAnimationFrame(this.tick);
  };
}
