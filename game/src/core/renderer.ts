import * as THREE from "three";

export function createRenderer(canvas: HTMLCanvasElement): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  // The sky dome outputs real (unbounded) radiance, so the image needs tone
  // mapping to land in display range — without it the sky blows out to white
  // and the ground crushes to mud. ACES also gives the warm rolloff that makes
  // dawn/dusk read as sunlight rather than an orange wash.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.62;

  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  // The main loop resets these itself, once per frame, so the counters cover
  // every pass the composer runs rather than just the last one.
  renderer.info.autoReset = false;

  window.addEventListener("resize", () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  return renderer;
}
