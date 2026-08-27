import * as THREE from "three";
import { getEnemy, type EnemyDef } from "../data/enemies";
import type { Terrain } from "../world/terrain";
import { mulberry32 } from "../utils/rng";
import { events } from "../utils/events";

type EnemyAiState = "idle" | "chase" | "attack";

let nextEnemyId = 0;

function buildEnemyMesh(color: number): THREE.Group {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.35, 0.9, 4, 8),
    new THREE.MeshStandardMaterial({ color }),
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
  private aiState: EnemyAiState = "idle";
  private lastAttackMs = -Infinity;

  constructor(def: EnemyDef, x: number, y: number, z: number) {
    this.id = `enemy-${nextEnemyId++}`;
    this.def = def;
    this.object = buildEnemyMesh(def.color);
    this.object.position.set(x, y, z);
    this.health = def.maxHealth;
  }

  // Returns true if this hit killed the enemy.
  takeDamage(amount: number): boolean {
    this.health = Math.max(0, this.health - amount);
    return this.health <= 0;
  }

  update(
    dt: number,
    nowMs: number,
    playerPos: THREE.Vector3,
    terrain: Terrain,
    onAttackPlayer: (damage: number) => void,
  ): void {
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

  getEnemies(): Enemy[] {
    return this.enemies;
  }

  private spawnOne(): void {
    const def = getEnemy("zombie");
    const angle = this.rand() * Math.PI * 2;
    const radius = SPAWN_RADIUS_MIN + this.rand() * (SPAWN_RADIUS_MAX - SPAWN_RADIUS_MIN);
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const y = this.terrain.heightAt(x, z);

    const enemy = new Enemy(def, x, y, z);
    this.enemies.push(enemy);
    this.scene.add(enemy.object);
    events.emit("enemy-spawned", { id: enemy.id });
  }

  removeEnemy(id: string): void {
    const index = this.enemies.findIndex((e) => e.id === id);
    if (index === -1) return;
    this.scene.remove(this.enemies[index].object);
    this.enemies.splice(index, 1);
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
  }
}
