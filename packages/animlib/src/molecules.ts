import type { MoleculeProps } from './molecule-types.js';
import type { Geometry, Vec3 } from './types.js';

/** Self-contained: installed verbatim in QuickJS with the other mesh builders. */
export function createMoleculeBuilders() {
  const templates=new Map<number,{unit:Vec3[];faces:[number,number,number][]}>();
  function sphere(detail:number) {
    const cached=templates.get(detail);if(cached)return cached;
    const unit: Vec3[] = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
    let faces: [number,number,number][] = [[0,2,4],[2,1,4],[1,3,4],[3,0,4],[2,0,5],[1,2,5],[3,1,5],[0,3,5]];
    for(let level=0;level<detail;level++) {
      const edges = new Map<string,number>();
      const middle=(a:number,b:number) => {
        const key=`${Math.min(a,b)},${Math.max(a,b)}`, found=edges.get(key);
        if(found!==undefined)return found;
        const v=unit[a].map((x,i)=>x+unit[b][i]) as Vec3, length=Math.hypot(...v), index=unit.length;
        unit.push(v.map(x=>x/length) as Vec3); edges.set(key,index); return index;
      };
      faces=faces.flatMap(([a,b,c])=>{const ab=middle(a,b),bc=middle(b,c),ca=middle(c,a);return [[a,ab,ca],[ab,b,bc],[ca,bc,c],[ab,bc,ca]] as [number,number,number][];});
    }
    const template={unit,faces};templates.set(detail,template);return template;
  }
  function molecule(props: MoleculeProps): Geometry[] {
    if (!props || !Array.isArray(props.positions) || props.positions.length % 3 || props.positions.length > 30000 || !props.positions.length) throw new Error('molecule requires packed XYZ positions for 1–10000 sites');
    const { positions, radius } = props, detail = props.detail ?? 0, origin = props.origin ?? [0,0,0];
    if (!Number.isFinite(radius) || radius <= 0 || radius > 1e6) throw new Error('molecule radius must be finite and positive, at most 1000000');
    if (!Number.isInteger(detail)||detail<0||detail>3) throw new Error('molecule detail must be an integer from 0 to 3');
    if (!Array.isArray(origin) || origin.length !== 3) throw new Error('molecule origin must be a finite Vec3');
    for(let i=0;i<3;i++) if (!Number.isFinite(origin[i]) || Math.abs(origin[i])>1e6) throw new Error('molecule origin must be a finite Vec3 within ±1000000');
    for(let i=0;i<positions.length;i++) if (!Number.isFinite(positions[i]) || Math.abs(positions[i])>1e6 || Math.abs(positions[i]-origin[i%3])+radius>1e6) throw new Error('molecule positions and radius must produce finite coordinates within ±1000000');
    const trianglesPerSite=8*4**detail,verticesPerSite=trianglesPerSite/2+2;
    if(positions.length/3*trianglesPerSite>500000||positions.length/3*verticesPerSite>500000)throw new Error('molecule total geometry budget exceeds 500000 vertices or triangles');
    const {unit,faces}=sphere(detail);
    const batchSize=Math.min(Math.floor(20000/faces.length),Math.floor(20000/unit.length)), result: Geometry[]=[];
    for(let start=0;start<positions.length/3;start+=batchSize) {
      const vertices: Vec3[]=[],normals: Vec3[]=[],triangles: [number,number,number][]=[];
      const end=Math.min(positions.length/3,start+batchSize);
      for(let site=start;site<end;site++) {
        const offset=vertices.length;
        for(const n of unit) {
          vertices.push([positions[3*site]-origin[0]+radius*n[0],positions[3*site+1]-origin[1]+radius*n[1],positions[3*site+2]-origin[2]+radius*n[2]]);
          normals.push([n[0],n[1],n[2]]);
        }
        for(const [a,b,c] of faces) triangles.push([offset+a,offset+b,offset+c]);
      }
      result.push({kind:'mesh',vertices,normals,triangles,shading:'smooth'});
    }
    return result;
  }
  return { molecule };
}
