import type { ExplanatoryGeometry, SurfaceScalar } from "./explanatory-types.js";
import type { ElementStyle, Material, ProceduralTexture, Vec3 } from "./types.js";

/** A sampled graph in local XYZ coordinates, with Z given by fn(X, Y). */
export interface SurfaceProps extends ElementStyle, ExplanatoryGeometry {
  scalar?: SurfaceScalar;
  texture?: ProceduralTexture;
  material?: Material;
  fn: (x: number, y: number) => number;
  /** Increasing domain endpoints; defaults to [-2, 2]. */
  xRange?: [number, number];
  yRange?: [number, number];
  /** Grid cell counts; each defaults to 32. */
  xSegments?: number;
  ySegments?: number;
  shading?: "unlit" | "flat" | "smooth";
}

/** A grid sampled over an increasing parameter domain. */
export interface ParametricSurfaceProps extends ElementStyle, ExplanatoryGeometry {
  scalar?: SurfaceScalar;
  texture?: ProceduralTexture;
  material?: Material;
  fn: (u: number, v: number) => Vec3;
  /** Increasing domain endpoints; each defaults to [0, 1]. */
  uRange?: [number, number];
  vRange?: [number, number];
  /** Grid cell counts; each defaults to 32. Closed axes require at least 3. */
  uSegments?: number;
  vSegments?: number;
  /** Wrap indices across the seam, without sampling the duplicate endpoint. */
  closedU?: boolean;
  closedV?: boolean;
  shading?: "unlit" | "flat" | "smooth";
}
