import type {Vec3} from './types.js';
import type {NucleicAnchor,RNABase} from './nucleic-types.js';
export interface ProcessingSite {id:string;base:RNABase;position:Vec3;}
export interface NucleicSpliceProps {
  sites:ProcessingSite[];intron:{start:number;end:number};initialNormal:Vec3;baseReach:number;joinDistance:number;
  departure:{translation:Vec3;axis:Vec3;angle:number};
  phases?:{cut:number;closeEnd:number;departEnd:number};
  /** Bend the initially straight boundary-to-boundary bridge at fixed analytic arc offsets.
   * Exons translate with endpoints. Euclidean chord lengths change while forming. */
  formation?:{start:number;end:number;angle:number;bendDirection:Vec3};
}
export interface NucleicSpliceResult {
  anchors:NucleicAnchor[];bonds:[string,string][];retainedIds:string[];removedIds:string[];
  cutEnds:string[];phase:'intact'|'closing'|'joined';joinDistance:number;
  provenance:{kind:'schematic';description:string};
}
export interface NucleicThreadProps {
  sites:{id:string;base:RNABase;offset:number}[];path:Vec3[];initialNormal:Vec3;baseReach:number;
  aperture:{center:Vec3;normal:Vec3;radius:number;halfThickness:number;chainRadius:number};
}
export interface NucleicThreadResult {
  anchors:NucleicAnchor[];bonds:[string,string][];arcCoordinates:number[];signedSides:number[];pathLength:number;
  provenance:{kind:'schematic';description:string};
}
