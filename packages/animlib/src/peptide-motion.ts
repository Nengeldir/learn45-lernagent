import type {PeptideSpec,PeptidePose} from './peptide-types.js';
import type {Vec3} from './types.js';

/** Self-contained pure internal-coordinate construction, installable in the scene VM. */
export function createPeptideBuilders() {
  const add=(a:Vec3,b:Vec3):Vec3=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]],sub=(a:Vec3,b:Vec3):Vec3=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]],mul=(a:Vec3,s:number):Vec3=>[a[0]*s,a[1]*s,a[2]*s];
  const dot=(a:Vec3,b:Vec3)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2],cross=(a:Vec3,b:Vec3):Vec3=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const unit=(v:Vec3):Vec3=>{const l=Math.hypot(...v);if(l<1e-8||!Number.isFinite(l))throw new Error('Degenerate peptide frame');return mul(v,1/l);};
  const vec=(v:Vec3):Vec3=>{if(!Array.isArray(v)||v.length!==3||[0,1,2].some(i=>!Number.isFinite(v[i])||Math.abs(v[i])>1000))throw new Error('Invalid peptide template coordinate');return [...v];};
  const identity=(s:string)=>{if(typeof s!=='string'||!/^[a-zA-Z0-9_.-]{1,100}$/.test(s))throw new Error('Invalid peptide identity');};
  function basis(n:Vec3,ca:Vec3,c:Vec3){const x=unit(sub(c,ca)),towardN=sub(n,ca),y=unit(sub(towardN,mul(x,dot(towardN,x)))),z=cross(x,y);return {x,y,z};}
  function place(a:Vec3,b:Vec3,c:Vec3,length:number,angle:number,torsion:number):Vec3 {
    const x=unit(sub(c,b)),z=unit(cross(sub(b,a),x)),y=cross(z,x);
    return add(c,mul(add(mul(x,-Math.cos(angle)),add(mul(y,Math.sin(angle)*Math.cos(torsion)),mul(z,Math.sin(angle)*Math.sin(torsion)))),length));
  }
  function peptidePose(spec:PeptideSpec,phi:number[],psi:number[]):PeptidePose {
    if(!spec||!Array.isArray(spec.residues)||spec.residues.length<2||spec.residues.length>96)throw new Error('Peptide residue budget requires2–96');
    const count=spec.residues.length;
    for(const angles of [phi,psi])if(!Array.isArray(angles)||angles.length!==count||Array.from(angles).some(a=>!Number.isFinite(a)||Math.abs(a)>4*Math.PI))throw new Error('Peptide torsion arrays must be dense, finite and within±4PI');
    if(!Number.isFinite(spec.peptideLength)||spec.peptideLength<.1||spec.peptideLength>10)throw new Error('Invalid peptide link length');
    for(const angle of [spec.angleCA_C_N,spec.angleC_N_CA])if(!Number.isFinite(angle)||angle<.1||angle>Math.PI-.1)throw new Error('Invalid peptide link angle');
    if(!spec.components||typeof spec.components!=='object'||Array.isArray(spec.components))throw new Error('Invalid peptide components');
    const entries=Object.entries(spec.components);if(!entries.length||entries.length>8)throw new Error('Peptide component budget requires1–8');
    const templates=new Map(entries.map(([key,component])=>{
      identity(key);
      if(!component||!Array.isArray(component.atoms)||component.atoms.length<4||component.atoms.length>24||!Array.isArray(component.bonds)||!component.bonds.length||component.bonds.length>32)throw new Error('Peptide component geometry budget exceeded');
      const atoms=Array.from(component.atoms,a=>{if(!a)throw new Error('Sparse peptide template');identity(a.name);return {name:a.name,position:vec(a.position)};}),map=new Map(atoms.map(a=>[a.name,a.position]));
      if(map.size!==atoms.length)throw new Error('Duplicate peptide atom identity');
      for(const name of ['N','CA','C','O'])if(!map.has(name))throw new Error('Peptide template requires N/CA/C/O');
      const adjacency=new Map(atoms.map(a=>[a.name,new Set<string>()])),seen=new Set<string>();
      const bonds=Array.from(component.bonds,b=>{if(!Array.isArray(b)||b.length!==2||b[0]===b[1]||!map.has(b[0])||!map.has(b[1]))throw new Error('Invalid peptide template bond');const edge=[...b].sort().join('/');if(seen.has(edge))throw new Error('Duplicate peptide template bond');seen.add(edge);adjacency.get(b[0])!.add(b[1]);adjacency.get(b[1])!.add(b[0]);return [...b] as [string,string];});
      for(const edge of ['CA/N','C/CA','C/O'])if(!seen.has(edge))throw new Error('Peptide template requires backbone bonds');
      // Carbonyl oxygen follows psi in the peptide plane. Cross-linked or cyclic backbone templates are unsupported.
      if(adjacency.get('O')!.size!==1||adjacency.get('N')!.size!==1||adjacency.get('C')!.size!==2)throw new Error('Unsupported peptide backbone connectivity');
      const visited=new Set<string>(),pending=['N'];while(pending.length){const name=pending.pop()!;if(visited.has(name))continue;visited.add(name);pending.push(...adjacency.get(name)!);}if(visited.size!==atoms.length)throw new Error('Peptide template must be connected');
      const n=map.get('N')!,ca=map.get('CA')!,c=map.get('C')!,o=map.get('O')!,frame=basis(n,ca,c);
      const nca=Math.hypot(...sub(n,ca)),cac=Math.hypot(...sub(c,ca)),co=Math.hypot(...sub(o,c)),angle=Math.acos(Math.max(-1,Math.min(1,dot(unit(sub(n,ca)),unit(sub(c,ca))))));
      for(const [a,b] of bonds)if(Math.hypot(...sub(map.get(a)!,map.get(b)!))<1e-8)throw new Error('Degenerate peptide template bond');
      const local=atoms.map(a=>{const v=sub(a.position,ca);return {name:a.name,position:[dot(v,frame.x),dot(v,frame.y),dot(v,frame.z)] as Vec3};});
      return [key,{atoms:local,bonds,nca,cac,co,angle}] as const;
    }));
    const ids=new Set<string>(),residues=Array.from(spec.residues,r=>{if(!r)throw new Error('Sparse peptide residue');identity(r.id);if(ids.has(r.id))throw new Error('Duplicate peptide residue identity');ids.add(r.id);const template=templates.get(r.component);if(!template)throw new Error('Unknown peptide component');return {...r,template};});
    if(residues.reduce((s,r)=>s+r.template.atoms.length,0)>1536||residues.reduce((s,r)=>s+r.template.bonds.length+1,0)>2048)throw new Error('Aggregate peptide geometry budget exceeded');
    const backbones:{n:Vec3;ca:Vec3;c:Vec3;nextN:Vec3}[]=[];
    for(let i=0;i<count;i++){
      const t=residues[i].template,previous=backbones[i-1];
      const n:Vec3=i?previous.nextN:[0,0,0];
      const ca:Vec3=i?place(previous.ca,previous.c,n,t.nca,spec.angleC_N_CA,Math.PI):[t.nca,0,0];
      const c:Vec3=i?place(previous.c,n,ca,t.cac,t.angle,phi[i]):[t.nca-t.cac*Math.cos(t.angle),t.cac*Math.sin(t.angle),0];
      backbones.push({n,ca,c,nextN:place(n,ca,c,spec.peptideLength,spec.angleCA_C_N,psi[i])});
    }
    const atoms:PeptidePose['atoms']=[],anchors:PeptidePose['anchors']=[],bonds:PeptidePose['bonds']=[],center:Vec3=[0,0,0];
    for(let i=0;i<count;i++){
      const r=residues[i],b=backbones[i],frame=basis(b.n,b.ca,b.c),value=i/(count-1);
      for(const a of r.template.atoms){
        let position=add(b.ca,add(add(mul(frame.x,a.position[0]),mul(frame.y,a.position[1])),mul(frame.z,a.position[2])));
        if(a.name==='N')position=[...b.n];if(a.name==='CA')position=[...b.ca];if(a.name==='C')position=[...b.c];
        if(a.name==='O')position=add(b.c,mul(unit(mul(add(unit(sub(b.ca,b.c)),unit(sub(b.nextN,b.c))),-1)),r.template.co));
        atoms.push({id:r.id+'/'+a.name,residueId:r.id,name:a.name,position,value});
      }
      anchors.push({id:r.id,position:[...b.ca],value});for(let j=0;j<3;j++)center[j]+=b.ca[j]/count;
      for(const [a,c] of r.template.bonds)bonds.push([r.id+'/'+a,r.id+'/'+c]);if(i)bonds.push([residues[i-1].id+'/C',r.id+'/N']);
    }
    return {atoms,anchors,bonds,center,provenance:{kind:'schematic',description:'Original idealized peptide: template side chains, explicit peptide geometry, prescribed phi/psi torsions and trans omega. Carbonyl oxygens follow peptide planes. No deposited conformation, energetic dynamics, or collision avoidance is claimed.'}};
  }
  return {peptidePose};
}
