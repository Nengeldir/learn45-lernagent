import type { MolecularChain, MolecularData, PDBImportOptions } from './molecule-types.js';
import type { Vec3 } from './types.js';

/** Offline legacy PDB reader. Intentionally excluded from the scene VM. */
export function importPDB(text: string, options: PDBImportOptions): MolecularData {
  if(typeof text!=='string' || !options?.source?.trim()) throw new Error('PDB import requires text and a provenance source');
  const selection=options.selection ?? 'residues';
  if(selection!=='residues' && selection!=='heavy-atoms') throw new Error('Invalid PDB selection');
  const proteins=new Set('ALA ARG ASN ASP CYS GLN GLU GLY HIS ILE LEU LYS MET PHE PRO SER THR TRP TYR VAL SEC PYL'.split(' '));
  const nucleic=new Set('A C G U I DA DC DG DT DI DU'.split(' '));
  type Atom={name:string;residue:string;seq:string;chain:string;alt:string;occupancy:number;xyz:Vec3;kind:MolecularChain['kind'];element:string};
  const residues=new Map<string,Atom[]>(),titles:string[]=[];
  let pdbId:string|undefined,model='1',foundAtom=false,startedModel=false;
  for(const [index,line] of text.split(/\r?\n/).entries()) {
    const record=line.slice(0,6).trim();
    if(record==='HEADER') pdbId=line.slice(62,66).trim() || undefined;
    if(record==='TITLE') titles.push(line.slice(10,80).trim());
    if(record==='MODEL') { if(startedModel || foundAtom) break; startedModel=true;model=line.slice(10,14).trim() || '1'; }
    if(record==='ENDMDL') break;
    if(record!=='ATOM') continue; // HETATM ligands, waters and modified residues require explicit external handling.
    foundAtom=true;
    const chain=line.slice(21,22).trim();
    if(options.chains && !options.chains.includes(chain)) continue;
    const name=line.slice(12,16).trim(),residue=line.slice(17,20).trim(),seq=line.slice(22,27).trim(),alt=line.slice(16,17).trim();
    const fields=[line.slice(30,38),line.slice(38,46),line.slice(46,54)];
    const xyz=fields.map(Number) as Vec3;
    if(fields.some(v=>!v.trim()) || xyz.some(v=>!Number.isFinite(v) || Math.abs(v)>1e6)) throw new Error(`Invalid PDB coordinate on line ${index+1}`);
    const occupancyText=line.slice(54,60).trim(),occupancy=occupancyText ? Number(occupancyText) : 1;
    if(!Number.isFinite(occupancy) || occupancy<0 || occupancy>1) throw new Error(`Invalid PDB occupancy on line ${index+1}`);
    if(occupancy===0)continue;
    const element=line.slice(76,78).trim().toUpperCase() || name.replace(/^\d+/,'').slice(0,1).toUpperCase();
    if(element==='H'||element==='D')continue;
    const kind=proteins.has(residue)?'protein':nucleic.has(residue)?'nucleic':'other';
    const key=`${chain}\0${seq}`,atom:Atom={name,residue,seq,chain,alt,occupancy,xyz,kind,element};
    const list=residues.get(key)??[];list.push(atom);residues.set(key,list);
  }
  if(!foundAtom)throw new Error('No ATOM records found: expected legacy PDB text, not mmCIF');
  const chains=new Map<string,MolecularChain>(),min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(const atoms of residues.values()) {
    // One residue-wide conformer: highest mean occupancy; lexicographic tie-break.
    const alternatives=new Map<string,{sum:number;count:number}>();
    for(const a of atoms)if(a.alt){const v=alternatives.get(a.alt)??{sum:0,count:0};v.sum+=a.occupancy;v.count++;alternatives.set(a.alt,v);}
    const alt=[...alternatives].sort((a,b)=>b[1].sum/b[1].count-a[1].sum/a[1].count || a[0].localeCompare(b[0]))[0]?.[0];
    const chosen=new Map<string,Atom>();
    for(const a of atoms)if(!a.alt || a.alt===alt){const old=chosen.get(a.name);if(!old || (!old.alt && a.alt))chosen.set(a.name,a);}
    for(const a of chosen.values()) {
      if(selection==='residues' && !((a.kind==='protein'&&a.name==='CA')||(a.kind==='nucleic'&&a.name==='P')))continue;
      const chain=chains.get(a.chain)??{id:a.chain,kind:a.kind,positions:[],sites:[]};
      if(chain.kind!==a.kind)chain.kind='other';
      chain.positions.push(...a.xyz);chain.sites.push(`${a.residue}:${a.seq}:${a.name}`);chains.set(a.chain,chain);
      for(let i=0;i<3;i++){min[i]=Math.min(min[i],a.xyz[i]);max[i]=Math.max(max[i],a.xyz[i]);}
    }
  }
  if(!chains.size)throw new Error('PDB selection contains no sites');
  return {format:'animlib-molecule-v1',units:'angstrom',selection,chains:[...chains.values()],center:min.map((v,i)=>(v+max[i])/2) as Vec3,
    provenance:{source:options.source,...(pdbId?{pdbId}:{}),title:titles.join(' '),model,alternateLocations:'One conformer per residue: highest mean occupancy, lexicographic tie-break; blank/shared atoms retained.'}};
}
