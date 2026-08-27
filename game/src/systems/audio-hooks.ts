import { events } from "../utils/events";
import { sound } from "../utils/audio";

const TOOL_KINDS = new Set(["tree", "rock", "iron_vein"]);

// Wires the game's event bus to the procedural sound system — kept as its
// own module (rather than scattering sound.* calls through every system) so
// gameplay logic stays free of audio concerns, matching how ui/hud.ts stays
// decoupled from gameplay by listening on the same bus.
export class AudioHooks {
  constructor() {
    events.on("resource-gathered", ({ kind }) => {
      if (kind === "tree") sound.chop();
      else if (TOOL_KINDS.has(kind)) sound.mine();
      else sound.gatherSoft();
    });
    events.on("player-attack", () => sound.swing());
    events.on("enemy-hit", () => sound.hit());
    events.on("enemy-killed", () => sound.enemyDeath());
    events.on("player-damaged", () => sound.playerHurt());
    events.on("player-died", () => sound.playerDied());
    events.on("item-crafted", () => sound.craft());
    events.on("building-placed", () => sound.place());
    events.on("crop-planted", () => sound.plant());
    events.on("crop-harvested", () => sound.harvest());
  }
}
