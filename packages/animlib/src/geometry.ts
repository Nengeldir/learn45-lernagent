import type { CameraState, Geometry, Position, Vec3 } from './types.js';
import { GeometryCache } from './cache.js';
import { morphPathContours, pathContours } from './path.js';

export const vec3 = (p: Position): Vec3 => [p[0], p[1], p[2] ?? 0];
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export function rotate(point: Vec3, rotation: Vec3): Vec3 {
  let [x, y, z] = point;
  let c = Math.cos(rotation[0]), s = Math.sin(rotation[0]);
  [y, z] = [y*c-z*s, y*s+z*c];
  c = Math.cos(rotation[1]); s = Math.sin(rotation[1]);
  [x, z] = [x*c+z*s, -x*s+z*c];
  c = Math.cos(rotation[2]); s = Math.sin(rotation[2]);
  return [x*c-y*s, x*s+y*c, z];
}
export interface Projection { x: number; y: number; depth: number; visible: boolean; scale: number }
export function project(point: Vec3, camera: CameraState, width: number, height: number): Projection {
  const delta: Vec3 = point.map((v, i) => v-camera.target[i]) as Vec3;
  // Undo world-up yaw before camera-local pitch to keep the horizon upright.
  const [x,y,z] = rotate(rotate(delta, [0, -camera.yaw, 0]), [-camera.pitch, 0, 0]);
  const depth = camera.distance-z;
  const perspective = Math.min(1, Math.max(0, camera.perspective));
  const divisor = (1-perspective) + perspective * depth / camera.distance;
  // Match the shaders throughout the visible depth range. Clamping a positive
  // divisor shrinks near-camera geometry and sends anchor rays to the wrong pixel.
  const scale = height/camera.height / (divisor > 0 ? divisor : 0.01);
  return { x: width/2+x*scale, y: height/2-y*scale, depth, visible: depth > 0.01 && depth < camera.distance*100 && divisor > 0, scale };
}
export function outline(geometry: Geometry, tolerance = 0.002): { points: Vec3[]; closed: boolean } | null {
  switch (geometry.kind) {
    case 'circle': return { points: Array.from({ length: 96 }, (_, i) => { const a=i*Math.PI/48; return [Math.cos(a)*(geometry.radius ?? 1),Math.sin(a)*(geometry.radius ?? 1),0]; }), closed: true };
    case 'rectangle': { const w=(geometry.width ?? 2)/2,h=(geometry.height ?? 1)/2; return { points: [[-w,-h,0],[w,-h,0],[w,h,0],[-w,h,0]], closed: true }; }
    case 'path': {
      if (geometry.d !== undefined || geometry.curve === 'smooth') {
        const contours = pathContours(geometry, tolerance);
        return contours.length === 1 ? contours[0] : null;
      }
      return { points: (geometry.points ?? []).map(vec3), closed: !!geometry.closed };
    }
    case 'line': case 'arrow': return { points: (geometry.points ?? []).map(vec3), closed: false };
    default: return null;
  }
}
export function resample(points: Vec3[], count: number, closed: boolean): Vec3[] {
  if (!points.length) return [];
  if (points.length === 1) return Array.from({length: count}, () => [...points[0]] as Vec3);
  const path = closed ? [...points, points[0]] : points;
  const lengths=[0];
  for (let i=1;i<path.length;i++) lengths.push(lengths[i-1]+Math.hypot(...path[i].map((v,j)=>v-path[i-1][j])));
  const total=lengths.at(-1)!;
  if (!total) return Array.from({length: count},()=>[...points[0]] as Vec3);
  let segment=1;
  return Array.from({length: count},(_,i)=> {
    const distance=total*i/(closed ? count : Math.max(1,count-1));
    while(segment<lengths.length-1 && lengths[segment]<distance) segment++;
    const t=(distance-lengths[segment-1])/(lengths[segment]-lengths[segment-1] || 1);
    return path[segment-1].map((v,j)=>lerp(v,path[segment][j],t)) as Vec3;
  });
}
function error(a: Vec3[], b: Vec3[], offset=0): number { return a.reduce((sum,p,i)=>sum+p.reduce((v,x,j)=>v+(x-b[(i+offset)%b.length][j])**2,0),0); }
const matches = new GeometryCache<[Vec3[], Vec3[]]>();

