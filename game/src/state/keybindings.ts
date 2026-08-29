// Input is addressed by what it does, not by which key does it. Every gameplay
// check goes through an Action, so rebinding is a data change rather than a
// hunt through the code for string literals.
export type Action =
  | "moveForward"
  | "moveBack"
  | "moveLeft"
  | "moveRight"
  | "sprint"
  | "jump"
  | "gather"
  | "farm"
  | "cancelBuild"
  | "crafting"
  | "building"
  | "inventory"
  | "options"
  | "toggleView"
  | "hotbar1"
  | "hotbar2"
  | "hotbar3"
  | "hotbar4"
  | "hotbar5"
  | "hotbar6"
  | "hotbar7"
  | "hotbar8";

// Order here is the order the Options screen lists them in, grouped the way a
// player thinks about them rather than alphabetically.
export const ACTIONS: Action[] = [
  "moveForward",
  "moveBack",
  "moveLeft",
  "moveRight",
  "sprint",
  "jump",
  "gather",
  "farm",
  "cancelBuild",
  "toggleView",
  "hotbar1",
  "hotbar2",
  "hotbar3",
  "hotbar4",
  "hotbar5",
  "hotbar6",
  "hotbar7",
  "hotbar8",
  "crafting",
  "building",
  "inventory",
  "options",
];

export const ACTION_LABELS: Record<Action, string> = {
  moveForward: "Move forward",
  moveBack: "Move back",
  moveLeft: "Move left",
  moveRight: "Move right",
  sprint: "Sprint",
  jump: "Jump",
  gather: "Gather / interact",
  farm: "Plant / harvest",
  cancelBuild: "Cancel placement",
  toggleView: "First / third person",
  crafting: "Crafting menu",
  building: "Build menu",
  inventory: "Inventory",
  options: "Options",
  hotbar1: "Build slot 1",
  hotbar2: "Build slot 2",
  hotbar3: "Build slot 3",
  hotbar4: "Build slot 4",
  hotbar5: "Build slot 5",
  hotbar6: "Build slot 6",
  hotbar7: "Build slot 7",
  hotbar8: "Build slot 8",
};

// Two slots per action, as most games in the genre offer: it keeps both
// conventions alive where the genre is split (Tab and I both open the
// inventory) without either being hard-coded.
export type Bindings = Record<Action, string[]>;

export const DEFAULT_BINDINGS: Bindings = {
  moveForward: ["KeyW"],
  moveBack: ["KeyS"],
  moveLeft: ["KeyA"],
  moveRight: ["KeyD"],
  sprint: ["ShiftLeft", "ShiftRight"],
  jump: ["Space"],
  gather: ["KeyE"],
  farm: ["KeyF"],
  cancelBuild: ["KeyQ"],
  // F5 is the view-toggle key players arrive with from Minecraft; V is the
  // second slot for keyboards where F5 is claimed by the browser.
  toggleView: ["F5", "KeyV"],
  crafting: ["KeyC"],
  building: ["KeyB"],
  inventory: ["Tab", "KeyI"],
  options: ["Escape"],
  hotbar1: ["Digit1"],
  hotbar2: ["Digit2"],
  hotbar3: ["Digit3"],
  hotbar4: ["Digit4"],
  hotbar5: ["Digit5"],
  hotbar6: ["Digit6"],
  hotbar7: ["Digit7"],
  hotbar8: ["Digit8"],
};

const STORAGE_KEY = "romestead-keybindings-v1";

// KeyboardEvent.code is what gets stored — it's layout-independent, so a
// binding made on AZERTY still means the same physical key. It is not
// presentable, hence this.
export function keyLabel(code: string): string {
  if (!code) return "—";
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Numpad")) return `Num ${code.slice(6)}`;
  if (code.startsWith("Arrow")) return code.slice(5);
  const named: Record<string, string> = {
    Space: "Space",
    Escape: "Esc",
    Tab: "Tab",
    ShiftLeft: "L Shift",
    ShiftRight: "R Shift",
    ControlLeft: "L Ctrl",
    ControlRight: "R Ctrl",
    AltLeft: "L Alt",
    AltRight: "R Alt",
    Enter: "Enter",
    Backspace: "Backspace",
    CapsLock: "Caps",
  };
  return named[code] ?? code;
}

function isValid(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string" && v.length > 0);
}

export function loadBindings(): Bindings {
  const bindings = structuredClone(DEFAULT_BINDINGS);
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return bindings;
    const parsed = JSON.parse(raw) as Partial<Record<Action, unknown>>;
    for (const action of ACTIONS) {
      const stored = parsed[action];
      // Anything unreadable falls back to that action's default rather than
      // leaving it unbound — an unbound Options key would strand the player
      // with no way back into this screen to fix it.
      if (isValid(stored) && stored.length > 0) bindings[action] = stored.slice(0, 2);
    }
  } catch (err) {
    console.warn("Failed to read key bindings, using defaults:", err);
  }
  return bindings;
}

export function saveBindings(bindings: Bindings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings));
  } catch (err) {
    console.warn("Failed to save key bindings:", err);
  }
}

// Assigns a key to one slot, first removing it from wherever else it was bound.
// Without that, a duplicate would silently fire two actions at once.
export function rebind(
  bindings: Bindings,
  action: Action,
  slot: number,
  code: string,
): void {
  for (const other of ACTIONS) {
    bindings[other] = bindings[other].filter(
      (existing, index) => !(existing === code && !(other === action && index === slot)),
    );
  }
  const slots = bindings[action].slice();
  slots[slot] = code;
  // An action whose every slot was cleared by the conflict sweep above would
  // otherwise keep an undefined hole in the array.
  bindings[action] = slots.filter((c) => typeof c === "string" && c.length > 0);
}
