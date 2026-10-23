/** Shared CPU clipping and feature edges; both native backends consume the result. */
import earcut from 'earcut';
import { add, sub, mul, dot, cross, unit } from './spatial.js';
import { parseColor, type PaletteResolver } from './palette.js';
import type { ClipPlane, ColorValue, Geometry, ScalarColors, Vec3 } from './types.js';
export type RGBA = [number, number, number, number];
export interface Corner { p: Vec3; n?: Vec3; c?: RGBA; }
export interface Section { points: Vec3[]; color: ColorValue; width: number; }
export interface ExplainedMesh { corners: Corner[]; caps: { corners: Corner[]; color: ColorValue }[]; sections: Section[]; }

export function scalarVertexColors(scalar: ScalarColors, palette: PaletteResolver): RGBA[] {
  const stops = scalar.colors.map(c => parseColor(palette.resolve(c)));
  return scalar.values.map(value => {
    const t = Math.max(0, Math.min(1, (value-scalar.domain[0])/(scalar.domain[1]-scalar.domain[0]))) * (stops.length-1);
    const i = Math.min(stops.length-2, Math.floor(t));
    return stops[i].map((v, axis) => v+(stops[i+1][axis]-v)*(t-i)) as RGBA;
  });
}
const mix = (a: Corner, b: Corner, t: number): Corner => ({
  p: add(a.p, mul(sub(b.p,a.p),t)),
  ...(a.n && b.n ? { n: add(a.n,mul(sub(b.n,a.n),t)) } : {}),
  ...(a.c && b.c ? { c: a.c.map((v,i)=>v+(b.c![i]-v)*t) as RGBA } : {}),
});
const meshEpsilon = (corners: Corner[]) => 1e-8*corners.reduce((m,c)=>Math.max(m,...c.p.map(Math.abs)),1);
// Use the same coplanar classification for fills, generated caps and contours.
// Strict signs can discard cap vertices whose computed plane residual is roundoff.
const distance = (p: Vec3, plane: ClipPlane, epsilon: number) => {
  const d=(dot(p,plane.normal)-plane.offset)/Math.hypot(...plane.normal);
  return Math.abs(d)<=epsilon?0:d;
};
function polygonClip(poly: Corner[], plane: ClipPlane, epsilon: number): Corner[] {
  const output: Corner[] = [];
  for (let i=0;i<poly.length;i++) {
    const a=poly[i],b=poly[(i+1)%poly.length],da=distance(a.p,plane,epsilon),db=distance(b.p,plane,epsilon);
    if (da<=0) output.push(a);
    if ((da<0&&db>0)||(da>0&&db<0)) output.push(mix(a,b,da/(da-db)));
  }
  return output;
}
const fan = (poly: Corner[]) => poly.slice(2).flatMap((c,i)=>[poly[0],poly[i+1],c]);
export function clipTriangles(corners: Corner[], planes: ClipPlane[], epsilon=meshEpsilon(corners)): Corner[] {
  let result = corners;
  for (const plane of planes) {
    const next: Corner[]=[];
    for(let i=0;i<result.length;i+=3) next.push(...fan(polygonClip(result.slice(i,i+3),plane,epsilon)));
    result=next;
  }
  return result;
}
const key = (p: Vec3, epsilon: number) => p.map(v=>Math.round(v/epsilon)).join(',');

/** Only degree-two closed contours are capped. Open/nonmanifold sections stay contours. */
function capLoops(segments: Vec3[][], normal: Vec3, epsilon: number): Corner[] {
  const points = new Map<string,Vec3>(), adjacency = new Map<string,Set<string>>();
  for(const [a,b] of segments) {
    const ka=key(a,epsilon),kb=key(b,epsilon); if(ka===kb)continue;
    points.set(ka,a);points.set(kb,b);
    if(!adjacency.has(ka))adjacency.set(ka,new Set());if(!adjacency.has(kb))adjacency.set(kb,new Set());
    adjacency.get(ka)!.add(kb);adjacency.get(kb)!.add(ka);
  }
  const loops:Vec3[][]=[],visited=new Set<string>();
  for(const start of adjacency.keys()) {
    if(visited.has(start))continue;
    const component:string[]=[],pending=[start];
    while(pending.length){const k=pending.pop()!;if(visited.has(k))continue;visited.add(k);component.push(k);pending.push(...adjacency.get(k)!);}
    if(component.some(k=>adjacency.get(k)!.size!==2))continue;
    const loop:Vec3[]=[];let prev='',current=start;
    do {loop.push(points.get(current)!);const next=[...adjacency.get(current)!].find(k=>k!==prev)!;prev=current;current=next;}while(current!==start&&loop.length<=component.length);
    if(current===start&&loop.length>=3)loops.push(loop);
  }
  const n=unit(normal),u=unit(cross(n,Math.abs(n[0])<0.8?[1,0,0]:[0,1,0])),v=cross(n,u);
  const projected=loops.map(loop=>loop.map(p=>[dot(p,u),dot(p,v)]));
  const inside=(poly:number[][],p:number[])=>{let yes=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;};
  const parents=projected.map((loop,i)=>projected.flatMap((other,j)=>i!==j&&inside(other,loop[0])?[j]:[]));
  const result:Corner[]=[];
  for(let i=0;i<loops.length;i++) {
    if(parents[i].length%2)continue;
    const ids=[i,...loops.flatMap((_,j)=>parents[j].length===parents[i].length+1&&parents[j].includes(i)?[j]:[])];
    const vertices=ids.flatMap(j=>loops[j]),coords=ids.flatMap(j=>projected[j].flat()),holes:number[]=[];let count=loops[i].length;
    for(const j of ids.slice(1)){holes.push(count);count+=loops[j].length;}
    for(const index of earcut(coords,holes,2)) result.push({p:vertices[index],n});
  }
  return result;
}

