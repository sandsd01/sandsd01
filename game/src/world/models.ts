import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";

// Kenney's "Mini Forest" pack (CC0 — see public/models/LICENSE.txt). The GLBs
// reference a shared colormap atlas by relative path, which is why they're
// served as static files from public/ with Textures/ alongside rather than
// being bundled.

export type ModelName =
  | "tree"
  | "tree-high"
  | "rocks-low"
  | "rocks-high"
  | "stones"
  | "plant"
  | "patch-dirt"
  | "fence"
  | "building-platform"
  | "building-structure"
  | "character-archer";

// The pack is authored against roughly 1-unit tiles, which is not this world's
// scale (the player stands 1.7 units tall), and "the right size" differs by
// what the prop is: a tree is defined by how tall it is, a floor patch by how
// much of a grid cell it covers. Each model therefore declares which dimension
// to fit and the size to fit it to, and the loader derives the scale factor —
// far more robust than baking in a magic multiplier per file.
interface ModelSpec {
  fit: "height" | "width";
  size: number;
}

const SPECS: Record<ModelName, ModelSpec> = {
  tree: { fit: "height", size: 4.6 },
  "tree-high": { fit: "height", size: 6.4 },
  "rocks-low": { fit: "height", size: 1.1 },
  "rocks-high": { fit: "height", size: 1.9 },
  stones: { fit: "height", size: 0.6 },
  plant: { fit: "height", size: 0.9 },
  "patch-dirt": { fit: "width", size: 0.95 },
  fence: { fit: "width", size: 0.95 },
  "building-platform": { fit: "width", size: 0.95 },
  "building-structure": { fit: "width", size: 0.95 },
  "character-archer": { fit: "height", size: 1.7 },
};

export interface LoadedModel {
  /** Normalised template: origin at the base, centred on x/z. Clone to use. */
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
}

export type ModelLibrary = Partial<Record<ModelName, LoadedModel>>;

// Scales the model to its declared size and moves it so its base sits at y=0
// and it is centred on x/z — which is how everything else in this game places
// objects (terrain height is the floor, positions are feet positions).
function normalise(scene: THREE.Group, spec: ModelSpec): void {
  const box = new THREE.Box3().setFromObject(scene);
  const size = new THREE.Vector3();
  box.getSize(size);

  const extent = spec.fit === "height" ? size.y : Math.max(size.x, size.z);
  if (extent > 0.0001) scene.scale.setScalar(spec.size / extent);

  // Re-measure after scaling rather than scaling the first measurement: a
  // model whose root node carries its own transform would otherwise be offset.
  const scaled = new THREE.Box3().setFromObject(scene);
  const centre = new THREE.Vector3();
  scaled.getCenter(centre);
  scene.position.set(-centre.x, -scaled.min.y, -centre.z);

  scene.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  });
}

// A model that fails to load is not fatal: the caller falls back to the
// procedural geometry the game shipped with, so a missing or corrupt file
// costs some visual polish rather than the whole world.
async function loadOne(
  loader: GLTFLoader,
  name: ModelName,
): Promise<[ModelName, LoadedModel] | null> {
  try {
    const gltf = await loader.loadAsync(`models/${name}.glb`);
    const scene = gltf.scene;
    normalise(scene, SPECS[name]);
    // Wrapping in a parent keeps the normalising transform intact: callers
    // position and rotate the wrapper and never disturb the offsets above.
    const wrapper = new THREE.Group();
    wrapper.add(scene);
    return [name, { scene: wrapper, animations: gltf.animations }];
  } catch (err) {
    console.warn(`Failed to load model "${name}", falling back to procedural geometry:`, err);
    return null;
  }
}

export async function loadModels(): Promise<ModelLibrary> {
  const loader = new GLTFLoader();
  const names = Object.keys(SPECS) as ModelName[];
  const loaded = await Promise.all(names.map((name) => loadOne(loader, name)));

  const library: ModelLibrary = {};
  for (const entry of loaded) {
    if (entry) library[entry[0]] = entry[1];
  }
  return library;
}

// Static props share their geometry and materials across every instance, so a
// plain clone is cheap; three reuses the underlying buffers.
//
// A rigged model cannot use that path. Object3D.clone() copies the SkinnedMesh
// but leaves it pointing at the *original* skeleton, so the copy is driven by
// bones that nothing animates — it renders collapsed or not at all, with no
// error to say why. SkeletonUtils.clone rebuilds the bone hierarchy and rebinds
// the mesh to it.
export function instantiate(model: LoadedModel): THREE.Object3D {
  let skinned = false;
  model.scene.traverse((child) => {
    if ((child as THREE.SkinnedMesh).isSkinnedMesh) skinned = true;
  });
  return skinned ? cloneSkinned(model.scene) : model.scene.clone(true);
}
