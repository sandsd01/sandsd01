import * as THREE from "three";

export type ResourceNodeKind = "tree" | "rock" | "berry_bush" | "clay_pit" | "iron_vein";

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
  berry_bush: {
    kind: "berry_bush",
    yieldItemId: "berry",
    yieldQtyPerHit: 1,
    hitsToDeplete: 3,
    respawnMs: 18_000,
  },
  clay_pit: {
    kind: "clay_pit",
    yieldItemId: "clay",
    yieldQtyPerHit: 1,
    hitsToDeplete: 3,
    respawnMs: 22_000,
  },
  iron_vein: {
    kind: "iron_vein",
    yieldItemId: "iron_ore",
    yieldQtyPerHit: 1,
    hitsToDeplete: 5,
    respawnMs: 35_000,
  },
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

function buildBerryBushMesh(): THREE.Group {
  const group = new THREE.Group();
  const bush = new THREE.Mesh(
    new THREE.SphereGeometry(0.6, 8, 6),
    new THREE.MeshStandardMaterial({ color: 0x2f5a2f, flatShading: true }),
  );
  bush.position.y = 0.5;
  bush.scale.y = 0.8;
  const berries = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.62, 0),
    new THREE.MeshStandardMaterial({ color: 0x9a2a4a, flatShading: true, wireframe: false }),
  );
  berries.position.y = 0.5;
  berries.scale.setScalar(0.35);
  group.add(bush, berries);
  return group;
}

function buildClayPitMesh(): THREE.Group {
  const group = new THREE.Group();
  const pit = new THREE.Mesh(
    new THREE.CylinderGeometry(0.9, 0.7, 0.25, 8),
    new THREE.MeshStandardMaterial({ color: 0x8a5a42, flatShading: true }),
  );
  pit.position.y = 0.12;
  group.add(pit);
  return group;
}

function buildIronVeinMesh(): THREE.Group {
  const group = new THREE.Group();
  const rock = new THREE.Mesh(
    new THREE.DodecahedronGeometry(0.7, 0),
    new THREE.MeshStandardMaterial({ color: 0x5a5a5a, flatShading: true }),
  );
  rock.position.y = 0.4;
  const streak = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.3, 0),
    new THREE.MeshStandardMaterial({ color: 0xd0895a, flatShading: true }),
  );
  streak.position.y = 0.6;
  group.add(rock, streak);
  return group;
}

const NODE_MESH_BUILDERS: Record<ResourceNodeKind, () => THREE.Group> = {
  tree: buildTreeMesh,
  rock: buildRockMesh,
  berry_bush: buildBerryBushMesh,
  clay_pit: buildClayPitMesh,
  iron_vein: buildIronVeinMesh,
};

const HIT_PUNCH_MS = 160;
const HIT_PUNCH_SCALE = 1.35;

let nextId = 0;

export class ResourceNode {
  readonly id: string;
  readonly config: ResourceNodeConfig;
  readonly object: THREE.Group;
  hitsRemaining: number;
  depleted = false;
  private depletedAtMs = 0;
  private hitAnimStartMs = -Infinity;

  constructor(kind: ResourceNodeKind, x: number, y: number, z: number) {
    this.id = `node-${nextId++}`;
    this.config = RESOURCE_NODE_CONFIGS[kind];
    this.object = NODE_MESH_BUILDERS[kind]();
    this.object.position.set(x, y, z);
    this.hitsRemaining = this.config.hitsToDeplete;
  }

  // Returns the item/qty yielded by this hit, or null if already depleted.
  hit(nowMs: number): { itemId: string; qty: number } | null {
    if (this.depleted) return null;
    this.hitAnimStartMs = nowMs;
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
    if (this.depleted) {
      if (nowMs - this.depletedAtMs >= this.config.respawnMs) {
        this.depleted = false;
        this.hitsRemaining = this.config.hitsToDeplete;
        this.object.visible = true;
      }
      return;
    }

    // A quick punch-scale pulse on hit — clear visual confirmation that a
    // gather actually connected, independent of the HUD count updating.
    const elapsed = nowMs - this.hitAnimStartMs;
    const scale = elapsed < HIT_PUNCH_MS ? 1 + (1 - elapsed / HIT_PUNCH_MS) * (HIT_PUNCH_SCALE - 1) : 1;
    this.object.scale.setScalar(scale);
  }
}
