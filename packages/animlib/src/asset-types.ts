import type { Bounds3D, ColorValue, ElementStyle, Geometry, Vec2, Vec3 } from './types.js';

export interface AssetGeometryRef { id: string; hash: string; part: string }
export interface AssetImageRef { id: string; hash: string }
export type AssetRef = AssetGeometryRef | AssetImageRef;
export interface ImageTexture {
  image: AssetImageRef;
  alphaMode: 'opaque' | 'blend';
  filter: 'nearest' | 'linear';
  wrap: 'clamp' | 'repeat';
  tint?: ColorValue;
}
export interface PreparedImageInput {
  id: string; kind: 'image'; version: 1; width: number; height: number;
  storage: 'rgba8'; encoding: 'srgb'; origin: 'top-left'; alpha: 'straight';
  colorPolicy: 'source'; pixels: Uint8Array; provenance: AssetProvenance;
}
export interface ImageDescriptor {
  id: string; kind: 'image'; hash: string; width: number; height: number;
}
export type AssetDescriptor = ModelAssetDescriptor | ImageDescriptor;
export interface ResolvedImage extends ImageDescriptor { copyPixels(): Uint8Array<ArrayBuffer> }
export interface ImageProps extends ElementStyle {
  asset: string; width?: number; height?: number;
  alphaMode?: ImageTexture['alphaMode']; filter?: ImageTexture['filter']; wrap?: ImageTexture['wrap']; tint?: ColorValue;
}
export interface AssetProvenance {
  source: string;
  sourceHash: string;
  creator: string;
  license: string;
  preparedAt: string;
  converter: { name: string; version: string; options: Record<string, unknown> };
  selection: string;
  modifications: string[];
  fidelity: string;
}
export interface PreparedModelPart {
  id: string;
  vertices: Vec3[];
  triangles: [number, number, number][];
  normals?: Vec3[];
  uv0?: Vec2[];
  imageTexture?: ImageTexture;
}
export interface PreparedModelInput {
  id: string;
  kind: 'model';
  version: 1;
  /** Explicit physical units, or an explicit source-defined unit declaration. */
  units: string;
  provenance: AssetProvenance;
  parts: PreparedModelPart[];
}
export interface ModelPartDescriptor {
  id: string; vertexCount: number; triangleCount: number; bounds: Bounds3D;
  hasUV0?: boolean;
  imageTexture?: ImageTexture;
}
export interface ModelAssetDescriptor {
  id: string; kind: 'model'; hash: string; bounds: Bounds3D; parts: ModelPartDescriptor[];
}
/** Descriptor-backed mesh model, styled with the ordinary scene mesh controls. */
export interface PreparedModelProps extends ElementStyle {
  source?: 'prepared';
  asset: string;
  shading?: Geometry['shading'];
  material?: Geometry['material'];
  texture?: Geometry['texture'];
  clipPlanes?: Geometry['clipPlanes'];
  outline?: Geometry['outline'];
}
/** Explicit host capability. Resolution never mutates or expands a Frame. */
export interface AssetGeometryResolver { resolve(ref: AssetGeometryRef): Geometry; resolveImage?(ref: AssetImageRef): ResolvedImage }
export interface AssetLease extends AssetGeometryResolver { dispose(): void }
export interface AssetRegistry<D extends AssetDescriptor = AssetDescriptor> {
  readonly catalog: D[];
  acquire(refs: readonly AssetRef[]): AssetLease;
  stats(): { decodedBytes: number; pinnedBytes: number; leases: number; models: number };
}
export interface AssetBlobRef { path: string; hash: string; byteLength: number }
/** Native image package manifest; pixels remain outside descriptors and scenes. */
export interface ImageAssetDescriptor {
  id: string; kind: 'image'; version: 1; hash: string;
  width: number; height: number;
  storage: 'rgba8'; encoding: 'srgb'; origin: 'top-left'; alpha: 'straight';
  colorPolicy: 'source'; pixels: AssetBlobRef; provenance: AssetProvenance;
}
export interface ModelPackage {
  kind: 'model'; version: 1; id: string; hash: string; units: string; provenance: AssetProvenance;
  parts: { id: string; vertexCount: number; triangleCount: number;
    positions: AssetBlobRef; indices: AssetBlobRef; normals?: AssetBlobRef; uv0?: AssetBlobRef; imageTexture?: ImageTexture }[];
}