function parameterize(points: Vec3[], closed: boolean) {
  const path = points.filter((p,i) => !i || p.some((v,j) => v !== points[i-1][j]));
  if (closed && path.length > 1 && path[0].every((v,i) => v === path.at(-1)![i])) path.pop();
  if (closed && path.length) path.push(path[0]);
  const distances = [0];
  for (let i=1;i<path.length;i++) distances.push(distances[i-1]+Math.hypot(...path[i].map((v,j)=>v-path[i-1][j])));
  const total = distances.at(-1)!;
  const knots = distances.map(d => total ? d/total : 0);
  const at = (t: number): Vec3 => {
    if (closed) t = ((t % 1) + 1) % 1;
    if (!total || t <= 0) return [...path[0]];
    if (t >= 1) return [...path.at(-1)!];
    let low=0,high=knots.length-1;
    while (low+1<high) { const middle=(low+high)>>>1;if(knots[middle]<t)low=middle;else high=middle; }
    // Return authored vertices exactly, including when cyclic alignment adds rounding error.
    if (Math.abs(t-knots[low])<1e-12) return [...path[low]];
    if (Math.abs(t-knots[high])<1e-12) return [...path[high]];
    const fraction=(t-knots[low])/(knots[high]-knots[low]);
    return path[low].map((v,i)=>lerp(v,path[high][i],fraction)) as Vec3;
  };
  return { knots, at };
}

/** Match outlines without removing either endpoint's authored corners. */
export function matchPoints(from: Vec3[], to: Vec3[], closed: boolean, count=96): [Vec3[],Vec3[]] {
  if (!from.length || !to.length) return [from,to];
  const key=JSON.stringify([from,to,closed,count]),cached=matches.get(key);
  if (cached) return cached;
  const save=(a:Vec3[],b:Vec3[]):[Vec3[],Vec3[]]=>matches.set(key,[a,b],(a.length+b.length)*64);
  if (from.length===to.length && from.every((p,i)=>p.every((v,j)=>v===to[i][j]))) {
    return save(from.map(p=>[...p]),to.map(p=>[...p]));
  }
  // Matching vertex counts can retain the original topology. This also avoids
  // subdividing a two-point round arrow into dozens of redundant tube rings.
  if (from.length===to.length && from.length<=count) {
    let best=to,score=error(from,to);
    for (const candidate of [to,[...to].reverse()]) for(let offset=0;offset<(closed?to.length:1);offset++) {
      const candidateScore=error(from,candidate,offset);
      if(candidateScore<score){score=candidateScore;best=candidate.map((_,i)=>candidate[(i+offset)%candidate.length]);}
    }
    return save(from.map(p=>[...p]),best.map(p=>[...p]));
  }
  const a=resample(from,count,closed), b=resample(to,count,closed);
  let score=error(a,b),shift=0,direction=1;
  for (const candidate of [b,[...b].reverse()]) {
    for(let offset=0;offset<(closed ? count : 1);offset++) {
      const candidateScore=error(a,candidate,offset);
      if(candidateScore<score) {
        score=candidateScore;direction=candidate===b?1:-1;
        shift=direction===1?offset/count:(closed?(count-1-offset)/count:1);
      }
    }
  }
  const source=parameterize(from,closed),target=parameterize(to,closed);
  const wrap=(t:number)=>closed?((t%1)+1)%1:Math.max(0,Math.min(1,t));
  // Sample the union of both outlines' corners as well as the alignment samples.
  // Added samples subdivide edges; they never cut across an existing corner.
  const knots=[...source.knots,...target.knots.map(t=>wrap((t-shift)*direction)),
    ...Array.from({length:count},(_,i)=>i/(closed?count:count-1))]
    .map(wrap).sort((x,y)=>x-y).filter((t,i,all)=>!i||t-all[i-1]>1e-12);
  return save(knots.map(t=>source.at(t)),knots.map(t=>target.at(wrap(shift+direction*t))));
}
export function morphOutline(from: Geometry,to: Geometry,progress:number,tolerance=0.002): { points: Vec3[]; closed:boolean } | null {
  const curves=morphPathContours(from,to,progress,tolerance);
  if(curves)return curves.length===1?curves[0]:null;
  const a=outline(from,tolerance),b=outline(to,tolerance);
  if(!a||!b||a.closed!==b.closed||!a.points.length||!b.points.length) return null;
  const [start,end]=matchPoints(a.points,b.points,a.closed);
  return {points:start.map((p,i)=>p.map((v,j)=>lerp(v,end[i][j],progress)) as Vec3),closed:a.closed};
}

