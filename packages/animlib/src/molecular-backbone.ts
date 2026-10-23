import type { MoleculeProps } from './molecule-types.js';
import type { ArticulatedChainSpec, MolecularBackboneProps, MolecularBackboneResult } from './molecular-backbone-types.js';
import type { Geometry, Vec3 } from './types.js';

/** Self-contained after TS erasure: safe to install verbatim in the scene VM. */
export function createMolecularBackboneBuilders(beads: { molecule(props: MoleculeProps): Geometry[] }) {
  const add=(a:Vec3,b:Vec3):Vec3=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
  const sub=(a:Vec3,b:Vec3):Vec3=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
  const mul=(a:Vec3,s:number):Vec3=>[a[0]*s,a[1]*s,a[2]*s];
  const dot=(a:Vec3,b:Vec3)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
  const cross=(a:Vec3,b:Vec3):Vec3=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  function unit(v:Vec3,label:string):Vec3 {const n=Math.hypot(...v);if(!Number.isFinite(n)||n<1e-10)throw new Error(`${label} has zero or numerically degenerate length`);return mul(v,1/n);}
  function vec(v:Vec3,label:string):Vec3 {if(!Array.isArray(v)||v.length!==3||![v[0],v[1],v[2]].every(x=>Number.isFinite(x)&&Math.abs(x)<=1e6))throw new Error(`${label} coordinates must be finite and within ±1000000`);return [v[0],v[1],v[2]];}
  function identity(id:string,label:string) {if(typeof id!=='string'||!id.length||id.length>160)throw new Error(`${label} identity must be a nonempty string of at most 160 characters`);}
  function perpendicular(n:Vec3,t:Vec3):Vec3 {return unit(sub(n,mul(t,dot(n,t))),'initial normal (parallel to tangent)');}
  function transport(n:Vec3,a:Vec3,b:Vec3):Vec3 {
    const c=dot(a,b);if(c<-1+1e-7)throw new Error('Backbone tangent reversal is unsupported; split the segment');
    const axis=cross(a,b);
    // Minimal rotation between tangents (Rodrigues without normalizing the axis).
    const rotated=add(add(n,cross(axis,n)),mul(cross(axis,cross(axis,n)),1/(1+c)));
    return perpendicular(rotated,b);
  }
  function molecularBackbone(props:MolecularBackboneProps):MolecularBackboneResult {
    if(!props||!['sticks','beads','backbone'].includes(props.representation))throw new Error('Explicit molecular representation must be sticks, beads, or backbone');
    if(!Array.isArray(props.segments)||!props.segments.length||props.segments.length>10000)throw new Error('Molecular segments must contain 1–10000 explicit segments');
    if(!Array.isArray(props.bonds)||props.bonds.length>20000)throw new Error('Explicit bonds must be an array of at most 20000 edges');
    const origin=vec(props.origin??[0,0,0],'origin'),seed=vec(props.initialNormal??[0,0,1],'initial normal');
    const radius=props.radius,radial=props.radialSegments??8,samples=props.samplesPerLink??4,maxMeshes=props.maxMeshes??128,beadDetail=props.beadDetail??1;
    if(!Number.isFinite(radius)||radius<=0||radius>1e5)throw new Error('Molecular radius must be positive and at most 100000');
    if(!Number.isInteger(radial)||radial<3||radial>64)throw new Error('radialSegments must be an integer from 3 to 64');
    if(!Number.isInteger(samples)||samples<1||samples>32)throw new Error('samplesPerLink must be an integer from 1 to 32');
    if(!Number.isInteger(maxMeshes)||maxMeshes<1||maxMeshes>128)throw new Error('Molecular mesh budget must be 1–128');
    if(!Number.isInteger(beadDetail)||beadDetail<0||beadDetail>3)throw new Error('Molecular bead detail must be an integer from 0 to 3');
    const provenance=props.provenance;
    if(!provenance||!['schematic','scientific'].includes(provenance.kind)||typeof provenance.source!=='string'||!provenance.source.trim()||typeof provenance.units!=='string'||!provenance.units.trim())throw new Error('Molecular provenance requires kind, source, and units');
    const colors=props.colors??['RED','ORANGE','YELLOW','GREEN','TEAL','BLUE'];
    if(!Array.isArray(colors)||colors.length<2||colors.length>16||colors.some(c=>typeof c!=='string'||!c.length))throw new Error('Sequence colors require 2–16 named palette colors');
    const result:MolecularBackboneResult={meshes:[],anchors:[],segments:[],bonds:[],vertexResidueIds:[],provenance:{...provenance}};
    const byId=new Map<string,number>(),segmentIds=new Set<string>();
    for(const segment of props.segments){
      if(!segment)throw new Error('Invalid molecular segment');identity(segment.id,'segment');
      if(segmentIds.has(segment.id))throw new Error(`Duplicate segment identity ${segment.id}`);segmentIds.add(segment.id);
      if(typeof segment.chainId!=='string'||segment.chainId.length>160)throw new Error('Invalid chain identity');
      if(!Array.isArray(segment.residues)||!segment.residues.length)throw new Error('Each explicit segment requires at least one residue');
      const ids:string[]=[];
      for(const residue of segment.residues){
        if(!residue)throw new Error('Invalid residue');identity(residue.id,'residue');
        if(byId.has(residue.id))throw new Error(`Duplicate residue identity ${residue.id}`);
        if(result.anchors.length>=10000)throw new Error('Molecular anchor budget exceeds 10000');
        const position=sub(vec(residue.position,'residue'),origin);
        if(position.some(x=>Math.abs(x)+radius>1e6))throw new Error('Molecular coordinate plus radius exceeds ±1000000');
        if(!Number.isFinite(residue.value)||residue.value<0||residue.value>1)throw new Error('Residue sequence value must be in [0,1]');
        byId.set(residue.id,result.anchors.length);ids.push(residue.id);
        result.anchors.push({id:residue.id,position,value:residue.value,segmentId:segment.id,chainId:segment.chainId});
      }
      result.segments.push({id:segment.id,residueIds:ids});
      // Explicit segments assert uninterrupted adjacency, even in bead/stick representations.
      for(let i=1;i<ids.length;i++)unit(sub(result.anchors[byId.get(ids[i])!].position,result.anchors[byId.get(ids[i-1])!].position),'Repeated connected residue anchor');
    }
    const edges=new Set<string>();
    for(const edge of props.bonds){
      if(!Array.isArray(edge)||edge.length!==2||!byId.has(edge[0])||!byId.has(edge[1])||edge[0]===edge[1])throw new Error('Bond must connect two distinct known residue IDs');
      const ia=byId.get(edge[0])!,ib=byId.get(edge[1])!,key=`${Math.min(ia,ib)},${Math.max(ia,ib)}`;
      if(edges.has(key))throw new Error('Duplicate undirected bond');edges.add(key);
      unit(sub(result.anchors[ia].position,result.anchors[ib].position),'Bond');result.bonds.push([edge[0],edge[1]]);
    }
    let totalVertices=0,totalTriangles=0;
    const linkCount=result.segments.reduce((sum,s)=>sum+s.residueIds.length-1,0);
    const estimatedTriangles=props.representation==='beads'?result.anchors.length*8*4**beadDetail:
      props.representation==='sticks'?result.bonds.length*radial*2:linkCount*samples*radial*2;
    if(estimatedTriangles>500000)throw new Error('Molecular total geometry budget exceeds 500000 triangles');
    function push(mesh:Geometry,ids:string[]){
      totalVertices+=mesh.vertices!.length;totalTriangles+=mesh.triangles!.length;
      if(totalVertices>500000||totalTriangles>500000)throw new Error('Molecular total geometry budget exceeds 500000 vertices or triangles');
      if(result.meshes.length>=maxMeshes)throw new Error('Molecular mesh count budget exceeded');
      if(mesh.vertices!.some(p=>p.some(v=>!Number.isFinite(v)||Math.abs(v)>1e6)))throw new Error('Generated molecular coordinates exceed numeric bounds');
      result.meshes.push(mesh);result.vertexResidueIds.push(ids);
    }
    const scalar=(values:number[])=>({values,domain:[0,1] as [number,number],colors:[...colors]});
    if(props.representation==='beads'){
      const perSite=4*4**beadDetail+2;
      const meshes=beads.molecule({positions:result.anchors.flatMap(a=>a.position),radius,detail:beadDetail});let first=0;
      for(const mesh of meshes){const ids:string[]=[],values:number[]=[];
        for(let i=0;i<mesh.vertices!.length;i++){const a=result.anchors[first+Math.floor(i/perSite)];ids.push(a.id);values.push(a.value);}
        first+=mesh.vertices!.length/perSite;mesh.scalarColors=scalar(values);push(mesh,ids);
      }
      return result;
    }
    type Ring={p:Vec3;t:Vec3;n:Vec3;value:number;id:string};
    // Chunk at ring boundaries; duplicate only the seam ring, preserving every face.
    function tube(rings:Ring[]){
      const ringsPerMesh=Math.min(Math.floor(20000/radial),Math.floor(20000/(2*radial))+1);
      for(let start=0;start<rings.length-1;start+=ringsPerMesh-1){
        const end=Math.min(rings.length,start+ringsPerMesh),vertices:Vec3[]=[],normals:Vec3[]=[],triangles:[number,number,number][]=[],values:number[]=[],ids:string[]=[];
        for(let i=start;i<end;i++){const r=rings[i],b=cross(r.t,r.n);
          for(let j=0;j<radial;j++){const angle=2*Math.PI*j/radial,n=add(mul(r.n,Math.cos(angle)),mul(b,Math.sin(angle)));
            vertices.push(add(r.p,mul(n,radius)));normals.push(n);values.push(r.value);ids.push(r.id);}
          if(i>start)for(let j=0;j<radial;j++){const a=(i-start-1)*radial+j,b=(i-start-1)*radial+(j+1)%radial;triangles.push([a,b,a+radial],[b,b+radial,a+radial]);}
        }
        push({kind:'mesh',vertices,normals,triangles,scalarColors:scalar(values),shading:'smooth'},ids);
      }
    }
    if(props.representation==='sticks'){
      // Merge short independent tubes into native batches instead of one object per edge.
      const packed:Ring[][]=[];
      const stickSeed=unit(seed,'initial normal');
      for(const [aId,bId] of result.bonds){const a=result.anchors[byId.get(aId)!],b=result.anchors[byId.get(bId)!],t=unit(sub(b.position,a.position),'Bond');
        const projected=sub(stickSeed,mul(t,dot(stickSeed,t)));
        // A projected frame is continuous off its poles. Reject the singular
        // neighborhood rather than silently changing polygon vertex correspondence.
        if(Math.hypot(...projected)<1e-7)throw new Error('Bond initial normal is nearly parallel to tangent; choose initialNormal with sine of separation >= 1e-7 throughout the motion');
        const n=unit(projected,'Bond normal');
        packed.push([{p:a.position,t,n,value:a.value,id:a.id},{p:b.position,t,n,value:b.value,id:b.id}]);
      }
      let vertices:Vec3[]=[],normals:Vec3[]=[],triangles:[number,number,number][]=[],values:number[]=[],ids:string[]=[];
      const flush=()=>{if(!vertices.length)return;push({kind:'mesh',vertices,normals,triangles,scalarColors:scalar(values),shading:'smooth'},ids);vertices=[];normals=[];triangles=[];values=[];ids=[];};
      for(const rings of packed){if(vertices.length+radial*2>20000||triangles.length+radial*2>20000)flush();const offset=vertices.length;
        for(const r of rings){const side=cross(r.t,r.n);for(let j=0;j<radial;j++){const angle=2*Math.PI*j/radial,n=add(mul(r.n,Math.cos(angle)),mul(side,Math.sin(angle)));vertices.push(add(r.p,mul(n,radius)));normals.push(n);values.push(r.value);ids.push(r.id);}}
        for(let j=0;j<radial;j++){const a=offset+j,b=offset+(j+1)%radial;triangles.push([a,b,a+radial],[b,b+radial,a+radial]);}
      }flush();return result;
    }
    for(const segment of result.segments){
      const anchors=segment.residueIds.map(id=>result.anchors[byId.get(id)!]);if(anchors.length===1)continue;
      const links=anchors.slice(1).map((a,i)=>sub(a.position,anchors[i].position));
      const dirs=links.map(v=>unit(v,'Backbone link'));
      const tangents=anchors.map((_,i)=>i===0?dirs[0]:i===anchors.length-1?dirs[dirs.length-1]:unit(add(dirs[i-1],dirs[i]),'Backbone reversal'));
      for(let i=1;i<dirs.length;i++)if(dot(dirs[i-1],dirs[i])<-1+1e-7)throw new Error('Backbone reversal is unsupported; split the segment');
      const rings:Ring[]=[];let previousT=tangents[0],normal=perpendicular(seed,previousT);
      for(let edge=0;edge<links.length;edge++){
        const a=anchors[edge],b=anchors[edge+1],length=Math.hypot(...links[edge]),m0=mul(tangents[edge],length),m1=mul(tangents[edge+1],length);
        for(let step=0;step<samples+(edge===links.length-1?1:0);step++){
          const u=step/samples,u2=u*u,u3=u2*u;
          const p=add(add(mul(a.position,2*u3-3*u2+1),mul(m0,u3-2*u2+u)),add(mul(b.position,-2*u3+3*u2),mul(m1,u3-u2)));
          const t=unit(add(add(mul(a.position,6*u2-6*u),mul(m0,3*u2-4*u+1)),add(mul(b.position,-6*u2+6*u),mul(m1,3*u2-2*u))),'Backbone derivative');
          normal=transport(normal,previousT,t);previousT=t;
          rings.push({p,t,n:normal,value:a.value+(b.value-a.value)*u,id:u<0.5?a.id:b.id});
        }
      }
      tube(rings);
    }
    return result;
  }
  function articulatedChainPose(spec:ArticulatedChainSpec,time:number):Vec3[]{
    if(!Number.isFinite(time))throw new Error('Articulated chain time must be finite');
    if(!spec||!Array.isArray(spec.lengths)||!spec.lengths.length||spec.lengths.length>9999)throw new Error('Articulated chain requires 1–9999 links');
    if(!Number.isFinite(spec.start)||!Number.isFinite(spec.duration)||spec.duration<=0)throw new Error('Articulated chain start and positive duration must be finite');
    for(const angles of [spec.from,spec.to])if(!Array.isArray(angles)||angles.length!==spec.lengths.length||angles.some(a=>!Array.isArray(a)||a.length!==2||a.some(v=>!Number.isFinite(v)||Math.abs(v)>1e6)))throw new Error('Joint angle topology must match links and contain finite bend/twist pairs');
    if(spec.lengths.some(v=>!Number.isFinite(v)||v<=1e-10||v>1e6))throw new Error('Link lengths must be positive finite values above numeric precision');
    const origin=vec(spec.origin??[0,0,0],'Articulated origin');let t=unit(vec(spec.direction??[1,0,0],'direction'),'direction'),n=perpendicular(vec(spec.normal??[0,1,0],'normal'),t);
    const u=Math.max(0,Math.min(1,(time-spec.start)/spec.duration)),alpha=u*u*(3-2*u),positions=[origin];
    for(let i=0;i<spec.lengths.length;i++){
      const bend=spec.from[i][0]+(spec.to[i][0]-spec.from[i][0])*alpha,twist=spec.from[i][1]+(spec.to[i][1]-spec.from[i][1])*alpha;
      n=add(mul(n,Math.cos(twist)),mul(cross(t,n),Math.sin(twist)));
      const nextT=unit(add(mul(t,Math.cos(bend)),mul(n,Math.sin(bend))),'Joint tangent');
      n=unit(add(mul(n,Math.cos(bend)),mul(t,-Math.sin(bend))),'Joint normal');t=nextT;
      const next=vec(add(positions[i],mul(t,spec.lengths[i])),'Articulated output');
      if(Math.abs(Math.hypot(...sub(next,positions[i]))/spec.lengths[i]-1)>1e-8)throw new Error('Link length is below coordinate-relative numeric precision; rescale or recenter the chain');
      positions.push(next);
    }
    return positions;
  }
  return {molecularBackbone,articulatedChainPose};
}
