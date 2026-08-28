import * as THREE from "three";
import { merge, paint, placed, roughen, varyColor } from "./geometry";
import { instantiate, type ModelLibrary, type ModelName } from "./models";

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

// Every prop shares one flat-shaded material and carries its colour in vertex
// data (see world/geometry.ts), so the whole world costs a single shader
// program and each prop is one draw call.
const PROP_MATERIAL = new THREE.MeshStandardMaterial({
  vertexColors: true,
  flatShading: true,
  roughness: 0.85,
  metalness: 0,
});

const BARK = 0x7a5638;
// Foliage sits brighter than it looks: tone mapping pulls mid-greens down, and
// the shaded side of a canopy has only the sky fill to light it.
const LEAF_BROADLEAF = 0x69ad4a;
const LEAF_CONIFER = 0x479c62;

// Two silhouettes — a round broadleaf and a tapered conifer — so a forest
// reads as a forest rather than a row of identical cones.
function buildTreeGeometry(rand: () => number): THREE.BufferGeometry {
  const conifer = rand() < 0.45;
  const bark = varyColor(BARK, rand, 0.08);
  const leaf = varyColor(conifer ? LEAF_CONIFER : LEAF_BROADLEAF, rand, 0.1);

  const trunkH = (conifer ? 1.5 : 1.9) + rand() * 0.8;
  const parts: THREE.BufferGeometry[] = [
    placed(paint(new THREE.CylinderGeometry(0.16, 0.27, trunkH, 6), bark), 0, trunkH / 2, 0),
  ];

  if (conifer) {
    const layers = 3 + Math.floor(rand() * 2);
    const spread = 0.82 + rand() * 0.26;
    for (let i = 0; i < layers; i++) {
      const f = i / layers;
      parts.push(
        placed(
          paint(new THREE.ConeGeometry(spread * (1 - f * 0.6), 1.35 - f * 0.26, 7), leaf),
          0,
          trunkH + 0.3 + i * 0.62,
          0,
          { rotY: rand() * Math.PI },
        ),
      );
    }
  } else {
    const blobs = 3;
    const base = 0.72 + rand() * 0.26;
    for (let i = 0; i < blobs; i++) {
      const f = i / (blobs - 1);
      const r = base * (1 - f * 0.3);
      parts.push(
        placed(
          roughen(paint(new THREE.IcosahedronGeometry(r, 0), leaf), r * 0.14, rand),
          (rand() * 2 - 1) * 0.18,
          trunkH + 0.42 + i * base * 0.6,
          (rand() * 2 - 1) * 0.18,
          { rotY: rand() * Math.PI, scaleY: 0.85 },
        ),
      );
    }
  }

  return merge(parts);
}

function buildRockGeometry(rand: () => number): THREE.BufferGeometry {
  const stone = varyColor(0x8d8b86, rand, 0.07);
  const r = 0.55 + rand() * 0.3;
  const parts: THREE.BufferGeometry[] = [
    placed(
      roughen(paint(new THREE.IcosahedronGeometry(r, 0), stone), r * 0.26, rand),
      0,
      r * 0.62,
      0,
      { rotY: rand() * Math.PI, scaleY: 0.78 },
    ),
  ];
  // A couple of smaller boulders alongside give the cluster a real silhouette.
  const extras = 1 + Math.floor(rand() * 2);
  for (let i = 0; i < extras; i++) {
    const rr = r * (0.35 + rand() * 0.3);
    const a = rand() * Math.PI * 2;
    const d = r * (0.85 + rand() * 0.5);
    parts.push(
      placed(
        roughen(paint(new THREE.IcosahedronGeometry(rr, 0), varyColor(stone, rand, 0.06)), rr * 0.3, rand),
        Math.cos(a) * d,
        rr * 0.55,
        Math.sin(a) * d,
        { rotY: rand() * Math.PI, scaleY: 0.8 },
      ),
    );
  }
  return merge(parts);
}

function buildBerryBushGeometry(rand: () => number): THREE.BufferGeometry {
  const leaf = varyColor(0x3f6f36, rand, 0.09);
  const parts: THREE.BufferGeometry[] = [];
  const blobs = 3;
  for (let i = 0; i < blobs; i++) {
    const r = 0.36 + rand() * 0.16;
    const a = (i / blobs) * Math.PI * 2 + rand() * 0.6;
    parts.push(
      placed(
        roughen(paint(new THREE.IcosahedronGeometry(r, 0), leaf), r * 0.18, rand),
        Math.cos(a) * 0.22,
        0.3 + rand() * 0.16,
        Math.sin(a) * 0.22,
        { rotY: rand() * Math.PI, scaleY: 0.82 },
      ),
    );
  }
  // Berries read at a distance only as small saturated specks; a handful is
  // enough to identify the bush without turning it into a fruit salad.
  for (let i = 0; i < 6; i++) {
    const a = rand() * Math.PI * 2;
    const d = 0.28 + rand() * 0.22;
    parts.push(
      placed(
        paint(new THREE.IcosahedronGeometry(0.075, 0), 0xa8264c),
        Math.cos(a) * d,
        0.34 + rand() * 0.34,
        Math.sin(a) * d,
      ),
    );
  }
  return merge(parts);
}