/** Shared miter vertices keep neighboring stroke segments watertight without alpha overlap. */
export function strokeTriangles(points:Vec3[],width:number,closed:boolean):Vec3[] {
  points=points.filter((p,i)=>!i||Math.hypot(...p.map((v,j)=>v-points[i-1][j]))>1e-10);
  if(closed&&points.length>1&&Math.hypot(...points[0].map((v,i)=>v-points.at(-1)![i]))<1e-10)points=points.slice(0,-1);
  if(points.length<2||width<=0)return [];
  const half=width/2;
  const side=(a:Vec3,b:Vec3):Vec3=>{const x=b[0]-a[0],y=b[1]-a[1],length=Math.hypot(x,y);return length>1e-10?[-y/length,x/length,0]:[1,0,0];};
  const edges=points.map((point,i)=> {
    const before=side(points[(i+points.length-1)%points.length],point),after=side(point,points[(i+1)%points.length]);
    let normal=after,magnitude=half;
    if(!closed&&i===0)normal=after;
    else if(!closed&&i===points.length-1)normal=before;
    else {
      const sum:Vec3=[before[0]+after[0],before[1]+after[1],0],length=Math.hypot(sum[0],sum[1]);
      if(length>1e-8){normal=[sum[0]/length,sum[1]/length,0];magnitude=Math.min(half*4,half/Math.max(1e-6,normal[0]*after[0]+normal[1]*after[1]));}
    }
    return [-1,1].map(sign=>point.map((v,j)=>v+normal[j]*magnitude*sign) as Vec3);
  });
  const triangles:Vec3[]=[];
  for(let i=0;i<(closed?points.length:points.length-1);i++){const a=edges[i],b=edges[(i+1)%points.length];triangles.push(a[0],a[1],b[0],b[0],a[1],b[1]);}
  return triangles;
}

export interface Surface { points: Vec3[]; normals: Vec3[] }
const dot = (a: Vec3, b: Vec3): number => a.reduce((sum,v,i) => sum+v*b[i],0);
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const unit = (v: Vec3): Vec3 => { const length=Math.hypot(...v);return v.map(n=>n/length) as Vec3; };
function perpendicular(tangent: Vec3): Vec3 {
  const axis=tangent.map(Math.abs).indexOf(Math.min(...tangent.map(Math.abs)));
  const reference: Vec3=[0,0,0];reference[axis]=1;
  return unit(cross(tangent,reference));
}

