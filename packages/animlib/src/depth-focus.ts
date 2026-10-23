import type {CameraFocus} from './types.js';
/** Thin-lens sampling is opt-in. Aperture is a world-space lens radius. */
export type FocusSettings=CameraFocus;
export class FocusBudgetError extends Error { constructor(message:string){super(message);this.name='FocusBudgetError';} }
export function normalizeFocus(value:unknown):Required<FocusSettings>|undefined {
  if(value===undefined)return undefined;
  if(!value||typeof value!=='object')throw new FocusBudgetError('Camera focus must be an object.');
  if(Object.keys(value).some(k=>!['distance','aperture','samples'].includes(k)))throw new FocusBudgetError('Unknown camera focus property.');
  const {distance,aperture,samples=16}=value as FocusSettings;
  if(!Number.isFinite(distance)||distance<.01||distance>1e6)throw new FocusBudgetError('Focus distance must be finite, between 0.01 and 1000000 world units.');
  if(!Number.isFinite(aperture)||aperture<0||aperture>1000)throw new FocusBudgetError('Focus aperture must be finite, between 0 and 1000 world units.');
  if(samples!==8&&samples!==16&&samples!==32)throw new FocusBudgetError('Focus samples must be 8, 16, or 32.');
  return {distance,aperture,samples};
}
/** Antipodal stratified disk points have exactly zero centroid and stable seek results. */
export function apertureSamples(count:8|16|32):[number,number][] {
  const result:[number,number][]=[];
  for(let i=0;i<count/2;i++){const r=Math.sqrt((i+.5)/(count/2)),a=i*Math.PI*(3-Math.sqrt(5));const x=r*Math.cos(a),y=r*Math.sin(a);result.push([x,y],[-x,-y]);}
  return result;
}
export function focusShift(depth:number,distance:number,lens:readonly number[]):[number,number] {
  return [lens[0]*(depth/distance-1),lens[1]*(depth/distance-1)];
}
export function focusPreflight(width:number,height:number,batches:{samples:number;vertices:number;draws?:number;pixels?:number}[]):{bytes:number;samplePixels:number;vertices:number;draws:number} {
  if(!batches.length)return {bytes:0,samplePixels:0,vertices:0,draws:0};
  const pixels=width*height,bytes=pixels*44;
  const samplePixels=batches.reduce((sum,b)=>sum+(b.pixels??pixels)*b.samples,0),vertices=batches.reduce((sum,b)=>sum+b.vertices*b.samples,0);
  const draws=batches.reduce((sum,b)=>sum+(b.draws??0)*b.samples,0);
  if(!Number.isSafeInteger(bytes)||bytes>256*1024*1024)throw new FocusBudgetError('Optical focus surfaces exceed the 256 MiB budget. Reduce output dimensions.');
  if(!Number.isSafeInteger(samplePixels)||samplePixels>64_000_000)throw new FocusBudgetError('Optical focus exceeds 64 million sample-pixels per frame. Reduce quality, dimensions, or focused views.');
  if(!Number.isSafeInteger(vertices)||vertices>32_000_000)throw new FocusBudgetError('Optical focus exceeds 32 million submitted vertices per frame. Reduce geometry density, quality, or focused views.');
  if(!Number.isSafeInteger(draws)||draws>64_000)throw new FocusBudgetError('Optical focus exceeds 64000 scene draw submissions per frame. Reduce groups, quality, or focused views.');
  return {bytes,samplePixels,vertices,draws};
}
