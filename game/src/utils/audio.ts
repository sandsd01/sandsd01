// Procedurally synthesized sound effects via the Web Audio API — no audio
// asset files to fetch/host, consistent with the primitive-geometry-only
// approach used for visuals. Every sound is a short oscillator tone and/or
// noise burst shaped by a gain envelope.
type ToneShape = OscillatorType;

class SoundSystem {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;

  private ensureContext(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
    if (!Ctor) return null;
    this.ctx = new Ctor();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.35;
    this.masterGain.connect(this.ctx.destination);
    return this.ctx;
  }

  // Browsers suspend audio until a user gesture; call this from a click
  // handler to start it.
  unlock(): void {
    const ctx = this.ensureContext();
    if (ctx && ctx.state === "suspended") void ctx.resume();
  }

  private tone(freq: number, durationMs: number, shape: ToneShape, volume: number, glideTo?: number): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = shape;
    const now = ctx.currentTime;
    osc.frequency.setValueAtTime(freq, now);
    if (glideTo !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, glideTo), now + durationMs / 1000);
    }
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + durationMs / 1000);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + durationMs / 1000);
  }

  private noiseBurst(durationMs: number, volume: number): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    const size = Math.max(1, Math.floor(ctx.sampleRate * (durationMs / 1000)));
    const buffer = ctx.createBuffer(1, size, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < size; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / size);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    source.connect(gain);
    gain.connect(this.masterGain);
    source.start();
  }

  chop(): void {
    this.tone(220, 90, "square", 0.3);
  }

  mine(): void {
    this.noiseBurst(70, 0.35);
    this.tone(140, 90, "square", 0.2);
  }

  gatherSoft(): void {
    // Berries/clay — a softer pluck for hand-gathering, no tool clang.
    this.tone(520, 70, "triangle", 0.25, 700);
  }

  swing(): void {
    this.tone(180, 60, "sawtooth", 0.18);
  }

  hit(): void {
    this.noiseBurst(50, 0.35);
  }

  enemyDeath(): void {
    this.tone(150, 260, "sawtooth", 0.35, 35);
  }

  playerHurt(): void {
    this.tone(120, 180, "square", 0.35, 55);
  }

  playerDied(): void {
    this.tone(200, 500, "sawtooth", 0.4, 40);
  }

  craft(): void {
    this.tone(440, 90, "sine", 0.28, 660);
    window.setTimeout(() => this.tone(660, 110, "sine", 0.2, 880), 70);
  }

  place(): void {
    this.tone(300, 130, "square", 0.3, 200);
  }

  plant(): void {
    this.tone(300, 80, "sine", 0.22, 420);
  }

  harvest(): void {
    this.tone(520, 100, "triangle", 0.28, 760);
  }
}

export const sound = new SoundSystem();
