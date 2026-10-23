import type {NucleicTranslationProps,NucleicTranslationResult} from './nucleic-translation-types.js';
import type {Vec3} from './types.js';
/** Self-contained factory for identical host and QuickJS absolute-time evaluation. */
export function createNucleicTranslationBuilders(){
 const check=(ok:unknown,s:string)=>{if(!ok)throw Error('Translation: '+s);};
 const dense=(v:unknown,min:number,max:number)=>Array.isArray(v)&&v.length>=min&&v.length<=max&&Array.from({length:v.length},(_,i)=>i).every(i=>Object.prototype.hasOwnProperty.call(v,i));
 const num=(v:number,min:number,max:number,s:string)=>check(Number.isFinite(v)&&v>=min&&v<=max,s+' out of bounds');
 const vec=(v:Vec3)=>{check(dense(v,3,3)&&v.every(n=>Number.isFinite(n)&&Math.abs(n)<=1000),'bounded dense vector required');return v;};
 const add=(a:Vec3,b:Vec3):Vec3=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]],mul=(a:Vec3,n:number):Vec3=>[a[0]*n,a[1]*n,a[2]*n],dot=(a:Vec3,b:Vec3)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2],cross=(a:Vec3,b:Vec3):Vec3=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],unit=(a:Vec3)=>{const n=Math.hypot(...a);check(n>1e-8,'degenerate frame');return mul(a,1/n);};
 const smooth=(v:number)=>{v=Math.max(0,Math.min(1,v));return v*v*(3-2*v);};
 // Standard code in NCBI's U,C,A,G lexical ordering; * denotes release, never cargo.
 const letters='UCAG',code='FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG',names:Record<string,string>={F:'Phe',L:'Leu',S:'Ser',Y:'Tyr',C:'Cys',W:'Trp',P:'Pro',H:'His',Q:'Gln',R:'Arg',I:'Ile',M:'Met',T:'Thr',N:'Asn',K:'Lys',V:'Val',A:'Ala',D:'Asp',E:'Glu',G:'Gly'},complement:Record<string,string>={A:'U',U:'A',G:'C',C:'G'};
 function nucleicTranslationCycle(p:NucleicTranslationProps,time:number):NucleicTranslationResult{
  check(p&&typeof p==='object','props required');check(Number.isFinite(time),'finite absolute time required');check(dense(p.sites,6,192)&&p.sites.length%3===0,'dense complete codons required');check(p.direction==='5to3'&&p.anticodonDirection==='3to5','explicit antiparallel orientations required');
  const n=p.sites.length/3-1;check(dense(p.carriers,n,n),'one carrier per sense codon required');const ids=new Set<string>(),id=(s:string)=>{check(typeof s==='string'&&/^[A-Za-z0-9_.-]{1,120}$/.test(s)&&!ids.has(s),'invalid or duplicate identity');ids.add(s);};
  p.sites.forEach(s=>{check(s&&typeof s==='object'&&letters.includes(s.base)&&s.base.length===1,'RNA alphabet required');id(s.id);});
  const codons=Array.from({length:n+1},(_,i)=>{const sequence=p.sites.slice(i*3,i*3+3).map(s=>s.base).join(''),letter=code[letters.indexOf(sequence[0])*16+letters.indexOf(sequence[1])*4+letters.indexOf(sequence[2])];check(i===n?letter==='*':letter!=='*','one terminal stop required');if(i===0)check(sequence==='AUG','AUG initiation required');return {index:i,ids:p.sites.slice(i*3,i*3+3).map(s=>s.id) as [string,string,string],sequence,aminoAcid:letter==='*'?null:names[letter]};});
  p.carriers.forEach((c,i)=>{check(c&&typeof c==='object','carrier required');id(c.id);id(c.residueId);check(c.anticodon===Array.from(codons[i].sequence).map(b=>complement[b]).join(''),'complementary 3to5 anticodon required');check(c.aminoAcid===codons[i].aminoAcid,'standard-code cargo mismatch');});
  num(p.pitch,.05,10,'pitch');num(p.carrierHeight,.1,20,'carrier height');num(p.peptideSpacing,.05,5,'peptide spacing');num(p.subunitSeparation,.1,20,'subunit separation');num(p.start,0,86400,'start');num(p.cycleDuration,.1,10000,'cycle duration');num(p.releaseDuration,.1,10000,'release duration');num(p.disassemblyDuration,.1,10000,'disassembly duration');check(p.assembly&&typeof p.assembly==='object','assembly required');num(p.assembly.start,0,p.start,'assembly start');num(p.assembly.duration,.1,10000,'assembly duration');check(p.assembly.start+p.assembly.duration<=p.start,'assembly must precede initiation');const stop=p.start+n*p.cycleDuration,release=stop+p.cycleDuration*.25,end=release+p.releaseDuration+p.disassemblyDuration;check(end<=86400,'complete schedule exceeds 86400 seconds');
  let coilRadius=0,coilTwist=0,rise=p.peptideSpacing;if(p.productCoil!==undefined){check(p.productCoil&&typeof p.productCoil==='object','coil object required');num(p.productCoil.radius,.001,5,'coil radius');num(p.productCoil.twist,.01,Math.PI,'coil twist');coilRadius=p.productCoil.radius;coilTwist=p.productCoil.twist;const chord=2*coilRadius*Math.sin(coilTwist/2);check(chord<p.peptideSpacing,'coil chord must be shorter than peptide spacing');rise=Math.sqrt(p.peptideSpacing*p.peptideSpacing-chord*chord);}
  const coil=(k:number):Vec3=>[coilRadius*Math.sin(k*coilTwist),k*rise,coilRadius*(1-Math.cos(k*coilTwist))];
  const origin=vec(p.origin),x=unit(vec(p.axis)),seed=unit(vec(p.normal)),y=unit(add(seed,mul(x,-dot(x,seed)))),z=cross(x,y),arrival=vec(p.arrivalOffset),exit=vec(p.exitOffset),world=(v:Vec3)=>add(origin,add(add(mul(x,v[0]),mul(y,v[1])),mul(z,v[2]))),d=3*p.pitch,P=-d/2,A=d/2,E=-d*1.5,h=p.carrierHeight;
  // Absolute event comparisons own discrete state. Dividing elapsed time first
  // can put an exact event on the wrong side of its fractional cycle boundary.
  const event=(i:number,f=0)=>p.start+(i+f)*p.cycleDuration;
  const progress=(a:number,b:number)=>time<=a?0:time>=b?1:smooth((time-a)/(b-a));
  const interval=(i:number,a:number,b:number)=>progress(event(i,a),event(i,b));
  const advance=(i:number)=>i===0?0:interval(i,.5,.7);let register=0;for(let i=1;i<n;i++)register+=advance(i);
  const site=(a:number)=>world([a,.3,0]);const sites={A:site(A),P:site(P),E:site(E)};
  const carriers=p.carriers.map((c,i)=>{const a=interval(i,0,.25),own=advance(i),nextMove=interval(i+1,.5,.7),isLast=i===n-1,lastMove=isLast?0:nextMove,exitStart=isLast?release:event(i+1,.7),exitEnd=isLast?release+.6*p.releaseDuration:event(i+1,.95),lastDepart=progress(exitStart,exitEnd);
   const dock=i===0?P:A,px=dock-(i===0?0:d*own)-d*lastMove,local:Vec3=[px+arrival[0]*(1-a)+exit[0]*lastDepart,.3+arrival[1]*(1-a)+exit[1]*lastDepart,arrival[2]*(1-a)+exit[2]*lastDepart],anticodonPosition=world(local),payloadPosition=world(add(local,[0,h,0]));
   const arrived=time>=event(i),spent=isLast?time>=release:time>=event(i+1,.5),moving=(i>0&&time>event(i,.5)&&time<event(i,.7))||(!isLast&&time>event(i+1,.5)&&time<event(i+1,.7));
   const carrierPhase=!arrived?'waiting':time<event(i,.25)?'arriving':time>=exitEnd?'spent':time>exitStart?'exiting':moving?'translocating':'docked';
   return {id:c.id,anticodon:c.anticodon,position:anticodonPosition,anticodonPosition,payloadPosition,tangent:[...x] as Vec3,normal:[...y] as Vec3,phase:carrierPhase as NucleicTranslationResult['carriers'][number]['phase'],visible:arrived&&time<exitEnd,loaded:arrived&&!spent};});
  // Continuous old-chain transfer P -> A with room made for the incoming residue.
  let incorporated=0,current=0;for(let i=0;i<n;i++){if(time>=event(i,i===0?.25:.5))incorporated++;if(time>=event(i))current=i;}
  const transfer=current===0?0:interval(current,.3,.5),transferring=current>0&&time>event(current,.3)&&time<event(current,.5),move=advance(current),releasing=progress(release,release+p.releaseDuration),released=time>=release;
  const activeX=current===0?P:P+d*transfer-d*move,chainCount=current===0?1:current+transfer,shift:Vec3=[6*releasing,1*releasing,2*releasing];
  const residues=p.carriers.map((c,i)=>{let position=carriers[i].payloadPosition;if(i<current||(i===current&&time>=event(i,i===0?.25:.5)))position=world(add(add([activeX,.3+h,0],coil(chainCount-1-i)),shift));return {id:c.residueId,aminoAcid:c.aminoAcid,position,visible:time>=event(i),incorporated:i<incorporated};});
  // At the terminal stop the product remains on its P-site carrier
  // until release; product release itself is an independent rigid departure.
  if(time>=stop)for(let i=0;i<n;i++)residues[i].position=world(add(add([P,.3+h,0],coil(n-1-i)),shift));
  const bonds:[string,string][]=[];for(let i=1;i<incorporated;i++)bonds.push([p.carriers[i-1].residueId,p.carriers[i].residueId]);
  const anchors=p.sites.map((s,i)=>{const px=P+(i-1)*p.pitch-register*d,curve=.06*px*px;return {id:s.id,base:s.base,strand:'rna' as const,shape:(s.base==='A'||s.base==='G'?'purine':'pyrimidine') as 'purine'|'pyrimidine',backbone:world([px,-curve,0]),tip:world([px,.18-curve,0]),tangent:unit(add(x,mul(y,-.12*px))),normal:unit(add(y,mul(x,.12*px)))};});
  const assembled=progress(p.assembly.start,p.assembly.start+p.assembly.duration),separate=progress(release+p.releaseDuration,end),gap=p.subunitSeparation*(1-assembled+separate),subunits=[{id:'large' as const,position:world([0,gap,0])},{id:'small' as const,position:world([0,-gap,0])}];
  return {rna:{anchors,bonds:p.sites.slice(1).map((s,i)=>[p.sites[i].id,s.id]),register},codons,sites,carriers,product:{residues,bonds,...(transferring?{transfer:{fromCarrierId:p.carriers[current-1].id,toCarrierId:p.carriers[current].id,progress:transfer}}:!released&&incorporated?{attachedCarrierId:p.carriers[incorporated-1].id}:{}),released},subunits,stopRecognized:time>=stop+.2*p.cycleDuration,complete:time>=end,provenance:{kind:'schematic',description:'Original prescribed A/P/E translation choreography with standard-code mapping and persistent identities. Anticodons read 3to5; RNA 5to3. No wobble, release-factor structure, molecular dynamics, reaction rates or deposited ribosome geometry.'}};
 }
 return {nucleicTranslationCycle};
}
