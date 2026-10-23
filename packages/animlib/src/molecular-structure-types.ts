import type { Vec3 } from './types.js';
export type StructureBondOrder = 'single' | 'double' | 'triple' | 'aromatic' | 'unspecified';
export interface ResidueBondTemplate { source:string; version:string; bonds:{a:string;b:string;order:StructureBondOrder}[]; }
export interface StructureImportOptions {
  source:string; accession?:string; chains?:string[];
  /** Host-supplied deposited component dictionaries; no automatic chemical inference. */
  residueTemplates?:Record<string,ResidueBondTemplate>;
  /** Explicit standard C—N peptide template; never enabled implicitly. */
  polymerLinks?:'none'|'standard-peptide';
}
export interface StructureAtom {id:string;residueId:string;serial:number;name:string;element:string;alt:string;occupancy:number;position:Vec3;}
export interface StructureResidue {id:string;chainId:string;authorSequence:number;insertionCode:string;name:string;selectedAlt:string;atomIds:string[];anchorId?:string;segmentId:string;value:number;}
export interface StructureBond {a:string;b:string;order:StructureBondOrder;sources:{kind:'CONECT'|'template'|'peptide-rule';source:string}[];}
export interface MolecularStructure {
  format:'animlib-structure-v1';units:'angstrom';accession?:string;model:string;title:string;
  atoms:StructureAtom[];residues:StructureResidue[];
  segments:{id:string;chainId:string;residueIds:string[]}[];
  breaks:{before:string;reason:'TER'|'chain-change'|'author-gap'|'missing-polymer-atoms'|'polymer-distance'|'unsupported-polymer'}[];
  bonds:StructureBond[];center:Vec3;diagnostics:string[];
  provenance:{source:string;selection:string;alternateLocations:string;polymerLinks:string};
}
