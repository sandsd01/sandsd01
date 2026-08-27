import * as THREE from "three";
import type { SceneRig } from "../core/scene";

// A full day/night cycle in real-world milliseconds. Kept short (a few
// minutes) so the effect is visible during normal play rather than a
// realistic 24h cycle, matching the plan's "simple, low-priority nice-to-have"
// scope for this system — purely visual, nothing else is gated on it.
export const DAY_LENGTH_MS = 6 * 60 * 1000;

interface SkyKeyframe {
  t: number; // 0..1 fraction of the day
  sky: THREE.Color;
  sunColor: THREE.Color;
  sunIntensity: number;
  hemiIntensity: number;
}

const KEYFRAMES: SkyKeyframe[] = [
  { t: 0.0, sky: new THREE.Color(0x0a1128), sunColor: new THREE.Color(0x22335a), sunIntensity: 0.0, hemiIntensity: 0.22 },
  { t: 0.22, sky: new THREE.Color(0x1a2144), sunColor: new THREE.Color(0x3a4a7a), sunIntensity: 0.05, hemiIntensity: 0.25 },
  { t: 0.28, sky: new THREE.Color(0xf4a460), sunColor: new THREE.Color(0xffd9a0), sunIntensity: 0.6, hemiIntensity: 0.6 },
  { t: 0.5, sky: new THREE.Color(0x9fd0e8), sunColor: new THREE.Color(0xfff2d0), sunIntensity: 1.1, hemiIntensity: 0.9 },
  { t: 0.72, sky: new THREE.Color(0xff7f50), sunColor: new THREE.Color(0xffab73), sunIntensity: 0.5, hemiIntensity: 0.5 },
  { t: 0.78, sky: new THREE.Color(0x1a2144), sunColor: new THREE.Color(0x3a4a7a), sunIntensity: 0.05, hemiIntensity: 0.25 },
  { t: 1.0, sky: new THREE.Color(0x0a1128), sunColor: new THREE.Color(0x22335a), sunIntensity: 0.0, hemiIntensity: 0.22 },
];

function lerpKeyframes(t: number): { sky: THREE.Color; sunColor: THREE.Color; sunIntensity: number; hemiIntensity: number } {
  let a = KEYFRAMES[0];
  let b = KEYFRAMES[KEYFRAMES.length - 1];
  for (let i = 0; i < KEYFRAMES.length - 1; i++) {
    if (t >= KEYFRAMES[i].t && t <= KEYFRAMES[i + 1].t) {
      a = KEYFRAMES[i];
      b = KEYFRAMES[i + 1];
      break;
    }
  }
  const span = b.t - a.t || 1;
  const local = THREE.MathUtils.clamp((t - a.t) / span, 0, 1);
  return {
    sky: a.sky.clone().lerp(b.sky, local),
    sunColor: a.sunColor.clone().lerp(b.sunColor, local),
    sunIntensity: THREE.MathUtils.lerp(a.sunIntensity, b.sunIntensity, local),
    hemiIntensity: THREE.MathUtils.lerp(a.hemiIntensity, b.hemiIntensity, local),
  };
}

export class DayNightSystem {
  constructor(private readonly rig: SceneRig) {}

  // Fraction of the day cycle currently elapsed, in [0, 1). 0 = midnight,
  // 0.25 = sunrise, 0.5 = noon, 0.75 = sunset.
  getTimeOfDay(nowMs: number): number {
    return (nowMs % DAY_LENGTH_MS) / DAY_LENGTH_MS;
  }

  update(nowMs: number): void {
    const t = this.getTimeOfDay(nowMs);
    const { sky, sunColor, sunIntensity, hemiIntensity } = lerpKeyframes(t);

    (this.rig.scene.background as THREE.Color).copy(sky);
    (this.rig.scene.fog as THREE.Fog).color.copy(sky);

    this.rig.sunLight.color.copy(sunColor);
    this.rig.sunLight.intensity = sunIntensity;
    this.rig.hemiLight.intensity = hemiIntensity;

    // Sun orbits from east (sunrise, t=0.25) overhead to west (sunset, t=0.75)
    // and continues below the horizon at night — purely cosmetic since
    // shadows aren't enabled, but it keeps lighting direction consistent
    // with time of day.
    const angle = (t - 0.25) * Math.PI * 2;
    const radius = 100;
    this.rig.sunLight.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius, 40);
  }
}
