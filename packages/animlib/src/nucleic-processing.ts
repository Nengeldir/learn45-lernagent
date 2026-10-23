import type {Vec3} from './types.js';
import type {NucleicAnchor} from './nucleic-types.js';
import type {NucleicSpliceProps,NucleicSpliceResult,NucleicThreadProps,NucleicThreadResult} from './nucleic-processing-types.js';

/** Pure, bounded schematic poses. Self-contained after TypeScript erasure for QuickJS. */
export function createNucleicProcessingBuilders(){
 const add=(a:Vec3,b:Vec3):Vec3=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]],sub=(a:Vec3,b:Vec3):Vec3=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]],mul=(a:Vec3,s:number):Vec3=>[a[0]*s,a[1]*s,a[2]*s];
 const dot=(a:Vec3,b:Vec3)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2],cross=(a:Vec3,b:Vec3):Vec3=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
 const vec=(a:Vec3):Vec3=>{if(!Array.isArray(a)||a.length!==3||[0,1,2].some(i=>!Number.isFinite(a[i])||Math.abs(a[i])>100000))throw Error('Processing coordinate must be dense finite Vec3 within100000');return [a[0],a[1],a[2]];};
 const unit=(a:Vec3):Vec3=>{const d=Math.hypot(...a);if(!Number.isFinite(d)||d<1e-6)throw Error('Degenerate processing frame or segment (<1e-6)');return mul(a,1/d);};
 const positive=(n:number,name:string,max=10000)=>{if(!Number.isFinite(n)||n<1e-5||n>max)throw Error(`Invalid ${name}: expected1e-5..${max}`);};
 const progress=(p:number)=>{if(!Number.isFinite(p)||p<0||p>1)throw Error('Processing progress must be in[0,1]');};
 const smooth=(p:number,a:number,b:number)=>{const t=Math.max(0,Math.min(1,(p-a)/(b-a)));return t*t*(3-2*t);};
 const project=(n:Vec3,t:Vec3)=>unit(sub(n,mul(t,dot(n,t))));
 const rotate=(p:Vec3,axis:Vec3,a:number):Vec3=>add(add(mul(p,Math.cos(a)),mul(cross(axis,p),Math.sin(a))),mul(axis,dot(axis,p)*(1-Math.cos(a))));
 function identities(sites:{id:string;base:string}[]){if(!Array.isArray(sites)||sites.length<2||sites.length>128)throw Error('Processing site budget2–128');const ids=new Set<string>();for(const s of Array.from(sites)){if(!s||typeof s.id!=='string'||!s.id.length||s.id.length>120||ids.has(s.id))throw Error('Invalid or duplicate processing identity');if(!['A','C','G','U'].includes(s.base))throw Error('Invalid RNA alphabet');ids.add(s.id);}}
 function frames(points:Vec3[],seed:Vec3){
  const dirs=points.slice(1).map((p,i)=>unit(sub(p,points[i])));for(let i=1;i<dirs.length;i++)if(dot(dirs[i-1],dirs[i])<-.95)throw Error('Unsupported processing corner: cosine below-0.95');
  const tangents=points.map((_,i)=>i===0?dirs[0]:i===points.length-1?dirs[dirs.length-1]:unit(add(dirs[i-1],dirs[i]))),normals:Vec3[]=[project(unit(seed),tangents[0])];
  for(let i=1;i<points.length;i++){const a=tangents[i-1],b=tangents[i],c=dot(a,b);if(c<-.95)throw Error('Unsupported processing frame reversal');const v=cross(a,b),n=normals[i-1];normals.push(project(add(add(n,cross(v,n)),mul(cross(v,cross(v,n)),1/(1+c))),b));}
  return {tangents,normals};
 }
 function anchor(s:{id:string;base:string},p:Vec3,t:Vec3,n:Vec3,reach:number):NucleicAnchor{return {id:s.id,base:s.base as 'A',strand:'rna',shape:s.base==='A'||s.base==='G'?'purine':'pyrimidine',backbone:vec(p),tip:vec(add(p,mul(n,reach))),tangent:[...t],normal:[...n]};}
 function nucleicSplice(props:NucleicSpliceProps,p:number):NucleicSpliceResult{
  progress(p);if(!props)throw Error('Missing splice props');identities(props.sites);const sites=Array.from(props.sites,s=>({...s,position:vec(s.position)})),n=sites.length,range=props.intron;
  if(!range||!Number.isInteger(range.start)||!Number.isInteger(range.end)||range.start<2||range.end>n-3||range.end<=range.start)throw Error('Intron must be interior with2+ sites per fragment');
  const {start,end}=range,seed=vec(props.initialNormal);unit(seed);positive(props.baseReach,'baseReach',100);positive(props.joinDistance,'joinDistance',100);
  const ph=props.phases??{cut:.2,closeEnd:.7,departEnd:.95};if(!ph||![ph.cut,ph.closeEnd,ph.departEnd].every(Number.isFinite)||ph.cut<=0||ph.closeEnd<=ph.cut||ph.departEnd<ph.closeEnd||ph.departEnd>1)throw Error('Invalid ordered splice phases');
  const departure=props.departure;if(!departure)throw Error('Missing departure');const translation=vec(departure.translation),axis=unit(vec(departure.axis));if(!Number.isFinite(departure.angle)||Math.abs(departure.angle)>4*Math.PI)throw Error('Invalid departure rotation');
  // Optional analytic pre-cut bending. The bridge's material arc coordinates stay
  // fixed; its straight chords are deliberately not a chemical bond invariant.
  let formedFrames:{tangents:Vec3[];normals:Vec3[]}|undefined;
  if(props.formation){
   const f=props.formation;
   if(![f.start,f.end,f.angle].every(Number.isFinite)||f.start<0||f.end<=f.start||f.end>=ph.cut||f.angle<=0||f.angle>1.9*Math.PI)throw Error('Invalid formation phases or bend angle (0,1.9pi]');
   const oldLeft=sites[start-1].position,oldRight=sites[end+1].position,d=sub(oldRight,oldLeft),length=Math.hypot(...d);positive(length,'formation arc length');
   const tangent=unit(d),bendInput=vec(f.bendDirection),perpendicular=sub(bendInput,mul(tangent,dot(bendInput,tangent)));
   if(Math.hypot(...perpendicular)<1e-6)throw Error('Formation bendDirection must have a nondegenerate perpendicular component');
   const bend=unit(perpendicular),bendAxis=unit(cross(tangent,bend)),initial=project(unit(seed),tangent),center=mul(add(oldLeft,oldRight),.5);
   const sinc=(v:number)=>Math.abs(v)<1e-4?1-v*v/6+v*v*v*v/120:Math.sin(v)/v;
   const finalGap=length*sinc(f.angle/2);if(props.joinDistance>finalGap)throw Error('joinDistance must not exceed formed exon gap');
   const offsets:number[]=[];
   for(let i=start-1;i<=end+1;i++){
    const v=sub(sites[i].position,oldLeft),s=dot(v,tangent);
    if(Math.hypot(...sub(v,mul(tangent,s)))>1e-7)throw Error('Formation bridge must be collinear');
    if(i>start-1&&s-offsets[offsets.length-1]<1e-5)throw Error('Formation arc offsets must be strictly ordered');offsets.push(s);
   }
   // A quarter-turn maximum between material samples prevents a long chord from
   // cutting across most of the loop, including at its fully bent endpoint.
   for(let i=1;i<offsets.length;i++)if((offsets[i]-offsets[i-1])*f.angle/length>Math.PI/2)throw Error('Formation arc samples exceed quarter-turn chord limit');
   // Every intermediate arc lies within length of the fixed bridge midpoint.
   // Reserve rigid exon travel, subsequent closure, rotation and departure too.
   for(const s of sites)for(let k=0;k<3;k++)if(Math.max(Math.abs(s.position[k]),Math.abs(center[k]))+2*length+Math.abs(translation[k])+props.baseReach>100000)throw Error('Splice formation schedule coordinate bound exceeded');
   const theta=f.angle*smooth(p,f.start,f.end),gap=length*sinc(theta/2),shift=mul(tangent,(length-gap)/2);
   for(let i=0;i<start;i++)sites[i].position=add(sites[i].position,shift);
   for(let i=end+1;i<n;i++)sites[i].position=sub(sites[i].position,shift);
   formedFrames={tangents:[],normals:[]};
   for(let i=start;i<=end;i++){
    const u=offsets[i-start+1]/length-.5,axial=length*u*sinc(theta*u);
    // Stable cos(theta*u)-cos(theta/2), including theta approaching zero.
    const radial=length*theta/2*(.25-u*u)*sinc(theta*(.5+u)/2)*sinc(theta*(.5-u)/2);
    sites[i].position=add(center,add(mul(tangent,axial),mul(bend,radial)));
    formedFrames.tangents.push(rotate(tangent,bendAxis,-theta*u));formedFrames.normals.push(rotate(initial,bendAxis,-theta*u));
   }
  }
  const left=sites[start-1].position,right=sites[end+1].position,direction=unit(sub(right,left)),distance=Math.hypot(...sub(right,left));if(props.joinDistance>distance)throw Error('joinDistance must not exceed original exon gap');
  const delta=mul(direction,(distance-props.joinDistance)/2),centroid:Vec3=[0,0,0];for(let i=start;i<=end;i++)for(let k=0;k<3;k++)centroid[k]+=sites[i].position[k]/(end-start+1);
  // Bound the entire rotation/translation schedule, not only the requested frame.
  for(let i=0;i<n;i++){const s=sites[i],removed=i>=start&&i<=end;if(removed){const r=Math.hypot(...sub(s.position,centroid))+props.baseReach;for(let k=0;k<3;k++)if(Math.max(Math.abs(centroid[k]),Math.abs(centroid[k]+translation[k]))+r>100000)throw Error('Splice schedule coordinate bound exceeded');}else{vec(add(s.position,mul(delta,i<start?1:-1)));for(let k=0;k<3;k++)if(Math.abs(s.position[k])+Math.abs(delta[k])+props.baseReach>100000)throw Error('Splice schedule coordinate bound exceeded');}}
  const closure=smooth(p,ph.cut,ph.closeEnd),depart=smooth(p,ph.cut,ph.departEnd),anchors:NucleicAnchor[]=[];
  for(const [a,b] of [[0,start-1],[start,end],[end+1,n-1]]){const fragment=sites.slice(a,b+1),removed=a===start,f=removed&&formedFrames?formedFrames:frames(fragment.map(s=>s.position),seed);for(let j=0;j<fragment.length;j++){const s=fragment[j],pos=removed?add(add(centroid,rotate(sub(s.position,centroid),axis,depart*departure.angle)),mul(translation,depart)):add(s.position,mul(delta,(a===0?1:-1)*closure)),t=removed?rotate(f.tangents[j],axis,depart*departure.angle):f.tangents[j],normal=removed?rotate(f.normals[j],axis,depart*departure.angle):f.normals[j];anchors.push(anchor(s,pos,t,normal,props.baseReach));}}
  const cut=p>=ph.cut,joined=p>=ph.closeEnd,bonds:[string,string][]=[];for(let i=1;i<n;i++)if(!cut||i!==start&&i!==end+1)bonds.push([sites[i-1].id,sites[i].id]);
  const gap=Math.hypot(...sub(anchors[start-1].backbone,anchors[end+1].backbone));if(joined){if(Math.abs(gap-props.joinDistance)>1e-7)throw Error('Splice closure did not reach joinDistance');bonds.push([sites[start-1].id,sites[end+1].id]);}
  return {anchors,bonds,retainedIds:sites.filter((_,i)=>i<start||i>end).map(s=>s.id),removedIds:sites.slice(start,end+1).map(s=>s.id),cutEnds:cut?(joined?[sites[start].id,sites[end].id]:[sites[start-1].id,sites[start].id,sites[end].id,sites[end+1].id]):[],phase:joined?'joined':cut?'closing':'intact',joinDistance:gap,provenance:{kind:'schematic',description:props.formation?'Analytic circular pre-cut formation preserves material arc offsets, not Euclidean chord lengths. Exons translate rigidly; all post-cut fragments are rigid. Ordered cut, closure, join and independent departure; no biochemical lariat or kinetics.':'Rigid fragments preserve internal distances. Ordered cut, closure, join and independently departing intron; no biochemical kinetics or conformational dynamics.'}};
 }
 function nucleicThread(props:NucleicThreadProps,p:number):NucleicThreadResult{
  progress(p);if(!props)throw Error('Missing threading props');identities(props.sites);positive(props.baseReach,'baseReach',100);if(!Array.isArray(props.path)||props.path.length<2||props.path.length>512)throw Error('Thread path budget2–512');
  const path=Array.from(props.path,vec),seed=vec(props.initialNormal),a=props.aperture;if(!a)throw Error('Missing aperture');const center=vec(a.center),normal=unit(vec(a.normal));positive(a.radius,'aperture radius');positive(a.halfThickness,'aperture thickness');positive(a.chainRadius,'chainRadius',100);if(a.chainRadius>=a.radius||a.chainRadius<props.baseReach)throw Error('Aperture chain clearance must enclose baseReach and fit radius');
  for(const point of path)for(const value of point)if(Math.abs(value)+props.baseReach>100000)throw Error('Thread schedule coordinate bound exceeded');
  const side=path.map(v=>dot(sub(v,center),normal)),arcs=[0];if(side[0]>=-a.halfThickness||side[side.length-1]<=a.halfThickness)throw Error('Thread path must cross complete aperture slab');
  for(let i=1;i<path.length;i++){
   if(side[i]-side[i-1]<1e-6)throw Error('Thread path must be strictly monotonic along aperture normal');const length=Math.hypot(...sub(path[i],path[i-1]));positive(length,'path segment');arcs.push(arcs[i-1]+length);
   // A swept ball can reach a slab face before its center enters the slab.
   // Outside this expanded slab its normal distance alone gives clearance;
   // inside, radial clearance by chainRadius suffices for the entire ball.
   // Convex radial norm attains its segment maximum at a clipped endpoint.
   const expandedHalfThickness=a.halfThickness+a.chainRadius;
   const lo=Math.max(0,(-expandedHalfThickness-side[i-1])/(side[i]-side[i-1])),hi=Math.min(1,(expandedHalfThickness-side[i-1])/(side[i]-side[i-1]));
   if(lo<=hi)for(const t of [lo,hi]){const q=sub(add(path[i-1],mul(sub(path[i],path[i-1]),t)),center),radial=Math.hypot(...sub(q,mul(normal,dot(q,normal))));if(radial+a.chainRadius>a.radius+1e-9)throw Error('Thread path collides with aperture slab');}
  }
  for(let i=0;i<props.sites.length;i++){const offset=props.sites[i].offset;if(!Number.isFinite(offset)||offset<0||offset>100000||i===0&&offset!==0||i>0&&offset-props.sites[i-1].offset<1e-5)throw Error('Thread offsets require first0 and increasing gaps>=1e-5');}
  const length=arcs[arcs.length-1],maxOffset=props.sites[props.sites.length-1].offset;if(maxOffset>=length)throw Error('Thread offsets exceed path domain');const f=frames(path,seed);
  function sample(s:number){let i=1;while(i<arcs.length-1&&arcs[i]<s)i++;const u=(s-arcs[i-1])/(arcs[i]-arcs[i-1]),pos=add(path[i-1],mul(sub(path[i],path[i-1]),u)),tangent=unit(add(mul(f.tangents[i-1],1-u),mul(f.tangents[i],u))),v=cross(f.tangents[i-1],tangent),c=dot(f.tangents[i-1],tangent),old=f.normals[i-1],n=project(add(add(old,cross(v,old)),mul(cross(v,cross(v,old)),1/(1+c))),tangent);return {pos,tangent,normal:n};}
  if(dot(sub(sample(maxOffset).pos,center),normal)>=-a.halfThickness||dot(sub(sample(length-maxOffset).pos,center),normal)<=a.halfThickness)throw Error('Thread path domain must fit full chain on each side');
  const travel=maxOffset+(length-maxOffset)*smooth(p,0,1),arcCoordinates=props.sites.map(s=>travel-s.offset),anchors=props.sites.map((s,i)=>{const q=sample(arcCoordinates[i]);return anchor(s,q.pos,q.tangent,q.normal,props.baseReach);});
  return {anchors,bonds:props.sites.slice(1).map((s,i)=>[props.sites[i].id,s.id]),arcCoordinates,signedSides:anchors.map(s=>dot(sub(s.backbone,center),normal)),pathLength:length,provenance:{kind:'schematic',description:'Exact arc-distance transport on an authored polyline through one aperture. Stable site offsets; transported frames. Polyline arc gaps are not fixed Euclidean bonds; no transport energetics.'}};
 }
 return {nucleicSplice,nucleicThread};
}
