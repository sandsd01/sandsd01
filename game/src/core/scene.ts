import * as THREE from "three";

export interface SceneRig {
  scene: THREE.Scene;
  hemiLight: THREE.HemisphereLight;
  sunLight: THREE.DirectionalLight;
}

// Initial colors/intensities match the day-night cycle's "noon" keyframe
// (see systems/day-night.ts) so the world looks right for a frame before the
// first day-night update runs.
export function createScene(): SceneRig {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9fd0e8);
  scene.fog = new THREE.Fog(0x9fd0e8, 60, 180);

  const hemiLight = new THREE.HemisphereLight(0xffffff, 0x445533, 0.9);
  scene.add(hemiLight);

  const sunLight = new THREE.DirectionalLight(0xfff2d0, 1.1);
  sunLight.position.set(60, 90, 40);
  sunLight.castShadow = false;
  scene.add(sunLight);
  scene.add(sunLight.target);

  return { scene, hemiLight, sunLight };
}
