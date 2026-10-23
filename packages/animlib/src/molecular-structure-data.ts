import type { MolecularBackboneProps } from './molecular-backbone-types.js';
import type { MolecularStructure, StructureAtom, StructureBond, StructureImportOptions, StructureResidue } from './molecular-structure-types.js';
import type { Vec3 } from './types.js';

/** Bounded host-only legacy PDB preparation. Does not alter the compatibility importer. */
export function importPDBStructure(text:string,options:StructureImportOptions):MolecularStructure {
  if(typeof text!=='string'||text.length>16000000||!options||typeof options.source!=='string'||!options.source.trim())throw new Error('Identified PDB import requires bounded legacy PDB text and source');
  if(options.polymerLinks!==undefined&&!['none','standard-peptide'].includes(options.polymerLinks))throw new Error('Unsupported polymer link policy');
  if(options.chains!==undefined&&(!Array.isArray(options.chains)||options.chains.length>100||Array.from(options.chains).some(c=>typeof c!=='string'||c.length>1)))throw new Error('Invalid PDB chain selection');
  const templates=options.residueTemplates??{};
  if(typeof templates!=='object'||Array.isArray(templates)||Object.keys(templates).length>256)throw new Error('Invalid residue templates');
  for(const [name,t] of Object.entries(templates))if(!name||!t||typeof t.source!=='string'||!t.source||typeof t.version!=='string'||!t.version||!Array.isArray(t.bonds)||t.bonds.length>256||Array.from(t.bonds).some(b=>!b||typeof b.a!=='string'||!b.a||typeof b.b!=='string'||!b.b||b.a===b.b||!['single','double','triple','aromatic','unspecified'].includes(b.order)))throw new Error(`Invalid residue template ${name}`);
  const standard=new Set('ALA ARG ASN ASP CYS GLN GLU GLY HIS ILE LEU LYS MET PHE PRO SER THR TRP TYR VAL'.split(' '));
  type Raw=StructureAtom&{chain:string;seq:number;ins:string;resname:string;block:number};
  const residueNames=new Map<string,string>(),groups=new Map<string,Raw[]>(),serials=new Set<number>(),connections:[number,number][]=[],titles:string[]=[],diagnostics:string[]=[];
  let laterModel=false,model='1',accession=options.accession,block=0,startedModel=false,coordinatesClosed=false,foundAtoms=false,ignoredHetero=0;
  const integer=(raw:string,label:string)=>{if(!/^-?\d+$/.test(raw.trim()))throw new Error(`Invalid PDB ${label}`);return Number(raw);};
  const lines=text.split(/\r?\n/);if(lines.length>200000)throw new Error('PDB record budget exceeded');
  for(let index=0;index<lines.length;index++){
    const line=lines[index],record=line.slice(0,6).trim();
    if(record==='HEADER')accession??=line.slice(62,66).trim()||undefined;
    if(record==='TITLE')titles.push(line.slice(10,80).trim());
    if(record==='MODEL'){if(startedModel||foundAtoms){coordinatesClosed=true;laterModel=true;}else{startedModel=true;model=line.slice(10,14).trim()||'1';}continue;}
    if(record==='ENDMDL'){coordinatesClosed=true;laterModel=false;continue;}
    if(record==='CONECT'){
      if(laterModel)continue;
      const from=integer(line.slice(6,11),'CONECT serial');
      for(let col=11;col<31;col+=5)if(line.slice(col,col+5).trim()){const to=integer(line.slice(col,col+5),'CONECT target');if(from===to)throw new Error('Self-linked PDB CONECT');connections.push([from,to]);if(connections.length>400000)throw new Error('PDB connectivity budget exceeded');}continue;
    }
    if(coordinatesClosed)continue;
    if(record==='TER'){block++;continue;}
    if(record==='HETATM'){ignoredHetero++;continue;}
    if(record!=='ATOM')continue;
    foundAtoms=true;
    const chain=line.slice(21,22).trim();if(options.chains&&!options.chains.includes(chain))continue;
    const serial=integer(line.slice(6,11),'atom serial');if(serials.has(serial))throw new Error(`Duplicate PDB atom serial ${serial}`);serials.add(serial);
    if(serials.size>100000)throw new Error('PDB atom budget exceeds100000');
    const name=line.slice(12,16).trim(),alt=line.slice(16,17).trim(),resname=line.slice(17,20).trim(),seq=integer(line.slice(22,26),'author sequence'),ins=line.slice(26,27).trim();
    if(!name||!resname||!/^[A-Za-z]?$/.test(ins)||!/^[A-Za-z0-9]?$/.test(alt))throw new Error(`Unsupported PDB atom identity at line ${index+1}`);
    const fields=[line.slice(30,38),line.slice(38,46),line.slice(46,54)],position=fields.map(Number) as Vec3;
    if(fields.some(f=>!f.trim())||position.some(v=>!Number.isFinite(v)||Math.abs(v)>1e6))throw new Error(`Invalid PDB coordinate at line ${index+1}`);
    const occupancyText=line.slice(54,60).trim(),occupancy=occupancyText?Number(occupancyText):1;
    if(!Number.isFinite(occupancy)||occupancy<0||occupancy>1)throw new Error(`Invalid PDB occupancy at line ${index+1}`);
    if(occupancy===0)continue;
    const element=line.slice(76,78).trim().toUpperCase()||name.replace(/^\d+/,'').slice(0,1).toUpperCase();if(element==='H'||element==='D')continue;
    if(!/^[A-Z]{1,2}$/.test(element))throw new Error(`Unsupported PDB element at line ${index+1}`);
    const siteKey=JSON.stringify([model,chain,block,seq,ins]);
    if(residueNames.has(siteKey)&&residueNames.get(siteKey)!==resname)throw new Error('Unsupported PDB residue microheterogeneity: select a residue identity before import');residueNames.set(siteKey,resname);
    const residueId=[model,chain,block,seq,ins,resname].map(String).map(encodeURIComponent).join('/'),id=`${residueId}/${encodeURIComponent(name)}`;
    const raw:Raw={id,residueId,serial,name,element,alt,occupancy,position,chain,seq,ins,resname,block};
    const group=groups.get(residueId)??[];group.push(raw);groups.set(residueId,group);
  }
  if(!foundAtoms||!groups.size)throw new Error('No selected ATOM records: expected legacy PDB, not mmCIF');
  if(ignoredHetero)diagnostics.push(`Excluded ${ignoredHetero} HETATM records (ligands/waters/modified residues are outside this selection).`);
  const result:MolecularStructure={format:'animlib-structure-v1',units:'angstrom',...(accession?{accession}:{}),model,title:titles.join(' '),atoms:[],residues:[],segments:[],breaks:[],bonds:[],center:[0,0,0],diagnostics,
    provenance:{source:options.source,selection:'first model, ATOM heavy atoms; HETATM/H/D/zero occupancy excluded',alternateLocations:'One residue-wide alternate selected by mean occupancy, lexicographic ties; shared atoms retained.',polymerLinks:options.polymerLinks??'none'}};
  const atomBySerial=new Map<number,StructureAtom>(),atomById=new Map<string,StructureAtom>(),rawResidues:Raw[]=[];
  for(const list of groups.values()){
    const alternatives=new Map<string,{sum:number;count:number}>();for(const a of list)if(a.alt){const x=alternatives.get(a.alt)??{sum:0,count:0};x.sum+=a.occupancy;x.count++;alternatives.set(a.alt,x);}
    const selectedAlt=[...alternatives].sort((a,b)=>b[1].sum/b[1].count-a[1].sum/a[1].count||a[0].localeCompare(b[0]))[0]?.[0]??'';
    const chosen=new Map<string,Raw>();for(const a of list)if(!a.alt||a.alt===selectedAlt){const old=chosen.get(a.name);if(old){if(old.alt===a.alt)throw new Error(`Duplicate selected atom name ${a.name} in ${a.residueId}`);if(old.alt)continue;}chosen.set(a.name,a);}
    const first=list[0],residue:StructureResidue={id:first.residueId,chainId:first.chain,authorSequence:first.seq,insertionCode:first.ins,name:first.resname,selectedAlt,atomIds:[],segmentId:'',value:0};
    rawResidues.push(first);
    for(const a of chosen.values()){const {id,residueId,serial,name,element,alt,occupancy,position}=a;const atom:StructureAtom={id,residueId,serial,name,element,alt,occupancy,position:[...position]};result.atoms.push(atom);atomBySerial.set(serial,atom);atomById.set(id,atom);residue.atomIds.push(id);if(name===(standard.has(first.resname)?'CA':'P'))residue.anchorId=id;}
    result.residues.push(residue);
  }
  const bondByPair=new Map<string,StructureBond>();
  function bond(a:string,b:string,order:StructureBond['order'],kind:StructureBond['sources'][number]['kind'],source:string){
    const key=[a,b].sort().join('\0'),old=bondByPair.get(key);if(old){if(!old.sources.some(s=>s.kind===kind&&s.source===source))old.sources.push({kind,source});if(old.order==='unspecified')old.order=order;return;}
    const p=atomById.get(a)!.position,q=atomById.get(b)!.position;if(Math.hypot(...p.map((v,j)=>v-q[j]))<1e-8)throw new Error('Deposited bond has repeated coordinates');
    const edge:StructureBond={a,b,order,sources:[{kind,source}]};bondByPair.set(key,edge);result.bonds.push(edge);if(result.bonds.length>200000)throw new Error('PDB output bond budget exceeded');
  }
  for(const [a,b] of connections){const aa=atomBySerial.get(a),bb=atomBySerial.get(b);if(aa&&bb)bond(aa.id,bb.id,'unspecified','CONECT',`${options.source} serials ${a}–${b}`);else if(diagnostics.length<100)diagnostics.push(`CONECT ${a}–${b} references excluded or unselected atoms; no replacement edge inferred.`);}
  for(const r of result.residues){const template=templates[r.name];if(!template)continue;const names=new Map(r.atomIds.map(id=>[atomById.get(id)!.name,id]));for(const e of template.bonds){const a=names.get(e.a),b=names.get(e.b);if(a&&b)bond(a,b,e.order,'template',`${template.source} (${template.version})`);}}
  for(let i=0;i<result.residues.length;i++){
    const r=result.residues[i],raw=rawResidues[i],prev=result.residues[i-1],prevRaw=rawResidues[i-1];r.value=result.residues.length===1?0:i/(result.residues.length-1);
    let reason:MolecularStructure['breaks'][number]['reason']|undefined;
    if(prev){
      const consecutive=(r.authorSequence===prev.authorSequence+1&&!r.insertionCode)||(r.authorSequence===prev.authorSequence&&r.insertionCode.charCodeAt(0)===(prev.insertionCode?prev.insertionCode.charCodeAt(0)+1:65));
      if(raw.block!==prevRaw.block)reason='TER';else if(r.chainId!==prev.chainId)reason='chain-change';else if(!consecutive)reason='author-gap';
      else if(!standard.has(r.name)||!standard.has(prev.name))reason='unsupported-polymer';
      else {const c=prev.atomIds.map(id=>atomById.get(id)!).find(a=>a.name==='C'),n=r.atomIds.map(id=>atomById.get(id)!).find(a=>a.name==='N');
        if(!c||!n||!r.anchorId||!prev.anchorId)reason='missing-polymer-atoms';
        else {const d=Math.hypot(...c.position.map((v,j)=>v-n.position[j]));if(d<0.8||d>1.8)reason='polymer-distance';else if(options.polymerLinks==='standard-peptide')bond(c.id,n.id,'single','peptide-rule','Declared standard peptide C–N template; contiguous author sequence, same TER block, C–N distance0.8–1.8Å sanity gate');}
      }
    }
    if(!prev||reason){const id=`segment-${result.segments.length}`;result.segments.push({id,chainId:r.chainId,residueIds:[]});if(reason)result.breaks.push({before:r.id,reason});}
    const segment=result.segments[result.segments.length-1];r.segmentId=segment.id;segment.residueIds.push(r.id);
  }
  const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];for(const a of result.atoms)for(let j=0;j<3;j++){lo[j]=Math.min(lo[j],a.position[j]);hi[j]=Math.max(hi[j],a.position[j]);}
  result.center=lo.map((v,j)=>(v+hi[j])/2) as Vec3;
  return result;
}

