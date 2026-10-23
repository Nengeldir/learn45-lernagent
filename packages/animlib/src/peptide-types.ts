import type {Vec3} from './types.js';
export interface PeptideComponent {
  atoms:{name:string;position:Vec3}[];
  bonds:[string,string][];
}
/** Original idealized peptide geometry; never a deposited conformation or dynamics model. */
export interface PeptideSpec {
  residues:{id:string;component:string}[];
  components:Record<string,PeptideComponent>;
  /** Explicit schematic geometry in the same units as component templates. */
  peptideLength:number;
  angleCA_C_N:number;
  angleC_N_CA:number;
}
export interface PeptidePose {
  atoms:{id:string;residueId:string;name:string;position:Vec3;value:number}[];
  anchors:{id:string;position:Vec3;value:number}[];
  bonds:[string,string][];
  center:Vec3;
  provenance:{kind:'schematic';description:string};
}
