import type {AnimationAction,ElementHandle,ElementStyle,Vec2} from '../types.js';
export interface GraphNode {readonly id:string;readonly position:readonly [number,number];readonly label?:string;}
export interface GraphEdge {readonly id:string;readonly from:string;readonly to:string;readonly weight:number;}
export interface GraphData {readonly directed?:boolean;readonly nodes:readonly GraphNode[];readonly edges:readonly GraphEdge[];}
export interface FrontierCandidate {readonly node:string;readonly cost:number;readonly predecessor?:string;readonly edge?:string;}
export interface SearchEvent {readonly type:'pop'|'relax'|'stale'|'frontier';readonly node:string;readonly cost:number;readonly predecessor?:string;readonly edge?:string;readonly accepted?:boolean;readonly frontier:readonly FrontierCandidate[];}
export interface SearchTrace {readonly distances:Readonly<Record<string,number>>;readonly predecessors:Readonly<Record<string,{node:string;edge:string}|null>>;readonly events:readonly SearchEvent[];}
export type GraphState='neutral'|'source'|'goal'|'frontier'|'active'|'settled';
export interface GraphOptions {radius?:number;nodeStyle?:ElementStyle;edgeStyle?:ElementStyle;fontSize?:number;weightOffset?:Vec2;costOffset?:Vec2;
  /** Native cost precision: 0–4 decimals, 1–6 integer digits. Defaults to edge precision (capped at 4) and 6 digits; finer values are rounded. */
  costFormat?: {decimals?:number;digits?:number};
}
export interface GraphDiagram {readonly data:GraphData;readonly nodes:ReadonlyMap<string,ElementHandle>;readonly edges:ReadonlyMap<string,ElementHandle>;readonly labels:ReadonlyMap<string,ElementHandle>;readonly weights:ReadonlyMap<string,ElementHandle>;readonly costs:ReadonlyMap<string,ElementHandle>;readonly states:ReadonlyMap<string,GraphState>;state(node:string,state:GraphState,style?:ElementStyle):AnimationAction;}
