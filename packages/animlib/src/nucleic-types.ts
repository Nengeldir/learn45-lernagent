import type {Geometry,PaletteColor,Vec3} from './types.js';
export type DNABase='A'|'C'|'G'|'T';
export type RNABase='A'|'C'|'G'|'U';
export interface NucleicSite {id:string;base:DNABase;}
export interface NucleicDuplexProps {
  axis:Vec3[];template:NucleicSite[];coding:NucleicSite[];pairs:[string,string][];
  templateDirection:'3to5';codingDirection:'5to3';initialNormal:Vec3;
  radius:number;backboneRadius:number;twistPerBase:number;
  window:{start:number;end:number;separation:number};
  radialSegments?:number;samplesPerLink?:number;baseColors?:PaletteColor[];
}
export interface NucleicAnchor {id:string;base:DNABase|RNABase;strand:'template'|'coding'|'rna';shape:'purine'|'pyrimidine';backbone:Vec3;tip:Vec3;tangent:Vec3;normal:Vec3;}
export interface NucleicPart {id:string;role:string;geometry:Geometry;opacity:number;}
export interface NucleicDuplexResult {
  parts:NucleicPart[];anchors:NucleicAnchor[];pairs:{templateId:string;codingId:string;pairedFraction:number}[];
  ends:{template:{fivePrime:string;threePrime:string};coding:{fivePrime:string;threePrime:string}};
  linkLengths:{template:number[];coding:number[]};opening:number;
  provenance:{kind:'schematic';description:string};
}
export interface NucleicTranscriptProps {
  id:string;bases:{id:string;base:RNABase;templateId:string}[];duplex:NucleicDuplexResult;
  start:number;secondsPerBase:number;approachFraction:number;radius:number;incomingOffset?:Vec3;
  /** World-space rotation about the free nucleotide's backbone anchor, easing to zero at incorporation. */
  incomingRotation?:{axis:Vec3;angle:number};
  /** Deliberate post-incorporation exit motion. Absent keeps formed anchors fixed.
   * The entire schedule is preflighted at every call: desired adjacent links must
   * remain nonzero and outside the antipodal frame tolerance. Unsupported folds
   * throw even before motion starts; reduce distance, extend duration, or use an
   * oblique direction. See helpers-and-assets.md for the analytic sufficient bound.
   * Nonterminal frames follow their outgoing links; the terminal base translates
   * with its docked orientation because it has no outgoing link.
   */
  emergence?:{direction:Vec3;distance:number;delay:number;duration:number};
}
export interface NucleicTranscriptResult {
  parts:NucleicPart[];anchors:NucleicAnchor[];incorporated:number;incomingId?:string;
  bonds:[string,string][];linkLengths:number[];ends?:{fivePrime:string;threePrime:string};triplets:[string,string,string][];
  provenance:{kind:'schematic';description:string};
}
