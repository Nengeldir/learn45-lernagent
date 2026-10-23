import type { PreparedModelProps } from './asset-types.js';
import type { AnimationAction, ColorValue, Bounds3D, ElementHandle, ElementStyle, Vec3 } from './types.js';

/** Serializable inventory. Mesh/image bytes never enter the scene VM. */
export interface ModelMetadata {
  version: 1;
  parts: { id: string; name: string; parent?: string; position: Vec3; primitives: number[] }[];
  primitives: { bounds: Bounds3D; triangles: number }[];
  bounds: Bounds3D;
  triangles: number;
  materials: string[];
}
export interface ModelAsset {
  kind: 'model';
  url: string;
  /** SHA-256 of the immutable GLB; verified by the browser when supplied. */
  sha256?: string;
  metadata: ModelMetadata;
}
/** Imported GLB model with its authored hierarchy and materials. */
export interface GLBModelProps extends Pick<ElementStyle, "position" | "rotation" | "scale" | "opacity" | "castShadow"> { asset: string; source?: 'glb'; tint?: ColorValue }
/** Omit source for a unique inventory ID; select it explicitly when both inventories contain the ID. */
export type ModelProps = PreparedModelProps | GLBModelProps;
export interface ModelPartHandle extends ElementHandle {
  /** Set prepared mesh fill, or multiply imported GLB colors (WHITE restores GLB colors). */
  tintTo(color: ColorValue): AnimationAction;
}
export interface ModelHandle extends ModelPartHandle {
  /** Prepared part ID, or a GLB node ID / unambiguous node name. */
  part(id: string): ModelPartHandle;
}
export interface ModelReference { asset: string; primitive: number; bounds: Bounds3D }
