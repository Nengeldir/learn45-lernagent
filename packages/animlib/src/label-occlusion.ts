import { project } from './geometry.js';
import { add, mul, cameraRay, cross, dot, sub } from './spatial.js';
import { VERTEX_FLOATS as stride } from './texture-shader.js';
import type { CameraState, Vec3 } from './types.js';
import type { GeometryDrawItem } from './render-geometry.js';
export interface LabelAnchor { point: Vec3; offset: number[]; mode: 'overlay'|'hide'|'fade'; }

/** Screen-packed labels bypass GPU clipping. Interpolate the same homogeneous
 * clip distances as the shaders before dividing by w, including painter bias. */
function clipLabelDepth(data: Float32Array, camera: CameraState, width:number, height:number): Float64Array {
  type Vertex={values:Float64Array;z:number;w:number};
  const vertices:Vertex[]=[];
  for(let i=0;i<data.length;i+=stride) {
    const depth=project([data[i],data[i+1],data[i+2]],camera,width,height).depth;
    const w=1-camera.perspective+camera.perspective*depth/camera.distance;
    const z=((depth-0.01)/(camera.distance*100-0.01)-data[i+12]*0.00000002)*w;
    vertices.push({values:Float64Array.from(data.subarray(i,i+stride)),z,w});
  }
  if(vertices.every(v=>v.z>=0&&v.z<=v.w))return Float64Array.from(data);
  const result:number[]=[];
  for(let i=0;i<vertices.length;i+=3) {
    let poly=vertices.slice(i,i+3);
    for(const distance of [(v:Vertex)=>v.z,(v:Vertex)=>v.w-v.z]) {
      const next:Vertex[]=[];
      for(let j=0;j<poly.length;j++) {
        const a=poly[j],b=poly[(j+1)%poly.length],da=distance(a),db=distance(b);
        if(da>=0)next.push(a);
        if((da<0&&db>0)||(da>0&&db<0)) {
          const t=da/(da-db);
          next.push({values:a.values.map((v,k)=>v+(b.values[k]-v)*t),z:a.z+(b.z-a.z)*t,w:a.w+(b.w-a.w)*t});
        }
      }
      poly=next;
    }
    for(let j=2;j<poly.length;j++)result.push(...poly[0].values,...poly[j-1].values,...poly[j].values);
  }
  return new Float64Array(result);
}

/** Whole-label visibility at its anchor against opaque fill triangles in this view. */
export function applyLabelOcclusion(items: GeometryDrawItem[], labels: Map<string,LabelAnchor>, camera: CameraState, width: number,height:number): GeometryDrawItem[] {
  if(!labels.size)return items;
  const factors=new Map<string,number>();
  for(const [id,label] of labels) {
    const anchor=project(label.point,camera,width,height);
    if(!anchor.visible){factors.set(id,0);continue;}
    let hidden=false;
    if(label.mode!=='overlay')for(const item of items) {
      if(item.elementId===id||item.screen||item.transparent||item.component!=='fill'||item.groups?.some(g=>g.opacity<0.999999))continue;
      const data=item.vertices;
      const ray=cameraRay(anchor.x+(label.offset[0]-data[13])*width,anchor.y-(label.offset[1]-data[14])*height,camera,width,height);
      for(let i=0;i<data.length;i+=3*stride) {
        const p=(j:number):Vec3=>[data[j],data[j+1],data[j+2]];
        const a=p(i),b=p(i+stride),c=p(i+2*stride),e1=sub(b,a),e2=sub(c,a),h=cross(ray.direction,e2),det=dot(e1,h);
        if(Math.abs(det)<1e-12)continue;
        const s=sub(ray.origin,a),u=dot(s,h)/det,q=cross(s,e1),v=dot(ray.direction,q)/det,t=dot(e2,q)/det;
        if(u>=0&&v>=0&&u+v<=1&&t>=0&&project(add(ray.origin,mul(ray.direction,t)),camera,width,height).depth<anchor.depth-1e-4){hidden=true;break;}
      }
      if(hidden)break;
    }
    factors.set(id,hidden?(label.mode==='fade'?0.2:0):1);
  }
  return items.flatMap(item=> {
    if(item.component!=='content')return [item];
    const factor=factors.get(item.elementId);if(factor===undefined)return [item];if(!factor)return [];
    const vertices=clipLabelDepth(item.vertices,camera,width,height);
    if(!vertices.length)return [];
    for(let i=0;i<vertices.length;i+=stride) {
      const p=project([vertices[i],vertices[i+1],vertices[i+2]],camera,width,height);
      vertices[i]=p.x-width/2;vertices[i+1]=height/2-p.y;vertices[i+2]=0;
      vertices[i+6]*=factor;vertices[i+7]=1;
    }
    return [{...item,vertices:Float32Array.from(vertices),depth:-1e9,transparent:item.transparent||factor<1,cameraDependentGeometry:true}];
  });
}
