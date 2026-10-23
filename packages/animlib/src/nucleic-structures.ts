import type {MolecularBackboneProps,MolecularBackboneResult} from './molecular-backbone-types.js';
import type {NucleicAnchor,NucleicDuplexProps,NucleicDuplexResult,NucleicPart,NucleicTranscriptProps,NucleicTranscriptResult} from './nucleic-types.js';
import type {Geometry,PaletteColor,Vec3} from './types.js';

/** Self-contained after TS erasure; all geometry uses ordinary native mesh builders. */
export function createNucleicBuilders(molecular:{molecularBackbone(props:MolecularBackboneProps):MolecularBackboneResult}) {
  const add=(a:Vec3,b:Vec3):Vec3=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]],sub=(a:Vec3,b:Vec3):Vec3=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]],mul=(a:Vec3,s:number):Vec3=>[a[0]*s,a[1]*s,a[2]*s];
  const dot=(a:Vec3,b:Vec3)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2],cross=(a:Vec3,b:Vec3):Vec3=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const unit=(a:Vec3,label:string):Vec3=>{const n=Math.hypot(...a);if(!Number.isFinite(n)||n<1e-8)throw new Error(`${label}: degenerate length or reversal`);return mul(a,1/n);};
  const vec=(a:Vec3):Vec3=>{if(!Array.isArray(a)||a.length!==3||[0,1,2].some(i=>!Number.isFinite(a[i])||Math.abs(a[i])>1e5))throw new Error('Nucleic coordinate must be a dense finite Vec3 within100000');return [a[0],a[1],a[2]];};
  const id=(v:string)=>{if(typeof v!=='string'||!v.length||v.length>120)throw new Error('Invalid nucleic identity');};
  const positive=(n:number,label:string,limit=100)=>{if(!Number.isFinite(n)||n<=1e-7||n>limit)throw new Error(`Invalid positive ${label}`);};
  const project=(n:Vec3,t:Vec3)=>unit(sub(n,mul(t,dot(n,t))),'Normal parallel to tangent');
  const palette:PaletteColor[]=['ORANGE','GREEN','GOLD','BLUE'];
  const value=(base:string)=>base==='A'?0:base==='C'?1/3:base==='G'?2/3:1;
  const shape=(base:string)=>base==='A'||base==='G'?'purine' as const:'pyrimidine' as const;
  function frames(axis:Vec3[],seed:Vec3){
    const dirs=axis.slice(1).map((p,i)=>unit(sub(p,axis[i]),'Axis link'));
    const tangents=axis.map((_,i)=>i===0?dirs[0]:i===axis.length-1?dirs[dirs.length-1]:unit(add(dirs[i-1],dirs[i]),'Axis reversal'));
    let n=project(unit(seed,'Initial normal'),tangents[0]);const normals=[n];
    for(let i=1;i<tangents.length;i++){const a=tangents[i-1],b=tangents[i],c=dot(a,b);if(c<-1+1e-7)throw new Error('Unsupported axis reversal');const v=cross(a,b);n=project(add(add(n,cross(v,n)),mul(cross(v,cross(v,n)),1/(1+c))),b);normals.push(n);}
    return {tangents,normals};
  }
  function plateMesh(anchors:NucleicAnchor[],colors=palette):Geometry {
    const vertices:Vec3[]=[],triangles:[number,number,number][]=[],values:number[]=[];
    function polygon(anchor:NucleicAnchor,points:[number,number][]){
      const scale=Math.hypot(...sub(anchor.tip,anchor.backbone))/.76,x=mul(anchor.normal,scale),y=mul(anchor.tangent,scale),z=unit(cross(x,y),'Base plate frame'),offset=vertices.length,count=points.length;
      for(const side of [-.055,.055])for(const [u,v] of points){vertices.push(add(anchor.backbone,add(add(mul(x,u),mul(y,v)),mul(z,side))));values.push(value(anchor.base));}
      for(let i=1;i<count-1;i++){triangles.push([offset,offset+i+1,offset+i]);triangles.push([offset+count,offset+count+i,offset+count+i+1]);}
      for(let i=0;i<count;i++){const j=(i+1)%count;triangles.push([offset+i,offset+j,offset+i+count],[offset+j,offset+j+count,offset+i+count]);}
    }
    for(const a of anchors){
      polygon(a,[[0,-.045],[.36,-.045],[.36,.045],[0,.045]]);
      const ring=(cx:number,r:number,n:number)=>Array.from({length:n},(_,i)=>[cx+r*Math.cos(i*2*Math.PI/n),r*Math.sin(i*2*Math.PI/n)] as [number,number]);
      polygon(a,ring(a.shape==='purine'?.44:.48,a.shape==='purine'?.2:.25,6));if(a.shape==='purine')polygon(a,ring(.64,.19,5));
    }
    return {kind:'mesh',vertices,triangles,shading:'flat',scalarColors:{domain:[0,1],colors:[...colors],values}};
  }
  function backbone(points:Vec3[],ids:string[],radius:number,normal:Vec3,color:PaletteColor,radial=8,samples=3):Geometry {
    const result=molecular.molecularBackbone({segments:[{id:'nucleic-strand',chainId:'nucleic',residues:points.map((position,i)=>({id:ids[i],position,value:0}))}],bonds:[],representation:'backbone',radius,initialNormal:normal,radialSegments:radial,samplesPerLink:samples,colors:[color,color],provenance:{kind:'schematic',source:'Nucleic schematic backbone; fixed-link anchor geometry',units:'arbitrary'}});
    if(result.meshes.length!==1)throw new Error('Nucleic mesh budget exceeded; reduce quality or strand length');return result.meshes[0];
  }
  function nucleicDuplex(props:NucleicDuplexProps,opening:number):NucleicDuplexResult {
    if(!Number.isFinite(opening)||opening<0||opening>1)throw new Error('Nucleic opening must be in[0,1]');
    if(!props||!Array.isArray(props.axis)||props.axis.length<2||props.axis.length>128)throw new Error('Nucleic axis budget requires2–128 sites');
    const count=props.axis.length,axis=Array.from(props.axis,vec),seed=vec(props.initialNormal);
    if(props.templateDirection!=='3to5'||props.codingDirection!=='5to3')throw new Error('Nucleic directions must be template3to5 and coding5to3');
    positive(props.radius,'helix radius');positive(props.backboneRadius,'backbone radius');
    if(!Number.isFinite(props.twistPerBase)||Math.abs(props.twistPerBase)>Math.PI)throw new Error('Nucleic twistPerBase must be finite within±PI');
    const window=props.window;if(!window||!Number.isInteger(window.start)||!Number.isInteger(window.end)||window.start<0||window.end>=count||window.end<=window.start)throw new Error('Invalid nucleic opening window');positive(window.separation,'window separation');
    const allIds=new Set<string>();
    for(const strand of [props.template,props.coding]){if(!Array.isArray(strand)||strand.length!==count)throw new Error('Nucleic sequence must match axis count');for(const site of Array.from(strand)){if(!site||!['A','C','G','T'].includes(site.base))throw new Error('Invalid DNA sequence alphabet');id(site.id);if(allIds.has(site.id))throw new Error('Duplicate nucleic identity');allIds.add(site.id);}}
    if(!Array.isArray(props.pairs)||props.pairs.length!==count)throw new Error('Explicit pairs must match axis count');
    const complement:Record<string,string>={A:'T',T:'A',C:'G',G:'C'};
    for(let i=0;i<count;i++){const pair=props.pairs[i];if(!Array.isArray(pair)||pair.length!==2||pair[0]!==props.template[i].id||pair[1]!==props.coding[i].id)throw new Error('Explicit pair identity/order mismatch');if(complement[props.template[i].base]!==props.coding[i].base)throw new Error('Explicit DNA pair is not complementary');}
    const radial=props.radialSegments??8,samples=props.samplesPerLink??3;
    if(!Number.isInteger(radial)||radial<3||radial>16||!Number.isInteger(samples)||samples<1||samples>8)throw new Error('Nucleic geometry quality budget exceeded');
    const colors=props.baseColors??palette;if(!Array.isArray(colors)||colors.length!==4||Array.from(colors).some(c=>typeof c!=='string'||!c))throw new Error('Nucleic base colors require four palette tokens');
    const {tangents,normals}=frames(axis,seed),weights=axis.map((_,i)=>i<=window.start||i>=window.end?0:Math.sin(Math.PI*(i-window.start)/(window.end-window.start))**2);
    const accumulated=[0];for(let i=1;i<count;i++)accumulated.push(accumulated[i-1]+(weights[i-1]+weights[i])/2);const middle=Math.floor((window.start+window.end)/2);
    const desired=(side:number,phase:number)=>axis.map((p,i)=>{const open=weights[i]*phase,angle=(i-middle)*props.twistPerBase-phase*(accumulated[i]-accumulated[middle])*props.twistPerBase,r=props.radius+window.separation*open,binormal=cross(tangents[i],normals[i]);return add(p,mul(add(mul(normals[i],Math.cos(angle)),mul(binormal,Math.sin(angle))),side*r));});
    const strandPoints:Vec3[][]=[],lengths:number[][]=[];
    for(const side of [-1,1]){const rest=desired(side,0),target=desired(side,opening),links=rest.slice(1).map((p,i)=>Math.hypot(...sub(p,rest[i]))),points=[target[0]];
      for(let i=1;i<count;i++)points.push(add(points[i-1],mul(unit(sub(target[i],target[i-1]),'Opening direction'),links[i-1])));
      // Same-origin centering is a rigid translation; it preserves lengths but does not pin outside-window sites.
      const delta:Vec3=[0,0,0];for(let i=0;i<count;i++)for(let j=0;j<3;j++)delta[j]+=(target[i][j]-points[i][j])/count;
      strandPoints.push(points.map(p=>vec(add(p,delta))));lengths.push(links);
    }
    const anchors:NucleicAnchor[]=[];
    for(let s=0;s<2;s++)for(let i=0;i<count;i++){const site=(s===0?props.template:props.coding)[i],p=strandPoints[s][i],towards=unit(sub(strandPoints[1-s][i],p),'Paired strand separation'),tangent=project(tangents[i],towards);anchors.push({id:site.id,base:site.base,strand:s===0?'template':'coding',shape:shape(site.base),backbone:[...p],tip:add(p,mul(towards,props.radius*.9)),normal:towards,tangent});}
    const parts:NucleicPart[]=[
      {id:'template-backbone',role:'template-backbone',geometry:backbone(strandPoints[0],props.template.map(s=>s.id),props.backboneRadius,seed,'BLUE',radial,samples),opacity:1},
      {id:'coding-backbone',role:'coding-backbone',geometry:backbone(strandPoints[1],props.coding.map(s=>s.id),props.backboneRadius,seed,'TEAL',radial,samples),opacity:1},
      {id:'template-bases',role:'template-bases',geometry:plateMesh(anchors.slice(0,count),colors),opacity:1},
      {id:'coding-bases',role:'coding-bases',geometry:plateMesh(anchors.slice(count),colors),opacity:1},
    ];
    return {parts,anchors,pairs:props.pairs.map(([templateId,codingId],i)=>({templateId,codingId,pairedFraction:1-weights[i]*opening})),ends:{template:{fivePrime:props.template[count-1].id,threePrime:props.template[0].id},coding:{fivePrime:props.coding[0].id,threePrime:props.coding[count-1].id}},linkLengths:{template:lengths[0],coding:lengths[1]},opening,provenance:{kind:'schematic',description:'Explicit antiparallel Watson–Crick DNA pairs. Transported curved axis; baseline anchor-link lengths preserved through opening. Outside-window target positions may shift after chain constraint integration. Shaped base plates are schematic, not atomic geometry.'}};
  }
  function nucleicTranscript(props:NucleicTranscriptProps,time:number):NucleicTranscriptResult {
    if(!Number.isFinite(time))throw new Error('Transcript time must be finite');
    if(!props||!Array.isArray(props.bases)||!props.bases.length||props.bases.length>32)throw new Error('RNA transcript budget requires1–32 bases');id(props.id);
    if(!Number.isFinite(props.start))throw new Error('Transcript start must be finite');positive(props.secondsPerBase,'secondsPerBase',86400);positive(props.radius,'RNA radius');
    if(!Number.isFinite(props.approachFraction)||props.approachFraction<=0||props.approachFraction>=1)throw new Error('Transcript approachFraction must be in(0,1)');
    const duplex=props.duplex;if(!duplex||duplex.opening!==1||!Array.isArray(duplex.anchors)||duplex.anchors.length>256)throw new Error('Transcript requires a fully-open duplex snapshot');
    const snapshotIds=new Set<string>();for(const a of Array.from(duplex.anchors)){if(!a||!['template','coding'].includes(a.strand)||!['A','C','G','T'].includes(a.base)||snapshotIds.has(a.id))throw new Error('Invalid duplex anchor snapshot');id(a.id);snapshotIds.add(a.id);vec(a.backbone);vec(a.tip);unit(vec(a.normal),'Snapshot normal');unit(vec(a.tangent),'Snapshot tangent');positive(Math.hypot(...sub(a.tip,a.backbone)),'base reach',1000);}
    const template=duplex.anchors.filter(a=>a.strand==='template'),allIds=new Set(duplex.anchors.map(a=>a.id));
    const complement:Record<string,string>={A:'U',T:'A',C:'G',G:'C'},targets:NucleicAnchor[]=[];let previous=-1;
    for(const site of Array.from(props.bases)){if(!site||!['A','C','G','U'].includes(site.base))throw new Error('Invalid RNA sequence alphabet');id(site.id);if(allIds.has(site.id))throw new Error('Duplicate RNA identity');allIds.add(site.id);
      const index=template.findIndex(a=>a.id===site.templateId);if(index<0||previous>=0&&index!==previous+1)throw new Error('RNA template references must be known and consecutive in3to5 order');previous=index;const a=template[index];if(complement[a.base]!==site.base)throw new Error('RNA base is not complementary to template');
      const reach=Math.hypot(...sub(vec(a.tip),vec(a.backbone))),inward=unit(vec(a.normal),'Template frame'),p=add(vec(a.backbone),mul(inward,2*reach)),normal=mul(inward,-1),tangent=project(vec(a.tangent),normal);
      targets.push({id:site.id,base:site.base,strand:'rna',shape:shape(site.base),backbone:p,tip:add(p,mul(normal,reach)),tangent,normal});
    }
    const baselineLinks=targets.slice(1).map((a,i)=>Math.hypot(...sub(a.backbone,targets[i].backbone)));
    const emergence=props.emergence;
    if(emergence){
      positive(emergence.distance,'emergence distance',100);positive(emergence.duration,'emergence duration',86400);
      if(!Number.isFinite(emergence.delay)||emergence.delay<0||emergence.delay>86400)throw new Error('Invalid emergence delay');
      const direction=unit(vec(emergence.direction),'Emergence direction'),original=targets.map(a=>({...a,backbone:[...a.backbone] as Vec3}));
      // Adjacent smoothstep weights differ by at most h(3-h²)/2, h<=1.
      // Every desired forward link lies on L-lambda*direction, 0<=lambda<=span.
      // Check this whole segment before sampling time: a zero would make normalized
      // integration jump; an antipodal endpoint makes minimal frame rotation singular.
      const h=Math.min(1,props.secondsPerBase/emergence.duration),span=emergence.distance*h*(3-h*h)/2;
      for(let i=0;i<baselineLinks.length;i++){
        const link=sub(original[i+1].backbone,original[i].backbone),length=baselineLinks[i];
        positive(length,'RNA target link',1000);
        const closest=sub(link,mul(direction,Math.max(0,Math.min(span,dot(link,direction))))),end=sub(link,mul(direction,span));
        const minLength=Math.hypot(...closest),endLength=Math.hypot(...end);
        if(minLength<=1e-7*Math.max(1,length,span)||dot(link,end)/(length*endLength)<=-1+1e-6)
          throw new Error('Unsupported RNA emergence schedule: folding exit geometry; use a smaller distance, longer duration, or noncollinear direction');
      }
      const weights=targets.map((_,i)=>{const age=time-props.start-(i+props.approachFraction)*props.secondsPerBase-emergence.delay,u=Math.max(0,Math.min(1,age/emergence.duration));return u*u*(3-2*u);});
      const desired=targets.map((a,i)=>add(a.backbone,mul(direction,weights[i]*emergence.distance))),points=desired.map(p=>[...p] as Vec3);
      for(let i=targets.length-2;i>=0;i--)if(weights[i]>0||weights[i+1]>0)points[i]=add(points[i+1],mul(unit(sub(desired[i],desired[i+1]),'RNA exit link'),baselineLinks[i]));
      for(let i=0;i<targets.length;i++)if(weights[i]>0){
        const a=targets[i],next=i+1;
        let normal=a.normal,tangent=a.tangent;
        // The terminal base has no outgoing link: its pure exit translation
        // retains the docked frame. Following the already-bent previous link
        // only after its own weight becomes positive would cause an onset snap.
        if(next<targets.length){
          const before=unit(sub(original[next].backbone,original[i].backbone),'RNA old frame'),after=unit(sub(points[next],points[i]),'RNA exit frame'),c=dot(before,after),v=cross(before,after);
          if(c<-1+1e-7)throw new Error('RNA emergence frame reversal');
          const rotate=(n:Vec3)=>add(add(n,cross(v,n)),mul(cross(v,cross(v,n)),1/(1+c)));
          normal=rotate(normal);tangent=rotate(tangent);
        }
        const reach=Math.hypot(...sub(a.tip,a.backbone));a.backbone=points[i];a.tip=add(a.backbone,mul(normal,reach));a.normal=normal;a.tangent=tangent;
      }
    }
    const rotation=props.incomingRotation;
    if(rotation&&(!Number.isFinite(rotation.angle)||Math.abs(rotation.angle)>4*Math.PI))throw new Error('Incoming rotation angle must be finite within ±4PI');
    const rotationAxis=rotation?unit(vec(rotation.axis),'Incoming rotation axis'):undefined;
    const offset=vec(props.incomingOffset??[0,2,1.5]),parts:NucleicPart[]=[],anchors:NucleicAnchor[]=[],bonds:[string,string][]=[],linkLengths:number[]=[];let incorporated=0,incomingId:string|undefined;
    for(let i=0;i<targets.length;i++){
      const age=(time-props.start)/props.secondsPerBase-i,docked=age>=props.approachFraction,visible=age>=0,arrival=Math.max(0,Math.min(1,age/props.approachFraction)),eased=arrival*arrival*(3-2*arrival),delta=mul(offset,1-eased),target=targets[i];
      if(docked)incorporated++;else if(visible)incomingId=target.id;
      const anchor={...target,backbone:add(target.backbone,delta),tip:add(target.tip,delta),tangent:[...target.tangent] as Vec3,normal:[...target.normal] as Vec3};anchors.push(anchor);
      if(rotation&&rotationAxis&&!docked){
        const angle=rotation.angle*(1-eased),c=Math.cos(angle),s=Math.sin(angle);
        const rotate=(v:Vec3)=>add(add(mul(v,c),mul(cross(rotationAxis,v),s)),mul(rotationAxis,dot(rotationAxis,v)*(1-c)));
        anchor.tip=add(anchor.backbone,rotate(sub(target.tip,target.backbone)));
        anchor.tangent=rotate(target.tangent);anchor.normal=rotate(target.normal);
      }
      parts.push({id:`${props.id}/base/${i}`,role:'rna-nucleotide',geometry:plateMesh([anchor]),opacity:visible?1:0});
      if(i>0){const a=targets[i-1],b=target,length=baselineLinks[i-1];positive(length,'RNA target link',1000);linkLengths.push(length);
        parts.push({id:`${props.id}/link/${i}`,role:'rna-backbone',geometry:backbone([a.backbone,b.backbone],[a.id,b.id],props.radius,project(a.normal,unit(sub(b.backbone,a.backbone),'RNA link')),'ORANGE',8,2),opacity:docked?1:0});if(docked)bonds.push([a.id,b.id]);}
    }
    const triplets:[string,string,string][]=[];for(let i=0;i+2<incorporated;i+=3)triplets.push([targets[i].id,targets[i+1].id,targets[i+2].id]);
    return {parts,anchors,incorporated,...(incomingId?{incomingId}:{}),bonds,linkLengths,...(incorporated?{ends:{fivePrime:targets[0].id,threePrime:targets[incorporated-1].id}}:{}),triplets,provenance:{kind:'schematic',description:emergence?'RNA5to3 incorporation on an open-template snapshot. Base-pair complement is explicit; only incorporated sites form edges. Optional post-incorporation emergence deliberately moves formed anchors while retaining baseline link lengths. Free incoming nucleotides are not yet covalently linked.':'RNA5to3 incorporation on a fixed open-template snapshot. Base-pair complement is explicit; only incorporated sites form edges. Target backbone distances are schematic and remain fixed; free incoming nucleotides are not yet covalently linked.'}};
  }
  return {nucleicDuplex,nucleicTranscript};
}
