import type { Geometry, Vec3 } from './types.js';

export interface MolecularEnvelopeOptions {
  /** Packed XYZ coordinates in a common unit (normally Å); 1–100,000 sites. */
  positions: number[];
  /** Gaussian standard deviation in coordinate units, controlling visual smoothing. */
  sigma: number;
  /** Isovalue of the summed, unit-height kernels. Must be >0. */
  isoLevel: number;
  /** Number of cells on the longest padded bounding-box axis; integer 4–64. */
  resolution?: number;
  /** Common coordinate origin subtracted before all calculations. */
  origin?: Vec3;
  /** Output ceiling, 1–20,000. Exceeding it throws; no silent triangle deletion. */
  maxTriangles?: number;
  /** Taubin smoothing cycles (0–20), default 6; changes the schematic envelope. */
  smoothingIterations?: number;
}

/** Host-only schematic density envelope. Never installed in the scene VM. */
export function createMolecularEnvelope(options: MolecularEnvelopeOptions): Geometry {
  return buildEnvelope(options, 20000, 20000);
}

export interface MolecularEnvelopePartsOptions extends Omit<MolecularEnvelopeOptions, 'maxTriangles'> {
  /** Total face ceiling across parts, 1–160,000; default 80,000. */
  maxTotalTriangles?: number;
  /** Face ceiling per part, 64–20,000; default 12,000. */
  trianglesPerPart?: number;
}

/** Host-only preparation: shared extraction and normals, then deterministic parts. */
export function createMolecularEnvelopeParts(options: MolecularEnvelopePartsOptions): Geometry[] {
  const maxTotalTriangles = options?.maxTotalTriangles ?? 80000;
  const trianglesPerPart = options?.trianglesPerPart ?? 12000;
  if (!Number.isInteger(maxTotalTriangles) || maxTotalTriangles < 1 || maxTotalTriangles > 160000) {
    throw new Error('Envelope total triangle budget must be 1–160000');
  }
  if (!Number.isInteger(trianglesPerPart) || trianglesPerPart < 64 || trianglesPerPart > 20000) {
    throw new Error('Envelope triangles per part must be 64–20000');
  }
  const geometry = buildEnvelope({ ...options, maxTriangles: maxTotalTriangles }, 160000, 100000);
  const { vertices, normals, triangles } = geometry;
  if (triangles!.length <= trianglesPerPart && vertices!.length <= 20000) return [geometry];
  const parts: Geometry[] = [];
  let map = new Map<number, number>(), outputVertices = 0;
  let part: Geometry = { kind: 'mesh', vertices: [], normals: [], triangles: [], shading: 'smooth' };
  const finish = () => {
    if (!part.triangles!.length) return;
    if (parts.length >= 128) throw new Error('Envelope part budget exceeded; increase trianglesPerPart');
    parts.push(part);
    map = new Map();
    part = { kind: 'mesh', vertices: [], normals: [], triangles: [], shading: 'smooth' };
  };
  for (const face of triangles!) {
    const added = face.reduce((n, i) => n + Number(!map.has(i)), 0);
    if (part.triangles!.length >= trianglesPerPart || part.vertices!.length + added > 20000) finish();
    const indices = face.map(i => {
      let local = map.get(i);
      if (local === undefined) {
        if (++outputVertices > 100000) throw new Error('Envelope output vertex budget exceeded; increase trianglesPerPart');
        local = part.vertices!.length;
        map.set(i, local);
        part.vertices!.push([...vertices![i]] as Vec3);
        part.normals!.push([...normals![i]] as Vec3);
      }
      return local;
    }) as [number, number, number];
    part.triangles!.push(indices);
  }
  finish();
  return parts;
}

