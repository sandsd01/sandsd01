import * as THREE from "three";
import { getEnemy, type EnemyDef } from "../data/enemies";
import type { Terrain } from "../world/terrain";
import { getZone } from "../world/zones";
import { WORLD_SIZE } from "../world/terrain";
import { mulberry32 } from "../utils/rng";
import { events } from "../utils/events";
import { resolveCollisions, type Collidable } from "../utils/collision";
import { buildFigureGeometry, createFigureMaterial, type FigurePalette } from "../world/figures";

type EnemyAiState = "idle" | "chase" | "attack";

const FLASH_MS = 120;
const DEATH_ANIM_MS = 300;
/** Body radius used against the world. A little under the player's, so a gap
 * the player can squeeze through is never one the enemy cannot follow into. */
const ENEMY_RADIUS = 0.42;
/** How far a step has to be shortened before it counts as having been stopped. */
const BLOCKED_EPSILON = 0.02;

let nextEnemyId = 0;

// Silhouette carries the threat read at a distance: the lanky, hunched zombie
// and the squat, heavy brute are told apart by shape before colour.
const ENEMY_FIGURES: Record<string, { height: number; build: number; hunch: number; palette: FigurePalette }> = {
  zombie: {
    height: 1.65,
    build: 0.9,
    hunch: 0.3,
    palette: { skin: 0x8fae6a, torso: 0x53663c, legs: 0x3d4633, accent: 0x2f3826 },
  },
  brute: {
    height: 2.0,
    build: 1.45,
    hunch: 0.16,
    palette: { skin: 0xa8705a, torso: 0x7d4340, legs: 0x452b2c, accent: 0x33201f },
  },
};

