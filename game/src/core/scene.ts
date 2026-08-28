import * as THREE from "three";
import { Sky } from "three/examples/jsm/objects/Sky.js";

// How far the shadow-casting sun sits from the player, and how wide an area
// its orthographic shadow camera covers. The sun is repositioned relative to
// the player every frame (see updateSunTarget) so the shadow map stays spent
// on what's actually on screen rather than the whole 200-unit world.
const SUN_DISTANCE = 70;
const SHADOW_EXTENT = 42;

export interface SceneRig {
  scene: THREE.Scene;
  hemiLight: THREE.HemisphereLight;
  sunLight: THREE.DirectionalLight;
  sky: Sky;
}

// Initial colors/intensities match the day-night cycle's "noon" keyframe
// (see systems/day-night.ts) so the world looks right for a frame before the
// first day-night update runs.
export function createScene(): SceneRig {
  const scene = new THREE.Scene();
  // Fog colour is re-tinted each frame to match the sky's horizon, which is
  // what keeps the terrain's far edge from ending in a hard line against the
  // sky dome (see DayNightSystem.update).
  scene.fog = new THREE.Fog(0x9fd0e8, 95, 250);

  // Sky is a shader dome (three's atmospheric scattering addon) rather than a
  // flat background colour, so dawn/dusk get a real gradient and a sun disc.
  // Scaled to sit inside the camera's 500-unit far plane.
  const sky = new Sky();
  sky.scale.setScalar(450);
  const u = sky.material.uniforms;
  u.turbidity.value = 2;
  u.rayleigh.value = 2.6;
  // Mie scattering is the white haze around the sun. The shader's default
  // (0.005) hazes the whole lower sky to near-white at this exposure; dialling
  // it back keeps the glow local to the sun and lets Rayleigh blue come
  // through.
  u.mieCoefficient.value = 0.0022;
  u.mieDirectionalG.value = 0.86;
  scene.add(sky);

  const hemiLight = new THREE.HemisphereLight(0xbfd8ff, 0x4a5a33, 1.1);
  scene.add(hemiLight);

  const sunLight = new THREE.DirectionalLight(0xfff2d0, 2.2);
  sunLight.position.set(60, 90, 40);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.camera.near = 1;
  sunLight.shadow.camera.far = SUN_DISTANCE * 2.2;
  sunLight.shadow.camera.left = -SHADOW_EXTENT;
  sunLight.shadow.camera.right = SHADOW_EXTENT;
  sunLight.shadow.camera.top = SHADOW_EXTENT;
  sunLight.shadow.camera.bottom = -SHADOW_EXTENT;
  // three re-aims the shadow camera every frame but never rebuilds its
  // projection, so without this the frustum stays at the default 10x10 units
  // and only a small patch around the player is ever shadowed.
  sunLight.shadow.camera.updateProjectionMatrix();
  // Normal bias handles the sloped terrain far better than a flat bias, which
  // otherwise leaves shadow acne on the hills or peter-panning on flat ground.
  sunLight.shadow.bias = -0.0005;
  sunLight.shadow.normalBias = 0.05;
  scene.add(sunLight);
  scene.add(sunLight.target);

  return { scene, hemiLight, sunLight, sky };
}

// Keeps the sun (and therefore its shadow frustum) centred on the player while
// preserving the direction the day-night cycle chose. Called once per frame.
export function updateSunTarget(
  rig: SceneRig,
  sunDirection: THREE.Vector3,
  focus: THREE.Vector3,
): void {
  rig.sunLight.target.position.copy(focus);
  rig.sunLight.target.updateMatrixWorld();
  rig.sunLight.position.copy(focus).addScaledVector(sunDirection, SUN_DISTANCE);
}
