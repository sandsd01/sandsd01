import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

// Subtle: enough to make the sun and a sunset sky glow, not enough to smear
// the crisp edges a low-poly look depends on.
//
// The threshold is in linear HDR, not display range: the pass samples the
// scene before tone mapping, where a sunlit surface already sits well above
// 1.0. Anything near 1 here catches most of the frame and fogs the whole
// image, so it has to sit above the exposure's white point (1 / 0.62).
const BLOOM_STRENGTH = 0.22;
const BLOOM_RADIUS = 0.45;
const BLOOM_THRESHOLD = 1.7;

export function createComposer(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
): EffectComposer {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());

  // A multisampled float target keeps both halves of the deal: MSAA (which the
  // renderer's own `antialias` can't provide once we render through a target,
  // and flat-shaded facets badly need) and HDR headroom for bloom to threshold
  // against before tone mapping.
  const target = new THREE.WebGLRenderTarget(size.x, size.y, {
    type: THREE.HalfFloatType,
    samples: 4,
  });

  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(
    new UnrealBloomPass(new THREE.Vector2(size.x, size.y), BLOOM_STRENGTH, BLOOM_RADIUS, BLOOM_THRESHOLD),
  );
  // Tone mapping and sRGB conversion happen here rather than in each material:
  // rendering through a target leaves the scene linear, which is exactly what
  // bloom wants to sample.
  composer.addPass(new OutputPass());

  window.addEventListener("resize", () => {
    composer.setSize(window.innerWidth, window.innerHeight);
  });

  return composer;
}
