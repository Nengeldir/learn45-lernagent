import type {NucleicAnchor,DNABase,RNABase} from './nucleic-types.js';
import type {Vec3} from './types.js';

/** Original schematic elongation on a straight DNA axis. All time is absolute. */
export interface NucleicTranscriptionCycleProps {
  template:{id:string;base:DNABase}[];
  coding:{id:string;base:DNABase}[];
  pairs:[string,string][];
  transcript:{id:string;base:RNABase;templateId:string}[];
  templateDirection:'3to5';codingDirection:'5to3';
  axis:{origin:Vec3;direction:Vec3;normal:Vec3};
  radius:number;pitch:number;twistPerBase:number;baseReach:number;
  window:{halfWidth:number;separation:number;lockOrientation?:boolean};
  start:number;cycleDuration:number;dockFraction:number;
  /** Optional initial opening; otherwise the first active window starts open. */
  opening?:{start:number;duration:number};
  /** Components in exitFrame: axis tangent, baseward normal, and cross product. */
  exitDirection:Vec3;
  /** Default active frame; axis uses the fixed declared anatomical basis. */
  exitFrame?:'active'|'axis';
  /** Circular exit radians per link, axis frame only; total turn <= pi/2. */
  exitBend?:number;
  rnaLinkLength:number;
  incomingOffset?:Vec3;
  incomingAngle?:number;
}
export interface NucleicTranscriptionCycleResult {
  dna:{anchors:NucleicAnchor[];pairs:{templateId:string;codingId:string;opening:number}[];bonds:[string,string][];linkLength:number};
  rna:{anchors:NucleicAnchor[];bonds:[string,string][];visibleIds:string[];incorporated:number;incomingId?:string;linkLength:number};
  activeSite:{position:Vec3;templatePosition:Vec3;tangent:Vec3;normal:Vec3;binormal:Vec3;register:number;templateIds:[string,string]};
  progress:number;complete:boolean;
  provenance:{kind:'schematic';description:string};
}
