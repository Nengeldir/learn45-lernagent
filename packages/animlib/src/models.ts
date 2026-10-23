import { validateModelMetadata } from './model-metadata.js';
import { WebIO } from '@gltf-transform/core';
import type { Texture, TextureInfo, Accessor } from '@gltf-transform/core';
import { KHRMaterialsUnlit, KHRTextureTransform, KHRMeshQuantization } from '@gltf-transform/extensions';
import type { Transform } from '@gltf-transform/extensions';
import type { Bounds3D, Geometry, Vec2, Vec3 } from './types.js';
import type { ModelMetadata } from './model-types.js';

export const MODEL_LIMITS = { bytes: 32 * 1024 * 1024, vertices: 200000, triangles: 200000, primitives: 256, nodes: 256, images: 64, imageSize: 4096, imagePixels: 16 * 1024 * 1024 } as const;
export interface ModelImage { bytes: Uint8Array<ArrayBuffer>; mime: string; width: number; height: number }
export interface ModelTexture {
  image: ModelImage; uv: number; offset: Vec2; scale: Vec2; rotation: number;
  wrapS: number; wrapT: number; nearest: boolean; minNearest: boolean;
}
export interface ModelMaterial {
  name: string; base: [number,number,number,number]; emission: Vec3;
  metal: number; rough: number; normalScale: number; occlusion: number;
  alpha: 'OPAQUE' | 'MASK' | 'BLEND'; cutoff: number; doubleSided: boolean; unlit: boolean;
  maps: (ModelTexture | undefined)[];
}
export interface ModelPrimitive {
  colors?: [number,number,number,number][];
  geometry: Geometry; uv0: Vec2[]; uv1: Vec2[]; material: ModelMaterial;
}
export interface ModelData { metadata: ModelMetadata; primitives: ModelPrimitive[]; images: ModelImage[] }
function requireModel(value: unknown, message: string): asserts value { if (!value) throw new Error(`Model: ${message}`); }
const finite = (v: number) => Number.isFinite(v) && Math.abs(v) <= 1e6;
const bounds = (points: Vec3[]): Bounds3D => {
  const min: Vec3 = [Infinity,Infinity,Infinity], max: Vec3 = [-Infinity,-Infinity,-Infinity];
  for (const p of points) for (let k=0;k<3;k++) { min[k]=Math.min(min[k],p[k]);max[k]=Math.max(max[k],p[k]); }
  return { min, max };
};
/** Read dimensions before browser decoding, bounding decoded memory as well as file size. */
export function modelImageSize(bytes: Uint8Array, mime: string): [number,number] {
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if(mime==='image/png' && bytes.length>=24 && view.getUint32(0)===0x89504e47 && view.getUint32(4)===0x0d0a1a0a && view.getUint32(12)===0x49484452) return [view.getUint32(16),view.getUint32(20)];
  if(mime==='image/jpeg' && bytes[0]===255 && bytes[1]===216) {
    let i=2;
    while(i+4<=bytes.length) {
      requireModel(bytes[i++]===255,'Invalid JPEG marker');
      while(bytes[i]===255)i++;
      const marker=bytes[i++];
      if(marker===217 || marker===218)break;
      const length=view.getUint16(i);requireModel(length>=2 && i+length<=bytes.length,'Invalid JPEG segment');
      if([192,193,194].includes(marker)) { requireModel(length>=7,'Invalid JPEG dimensions');return [view.getUint16(i+5),view.getUint16(i+3)]; }
      i+=length;
    }
  }
  throw new Error('Model: embedded textures must be valid PNG or JPEG images');
}

