import type {Vec3} from './types.js';
import type {NucleicAnchor,RNABase} from './nucleic-types.js';
/** Original kinematic translation diagram, not molecular dynamics. */
export interface NucleicTranslationProps {
 sites:{id:string;base:RNABase}[];
 direction:'5to3';anticodonDirection:'3to5';
 /** One per sense codon; anticodon is written antiparallel to the input codon. */
 carriers:{id:string;anticodon:string;residueId:string;aminoAcid:string}[];
 origin:Vec3;axis:Vec3;normal:Vec3;
 pitch:number;carrierHeight:number;peptideSpacing:number;
 /** Optional original schematic helix. Adjacent residue chords remain peptideSpacing. */
 productCoil?:{radius:number;twist:number};
 arrivalOffset:Vec3;exitOffset:Vec3;subunitSeparation:number;
 assembly:{start:number;duration:number};start:number;cycleDuration:number;
 releaseDuration:number;disassemblyDuration:number;
}
export interface NucleicTranslationResult {
 rna:{anchors:NucleicAnchor[];bonds:[string,string][];register:number};
 codons:{index:number;ids:[string,string,string];sequence:string;aminoAcid:string|null}[];
 sites:{A:Vec3;P:Vec3;E:Vec3};
 carriers:{id:string;anticodon:string;position:Vec3;anticodonPosition:Vec3;payloadPosition:Vec3;tangent:Vec3;normal:Vec3;phase:'waiting'|'arriving'|'docked'|'translocating'|'exiting'|'spent';visible:boolean;loaded:boolean}[];
 product:{residues:{id:string;aminoAcid:string;position:Vec3;visible:boolean;incorporated:boolean}[];bonds:[string,string][];attachedCarrierId?:string;transfer?:{fromCarrierId:string;toCarrierId:string;progress:number};released:boolean};
 subunits:{id:'large'|'small';position:Vec3}[];
 stopRecognized:boolean;complete:boolean;
 provenance:{kind:'schematic';description:string};
}
