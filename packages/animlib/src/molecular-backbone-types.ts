import type { ElementStyle, Geometry, Material, PaletteColor, Vec3 } from './types.js';

export interface MolecularResidueAnchor { id: string; position: Vec3; /** Normalized sequence-palette coordinate. */ value: number; }
/** Each segment declares uninterrupted ordered adjacency; no edges join segments implicitly. */
export interface MolecularSegment { id: string; chainId: string; residues: MolecularResidueAnchor[]; }
export interface MolecularBackboneProvenance { kind: 'schematic' | 'scientific'; source: string; units: string; }
export interface MolecularBackboneProps extends Omit<ElementStyle, 'billboard' | 'billboardOffset'> {
  segments: MolecularSegment[];
  /** Only these edges are drawn in sticks mode; no chemical bond inference. */
  bonds: [string, string][];
  representation: 'sticks' | 'beads' | 'backbone';
  radius: number;
  provenance: MolecularBackboneProvenance;
  origin?: Vec3;
  radialSegments?: number;
  samplesPerLink?: number;
  /** Sphere subdivision level for beads only; default 1. Higher detail uses the same mesh and aggregate budgets. */
  beadDetail?: 0 | 1 | 2 | 3;
  /** Projected frame seed. Sticks require sine of separation from every bond >= 1e-7 throughout motion; choose a different seed near a pole. Backbone also rejects parallel seeds. */
  initialNormal?: Vec3;
  colors?: PaletteColor[];
  maxMeshes?: number;
  material?: Material;
}
export interface MolecularBackboneResult {
  meshes: Geometry[];
  anchors: (MolecularResidueAnchor & { segmentId: string; chainId: string })[];
  segments: { id: string; residueIds: string[] }[];
  bonds: [string,string][];
  vertexResidueIds: string[][];
  provenance: MolecularBackboneProvenance;
}
/** Schematic serial-chain kinematics. No collision avoidance or energetic model. */
export interface ArticulatedChainSpec {
  lengths: number[];
  /** Per-link [bend, twist] in radians; twist then bend in the transported local frame. */
  from: [number, number][];
  to: [number, number][];
  start: number;
  duration: number;
  origin?: Vec3;
  direction?: Vec3;
  normal?: Vec3;
}
