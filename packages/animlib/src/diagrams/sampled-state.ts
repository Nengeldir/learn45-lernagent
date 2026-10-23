import type { Vec3 } from '../types.js';
import type { SampledState, SampledStateOptions } from './sampled-state-types.js';

/** Pure, self-contained factory installed verbatim in the scene VM. */
export function createSampledState(options:SampledStateOptions):SampledState {
  const finite=(n:number)=>{if(!Number.isFinite(n)||Math.abs(n)>1e6)throw new Error('Sampled state numbers must be finite with magnitude <= 1,000,000');return n;};
  if(!options||!Array.isArray(options.times)||!Array.isArray(options.values)||options.times.length<1||options.times.length>20000||options.times.length!==options.values.length)throw new Error('Sampled state requires 1–20000 aligned samples');
  const times=Array.from(options.times,finite);
  if(times.some((n,i)=>i>0&&n<=times[i-1]))throw new Error('Sample times must strictly increase');
  const first=options.values.find(v=>v!==null);
  if(!Array.isArray(first)||first.length<1||first.length>64||times.length*first.length>20000)throw new Error('Sampled state requires 1–64 components and at most 20000 component slots');
  const dimension=first.length;
  const vector=(v:readonly number[])=>{if(!Array.isArray(v)||v.length!==dimension)throw new Error('Sample dimension mismatch');return Array.from(v,finite);};
  const values=Array.from(options.values,v=>v===null?null:vector(v));
  if(!Array.isArray(options.projection)||options.projection.length!==3)throw new Error('Projection must have three rows');
  const matrix=Array.from(options.projection,vector);
  const project=(v:number[]):Vec3=>matrix.map(row=>finite(row.reduce((sum,c,i)=>sum+c*v[i],0))) as Vec3;
  // Validate projected endpoints eagerly, before consumers author geometry.
  const positions=values.map(v=>v===null?null:project(v));
  const runs:{first:number;last:number}[]=[];
  for(let i=0;i<values.length;i++)if(values[i]!==null){const first=i;while(i+1<values.length&&values[i+1]!==null)i++;runs.push({first,last:i});}
  const at=(time:number)=>{
    finite(time);if(time<times[0]||time>times[times.length-1])return null;
    let low=0,high=times.length-1;
    while(low<high){const mid=Math.ceil((low+high)/2);if(times[mid]<=time)low=mid;else high=mid-1;}
    const a=values[low];if(a===null)return null;
    if(times[low]===time)return {values:[...a],position:[...positions[low]!] as Vec3};
    const b=values[low+1];if(!b)return null;
    const u=(time-times[low])/(times[low+1]-times[low]),v=a.map((n,i)=>n+(b[i]-n)*u);
    return {values:v,position:project(v)};
  };
  return {
    segments:Object.freeze(runs.map(r=>Object.freeze({start:times[r.first],end:times[r.last],count:Math.max(2,r.last-r.first+1)}))),
    at,
    prefix:(segment,time)=>{
      finite(time);if(!Number.isInteger(segment)||segment<0||segment>=runs.length)throw new Error('Unknown trajectory segment');
      const r=runs[segment],t=Math.max(times[r.first],Math.min(times[r.last],time)),endpoint=at(t)!.position;
      const points=Array.from({length:Math.max(2,r.last-r.first+1)},(_,j)=>{
        const i=Math.min(r.last,r.first+j);return [...(times[i]<=t?positions[i]!:endpoint)] as Vec3;
      });
      return points;
    },
  };
}