export function explainMesh(corners: Corner[], planes: ClipPlane[] = []): ExplainedMesh {
  const caps: ExplainedMesh['caps']=[], sections:Section[]=[];
  let result=corners;
  const epsilon=meshEpsilon(corners);
  // Sequential caps participate in subsequent cuts, closing multi-plane solids.
  for(let planeIndex=0;planeIndex<planes.length;planeIndex++) {
    const plane=planes[planeIndex];
    const intersections=new Map<string,{points:Vec3[];sides:number}>();
    for(const source of [result,...caps.map(c=>c.corners)])for(let i=0;i<source.length;i+=3) {
      const tri=source.slice(i,i+3),d=tri.map(c=>distance(c.p,plane,epsilon));
      const sides=(d.some(v=>v>0)?1:0)|(d.some(v=>v<0)?2:0);
      if(!sides)continue;
      const hits:Vec3[]=[];
      for(let j=0;j<3;j++) {
        const k=(j+1)%3;
        if(d[j]===0)hits.push(tri[j].p);
        if((d[j]<0&&d[k]>0)||(d[j]>0&&d[k]<0))hits.push(mix(tri[j],tri[k],d[j]/(d[j]-d[k])).p);
      }
      const distinct=[...new Map(hits.map(p=>[key(p,epsilon),p])).values()];
      if(distinct.length!==2)continue;
      const id=distinct.map(p=>key(p,epsilon)).sort().join('|');
      const existing=intersections.get(id);
      if(existing)existing.sides|=sides;
      else intersections.set(id,{points:distinct,sides});
    }
    // An edge on the plane is a cut only when its incident surface reaches both
    // half-spaces. Touching edges on a discarded torus otherwise invent a disk.
    // Straddling triangles supply both sides directly, including vertex cuts.
    const segments=[...intersections.values()].filter(edge=>edge.sides===3).map(edge=>edge.points);
    result=clipTriangles(result,[plane],epsilon);
    for(const cap of caps)cap.corners=clipTriangles(cap.corners,[plane],epsilon);
    if(plane.section) {
      if(plane.section.cap && plane.section.cap!=='none')caps.push({corners:capLoops(segments,plane.normal,epsilon),color:plane.section.cap});
      const remaining=planes.slice(planeIndex+1);
      const points:Vec3[]=[];
      for(const segment of segments) {
        let [a,b]=segment;let visible=true;
        for(const p of remaining){const da=distance(a,p,epsilon),db=distance(b,p,epsilon);if(da>0&&db>0){visible=false;break;}if((da>0)!==(db>0)){const hit=add(a,mul(sub(b,a),da/(da-db)));if(da>0)a=hit;else b=hit;}}
        if(visible)points.push(a,b);
      }
      sections.push({points,color:plane.section.color,width:plane.section.width??0.025});
    }
  }
  return {corners:result,caps,sections};
}

/** Weld positions so authored hard-normal seams do not become spurious boundaries. */
export function outlineEdges(corners: Corner[], geometry: Geometry, facing: (p:Vec3,n:Vec3)=>number): Vec3[] {
  const edges=new Map<string,{a:Vec3;b:Vec3;faces:{n:Vec3;front:number}[]}>();
  const epsilon=1e-8*corners.reduce((m,c)=>Math.max(m,...c.p.map(Math.abs)),1);
  for(let i=0;i<corners.length;i+=3) {
    const [a,b,c]=corners.slice(i,i+3).map(c=>c.p),n=unit(cross(sub(b,a),sub(c,a)));
    if(Math.hypot(...cross(sub(b,a),sub(c,a)))<epsilon*epsilon)continue;
    const face={n,front:facing(a,n)};
    for(const [p,q] of [[a,b],[b,c],[c,a]]) {
      const id=[key(p,epsilon),key(q,epsilon)].sort().join('|');
      let edge=edges.get(id);if(!edge){edge={a:p,b:q,faces:[]};edges.set(id,edge);}edge.faces.push(face);
    }
  }
  const cos=Math.cos(geometry.outline?.creaseAngle??Math.PI/6),silhouette=geometry.outline?.silhouette!==false;
  return [...edges.values()].filter(e=>e.faces.length===1||e.faces.some((a,i)=>e.faces.slice(i+1).some(b=>dot(a.n,b.n)<cos-1e-8 || silhouette&&((a.front>0)!==(b.front>0))))).flatMap(e=>[e.a,e.b]);
}

/** Matching plane lists and scalar ramps interpolate with corresponding mesh vertices. */
export function morphExplanatory(from: Geometry,to:Geometry,t:number): Partial<Geometry> {
  const result:Partial<Geometry>={};
  if(from.scalarColors&&to.scalarColors&&from.scalarColors.values.length===to.scalarColors.values.length&&JSON.stringify([from.scalarColors.domain,from.scalarColors.colors])===JSON.stringify([to.scalarColors.domain,to.scalarColors.colors])) {
    result.scalarColors={...to.scalarColors,values:from.scalarColors.values.map((v,i)=>v+(to.scalarColors!.values[i]-v)*t)};
  }
  if(from.clipPlanes&&to.clipPlanes&&from.clipPlanes.length===to.clipPlanes.length&&from.clipPlanes.every((p,i)=>JSON.stringify(p.normal)===JSON.stringify(to.clipPlanes![i].normal)))result.clipPlanes=to.clipPlanes.map((p,i)=>({ ...p,offset:from.clipPlanes![i].offset+(p.offset-from.clipPlanes![i].offset)*t,
    // Interpolate only parallel normals; rotating a plane through a zero normal is undefined.
    normal: p.normal }));
  return result;
}
