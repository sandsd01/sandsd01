import * as THREE from "three";
import type { SceneRig } from "../core/scene";

// A full day/night cycle in real-world milliseconds. Kept short (a few
// minutes) so the effect is visible during normal play rather than a
// realistic 24h cycle, matching the plan's "simple, low-priority nice-to-have"
// scope for this system — purely visual, nothing else is gated on it.
export const DAY_LENGTH_MS = 6 * 60 * 1000;

// Peak sun elevation at noon, in degrees. Below ~60 the shadows stay long and
// readable all day instead of collapsing under the player at midday.
const MAX_ELEVATION = 58;

/** Raids begin a little after sunset (t = 0.75) and run until first light. */
const RAID_START_T = 0.78;
/** 0.48 of a cycle: sundown through to t = 0.26 of the following morning. */
export const RAID_DURATION_MS = DAY_LENGTH_MS * 0.48;
/** Nights between raids. Three gives a fresh world time to put up a wall. */
const RAID_INTERVAL_DAYS = 3;

/**
 * When the raid after `nowMs` falls: the raid hour of the night
 * `RAID_INTERVAL_DAYS` days out. Absolute, on the `elapsedMs` clock — see the
 * note on `RaidState` for why this is not counted in days.
 */
export function raidStartAfter(nowMs: number): number {
  const target = nowMs + RAID_INTERVAL_DAYS * DAY_LENGTH_MS;
  return Math.floor(target / DAY_LENGTH_MS) * DAY_LENGTH_MS + RAID_START_T * DAY_LENGTH_MS;
}

const SUN_WARM = new THREE.Color(0xffb066);
const SUN_NOON = new THREE.Color(0xfff4dc);

const FOG_NIGHT = new THREE.Color(0x141c33);
const FOG_TWILIGHT = new THREE.Color(0xdc9a66);
const FOG_DAY = new THREE.Color(0xbcd8ec);

const HEMI_NIGHT = new THREE.Color(0x5a6a92);
const HEMI_DAY = new THREE.Color(0xbfd8ff);

export class DayNightSystem {
  private readonly sunDirection = new THREE.Vector3(0, 1, 0);
  private daylight = 1;
  private readonly scratchColor = new THREE.Color();

  constructor(private readonly rig: SceneRig) {}

  // Fraction of the day cycle currently elapsed, in [0, 1). 0 = midnight,
  // 0.25 = sunrise, 0.5 = noon, 0.75 = sunset.
  getTimeOfDay(nowMs: number): number {
    return (nowMs % DAY_LENGTH_MS) / DAY_LENGTH_MS;
  }

  // 0 through the night, 1 in full day — the same factor the lighting keys
  // off, exposed so the ambient sound bed can track it instead of deriving a
  // second, subtly different notion of "night".
  getDaylight(): number {
    return this.daylight;
  }

  // Unit vector pointing from the world toward the sun. main.ts feeds this to
  // updateSunTarget so the shadow frustum tracks the player.
  getSunDirection(): THREE.Vector3 {
    return this.sunDirection;
  }

  update(nowMs: number): void {
    const t = this.getTimeOfDay(nowMs);

    // Sun rises in the east at t=0.25, peaks at noon, sets in the west at
    // t=0.75, and continues below the horizon overnight.
    const elevationDeg = MAX_ELEVATION * Math.sin((t - 0.25) * Math.PI * 2);
    const azimuthDeg = 90 + 360 * (t - 0.25);
    const phi = THREE.MathUtils.degToRad(90 - elevationDeg);
    const theta = THREE.MathUtils.degToRad(azimuthDeg);
    this.sunDirection.setFromSphericalCoords(1, phi, theta);

    this.rig.sky.material.uniforms.sunPosition.value.copy(this.sunDirection);

    // 0 through the night, 1 once the sun is properly up. Everything else
    // (light intensity, fog, sky richness) keys off these two factors so the
    // transitions stay consistent with each other.
    const day = THREE.MathUtils.smoothstep(elevationDeg, -6, 12);
    this.daylight = day;
    const high = THREE.MathUtils.smoothstep(elevationDeg, 0, 28);
    // Peaks while the sun sits near the horizon — the golden-hour window.
    const twilight = (1 - high) * day;

    this.rig.sunLight.color.copy(SUN_WARM).lerp(SUN_NOON, high);
    this.rig.sunLight.intensity = 3.8 * day;

    this.rig.hemiLight.color.copy(HEMI_NIGHT).lerp(HEMI_DAY, day);
    // Sky fill lights everything the sun doesn't reach, so it sets how dark a
    // shadow goes. It has to stay well under the sun's contribution or shadows
    // wash out to nothing — but high enough that shaded foliage keeps colour
    // instead of crushing to black.
    this.rig.hemiLight.intensity = THREE.MathUtils.lerp(0.4, 1.0, day);

    // Haze up at sunrise/sunset for a redder horizon, clear at noon. Rayleigh
    // stays low by day: pushing it higher washes the zenith out to white
    // rather than deepening the blue.
    this.rig.sky.material.uniforms.turbidity.value = THREE.MathUtils.lerp(1.5, 7, twilight);
    this.rig.sky.material.uniforms.rayleigh.value = THREE.MathUtils.lerp(0.4, 2.6, day);

    // Fog tracks the horizon colour so the terrain's far edge dissolves into
    // the sky instead of ending at a visible seam.
    this.scratchColor.copy(FOG_NIGHT).lerp(FOG_DAY, day);
    this.scratchColor.lerp(FOG_TWILIGHT, twilight * 0.75);
    (this.rig.scene.fog as THREE.Fog).color.copy(this.scratchColor);
  }
}
