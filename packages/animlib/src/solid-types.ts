import type { ExplanatoryGeometry } from "./explanatory-types.js";
import type { ElementStyle, Material, ProceduralTexture, Vec3 } from './types.js';

interface SolidStyle extends ElementStyle, ExplanatoryGeometry {
  texture?: ProceduralTexture;
  material?: Material;
  /** Smooth lighting by default; boxes default to flat lighting. */
  shading?: 'unlit' | 'flat' | 'smooth';
}

export interface BoxProps extends SolidStyle {
  width?: number;
  height?: number;
  depth?: number;
}

export interface CylinderProps extends SolidStyle {
  radius?: number;
  height?: number;
  radialSegments?: number;
  capped?: boolean;
}

export interface ConeProps extends CylinderProps {}

export interface TorusProps extends SolidStyle {
  /** Distance from the origin to the center of the tube. */
  radius?: number;
  tubeRadius?: number;
  /** Segments around the major ring (default 32). */
  radialSegments?: number;
  /** Segments around each tube cross-section (default 12). */
  tubularSegments?: number;
}

export interface TubeProps extends SolidStyle {
  /** Polyline centerline. Consecutive duplicates are ignored; U-turns are rejected. */
  points: Vec3[];
  radius?: number;
  radialSegments?: number;
  /** Cap open endpoints (default true). Ignored for closed tubes. */
  capped?: boolean;
  closed?: boolean;
}
