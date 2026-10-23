import { Document, WebIO } from '@gltf-transform/core';
import { KHRMaterialsUnlit } from '@gltf-transform/extensions';
import { parseModelGLB, MODEL_LIMITS } from './models.js';
import type { Vec2, Vec3 } from './types.js';
/** Convenient host-side exporter for agent-generated geometry. Never runs in the scene VM. */
export interface GeneratedModel {
  parts: { name:string; vertices:Vec3[]; triangles:[number,number,number][]; uv?:Vec2[]; position?:Vec3;
    baseColor?:[number,number,number,number]; metalness?:number; roughness?:number; unlit?:boolean;
    texture?:{bytes:Uint8Array;mime:'image/png'|'image/jpeg'} }[];
}
export async function createModelGLB(model:GeneratedModel):Promise<Uint8Array<ArrayBuffer>> {
  if(!model||!Array.isArray(model.parts)||!model.parts.length||model.parts.length>128)throw new Error('Generated model requires 1–128 parts');
  const doc=new Document(),buffer=doc.createBuffer(),scene=doc.createScene();doc.getRoot().setDefaultScene(scene);
  const unlit=doc.createExtension(KHRMaterialsUnlit);
  let vertices=0,triangles=0;
  for(const p of model.parts) {
    if(!Array.isArray(p.vertices)||!Array.isArray(p.triangles)||typeof p.name!=='string'||p.name.length>256)throw new Error('Invalid generated part');
    vertices+=p.vertices.length;triangles+=p.triangles.length;
    if(vertices>MODEL_LIMITS.vertices||triangles>MODEL_LIMITS.triangles)throw new Error('Generated geometry budget exceeded');
    if(p.vertices.some(v=>!Array.isArray(v)||v.length!==3||!v.every(Number.isFinite))||p.triangles.some(v=>!Array.isArray(v)||v.length!==3||!v.every(i=>Number.isInteger(i)&&i>=0&&i<p.vertices.length)))throw new Error('Invalid generated vertices/triangles');
    if(p.uv && (p.uv.length!==p.vertices.length||p.uv.some(v=>v.length!==2||!v.every(Number.isFinite))))throw new Error('UVs must match vertices');
    const material=doc.createMaterial(p.name).setBaseColorFactor(p.baseColor??[1,1,1,1]).setMetallicFactor(p.metalness??0).setRoughnessFactor(p.roughness??0.6).setDoubleSided(true);
    if(p.unlit)material.setExtension('KHR_materials_unlit',unlit.createUnlit());
    if((p.baseColor?.[3]??1)<1)material.setAlphaMode('BLEND');
    if(p.texture)material.setBaseColorTexture(doc.createTexture().setImage(p.texture.bytes).setMimeType(p.texture.mime));
    const primitive=doc.createPrimitive().setAttribute('POSITION',doc.createAccessor().setType('VEC3').setArray(new Float32Array(p.vertices.flat())).setBuffer(buffer)).setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(p.triangles.flat())).setBuffer(buffer)).setMaterial(material);
    if(p.uv)primitive.setAttribute('TEXCOORD_0',doc.createAccessor().setType('VEC2').setArray(new Float32Array(p.uv.flat())).setBuffer(buffer));
    scene.addChild(doc.createNode(p.name).setTranslation(p.position??[0,0,0]).setMesh(doc.createMesh(p.name).addPrimitive(primitive)));
  }
  const bytes=await new WebIO().registerExtensions([KHRMaterialsUnlit]).writeBinary(doc);
  await parseModelGLB(bytes);
  return new Uint8Array(bytes);
}
