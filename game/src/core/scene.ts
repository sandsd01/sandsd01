import * as THREE from "three";

export function createScene(): THREE.Scene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9fd0e8);
  scene.fog = new THREE.Fog(0x9fd0e8, 60, 180);

  const hemi = new THREE.HemisphereLight(0xffffff, 0x445533, 0.9);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff2d0, 1.1);
  sun.position.set(60, 90, 40);
  sun.castShadow = false;
  scene.add(sun);
  scene.add(sun.target);

  return scene;
}