/** Strict static-model profile. Never follows an external buffer/image URI. */
export async function parseModelGLB(bytes: Uint8Array): Promise<ModelData> {
  requireModel(bytes.byteLength>=20 && bytes.byteLength<=MODEL_LIMITS.bytes,'GLB must be 20 bytes–32 MB');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  requireModel(view.getUint32(0,true)===0x46546c67 && view.getUint32(4,true)===2 && view.getUint32(8,true)===bytes.length,'Invalid GLB 2.0 header');
  const length=view.getUint32(12,true);
  requireModel(view.getUint32(16,true)===0x4e4f534a && length%4===0 && 20+length<=bytes.length,'Invalid GLB JSON chunk');
  const json=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(20,20+length)));
  requireModel(json.asset?.version==='2.0','Expected glTF 2.0');
  requireModel(!json.animations?.length && !json.skins?.length,'Animations and skins are not supported yet; export a static pose');
  const supported=new Set(['KHR_materials_unlit','KHR_texture_transform','KHR_mesh_quantization']);
  requireModel((json.extensionsUsed??[]).every((e:string)=>supported.has(e)),`Unsupported extensions: ${(json.extensionsUsed??[]).filter((e:string)=>!supported.has(e)).join(', ')}. Export core static glTF materials`);
  requireModel((json.buffers??[]).length===1 && json.buffers.every((b:{uri?:string})=>b.uri===undefined),'Embed every buffer in the GLB');
  requireModel((json.images??[]).every((i:{uri?:string;bufferView?:number})=>i.uri===undefined && Number.isInteger(i.bufferView)),'Embed every image in the GLB');
  requireModel((json.nodes??[]).length<=MODEL_LIMITS.nodes && (json.images??[]).length<=MODEL_LIMITS.images,'Node/image budget exceeded');
  for (const key of ['accessors','bufferViews','meshes','materials','textures']) requireModel((json[key]??[]).length<=4096, `${key} inventory is oversized`);
  const nodes=json.nodes??[],parents=new Map<number,number>(),visiting=new Set<number>(),visited=new Set<number>();
  const checkNode=(index:number):void=>{
    requireModel(Number.isInteger(index)&&index>=0&&index<nodes.length,'Invalid node reference');
    requireModel(!visiting.has(index),'Node cycle');if(visited.has(index))return;
    visiting.add(index);
    requireModel((nodes[index].children??[]).length<=MODEL_LIMITS.nodes,'Too many node children');
    for(const child of nodes[index].children??[]){requireModel(!parents.has(child),'Node has multiple parents');parents.set(child,index);checkNode(child);}
    visiting.delete(index);visited.add(index);
  };
  for(let i=0;i<nodes.length;i++)checkNode(i);
  let allocated=0;
  for(const a of json.accessors??[]) { requireModel(Number.isInteger(a.count) && a.count>=0 && a.count<=MODEL_LIMITS.triangles*3,'Invalid accessor count'); allocated+=a.count*({SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16}[a.type as string]??16)*4; }
  requireModel(allocated<=64*1024*1024,'Decoded accessor budget exceeded');
  const io=new WebIO().registerExtensions([KHRMaterialsUnlit,KHRTextureTransform,KHRMeshQuantization]);
  const doc=await io.readBinary(bytes);
  const root=doc.getRoot(),scene=root.getDefaultScene()??root.listScenes()[0];
  requireModel(scene,'No scene');
  const images:ModelImage[]=[], imageMap=new Map<Texture,ModelImage>();let pixels=0;
  for(const t of root.listTextures()) {
    const data=t.getImage(),mime=t.getMimeType();requireModel(data,'Missing texture image');
    const [width,height]=modelImageSize(data,mime);pixels+=width*height;
    requireModel(width>0 && height>0 && width<=MODEL_LIMITS.imageSize && height<=MODEL_LIMITS.imageSize && pixels<=MODEL_LIMITS.imagePixels,'Decoded image budget exceeded (4096 per side; 16 megapixels total)');
    const image={bytes:new Uint8Array(data),mime,width,height};images.push(image);imageMap.set(t,image);
  }
  const texture=(t:Texture|null,info:TextureInfo|null):ModelTexture|undefined=>{
    if(!t || !info)return;
    const transform=info.getExtension<Transform>('KHR_texture_transform');
    const uv=transform?.getTexCoord()??info.getTexCoord();requireModel(uv===0 || uv===1,'Only TEXCOORD_0 and TEXCOORD_1 are supported');
    const offset=(transform?.getOffset()??[0,0]) as Vec2,scale=(transform?.getScale()??[1,1]) as Vec2,rotation=transform?.getRotation()??0;
    requireModel([...offset,...scale,rotation].every(finite),'Invalid UV transform');
    return {image:imageMap.get(t)!,uv,offset,scale,rotation,wrapS:info.getWrapS(),wrapT:info.getWrapT(),nearest:info.getMagFilter()===9728,minNearest:[9728,9984,9986].includes(info.getMinFilter()??9729)};
  };
  const materialCache=new Map<unknown,ModelMaterial>();
  const material=(m:ReturnType<typeof root.listMaterials>[number]|null):ModelMaterial=>{
    const cached=materialCache.get(m);if(cached)return cached;
    const result:ModelMaterial={name:m?.getName()??'',base:m?.getBaseColorFactor()??[1,1,1,1],emission:m?.getEmissiveFactor()??[0,0,0],metal:m?.getMetallicFactor()??1,rough:m?.getRoughnessFactor()??1,normalScale:m?.getNormalScale()??1,occlusion:m?.getOcclusionStrength()??1,alpha:m?.getAlphaMode()??'OPAQUE',cutoff:m?.getAlphaCutoff()??0.5,doubleSided:m?.getDoubleSided()??false,unlit:Boolean(m?.getExtension('KHR_materials_unlit')),maps:m?[texture(m.getBaseColorTexture(),m.getBaseColorTextureInfo()),texture(m.getMetallicRoughnessTexture(),m.getMetallicRoughnessTextureInfo()),texture(m.getNormalTexture(),m.getNormalTextureInfo()),texture(m.getOcclusionTexture(),m.getOcclusionTextureInfo()),texture(m.getEmissiveTexture(),m.getEmissiveTextureInfo())]:[]};
    requireModel([...result.base,...result.emission,result.metal,result.rough,result.normalScale,result.occlusion,result.cutoff].every(finite),'Invalid material factors');
    requireModel([...result.base,...result.emission,result.metal,result.rough,result.occlusion].every(v=>v>=0&&v<=1)&&result.cutoff>=0,'Material factors are out of range');
    materialCache.set(m,result);return result;
  };
  const elements=(a:Accessor|null,size:number,count?:number):number[][]|undefined=>{
    if(!a)return;
    requireModel(a.getElementSize()===size && (count===undefined || a.getCount()===count),'Mismatched vertex attributes');
    const values=Array.from({length:a.getCount()},(_,i)=>a.getElement(i,[]));
    requireModel(values.every(v=>v.every(finite)),'Nonfinite or oversized vertex attribute');return values;
  };
  const primitives:ModelPrimitive[]=[],parts:ModelMetadata['parts']=[],all:Vec3[]=[];
  const seen=new Set<unknown>();let vertexCount=0,triangleCount=0;
  const visit=(node:ReturnType<typeof root.listNodes>[number],parent?:{id:string;world:Vec3})=>{
    requireModel(!seen.has(node),'Node cycle or multiple parents');seen.add(node);
    const id=`node-${root.listNodes().indexOf(node)}`,matrix=node.getWorldMatrix();
    requireModel(matrix.every(finite),'Invalid node transform');
    const pivot=matrix.slice(12,15) as Vec3;
    const part:ModelMetadata['parts'][number]={id,name:node.getName(),...(parent?{parent:parent.id}:{}),position:pivot.map((v,i)=>v-(parent?.world[i]??0)) as Vec3,primitives:[]};parts.push(part);
    requireModel(!node.getSkin(),'Skins are not supported');
    for(const p of node.getMesh()?.listPrimitives()??[]) {
      requireModel(primitives.length<MODEL_LIMITS.primitives && p.getMode()===4 && !p.listTargets().length,'Only static triangle primitives are supported (maximum 256)');
      const positions=elements(p.getAttribute('POSITION'),3) as Vec3[]|undefined;requireModel(positions?.length,'Missing positions');
      vertexCount+=positions.length;requireModel(vertexCount<=MODEL_LIMITS.vertices,'Vertex budget exceeded (200,000)');
      const indices=p.getIndices();const flat=indices?elements(indices,1)!.flat():positions.map((_,i)=>i);
      requireModel(flat.length%3===0 && flat.every(i=>Number.isInteger(i)&&i>=0&&i<positions.length),'Invalid triangle indices');
      triangleCount+=flat.length/3;requireModel(triangleCount<=MODEL_LIMITS.triangles,'Triangle budget exceeded (200,000)');
      const vertices=positions.map(v=>[0,1,2].map(k=>v[0]*matrix[k]+v[1]*matrix[4+k]+v[2]*matrix[8+k]) as Vec3);
      requireModel(vertices.every(v=>v.every(finite)),'Transformed vertices exceed coordinate limits');
      const a=matrix[0],b=matrix[4],c=matrix[8],d=matrix[1],e=matrix[5],f=matrix[9],g=matrix[2],h=matrix[6],i=matrix[10];
      const det=a*(e*i-f*h)-b*(d*i-f*g)+c*(d*h-e*g);requireModel(Math.abs(det)>1e-15,'Singular node transform');
      const normals=(elements(p.getAttribute('NORMAL'),3,positions.length) as Vec3[]|undefined)?.map(n=>{
        const v=[((e*i-f*h)*n[0]+(f*g-d*i)*n[1]+(d*h-e*g)*n[2])/det,((c*h-b*i)*n[0]+(a*i-c*g)*n[1]+(b*g-a*h)*n[2])/det,((b*f-c*e)*n[0]+(c*d-a*f)*n[1]+(a*e-b*d)*n[2])/det] as Vec3;
        const len=Math.hypot(...v);requireModel(len>0 && Number.isFinite(len),'Invalid normal');return v.map(x=>x/len) as Vec3;
      });
      const triangles:Array<[number,number,number]>=[];for(let j=0;j<flat.length;j+=3)triangles.push(det<0?[flat[j],flat[j+2],flat[j+1]]:[flat[j],flat[j+1],flat[j+2]]);
      const uv0=elements(p.getAttribute('TEXCOORD_0'),2,positions.length) as Vec2[]|undefined,uv1=elements(p.getAttribute('TEXCOORD_1'),2,positions.length) as Vec2[]|undefined;
      const mat=material(p.getMaterial());for(const map of mat.maps)if(map)requireModel(map.uv===0?uv0:uv1,'Textured primitive is missing its UV coordinates');
      const colorAttribute=p.getAttribute('COLOR_0');
      const colors=colorAttribute?elements(colorAttribute,colorAttribute.getElementSize(),positions.length)?.map(c=>{requireModel((c.length===3||c.length===4)&&c.every(v=>v>=0&&v<=1),'Invalid vertex colors');return [c[0],c[1],c[2],c[3]??1] as [number,number,number,number];}):undefined;
      part.primitives.push(primitives.length);primitives.push({colors,geometry:{kind:'mesh',vertices,triangles,normals,shading:normals?'smooth':'flat'},uv0:uv0??[],uv1:uv1??[],material:mat});
      for(const v of vertices)all.push(v.map((n,k)=>n+pivot[k]) as Vec3);
    }
    for(const child of node.listChildren())visit(child,{id,world:pivot});
  };
  for(const node of scene.listChildren())visit(node);
  requireModel(primitives.length && all.length,'Model contains no triangles');
  const metadata:ModelMetadata={version:1,parts,primitives:primitives.map(p=>({bounds:bounds(p.geometry.vertices as Vec3[]),triangles:p.geometry.triangles!.length})),bounds:bounds(all),triangles:triangleCount,materials:[...materialCache.values()].map(m=>m.name)};
  validateModelMetadata(metadata);
  return {metadata,primitives,images};
}

/** A conservative box is available to headless bounds/attachment code without model bytes. */
export function modelBoundsGeometry(b:Bounds3D):Geometry {
  const vertices:Vec3[]=[];for(let i=0;i<8;i++)vertices.push([0,1,2].map(k=>(i&(1<<k))?b.max[k]:b.min[k]) as Vec3);
  return {kind:'mesh',vertices,triangles:[[0,2,1],[1,2,3],[4,5,6],[5,7,6],[0,1,4],[1,5,4],[2,6,3],[3,6,7],[0,4,2],[2,4,6],[1,3,5],[3,7,5]]};
}
