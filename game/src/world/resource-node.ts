import * as THREE from "three";

export type ResourceNodeKind = "tree" | "rock";

export interface ResourceNodeConfig {
  kind: ResourceNodeKind;
  yieldItemId: string;
  yieldQtyPerHit: number;
  hitsToDeplete: number;
  respawnMs: number;
}

export const RESOURCE_NODE_CONFIGS: Record<ResourceNodeKind, ResourceNodeConfig> = {
  tree: { kind: "tree", yieldItemId: "wood", yieldQtyPerHit: 1, hitsToDeplete: 4, respawnMs: 20_000 },
  rock: { kind: "rock", yieldItemId: "stone", yieldQtyPerHit: 1, hitsToDeplete: 4, respawnMs: 25_000 },
};

function buildTreeMesh(): THREE.Group {
  const group = new THREE.Group();
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.2, 0.28, 1.6, 6),
    new THREE.MeshStandardMaterial({ color: 0x6b4a2b }),
  );
  trunk.position.y = 0.8;
  const leaves = new THREE.Mesh(
    new THREE.ConeGeometry(1.1, 2.2, 8),
    new THREE.MeshStandardMaterial({ color: 0x2f6b2f }),
  );
  leaves.position.y = 2.4;
  group.add(trunk, leaves);
  return group;
}

function buildRockMesh(): THREE.Group {
  const group = new THREE.Group();
  const rock = new THREE.Mesh(
    new THREE.DodecahedronGeometry(0.7, 0),
    new THREE.MeshStandardMaterial({ color: 0x8a8a8a, flatShading: true }),
  );
  rock.position.y = 0.4;
  group.add(rock);
  return group;
}

let nextId = 0;

export class ResourceNode {
  readonly id: string;
  readonly config: ResourceNodeConfig;
  readonly object: THREE.Group;
  hitsRemaining: number;
  depleted = false;
  private depletedAtMs = 0;

  constructor(kind: ResourceNodeKind, x: number, y: number, z: number) {
    this.id = `node-${nextId++}`;
    this.config = RESOURCE_NODE_CONFIGS[kind];
    this.object = kind === "tree" ? buildTreeMesh() : buildRockMesh();
    this.object.position.set(x, y, z);
    this.hitsRemaining = this.config.hitsToDeplete;
  }

  // Returns the item/qty yielded by this hit, or null if already depleted.
  hit(nowMs: number): { itemId: string; qty: number } | null {
    if (this.depleted) return null;
    this.hitsRemaining -= 1;
    const result = { itemId: this.config.yieldItemId, qty: this.config.yieldQtyPerHit };
    if (this.hitsRemaining <= 0) {
      this.deplete(nowMs);
    }
    return result;
  }

  private deplete(nowMs: number): void {
    this.depleted = true;
    this.depletedAtMs = nowMs;
    this.object.visible = false;
  }

  update(nowMs: number): void {
    if (!this.depleted) return;
    if (nowMs - this.depletedAtMs >= this.config.respawnMs) {
      this.depleted = false;
      this.hitsRemaining = this.config.hitsToDeplete;
      this.object.visible = true;
    }
  }
}