function buildEnvelope(options: MolecularEnvelopeOptions, triangleCeiling: number, vertexCeiling: number): Geometry {
  const {positions,sigma,isoLevel}=options??{},resolution=options?.resolution??16,maxTriangles=options?.maxTriangles??20000;
  const origin=options?.origin??[0,0,0];
  const smoothingIterations=options?.smoothingIterations??6;
  if(!Array.isArray(positions)||!positions.length||positions.length%3||positions.length>300000)throw new Error('Envelope needs packed XYZ positions for 1–100000 sites');
  if(!Number.isFinite(sigma)||sigma<=0||sigma>1e5)throw new Error('Envelope sigma must be positive and at most 100000');
  if(!Number.isFinite(isoLevel)||isoLevel<=0||isoLevel>=positions.length/3)throw new Error('Envelope isoLevel must be positive and below the number of sites');
  if(!Number.isInteger(resolution)||resolution<4||resolution>64)throw new Error('Envelope resolution must be an integer from 4 to 64');
  if(!Number.isInteger(maxTriangles)||maxTriangles<1||maxTriangles>triangleCeiling)throw new Error(`Envelope triangle budget must be 1–${triangleCeiling}`);
  if(!Number.isInteger(smoothingIterations)||smoothingIterations<0||smoothingIterations>20)throw new Error('Envelope smoothing iterations must be 0–20');
  if(!Array.isArray(origin)||origin.length!==3)throw new Error('Envelope origin must be a finite Vec3');
  for(let i=0;i<3;i++)if(!Number.isFinite(origin[i])||Math.abs(origin[i])>1e6)throw new Error('Envelope origin must be a finite Vec3 within ±1000000');
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity],sites:Vec3[]=[];
  for(let i=0;i<positions.length;i+=3){
    const p:Vec3=[0,0,0];
    for(let j=0;j<3;j++){
      if(!Number.isFinite(positions[i+j])||Math.abs(positions[i+j])>1e6)throw new Error('Envelope coordinates must be finite and within ±1000000');
      p[j]=positions[i+j]-origin[j];min[j]=Math.min(min[j],p[j]);max[j]=Math.max(max[j],p[j]);
    }
    sites.push(p);
  }
  // Shifted truncated Gaussians are continuous and exactly zero beyond 4 sigma.
  // Padding therefore guarantees a zero-density boundary and a closed contour.
  const support=4*sigma,base=Math.exp(-8),sigma2=sigma*sigma;
  if(sigma2===0)throw new Error('Envelope sigma is below numeric precision');
  for(let j=0;j<3;j++){min[j]-=support;max[j]+=support;if(Math.max(Math.abs(min[j]),Math.abs(max[j]))>1e6)throw new Error('Envelope padded bounds exceed ±1000000');}
  const step=Math.max(...max.map((v,j)=>v-min[j]))/resolution;
  if(!Number.isFinite(step)||step<=0)throw new Error('Envelope bounds are below numeric precision');
  const cells=max.map((v,j)=>Math.ceil((v-min[j])/step)),[nx,ny,nz]=cells.map(n=>n+1),total=nx*ny*nz;
  const density=new Float64Array(total),gx=new Float64Array(total),gy=new Float64Array(total),gz=new Float64Array(total);
  const index=(x:number,y:number,z:number)=>(z*ny+y)*nx+x;
  let work=0;
  for(const p of sites){
    const lo=p.map((v,j)=>Math.max(0,Math.ceil((v-support-min[j])/step)));
    const hi=p.map((v,j)=>Math.min(cells[j],Math.floor((v+support-min[j])/step)));
    work+=(hi[0]-lo[0]+1)*(hi[1]-lo[1]+1)*(hi[2]-lo[2]+1);
    if(work>25000000)throw new Error('Envelope work budget exceeded; reduce resolution or site count');
    for(let z=lo[2];z<=hi[2];z++)for(let y=lo[1];y<=hi[1];y++)for(let x=lo[0];x<=hi[0];x++){
      const dx=min[0]+x*step-p[0],dy=min[1]+y*step-p[1],dz=min[2]+z*step-p[2],r2=dx*dx+dy*dy+dz*dz;
      if(r2>=support*support)continue;
      const d=Math.exp(-r2/(2*sigma2)),i=index(x,y,z);
      density[i]+=d-base;gx[i]+=dx*d/sigma2;gy[i]+=dy*d/sigma2;gz[i]+=dz*d/sigma2;
    }
  }
  const vertices:Vec3[]=[],normals:Vec3[]=[],triangles:[number,number,number][]=[];
  const cache=new Map<string,number>();
  const point=(i:number):Vec3=>[min[0]+i%nx*step,min[1]+Math.floor(i/nx)%ny*step,min[2]+Math.floor(i/(nx*ny))*step];
  function intersect(a:number,b:number){
    const t=(isoLevel-density[a])/(density[b]-density[a]);
    const key=t<1e-12?`v${a}`:t>1-1e-12?`v${b}`:`${Math.min(a,b)},${Math.max(a,b)}`;
    const found=cache.get(key);if(found!==undefined)return found;
    const p=point(a),q=point(b),v=p.map((x,j)=>x+(q[j]-x)*t) as Vec3;
    const normal:Vec3=[gx[a]+(gx[b]-gx[a])*t,gy[a]+(gy[b]-gy[a])*t,gz[a]+(gz[b]-gz[a])*t];
    const length=Math.hypot(...normal);
    if(length<1e-14)throw new Error('Envelope normal is undefined; change resolution or isoLevel');
    const id=vertices.length;if(id>=vertexCeiling)throw new Error('Envelope vertex budget exceeded; reduce resolution');
    vertices.push(v);normals.push(normal.map(x=>x/length) as Vec3);cache.set(key,id);return id;
  }
  const cross=(a:Vec3,b:Vec3):Vec3=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const dot=(a:Vec3,b:Vec3)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
  const sub=(a:Vec3,b:Vec3)=>a.map((v,i)=>v-b[i]) as Vec3;
  const tetrahedra=[[0,1,3,7],[0,3,2,7],[0,2,6,7],[0,6,4,7],[0,4,5,7],[0,5,1,7]];
  const edges=[[0,1],[0,2],[0,3],[1,2],[1,3],[2,3]];
  for(let z=0;z<cells[2];z++)for(let y=0;y<cells[1];y++)for(let x=0;x<cells[0];x++){
    const cube=[index(x,y,z),index(x+1,y,z),index(x,y+1,z),index(x+1,y+1,z),index(x,y,z+1),index(x+1,y,z+1),index(x,y+1,z+1),index(x+1,y+1,z+1)];
    if(cube.every(i=>density[i]<isoLevel)||cube.every(i=>density[i]>=isoLevel))continue;
    for(const tetra of tetrahedra){
      const ids=tetra.map(i=>cube[i]),polygon:number[]=[];
      for(const [a,b] of edges)if((density[ids[a]]<isoLevel)!==(density[ids[b]]<isoLevel)){const v=intersect(ids[a],ids[b]);if(!polygon.includes(v))polygon.push(v);}
      if(polygon.length<3)continue;
      const center:Vec3=[0,0,0],normal:Vec3=[0,0,0];
      for(const id of polygon)for(let j=0;j<3;j++)center[j]+=vertices[id][j]/polygon.length;
      // Orient against the actual piecewise-linear tetrahedron field. An
      // interpolated analytic Gaussian gradient can disagree on a coarse grid.
      const inside=ids.filter(i=>density[i]>=isoLevel),outside=ids.filter(i=>density[i]<isoLevel);
      for(const id of outside){const p=point(id);for(let j=0;j<3;j++)normal[j]+=p[j]/outside.length;}
      for(const id of inside){const p=point(id);for(let j=0;j<3;j++)normal[j]-=p[j]/inside.length;}
      const basis=sub(vertices[polygon[0]],center),side=cross(normal,basis);
      polygon.sort((a,b)=>Math.atan2(dot(sub(vertices[a],center),side),dot(sub(vertices[a],center),basis))-Math.atan2(dot(sub(vertices[b],center),side),dot(sub(vertices[b],center),basis)));
      for(let j=1;j<polygon.length-1;j++){
        const a=polygon[0],b=polygon[j],c=polygon[j+1],face=cross(sub(vertices[b],vertices[a]),sub(vertices[c],vertices[a]));
        if(Math.hypot(...face)<1e-12*step*step)continue;
        if(triangles.length>=maxTriangles)throw new Error('Envelope triangle budget exceeded; reduce resolution');
        triangles.push(dot(face,normal)>0?[a,b,c]:[a,c,b]);
      }
    }
  }
  if(!triangles.length)throw new Error('Envelope is empty at this resolution and isoLevel');
  // Taubin's paired Laplacian passes soften voxel-scale contours while limiting
  // shrinkage. This is display smoothing, not molecular geometry reconstruction.
  const neighbors=vertices.map(()=>new Set<number>());
  for(const [a,b,c] of triangles){neighbors[a].add(b).add(c);neighbors[b].add(a).add(c);neighbors[c].add(a).add(b);}
  for(let iteration=0;iteration<smoothingIterations;iteration++)for(const weight of [.5,-.53]){
    const next=vertices.map((v,i)=>{
      if(!neighbors[i].size)return v;
      const mean:Vec3=[0,0,0];
      for(const j of neighbors[i])for(let axis=0;axis<3;axis++)mean[axis]+=vertices[j][axis]/neighbors[i].size;
      return v.map((x,axis)=>x+weight*(mean[axis]-x)) as Vec3;
    });
    for(let i=0;i<vertices.length;i++)vertices[i]=next[i];
  }
  // Shading normals follow the final geometry, not the pre-smoothing field.
  const sums=vertices.map(()=>[0,0,0] as Vec3);
  for(const [a,b,c] of triangles){const n=cross(sub(vertices[b],vertices[a]),sub(vertices[c],vertices[a]));for(const i of [a,b,c])for(let j=0;j<3;j++)sums[i][j]+=n[j];}
  for(let i=0;i<normals.length;i++){const length=Math.hypot(...sums[i]);if(length>1e-14)normals[i]=sums[i].map(x=>x/length) as Vec3;}
  if(vertices.some(v=>v.some(x=>!Number.isFinite(x)||Math.abs(x)>1e6)))throw new Error('Smoothed envelope vertices exceed coordinate limits');
  return {kind:'mesh',vertices,normals,triangles,shading:'smooth'};
}