function buildClayPitGeometry(rand: () => number): THREE.BufferGeometry {
  const clay = varyColor(0x9c6642, rand, 0.07);
  const wet = varyColor(0x6f4530, rand, 0.05);
  const parts: THREE.BufferGeometry[] = [
    // Sunken floor plus a raised rim, so the pit reads as dug out of the
    // ground rather than as a disc laid on top of it.
    placed(paint(new THREE.CylinderGeometry(0.62, 0.5, 0.12, 10), wet), 0, 0.06, 0),
    placed(paint(new THREE.TorusGeometry(0.72, 0.17, 5, 12), clay), 0, 0.12, 0, {
      rotX: Math.PI / 2,
      scaleY: 1,
    }),
  ];
  const lumps = 2 + Math.floor(rand() * 3);
  for (let i = 0; i < lumps; i++) {
    const a = rand() * Math.PI * 2;
    const d = 0.75 + rand() * 0.35;
    const r = 0.12 + rand() * 0.12;
    parts.push(
      placed(
        roughen(paint(new THREE.IcosahedronGeometry(r, 0), clay), r * 0.3, rand),
        Math.cos(a) * d,
        r * 0.7,
        Math.sin(a) * d,
        { rotY: rand() * Math.PI, scaleY: 0.75 },
      ),
    );
  }
  return merge(parts);
}

function buildIronVeinGeometry(rand: () => number): THREE.BufferGeometry {
  const stone = varyColor(0x5f6066, rand, 0.06);
  const ore = varyColor(0xc87a44, rand, 0.07);
  const r = 0.6 + rand() * 0.22;
  const parts: THREE.BufferGeometry[] = [
    placed(
      roughen(paint(new THREE.IcosahedronGeometry(r, 0), stone), r * 0.28, rand),
      0,
      r * 0.6,
      0,
      { rotY: rand() * Math.PI, scaleY: 0.8 },
    ),
  ];
  // Ore shards angled out of the rock — the readable "there is metal here"
  // signal that a plain grey boulder can't give.
  const shards = 3 + Math.floor(rand() * 3);
  for (let i = 0; i < shards; i++) {
    const a = (i / shards) * Math.PI * 2 + rand() * 0.7;
    const d = r * (0.35 + rand() * 0.4);
    const s = 0.14 + rand() * 0.1;
    parts.push(
      placed(
        paint(new THREE.OctahedronGeometry(s, 0), ore),
        Math.cos(a) * d,
        r * (0.65 + rand() * 0.5),
        Math.sin(a) * d,
        { rotX: (rand() * 2 - 1) * 0.7, rotY: rand() * Math.PI, rotZ: (rand() * 2 - 1) * 0.7, scaleY: 1.9 },
      ),
    );
  }
  return merge(parts);
}

const GEOMETRY_BUILDERS: Record<ResourceNodeKind, (rand: () => number) => THREE.BufferGeometry> = {
  tree: buildTreeGeometry,
  rock: buildRockGeometry,
  berry_bush: buildBerryBushGeometry,
  clay_pit: buildClayPitGeometry,
  iron_vein: buildIronVeinGeometry,
};

// Which pack model stands in for each resource, where the pack has something
// better than the procedural version. Two silhouettes per kind so a forest
// isn't a row of clones.
//
// iron_vein deliberately keeps its procedural geometry: its ore shards are the
// only thing that says "there is metal here", and nothing in the pack carries
// that signal. Using a model that looks like an ordinary rock would cost the
// player information, which is a worse trade than a slightly mixed art style.
const MODEL_CHOICES: Partial<Record<ResourceNodeKind, ModelName[]>> = {
  tree: ["tree", "tree-high"],
  rock: ["rocks-low", "rocks-high"],
  berry_bush: ["plant"],
  clay_pit: ["patch-dirt"],
};

const HIT_PUNCH_MS = 160;
const HIT_PUNCH_SCALE = 1.35;

let nextId = 0;

export class ResourceNode {
  readonly id: string;
  readonly config: ResourceNodeConfig;
  readonly object: THREE.Object3D;
  hitsRemaining: number;
  depleted = false;
  private readonly baseScale: number;
  private depletedAtMs = 0;
  private hitAnimStartMs = -Infinity;

  constructor(
    kind: ResourceNodeKind,
    x: number,
    y: number,
    z: number,
    rand: () => number,
    models: ModelLibrary = {},
  ) {
    this.id = `node-${nextId++}`;
    this.config = RESOURCE_NODE_CONFIGS[kind];

    const choices = MODEL_CHOICES[kind];
    const chosen = choices ? models[choices[Math.floor(rand() * choices.length)]] : undefined;
    if (chosen) {
      this.object = instantiate(chosen);
    } else {
      // No model for this kind, or the file failed to load: the procedural
      // prop the game shipped with still works.
      const mesh = new THREE.Mesh(GEOMETRY_BUILDERS[kind](rand), PROP_MATERIAL);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.object = mesh;
    }
    this.object.position.set(x, y, z);
    this.object.rotation.y = rand() * Math.PI * 2;
    // Per-instance size wobble on top of the per-instance geometry, so even
    // two trees built from the same branch of the builder differ.
    this.baseScale = 0.88 + rand() * 0.3;
    this.object.scale.setScalar(this.baseScale);
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
    const punch =
      elapsed < HIT_PUNCH_MS ? 1 + (1 - elapsed / HIT_PUNCH_MS) * (HIT_PUNCH_SCALE - 1) : 1;
    this.object.scale.setScalar(this.baseScale * punch);
  }
}
