// From Claw3D's src/features/retro-office/core/geometry.ts (MIT, see ./LICENSE).
import { CANVAS_H, CANVAS_W, SCALE } from "./constants";

/** Claw3D canvas units -> three.js world coordinates. */
export const toWorld = (cx: number, cy: number): [number, number, number] => [
  cx * SCALE - CANVAS_W * SCALE * 0.5,
  0,
  cy * SCALE - CANVAS_H * SCALE * 0.5,
];

export const toCanvas = (wx: number, wz: number): [number, number] => [
  (wx + CANVAS_W * SCALE * 0.5) / SCALE,
  (wz + CANVAS_H * SCALE * 0.5) / SCALE,
];