/** Shared rings make a round, lit stroke around a path in any spatial direction. */
export function tubeTriangles(points: Vec3[], width: number, closed=false, capEnd=true): Surface {
  points=points.filter((p,i)=>!i||Math.hypot(...p.map((v,j)=>v-points[i-1][j]))>1e-10);
  if(closed&&points.length>1&&Math.hypot(...points[0].map((v,i)=>v-points.at(-1)![i]))<1e-10)points=points.slice(0,-1);
  const result: Surface={points:[],normals:[]};
  if(points.length<2||width<=0)return result;
  const segments=16,radius=width/2;
  const direction=(a:Vec3,b:Vec3)=>unit(b.map((v,i)=>v-a[i]) as Vec3);
  const tangents=points.map((point,i)=>{
    const before=direction(points[(i+points.length-1)%points.length],point);
    const after=direction(point,points[(i+1)%points.length]);
    if(!closed&&i===0)return after;
    if(!closed&&i===points.length-1)return before;
    const sum=before.map((v,j)=>v+after[j]) as Vec3;
    return Math.hypot(...sum)>1e-8?unit(sum):after;
  });
  let u=perpendicular(tangents[0]);
  const rings=points.map((point,i)=>{
    const tangent=tangents[i],projection=u.map((v,j)=>v-tangent[j]*dot(u,tangent)) as Vec3;
    u=Math.hypot(...projection)>1e-8?unit(projection):perpendicular(tangent);
    const v=cross(tangent,u);
    return Array.from({length:segments},(_,j)=>{
      const angle=j*Math.PI*2/segments,normal=u.map((n,k)=>n*Math.cos(angle)+v[k]*Math.sin(angle)) as Vec3;
      return { point:point.map((n,k)=>n+normal[k]*radius) as Vec3,normal };
    });
  });
  for(let i=0;i<(closed?points.length:points.length-1);i++)for(let j=0;j<segments;j++){
    const a=rings[i][j],b=rings[i][(j+1)%segments],c=rings[(i+1)%points.length][j],d=rings[(i+1)%points.length][(j+1)%segments];
    result.points.push(a.point,b.point,c.point,c.point,b.point,d.point);
    result.normals.push(a.normal,b.normal,c.normal,c.normal,b.normal,d.normal);
  }
  if(!closed)for(const i of capEnd?[0,points.length-1]:[0]){
    const normal=tangents[i].map(v=>v*(i===0?-1:1)) as Vec3;
    for(let j=0;j<segments;j++){
      result.points.push(points[i],rings[i][j].point,rings[i][(j+1)%segments].point);
      result.normals.push(normal,normal,normal);
    }
  }
  return result;
}

/** A circular cone gives an arrowhead the same silhouette from every side. */
export function coneTriangles(base: Vec3, tip: Vec3, radius: number): Surface {
  const result: Surface={points:[],normals:[]};
  const delta=tip.map((v,i)=>v-base[i]) as Vec3,length=Math.hypot(...delta);
  if(length<1e-10||radius<=0)return result;
  const axis=unit(delta),u=perpendicular(axis),v=cross(axis,u),segments=16;
  const rim=(angle:number)=>{
    const radial=u.map((n,i)=>n*Math.cos(angle)+v[i]*Math.sin(angle)) as Vec3;
    return {point:base.map((n,i)=>n+radial[i]*radius) as Vec3,normal:unit(radial.map((n,i)=>n*length+axis[i]*radius) as Vec3)};
  };
  const capNormal=axis.map(v=>-v) as Vec3;
  for(let i=0;i<segments;i++){
    const a=rim(i*Math.PI*2/segments),b=rim((i+1)*Math.PI*2/segments),middle=rim((i+0.5)*Math.PI*2/segments);
    result.points.push(a.point,b.point,tip,base,b.point,a.point);
    result.normals.push(a.normal,b.normal,middle.normal,capNormal,capNormal,capNormal);
  }
  return result;
}

const sphereCache=new Map<string,{points:Vec3[];normals:Vec3[]}>();
/** Latitude/longitude surface mesh with continuous normals for GPU-lit spheres. */
export function sphereTriangles(radius:number,segments=32,rings=20):{points:Vec3[];normals:Vec3[]} {
  const key=radius+':'+segments+':'+rings,cached=sphereCache.get(key);if(cached)return cached;
  const point=(ring:number,segment:number):Vec3=>{const latitude=Math.PI*ring/rings,longitude=Math.PI*2*segment/segments;return [Math.sin(latitude)*Math.cos(longitude),Math.cos(latitude),Math.sin(latitude)*Math.sin(longitude)];};
  const normals:Vec3[]=[];
  for(let r=0;r<rings;r++)for(let s=0;s<segments;s++) {
    const a=point(r,s),b=point(r+1,s),c=point(r+1,s+1),d=point(r,s+1);
    if(r>0)normals.push(a,b,d);if(r<rings-1)normals.push(d,b,c);
  }
  const result={normals,points:normals.map(p=>p.map(v=>v*radius) as Vec3)};
  if(sphereCache.size>=16)sphereCache.delete(sphereCache.keys().next().value!);sphereCache.set(key,result);return result;
}
