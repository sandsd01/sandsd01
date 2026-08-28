// Player-facing input options. Every game in this genre ships at least these
// two — an inverted-Y toggle and a sensitivity slider — because they're the
// difference between a camera feeling broken and feeling like yours. Kept out
// of GameState: they belong to the person at the keyboard, not to the save, so
// they survive starting a new world.
export interface Settings {
  /** Multiplier on raw mouse delta, 0.25x to 3x of the default feel. */
  mouseSensitivity: number;
  /** When true, moving the mouse down looks up (flight-sim convention). */
  invertY: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  mouseSensitivity: 1,
  invertY: false,
};

export const SENSITIVITY_MIN = 0.25;
export const SENSITIVITY_MAX = 3;

const STORAGE_KEY = "romestead-settings-v1";

function clampSensitivity(value: unknown): number {
  const n = typeof value === "number" && Number.isFinite(value) ? value : DEFAULT_SETTINGS.mouseSensitivity;
  return Math.min(SENSITIVITY_MAX, Math.max(SENSITIVITY_MIN, n));
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      mouseSensitivity: clampSensitivity(parsed.mouseSensitivity),
      invertY: parsed.invertY === true,
    };
  } catch (err) {
    console.warn("Failed to read settings, using defaults:", err);
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (err) {
    console.warn("Failed to save settings:", err);
  }
}