/** Map one selected conformer to existing native builders without inventing atom bonds. */
export function structureBackboneProps(structure:MolecularStructure,representation:'atoms'|'residues',radius:number):MolecularBackboneProps {
  if(!structure||structure.format!=='animlib-structure-v1'||!['atoms','residues'].includes(representation)||!Number.isFinite(radius)||radius<=0)throw new Error('Invalid identified structure mapping');
  const atoms=new Map(structure.atoms.map(a=>[a.id,a])),residues=new Map(structure.residues.map(r=>[r.id,r]));
  const segments=representation==='atoms'?structure.atoms.map(a=>({id:a.id,chainId:residues.get(a.residueId)!.chainId,residues:[{id:a.id,position:[...a.position] as Vec3,value:residues.get(a.residueId)!.value}]})):
    structure.segments.flatMap(s=>{const r=s.residueIds.map(id=>residues.get(id)!).filter(r=>r.anchorId);return r.length?[{id:s.id,chainId:s.chainId,residues:r.map(r=>({id:r.id,position:[...atoms.get(r.anchorId!)!.position] as Vec3,value:r.value}))}]:[];});
  if(!segments.length)throw new Error('Structure mapping has no selected anchors');
  return {segments,bonds:representation==='atoms'?structure.bonds.map(b=>[b.a,b.b]):[],representation:representation==='atoms'?'sticks':'beads',radius,origin:[...structure.center],provenance:{kind:'scientific',source:structure.provenance.source,units:'angstrom'}};
}
