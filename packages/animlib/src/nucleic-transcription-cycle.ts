import type {NucleicTranscriptionCycleProps,NucleicTranscriptionCycleResult} from './nucleic-transcription-cycle-types.js';
import type {NucleicAnchor} from './nucleic-types.js';
import type {Vec3} from './types.js';

/** Self-contained for host/QuickJS installation; no hidden state or scene geometry. */
export function createNucleicTranscriptionCycleBuilders(){
  const add=(a:Vec3,b:Vec3):Vec3=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]],mul=(a:Vec3,n:number):Vec3=>[a[0]*n,a[1]*n,a[2]*n],sub=(a:Vec3,b:Vec3)=>add(a,mul(b,-1));
  const dot=(a:Vec3,b:Vec3)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2],cross=(a:Vec3,b:Vec3):Vec3=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const check=(ok:unknown,message:string)=>{if(!ok)throw Error('Transcription cycle: '+message);};
  const vec=(v:Vec3):Vec3=>{check(Array.isArray(v)&&v.length===3&&[0,1,2].every(i=>Number.isFinite(v[i])&&Math.abs(v[i])<=1e4),'dense bounded Vec3 required');return [...v];};
  const unit=(v:Vec3):Vec3=>{const n=Math.hypot(...v);check(n>1e-8&&Number.isFinite(n),'degenerate frame');return mul(v,1/n);};
  const number=(n:number,min:number,max:number,label:string)=>check(Number.isFinite(n)&&n>=min&&n<=max,label+' out of bounds');
  const dense=(a:unknown,min:number,max:number):a is unknown[]=>Array.isArray(a)&&a.length>=min&&a.length<=max&&Array.from({length:a.length},(_,i)=>i).every(i=>Object.prototype.hasOwnProperty.call(a,i));
  const smooth=(u:number)=>{u=Math.max(0,Math.min(1,u));return u*u*(3-2*u);};
  const shape=(base:string)=>base==='A'||base==='G'?'purine' as const:'pyrimidine' as const;
  function nucleicTranscriptionCycle(p:NucleicTranscriptionCycleProps,time:number):NucleicTranscriptionCycleResult{
    check(p&&typeof p==='object','props required');check(Number.isFinite(time),'finite time required');
    check(dense(p.template,2,128)&&dense(p.coding,2,128)&&p.template.length===p.coding.length,'dense matching DNA sites required');
    const n=p.template.length;check(dense(p.pairs,n,n)&&dense(p.transcript,1,128),'dense pairs/transcript required');
    check(p.templateDirection==='3to5'&&p.codingDirection==='5to3','antiparallel DNA directions required');
    const ids=new Set<string>(),validId=(id:string)=>{check(typeof id==='string'&&/^[A-Za-z0-9_.-]{1,120}$/.test(id)&&!ids.has(id),'invalid/duplicate identity');ids.add(id);};
    const complement:Record<string,string>={A:'T',T:'A',C:'G',G:'C'},rnaComplement:Record<string,string>={A:'U',T:'A',C:'G',G:'C'};
    for(let i=0;i<n;i++){const a=p.template[i],b=p.coding[i],pair=p.pairs[i];check(a&&b&&['A','C','G','T'].includes(a.base)&&['A','C','G','T'].includes(b.base),'DNA alphabet');validId(a.id);validId(b.id);check(dense(pair,2,2)&&pair[0]===a.id&&pair[1]===b.id&&complement[a.base]===b.base,'explicit complementary pair order');}
    let first=-1;for(let i=0;i<p.transcript.length;i++){const a=p.transcript[i];check(a&&typeof a==='object','transcript site required');validId(a.id);const index=p.template.findIndex(s=>s.id===a.templateId);if(i===0)first=index;check(index>=0&&index===first+i&&rnaComplement[p.template[index].base]===a.base,'contiguous complementary transcript mapping');}
    number(p.radius,.01,100,'radius');number(p.pitch,.01,100,'pitch');number(p.baseReach,.001,p.radius,'base reach');number(p.twistPerBase,-Math.PI/2,Math.PI/2,'twist');
    check(p.window&&typeof p.window==='object','window required');number(p.window.halfWidth,2,128,'window half width');number(p.window.separation,.001,100,'window separation');
    number(p.start,0,86400,'start');number(p.cycleDuration,.01,86400,'cycle duration');number(p.dockFraction,.05,.9,'dock fraction');check(p.start+p.cycleDuration*p.transcript.length<=86400,'complete schedule exceeds86400');
    if(p.opening!==undefined){check(p.opening&&typeof p.opening==='object','opening required');number(p.opening.start,0,p.start,'opening start');number(p.opening.duration,.01,86400,'opening duration');check(p.opening.start+p.opening.duration<=p.start,'opening must finish before first arrival');}
    number(p.rnaLinkLength,.01,100,'RNA link length');const exit=unit(vec(p.exitDirection));check(Math.hypot(exit[0],exit[2])>1e-6,'exit cannot be parallel to base normal');
    const exitFrame=p.exitFrame??'active',bend=p.exitBend??0;
    check(exitFrame==='active'||exitFrame==='axis','invalid exit frame');number(bend,-.3,.3,'exit bend');
    check(bend===0||Math.abs(bend)>=1e-6,'nonzero exit bend must be >= 1e-6');
    check(bend===0||exitFrame==='axis','curved exit requires axis frame');
    check(Math.abs(bend)*(p.transcript.length-1)<=Math.PI/2,'full-schedule exit turn exceeds pi/2');
    check(exitFrame!=='axis'||Math.abs(exit[0])>=.1,'axis exit requires axial component >= .1');
    check(p.window.lockOrientation===undefined||typeof p.window.lockOrientation==='boolean','lock orientation must be boolean');
    const offset=vec(p.incomingOffset??[0,1.8,1.2]),angle=p.incomingAngle??2.1;number(angle,-4*Math.PI,4*Math.PI,'incoming angle');
    check(p.axis&&typeof p.axis==='object','axis required');const origin=vec(p.axis.origin),axis=unit(vec(p.axis.direction)),seed=unit(vec(p.axis.normal)),normal=unit(sub(seed,mul(axis,dot(seed,axis)))),binormal=cross(axis,normal);
    const r=p.radius,sep=p.window.separation,twist=p.twistPerBase,L=Math.hypot(p.pitch,2*r*Math.sin(twist/2));
    // Sufficient full-schedule bound: |dr|<=sep*pi/(2h), and
    // 4*r1*r2*sin²(dtheta/2) <= [(r+sep*a)*twist*(1-a)]².
    // The latter quadratic reaches its maximum at this clamped stationary point.
    const stationary=Math.max(0,Math.min(1,(sep-r)/(2*sep))),g=(r+sep*stationary)*(1-stationary),bound=(sep*Math.PI/(2*p.window.halfWidth))**2+(twist*g)**2;
    check(bound<L*L*(1-1e-8),'opening exceeds conservative full-schedule strand feasibility bound');
    const count=p.transcript.length,age=Math.max(0,(time-p.start)/p.cycleDuration),cycle=Math.min(count-1,Math.floor(age)),fraction=age-Math.floor(age),phase=time<p.start?0:age>=count?1:fraction;
    const progress=time<p.start?0:Math.min(count-1,cycle+(cycle<count-1?smooth((phase-p.dockFraction)/(1-p.dockFraction)):0));
    const center=first+progress,opening=p.opening?smooth((time-p.opening.start)/p.opening.duration):1;
    const weights=Array.from({length:n},(_,i)=>{const d=Math.abs(i-center)/p.window.halfWidth;return d>=1?0:opening*Math.cos(d*Math.PI/2)**2;});
    const transverse:Vec3[]=[],xs=[0],angles:number[]=[];let theta=0;
    for(let i=0;i<n;i++){if(i)theta+=twist*(1-(weights[i-1]+weights[i])/2);angles.push(theta);transverse.push(add(mul(normal,(r+sep*weights[i])*Math.cos(theta)),mul(binormal,(r+sep*weights[i])*Math.sin(theta))));if(i){const d=sub(transverse[i],transverse[i-1]);xs.push(xs[i-1]+Math.sqrt(L*L-dot(d,d)));}}
    const cLo=Math.floor(center),cHi=Math.min(n-1,cLo+1),cBlend=center-cLo,delta=angles[cHi]-angles[cLo];
    const activeTheta=angles[cLo]+Math.atan2(cBlend*Math.sin(delta),1-cBlend+cBlend*Math.cos(delta));
    if(p.window.lockOrientation)for(let i=0;i<n;i++)transverse[i]=add(mul(normal,(r+sep*weights[i])*Math.cos(angles[i]-activeTheta)),mul(binormal,(r+sep*weights[i])*Math.sin(angles[i]-activeTheta)));
    const mean=xs.reduce((a,b)=>a+b,0)/n,dna:NucleicAnchor[]=[],dnaBonds:[string,string][]=[];
    for(const side of [-1,1])for(let i=0;i<n;i++){const site=side<0?p.template[i]:p.coding[i],backbone=add(origin,add(mul(axis,xs[i]-mean),mul(transverse[i],side))),baseward=mul(unit(transverse[i]),-side);dna.push({id:site.id,base:site.base,strand:side<0?'template':'coding',shape:shape(site.base),backbone,tip:add(backbone,mul(baseward,p.baseReach)),tangent:[...axis],normal:baseward});if(i)dnaBonds.push([(side<0?p.template:p.coding)[i-1].id,site.id]);}
    const lo=Math.floor(center),hi=Math.min(n-1,lo+1),blend=center-lo,a=dna[lo],b=dna[hi],templatePosition=add(mul(a.backbone,1-blend),mul(b.backbone,blend)),activeNormal=unit(add(mul(a.normal,1-blend),mul(b.normal,blend))),activeBinormal=cross(axis,activeNormal),position=add(templatePosition,mul(activeNormal,2*p.baseReach));
    const world=(v:Vec3)=>add(add(mul(axis,v[0]),mul(activeNormal,v[1])),mul(activeBinormal,v[2])),exitWorld=world(exit),baseNormal=mul(activeNormal,-1),tangent=unit(sub(exitWorld,mul(baseNormal,dot(exitWorld,baseNormal))));
    const fixedWorld=(v:Vec3)=>add(add(mul(axis,v[0]),mul(normal,v[1])),mul(binormal,v[2]));
    const stableExit=fixedWorld(exit),curveSide=unit(sub(normal,mul(stableExit,dot(normal,stableExit)))),curveAxis=cross(stableExit,curveSide);
    const rotateAbout=(v:Vec3,k:Vec3,a:number)=>add(add(mul(v,Math.cos(a)),mul(cross(k,v),Math.sin(a))),mul(k,dot(k,v)*(1-Math.cos(a))));
    const anchors:NucleicAnchor[]=[],bonds:[string,string][]=[],visibleIds:string[]=[];let incorporated=0,incomingId:string|undefined;
    // Compare declared absolute events directly; inverse arithmetic can round
    // across an arrival/docking boundary. Completion uses the same decisions.
    for(let i=0;i<count;i++){
      const arrivalTime=p.start+i*p.cycleDuration,dockingTime=p.start+(i+p.dockFraction)*p.cycleDuration,local=(time-p.start)/p.cycleDuration-i,visible=time>=arrivalTime,docked=time>=dockingTime,u=smooth(local/p.dockFraction),q=progress-i;
      let target=add(position,mul(exitWorld,p.rnaLinkLength*q)),bn0=baseNormal,bt0=tangent,spin=exitWorld;
      if(exitFrame==='axis'){
        const theta=bend*q,half=bend/2,rad=bend===0?0:p.rnaLinkLength/(2*Math.sin(half));
        target=add(position,bend===0?mul(stableExit,p.rnaLinkLength*q):add(mul(stableExit,rad*Math.sin(theta)),mul(curveSide,rad*2*Math.sin(theta/2)**2)));
        const unwind=(p.window.lockOrientation?0:activeTheta)*(1-smooth(Math.max(0,q)/2)),localNormal=rotateAbout(mul(normal,-1),axis,unwind);
        bn0=rotateAbout(localNormal,curveAxis,theta);
        bt0=rotateAbout(unit(sub(stableExit,mul(localNormal,dot(stableExit,localNormal)))),curveAxis,theta);
        spin=rotateAbout(stableExit,curveAxis,theta);
      }
      const backbone=add(target,mul(world(offset),docked?0:1-u)),rotation=docked?0:angle*(1-u),c=Math.cos(rotation),ss=Math.sin(rotation),rotate=(v:Vec3)=>add(add(mul(v,c),mul(cross(spin,v),ss)),mul(spin,dot(spin,v)*(1-c))),bn=rotate(bn0),bt=rotate(bt0),site=p.transcript[i];
      anchors.push({id:site.id,base:site.base,strand:'rna',shape:shape(site.base),backbone,tip:add(backbone,mul(bn,p.baseReach)),normal:bn,tangent:bt});
      if(visible)visibleIds.push(site.id);if(docked){incorporated++;if(i)bonds.push([p.transcript[i-1].id,site.id]);}else if(visible)incomingId=site.id;
    }
    for(const anchor of [...dna,...anchors])check([...anchor.backbone,...anchor.tip].every(v=>Number.isFinite(v)&&Math.abs(v)<1e5),'generated geometry outside bounds');
    return {dna:{anchors:dna,pairs:p.pairs.map(([templateId,codingId],i)=>({templateId,codingId,opening:weights[i]})),bonds:dnaBonds,linkLength:L},rna:{anchors,bonds,visibleIds,incorporated,...(incomingId?{incomingId}:{}),linkLength:p.rnaLinkLength},activeSite:{position,templatePosition,tangent:[...axis],normal:activeNormal,binormal:activeBinormal,register:center,templateIds:[a.id,b.id]},progress,complete:incorporated===count,provenance:{kind:'schematic',description:exitFrame==='axis'||p.window.lockOrientation?'Original straight-axis moving transcription window; optional coherent duplex phase lock and bounded fixed-anatomical circular RNA exit with exact chord links. Illustrative prescribed transport, not chemical dynamics or world-anchored exterior DNA.':'Original straight-axis moving transcription window with exact strand-link constraints and prescribed straight RNA extrusion. Pair radius and twist close behind the window; common centering can move exterior sites. Not chemical dynamics, a curved exit solver, or a deposited enzyme.'}};
  }
  return {nucleicTranscriptionCycle};
}
