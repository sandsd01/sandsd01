import * as THREE from "three";
import { merge, paint, placed } from "./geometry";

export interface FigurePalette {
  skin: THREE.ColorRepresentation;
  torso: THREE.ColorRepresentation;
  legs: THREE.ColorRepresentation;
  accent: THREE.ColorRepresentation;
}

export interface FigureOpts {
  /** Total height from feet to top of head, in world units. */
  height: number;
  /** Girth multiplier — 1 is an ordinary build, >1 reads as heavy/brutish. */
  build?: number;
  /** Forward lean of the torso and head, in radians. */
  hunch?: number;
  palette: FigurePalette;
}

// One blocky humanoid shared by the player and every enemy. Proportions are
// expressed as fractions of total height so a 1.7-unit player and a 2-unit
// brute stay recognisably the same species of shape.
//
// Built feet-up with its origin at y=0, matching how the game positions
// characters (state stores the feet position), and returned as a single merged
// geometry so a character costs one draw call.
export function buildFigureGeometry(opts: FigureOpts): THREE.BufferGeometry {
  const { height: h, build = 1, hunch = 0, palette } = opts;

  const legH = h * 0.42;
  const torsoH = h * 0.34;
  const headH = h * 0.19;
  const shoulderW = h * 0.3 * build;
  const torsoD = h * 0.17 * build;
  const legW = h * 0.11 * build;
  const armW = h * 0.085 * build;

  const torsoY = legH + torsoH / 2;
  const headY = legH + torsoH + headH / 2;
  // Leaning tips the torso and head forward around the hips, so the lean
  // carries the head with it rather than detaching it from the neck.
  const lean = (y: number) => Math.sin(hunch) * (y - legH);

  const parts: THREE.BufferGeometry[] = [
    // Legs
    placed(paint(new THREE.BoxGeometry(legW, legH, legW * 1.15), palette.legs), -legW * 0.75, legH / 2, 0),
    placed(paint(new THREE.BoxGeometry(legW, legH, legW * 1.15), palette.legs), legW * 0.75, legH / 2, 0),

    // Torso
    placed(
      paint(new THREE.BoxGeometry(shoulderW, torsoH, torsoD), palette.torso),
      0,
      torsoY,
      lean(torsoY),
      { rotX: hunch },
    ),
    // Belt, which also hides the seam where the torso meets the legs.
    placed(
      paint(new THREE.BoxGeometry(shoulderW * 1.04, h * 0.045, torsoD * 1.06), palette.accent),
      0,
      legH + h * 0.02,
      lean(legH + h * 0.02),
    ),

    // Arms
    placed(
      paint(new THREE.BoxGeometry(armW, torsoH * 0.92, armW), palette.torso),
      -(shoulderW / 2 + armW * 0.55),
      torsoY + torsoH * 0.02,
      lean(torsoY),
      { rotX: hunch },
    ),
    placed(
      paint(new THREE.BoxGeometry(armW, torsoH * 0.92, armW), palette.torso),
      shoulderW / 2 + armW * 0.55,
      torsoY + torsoH * 0.02,
      lean(torsoY),
      { rotX: hunch },
    ),
    // Hands, so the arms end in something rather than a cut-off block.
    placed(
      paint(new THREE.BoxGeometry(armW * 1.1, armW * 1.1, armW * 1.1), palette.skin),
      -(shoulderW / 2 + armW * 0.55),
      torsoY - torsoH * 0.5,
      lean(torsoY - torsoH * 0.5),
    ),
    placed(
      paint(new THREE.BoxGeometry(armW * 1.1, armW * 1.1, armW * 1.1), palette.skin),
      shoulderW / 2 + armW * 0.55,
      torsoY - torsoH * 0.5,
      lean(torsoY - torsoH * 0.5),
    ),

    // Head
    placed(paint(new THREE.BoxGeometry(headH * 0.92, headH, headH * 0.9), palette.skin), 0, headY, lean(headY), {
      rotX: hunch,
    }),
  ];

  return merge(parts);
}

// Characters can't share one material the way static props can: enemies tint
// and fade individually (hit flash, death dissolve), which are material-level
// properties.
export function createFigureMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 0.8,
    metalness: 0,
  });
}
