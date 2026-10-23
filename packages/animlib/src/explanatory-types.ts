import type { ColorValue, PaletteColor, Vec3 } from './types.js';

/** Keep dot(normal, localPosition) <= offset. Normal need not be unit length. */
export interface ClipPlane {
  normal: Vec3;
  offset: number;
  /** Visible triangle/plane intersection. Omitted means clipping only. */
  section?: { color: ColorValue; width?: number; cap?: ColorValue };
}
export interface MeshOutline {
  color: ColorValue;
  /** Local world units, default 0.025. */
  width?: number;
  /** Face-normal angle in radians, default PI/6; PI disables creases. */
  creaseAngle?: number;
  /** Camera-dependent silhouette edges; default true. Boundaries always show. */
  silhouette?: boolean;
}
export interface ScalarRamp {
  domain: [number, number];
  /** 2–16 uniformly spaced named palette stops. */
  colors: PaletteColor[];
}
export interface ScalarColors extends ScalarRamp { values: number[]; }
export interface SurfaceScalar extends ScalarRamp {
  /** Sampled with each valid local position, including after control rebuilds. */
  fn: (x: number, y: number, z: number) => number;
}
export interface ExplanatoryGeometry {
  /** Up to four local half-spaces, applied in order. Meshes and spheres only. */
  clipPlanes?: ClipPlane[];
  outline?: MeshOutline;
}