function buildEnemyMesh(defId: string): THREE.Mesh {
  const figure = ENEMY_FIGURES[defId] ?? ENEMY_FIGURES.zombie;
  const material = createFigureMaterial();
  // Per-enemy material: the hit flash and death fade are material-level, so
  // enemies can't share one the way static props do.
  material.transparent = true;
  const mesh = new THREE.Mesh(buildFigureGeometry(figure), material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export class Enemy {
  readonly id: string;
  readonly def: EnemyDef;
  readonly object: THREE.Mesh;
  health: number;
  dying = false;
  /**
   * Per-enemy rather than read from the def, because a raider is dropped well
   * outside the def's 14-16 units and has to come looking. Left at the def's
   * value it would stand where it landed all night.
   */
  aggroRadius: number;
  private aiState: EnemyAiState = "idle";
  private lastAttackMs = -Infinity;
  private flashUntilMs = -Infinity;
  private deathStartMs = -Infinity;

  constructor(def: EnemyDef, x: number, y: number, z: number) {
    this.id = `enemy-${nextEnemyId++}`;
    this.def = def;
    this.object = buildEnemyMesh(def.id);
    this.object.position.set(x, y, z);
    this.health = def.maxHealth;
    this.aggroRadius = def.aggroRadius;
  }

  private get material(): THREE.MeshStandardMaterial {
    return this.object.material as THREE.MeshStandardMaterial;
  }

  // Returns true if this hit killed the enemy.
  takeDamage(amount: number, nowMs: number): boolean {
    this.health = Math.max(0, this.health - amount);
    this.flashUntilMs = nowMs + FLASH_MS;
    return this.health <= 0;
  }

  // Marks the enemy as dead but keeps it around (no longer targetable/acting)
  // to play a short shrink-and-fade before EnemyManager actually removes it.
  startDeathAnimation(nowMs: number): void {
    this.dying = true;
    this.deathStartMs = nowMs;
  }

  isDeathAnimDone(nowMs: number): boolean {
    return this.dying && nowMs - this.deathStartMs >= DEATH_ANIM_MS;
  }

  /**
   * @param collidables the same list the player is resolved against, so both
   *   move through one world. Enemies used to be resolved against nothing at
   *   all — they wrote straight to `object.position` — which meant every wall
   *   in the game stopped the player and no one else, and a base was scenery.
   * @param onAttackBuilding called with a point just ahead of a blocked enemy.
   *   Returns whether something breakable was actually there: true and the
   *   enemy stays put and works on it, false and it goes on sliding along
   *   whatever it is (a boulder, a tree) as before. Enemies still chase the
   *   player and only the player — they hit what is in the way, they do not
   *   pick out a base to besiege.
   */
  update(
    dt: number,
    nowMs: number,
    playerPos: THREE.Vector3,
    terrain: Terrain,
    onAttackPlayer: (damage: number) => void,
    collidables: Collidable[] = [],
    onAttackBuilding: (x: number, z: number, damage: number) => boolean = () => false,
  ): void {
    if (this.dying) {
      const t = Math.min(1, (nowMs - this.deathStartMs) / DEATH_ANIM_MS);
      this.object.scale.setScalar(1 - t);
      this.material.opacity = 1 - t;
      return;
    }

    const dx = playerPos.x - this.object.position.x;
    const dz = playerPos.z - this.object.position.z;
    const dist = Math.hypot(dx, dz);

    if (this.aiState === "idle" && dist < this.aggroRadius) {
      this.aiState = "chase";
    }

    if (this.aiState === "chase") {
      if (dist <= this.def.attackRange) {
        this.aiState = "attack";
      } else if (dist > this.aggroRadius * 1.5) {
        this.aiState = "idle";
      } else if (dist > 0) {
        const step = this.def.moveSpeed * dt;
        const wantX = this.object.position.x + (dx / dist) * step;
        const wantZ = this.object.position.z + (dz / dist) * step;
        const solved = resolveCollisions(wantX, wantZ, ENEMY_RADIUS, collidables);
        this.object.position.x = solved.x;
        this.object.position.z = solved.z;
        // Face the player, not the corrected step: an enemy shoved sideways
        // along a wall is still coming for you and should look like it.
        this.object.rotation.y = Math.atan2(dx, dz);

        const stopped =
          Math.hypot(solved.x - wantX, solved.z - wantZ) > BLOCKED_EPSILON &&
          nowMs - this.lastAttackMs >= this.def.attackCooldownMs;
        if (stopped) {
          // Sample past our own radius, in the direction we were trying to go —
          // the cell we are standing in is our own, not the thing in the way.
          const reach = ENEMY_RADIUS + this.def.attackRange * 0.5;
          const hit = onAttackBuilding(
            this.object.position.x + (dx / dist) * reach,
            this.object.position.z + (dz / dist) * reach,
            this.def.damage,
          );
          if (hit) this.lastAttackMs = nowMs;
        }
      }
    }

    if (this.aiState === "attack") {
      if (dist > this.def.attackRange * 1.3) {
        this.aiState = "chase";
      } else if (nowMs - this.lastAttackMs >= this.def.attackCooldownMs) {
        this.lastAttackMs = nowMs;
        onAttackPlayer(this.def.damage);
      }
    }

    this.object.position.y = terrain.heightAt(this.object.position.x, this.object.position.z);

    // Brief flash on taking a hit — clearer feedback than the health bar
    // alone, especially mid-fight with several enemies on screen. Driven by
    // emissive rather than base colour, since the figure's colours live in
    // vertex data that a material tint would only multiply against.
    this.material.emissive.setHex(nowMs < this.flashUntilMs ? 0xaaaaaa : 0x000000);
  }
}

// The ambient trickle, and the ceiling a raid is allowed to fill instead.
// These have to be separate numbers: a wave of six that ran into a cap of
// eight (which counts the dying, too) would arrive as two.
const MAX_ENEMIES = 8;
const RAID_MAX_ENEMIES = 18;
/**
 * How often a wanderer turns up near the homestead, and how much faster that
 * gets out on the frontier.
 *
 * The interval is scaled by distance rather than the count being: a spawner
 * that dropped three at once out there would read as an ambush the game had
 * decided on, where a shorter gap reads as a place that simply has more in it.
 */
const SPAWN_INTERVAL_MS = 9000;
const FRONTIER_SPAWN_INTERVAL_MS = 3500;
const SPAWN_RADIUS_MIN = 30;
const SPAWN_RADIUS_MAX = 90;
/**
 * Where the ground stops being safe, and where it is as dangerous as it gets.
 *
 * Matches `FRONTIER_RADIUS` in world/resource-node's scatter — the ring that
 * holds the only ancient stone in the world is the ring that is worst to stand
 * in, which is the entire bargain the frontier offers.
 */
const DANGER_RADIUS_MIN = 60;
const DANGER_RADIUS_MAX = 150;
/**
 * Share of wanderers that are brutes, at the near and far ends of that range.
 *
 * Zero at home is the *distance* term only — the biome floor below still puts
 * brutes in rough country a short walk from the door, which is what the
 * original zone rule did and is not something this change set out to soften.
 */
const BRUTE_SHARE_HOME = 0;
const BRUTE_SHARE_FRONTIER = 0.85;
/**
 * Rocky and wetland are harder ground to fight across wherever they are, so
 * they keep a floor under the distance term. Measured rather than guessed: a
 * ring around the homestead is mostly rough country, so this floor alone lands
 * about a third of the wanderers near home as brutes — roughly where the old
 * zone-decides-everything rule had it.
 */
const BRUTE_SHARE_ROUGH_BIOME = 0.5;

/**
 * How exposed a point is, 0 at the homestead and 1 out past the frontier.
 *
 * Exported because this is the one number that says what "far" means, and both
 * the spawn rate and the mix of what spawns have to agree about it.
 */
/**
 * Keeps a spawn point on the map.
 *
 * Both spawners now ring the *player*, and a player standing near the edge has
 * most of that ring hanging over the void: the terrain mesh stops at
 * ±WORLD_SIZE/2 even though `heightAt` will happily answer for a point past
 * it, so an unclamped spawn drops a raider onto ground that is not drawn.
 */
const EDGE_MARGIN = 4;
function onMap(v: number): number {
  const limit = WORLD_SIZE / 2 - EDGE_MARGIN;
  return THREE.MathUtils.clamp(v, -limit, limit);
}

export function dangerAt(x: number, z: number): number {
  const d = Math.hypot(x, z);
  return THREE.MathUtils.clamp(
    (d - DANGER_RADIUS_MIN) / (DANGER_RADIUS_MAX - DANGER_RADIUS_MIN),
    0,
    1,
  );
}
// A wave lands close enough to reach the player before the night is over, and
// far enough out that nothing materialises in the middle of the yard.
const WAVE_RADIUS_MIN = 26;
const WAVE_RADIUS_MAX = 38;

export class EnemyManager {
  private readonly enemies: Enemy[] = [];
  private lastSpawnMs = -Infinity;
  private readonly rand: () => number;
  /** While a raid runs the ambient trickle stops and the ceiling lifts. */
  private raiding = false;
  /** Ids spawned as part of the current raid, so "the wave is dead" is answerable. */
  private readonly raidIds = new Set<string>();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly terrain: Terrain,
    seed: number,
  ) {
    this.rand = mulberry32(seed ^ 0x1337beef);
  }

  // Live, targetable enemies only — a dying enemy is still animating out but
  // should no longer be attackable or attack the player.
  getEnemies(): Enemy[] {
    return this.enemies.filter((e) => !e.dying);
  }

  /**
   * Drops one wanderer on a ring around the **player**.
   *
   * It used to be a ring around the world origin, which was survivable on a
   * 200-unit map and is not on a 400-unit one: a player standing at the far
   * edge would have every wanderer in the game spawn back at the homestead and
   * never reach them, so walking away from spawn was the safest thing you
   * could do — exactly backwards from the world this is meant to be.
   */
  private spawnOne(playerX: number, playerZ: number): void {
    const angle = this.rand() * Math.PI * 2;
    const radius = SPAWN_RADIUS_MIN + this.rand() * (SPAWN_RADIUS_MAX - SPAWN_RADIUS_MIN);
    const x = onMap(playerX + Math.cos(angle) * radius);
    const z = onMap(playerZ + Math.sin(angle) * radius);
    // Two things decide what turns up: how far out it is, and what kind of
    // ground it is. Distance is the stronger of the two and it is the one the
    // player can see themselves making — the biome rule stays because rocky
    // and wetland are harder ground to fight across wherever they are.
    //
    // Note what is *not* here: no enemy gets extra health or damage for being
    // far from home. A brute is a brute at any radius. The frontier is harder
    // because more of what walks out of it are brutes, which the player can
    // read off the silhouettes — not because the game quietly rewrote the
    // numbers behind the same model.
    const zone = getZone(x, z);
    const danger = dangerAt(x, z);
    let bruteChance = BRUTE_SHARE_HOME + (BRUTE_SHARE_FRONTIER - BRUTE_SHARE_HOME) * danger;
    if (zone === "rocky" || zone === "wetland") {
      bruteChance = Math.max(bruteChance, BRUTE_SHARE_ROUGH_BIOME);
    }
    this.spawnAt(getEnemy(this.rand() < bruteChance ? "brute" : "zombie"), x, z);
  }

  private spawnAt(def: EnemyDef, x: number, z: number): Enemy {
    const enemy = new Enemy(def, x, this.terrain.heightAt(x, z), z);
    this.enemies.push(enemy);
    this.scene.add(enemy.object);
    events.emit("enemy-spawned", { id: enemy.id });
    return enemy;
  }

  /**
   * Places one enemy at an exact spot. For tests that need a known layout —
   * the ambient spawner picks its own ring position and the question under
   * test is usually what happens between an enemy and a wall, not where it
   * came from.
   */
  spawnEnemyAt(enemyId: string, x: number, z: number): string {
    return this.spawnAt(getEnemy(enemyId), x, z).id;
  }

  setRaiding(raiding: boolean): void {
    this.raiding = raiding;
    if (!raiding) this.raidIds.clear();
  }

  /** How many of the current raid's enemies are still on their feet. */
  raidersAlive(): number {
    return this.enemies.filter((e) => !e.dying && this.raidIds.has(e.id)).length;
  }

  /**
   * Drops a wave on a ring around the player.
   *
   * Around the *player*, not the world origin the ambient spawner uses: a
   * homestead built out past the ridge would otherwise be raided by enemies
   * that spawn back at spawn and never arrive.
   */
  spawnWave(count: number, brutes: number, aroundX: number, aroundZ: number): number {
    let spawned = 0;
    for (let i = 0; i < count; i++) {
      if (this.enemies.length >= RAID_MAX_ENEMIES) break;
      // Spread around the full circle rather than clustering, so a wave
      // arrives from every side and a one-sided wall is not a whole answer.
      const angle = ((i + this.rand()) / count) * Math.PI * 2;
      const radius = WAVE_RADIUS_MIN + this.rand() * (WAVE_RADIUS_MAX - WAVE_RADIUS_MIN);
      const def = getEnemy(i < brutes ? "brute" : "zombie");
      const enemy = this.spawnAt(
        def,
        onMap(aroundX + Math.cos(angle) * radius),
        onMap(aroundZ + Math.sin(angle) * radius),
      );
      // Reaches all the way back to the player from the spawn ring, so a wave
      // closes in rather than milling about where it landed.
      enemy.aggroRadius = WAVE_RADIUS_MAX * 1.6;
      this.raidIds.add(enemy.id);
      spawned++;
    }
    return spawned;
  }

  // Starts the death animation immediately and emits enemy-killed right away
  // (so loot/UI/audio react promptly); the mesh itself is only actually
  // removed from the scene once the animation finishes, in update().
  removeEnemy(id: string, nowMs: number): void {
    const enemy = this.enemies.find((e) => e.id === id);
    if (!enemy || enemy.dying) return;
    enemy.startDeathAnimation(nowMs);
    // Carries where and what died, not just which id: loot has to land at the
    // corpse, and by the time a listener could look the enemy up it may
    // already have finished its death animation and left the list.
    events.emit("enemy-killed", {
      id,
      enemyId: enemy.def.id,
      x: enemy.object.position.x,
      z: enemy.object.position.z,
    });
  }

  update(
    dt: number,
    nowMs: number,
    playerPos: THREE.Vector3,
    onAttackPlayer: (damage: number) => void,
    collidables: Collidable[] = [],
    onAttackBuilding: (x: number, z: number, damage: number) => boolean = () => false,
  ): void {
    // The trickle is suspended for the night: left running it would spend the
    // raid ceiling on wanderers and thin out the waves themselves.
    const interval = THREE.MathUtils.lerp(
      SPAWN_INTERVAL_MS,
      FRONTIER_SPAWN_INTERVAL_MS,
      dangerAt(playerPos.x, playerPos.z),
    );
    if (!this.raiding && nowMs - this.lastSpawnMs > interval && this.enemies.length < MAX_ENEMIES) {
      this.lastSpawnMs = nowMs;
      // The ceiling of eight holds wherever the player stands. Out on the
      // frontier they arrive faster, not in greater numbers at once: lifting
      // the cap as well would turn a long walk into an unwinnable one, and the
      // cap is also what keeps the frame budget honest.
      this.spawnOne(playerPos.x, playerPos.z);
    }

    for (const enemy of this.enemies) {
      enemy.update(dt, nowMs, playerPos, this.terrain, onAttackPlayer, collidables, onAttackBuilding);
    }

    for (let i = this.enemies.length - 1; i >= 0; i--) {
      if (this.enemies[i].isDeathAnimDone(nowMs)) {
        this.scene.remove(this.enemies[i].object);
        this.raidIds.delete(this.enemies[i].id);
        this.enemies.splice(i, 1);
      }
    }
  }
}
