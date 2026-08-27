import * as THREE from "three";
import { getEnemy, type EnemyDef } from "../data/enemies";
import type { Terrain } from "../world/terrain";
import { getZone } from "../world/zones";
import { mulberry32 } from "../utils/rng";
import { events } from "../utils/events";

type EnemyAiState = "idle" | "chase" | "attack";

const FLASH_MS = 120;
const DEATH_ANIM_MS = 300;

let nextEnemyId = 0;

function buildEnemyMesh(color: number): THREE.Group {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.35, 0.9, 4, 8),
    new THREE.MeshStandardMaterial({ color, transparent: true }),
  );
  body.position.y = 0.9;
  group.add(body);
  return group;
}

export class Enemy {
  readonly id: string;
  readonly def: EnemyDef;
  readonly object: THREE.Group;
  health: number;
  dying = false;
  private aiState: EnemyAiState = "idle";
  private lastAttackMs = -Infinity;
  private flashUntilMs = -Infinity;
  private deathStartMs = -Infinity;
  private readonly body: THREE.Mesh;
  private readonly baseColor: THREE.Color;

  constructor(def: EnemyDef, x: number, y: number, z: number) {
    this.id = `enemy-${nextEnemyId++}`;
    this.def = def;
    this.object = buildEnemyMesh(def.color);
    this.body = this.object.children[0] as THREE.Mesh;
    this.baseColor = (this.body.material as THREE.MeshStandardMaterial).color.clone();
    this.object.position.set(x, y, z);
    this.health = def.maxHealth;
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

  update(
    dt: number,
    nowMs: number,
    playerPos: THREE.Vector3,
    terrain: Terrain,
    onAttackPlayer: (damage: number) => void,
  ): void {
    if (this.dying) {
      const t = Math.min(1, (nowMs - this.deathStartMs) / DEATH_ANIM_MS);
      this.object.scale.setScalar(1 - t);
      (this.body.material as THREE.MeshStandardMaterial).opacity = 1 - t;
      return;
    }

    const dx = playerPos.x - this.object.position.x;
    const dz = playerPos.z - this.object.position.z;
    const dist = Math.hypot(dx, dz);

    if (this.aiState === "idle" && dist < this.def.aggroRadius) {
      this.aiState = "chase";
    }

    if (this.aiState === "chase") {
      if (dist <= this.def.attackRange) {
        this.aiState = "attack";
      } else if (dist > this.def.aggroRadius * 1.5) {
        this.aiState = "idle";
      } else if (dist > 0) {
        const step = this.def.moveSpeed * dt;
        this.object.position.x += (dx / dist) * step;
        this.object.position.z += (dz / dist) * step;
        this.object.rotation.y = Math.atan2(dx, dz);
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

    // Brief white flash on taking a hit — clearer feedback than the health
    // bar alone, especially mid-fight with several enemies on screen.
    const material = this.body.material as THREE.MeshStandardMaterial;
    if (nowMs < this.flashUntilMs) {
      material.color.set(0xffffff);
    } else {
      material.color.copy(this.baseColor);
    }
  }
}

const MAX_ENEMIES = 8;
const SPAWN_INTERVAL_MS = 9000;
const SPAWN_RADIUS_MIN = 30;
const SPAWN_RADIUS_MAX = 90;

export class EnemyManager {
  private readonly enemies: Enemy[] = [];
  private lastSpawnMs = -Infinity;
  private readonly rand: () => number;

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

  private spawnOne(): void {
    const angle = this.rand() * Math.PI * 2;
    const radius = SPAWN_RADIUS_MIN + this.rand() * (SPAWN_RADIUS_MAX - SPAWN_RADIUS_MIN);
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    // Rocky/wetland biomes are tougher terrain to fight through, so they
    // spawn the stronger Brute instead of a regular Zombie.
    const zone = getZone(x, z);
    const def = getEnemy(zone === "rocky" || zone === "wetland" ? "brute" : "zombie");
    const y = this.terrain.heightAt(x, z);

    const enemy = new Enemy(def, x, y, z);
    this.enemies.push(enemy);
    this.scene.add(enemy.object);
    events.emit("enemy-spawned", { id: enemy.id });
  }

  // Starts the death animation immediately and emits enemy-killed right away
  // (so loot/UI/audio react promptly); the mesh itself is only actually
  // removed from the scene once the animation finishes, in update().
  removeEnemy(id: string, nowMs: number): void {
    const enemy = this.enemies.find((e) => e.id === id);
    if (!enemy || enemy.dying) return;
    enemy.startDeathAnimation(nowMs);
    events.emit("enemy-killed", { id });
  }

  update(
    dt: number,
    nowMs: number,
    playerPos: THREE.Vector3,
    onAttackPlayer: (damage: number) => void,
  ): void {
    if (nowMs - this.lastSpawnMs > SPAWN_INTERVAL_MS && this.enemies.length < MAX_ENEMIES) {
      this.lastSpawnMs = nowMs;
      this.spawnOne();
    }

    for (const enemy of this.enemies) {
      enemy.update(dt, nowMs, playerPos, this.terrain, onAttackPlayer);
    }

    for (let i = this.enemies.length - 1; i >= 0; i--) {
      if (this.enemies[i].isDeathAnimDone(nowMs)) {
        this.scene.remove(this.enemies[i].object);
        this.enemies.splice(i, 1);
      }
    }
  }
}
