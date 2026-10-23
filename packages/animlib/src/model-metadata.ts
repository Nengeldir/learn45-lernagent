import type { ModelMetadata } from './model-types.js';
import type { Bounds3D } from './types.js';
export function validateModelMetadata(m: ModelMetadata): void {
  const check=(v:unknown,message:string):void=>{if(!v)throw new Error(`Model metadata: ${message}`);};
  const vector=(v:unknown):boolean=>Array.isArray(v)&&v.length===3&&v.every(n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=1e6);
  const bounds=(b:Bounds3D):void=>{check(b&&vector(b.min)&&vector(b.max)&&b.min.every((v,i)=>v<=b.max[i]),'invalid bounds');};
  check(m && m.version===1 && Array.isArray(m.parts)&&m.parts.length>0&&m.parts.length<=256&&Array.isArray(m.primitives)&&m.primitives.length>0&&m.primitives.length<=256,'invalid inventory');
  bounds(m.bounds);for(const p of m.primitives){bounds(p.bounds);check(Number.isInteger(p.triangles)&&p.triangles>0&&p.triangles<=200000,'invalid primitive triangle count');}
  const ids=new Set<string>(),primitives=new Set<number>();
  for(const p of m.parts) {
    check(typeof p.id==='string'&&/^node-\d+$/.test(p.id)&&!ids.has(p.id),'invalid part ID');
    check(p.parent===undefined||ids.has(p.parent),'parent must precede child');ids.add(p.id);
    check(typeof p.name==='string'&&p.name.length<=256&&vector(p.position),'invalid part');
    check(Array.isArray(p.primitives)&&p.primitives.every(i=>Number.isInteger(i)&&i>=0&&i<m.primitives.length&&!primitives.has(i)),'invalid primitives');
    for(const i of p.primitives)primitives.add(i);
  }
  check(primitives.size===m.primitives.length,'unassigned primitives');
  check(Number.isInteger(m.triangles)&&m.triangles>0&&m.triangles<=200000&&m.triangles===m.primitives.reduce((sum,p)=>sum+p.triangles,0),'invalid triangle count');
  check(Array.isArray(m.materials)&&m.materials.length<=256&&m.materials.every(n=>typeof n==='string'&&n.length<=256),'invalid materials');
}
