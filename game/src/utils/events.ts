// Lightweight typed pub/sub so gameplay systems can notify UI/save-load without
// direct references to each other.
type Listener<T> = (payload: T) => void;

export class EventBus<Events extends object> {
  private listeners: { [K in keyof Events]?: Set<Listener<Events[K]>> } = {};

  on<K extends keyof Events>(event: K, listener: Listener<Events[K]>): () => void {
    let set = this.listeners[event];
    if (!set) {
      set = new Set();
      this.listeners[event] = set;
    }
    set.add(listener);
    return () => set!.delete(listener);
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    const set = this.listeners[event];
    if (!set) return;
    for (const listener of set) listener(payload);
  }
}

export interface GameEvents {
  "inventory-changed": { itemId: string };
  "equipped-changed": { itemId: string | null };
  "container-changed": { buildingId: string };
  "player-health-changed": { current: number; max: number };
  "player-stamina-changed": { current: number; max: number };
  "player-damaged": { amount: number };
  "player-exhausted": Record<string, never>;
  "player-jumped": Record<string, never>;
  "player-landed": Record<string, never>;
  "player-footstep": Record<string, never>;
  "player-died": Record<string, never>;
  "player-respawned": Record<string, never>;
  "enemy-spawned": { id: string };
  "enemy-hit": { id: string; damage: number };
  "enemy-killed": { id: string; enemyId: string; x: number; z: number };
  "item-crafted": { itemId: string; qty: number };
  "item-picked-up": { itemId: string; qty: number };
  "resource-gathered": { itemId: string; qty: number; kind: string; finalHit: boolean };
  "player-attack": Record<string, never>;
  "building-removed": { id: string; buildingId: string };
  "building-damaged": { id: string; buildingId: string; damage: number; maxHealth: number };
  "building-destroyed": { id: string; buildingId: string };
  "building-repaired": { id: string; buildingId: string };
  "raid-warning": { secondsAway: number };
  "raid-started": Record<string, never>;
  "raid-wave": { wave: number; count: number };
  "raid-ended": { survived: boolean };
  "building-placed": { id: string; buildingId: string };
  "building-selection-changed": { buildingId: string | null };
  "crop-planted": { plotId: string; cropId: string };
  "crop-harvested": { plotId: string; cropId: string };
  "notification": { message: string };
  "game-saved": Record<string, never>;
  "game-loaded": Record<string, never>;
}

export const events = new EventBus<GameEvents>();
