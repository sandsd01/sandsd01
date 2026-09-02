// Procedurally synthesized sound effects via the Web Audio API — no audio
// asset files to fetch/host, consistent with the primitive-geometry-only
// approach used for visuals. Every sound is a short oscillator tone and/or
// noise burst shaped by a gain envelope.
type ToneShape = OscillatorType;

class SoundSystem {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private ambientGain: GainNode | null = null;
  private ambientFilter: BiquadFilterNode | null = null;
  private lastAmbientDaylight = -1;

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
    this.startAmbient();
  }

  // A continuous bed of filtered noise reading as wind. One looping buffer
  // rather than a stream of one-shots: the sound has to be seamless, and a
  // gap between repeats is exactly what the ear picks out.
  private startAmbient(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain || this.ambientGain) return;

    const seconds = 3;
    const size = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(1, size, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    // Brown-ish noise (a running sum of white) sits lower than white noise and
    // reads as wind rather than as static.
    let last = 0;
    for (let i = 0; i < size; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    }
    // Match the ends so the loop point isn't an audible click.
    const fade = Math.floor(ctx.sampleRate * 0.05);
    for (let i = 0; i < fade; i++) {
      const t = i / fade;
      data[i] *= t;
      data[size - 1 - i] *= t;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;

    this.ambientFilter = ctx.createBiquadFilter();
    this.ambientFilter.type = "lowpass";
    this.ambientFilter.frequency.value = 420;

    this.ambientGain = ctx.createGain();
    this.ambientGain.gain.value = 0.5;

    source.connect(this.ambientFilter);
    this.ambientFilter.connect(this.ambientGain);
    this.ambientGain.connect(this.masterGain);
    source.start();
  }

  // daylight is 0 at night and 1 in full day. Night is quieter but darker in
  // timbre, which reads as still air rather than as the sound being turned
  // down. Called every frame, so it early-outs unless the value really moved.
  updateAmbient(daylight: number): void {
    if (!this.ctx || !this.ambientGain || !this.ambientFilter) return;
    if (Math.abs(daylight - this.lastAmbientDaylight) < 0.02) return;
    this.lastAmbientDaylight = daylight;
    const now = this.ctx.currentTime;
    this.ambientGain.gain.setTargetAtTime(0.35 + daylight * 0.35, now, 1.5);
    this.ambientFilter.frequency.setTargetAtTime(240 + daylight * 320, now, 1.5);
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

  // Footsteps vary in pitch per step so a walk cycle doesn't turn into a
  // metronome; the filter keeps them as soft thumps rather than clicks.
  footstep(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    const size = Math.floor(ctx.sampleRate * 0.06);
    const buffer = ctx.createBuffer(1, size, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < size; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / size, 2.5);
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 700 + Math.random() * 500;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.18, ctx.currentTime);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    source.start();
  }

  jump(): void {
    this.tone(280, 130, "sine", 0.16, 460);
  }

  land(): void {
    this.noiseBurst(90, 0.22);
    this.tone(90, 110, "sine", 0.18);
  }

  // Deliberately unmusical and breathy: it should read as the body running out
  // rather than as an error tone.
  exhausted(): void {
    this.noiseBurst(220, 0.14);
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

  // Two long, low notes falling away — the closest thing to a horn this synth
  // can manage, and the only sustained cue in the game. Nothing else here
  // lasts a second, so it carries "something is coming" on length alone.
  raidHorn(): void {
    this.tone(150, 900, "sawtooth", 0.22, 96);
    window.setTimeout(() => this.tone(112, 1200, "sawtooth", 0.2, 72), 620);
  }

  // Dull and wooden, distinct from `hit` (flesh) and `chop` (a tool working
  // properly): this is a wall being taken apart.
  wallHit(): void {
    this.noiseBurst(90, 0.22);
    this.tone(96, 160, "square", 0.16, 62);
  }

  // Short, sharp, metallic — a thing closing on something, not a thing hitting
  // it. Distinct from `hit` so a trap firing across the yard is recognisable
  // without looking at it.
  trap(): void {
    this.noiseBurst(45, 0.28);
    this.tone(620, 70, "square", 0.14, 220);
  }

  // A string released — short, bright, gone. Nothing like the swing it stands
  // in for, so the ear can tell a shot from a miss with a sword.
  bowRelease(): void {
    this.tone(760, 90, "triangle", 0.2, 320);
  }

  // A short low creak, glided down: heavy timber moving, not a latch clicking.
  door(): void {
    this.tone(190, 220, "sawtooth", 0.16, 130);
  }

  raidOver(): void {
    this.tone(330, 220, "sine", 0.22, 494);
    window.setTimeout(() => this.tone(494, 420, "sine", 0.2, 660), 180);
  }
}

export const sound = new SoundSystem();
