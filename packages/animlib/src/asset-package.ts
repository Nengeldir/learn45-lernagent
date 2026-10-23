import type { AssetBlobRef, ImageAssetDescriptor, PreparedImageInput, ModelPackage, PreparedModelInput } from './asset-types.js';
import {imageBytes,validateImageHeader,validateImageTexture,validatePreparedImage} from './image-validation.js';
import type { Vec2, Vec3 } from './types.js';
import { ASSET_LIMITS, assetCheck, assetHash, assetId, assetKeys, hashAssetBytes, hashAssetContent, validateAssetProvenance, validatePreparedModel } from './asset-validation.js';

/** A host reader must enforce real-path containment and byteLength before reading. */
export type AssetBlobReader = (relativePath: string, byteLength: number) => Promise<Uint8Array<ArrayBuffer>>;
export function validateAssetPath(path: string): void {
  assetCheck(typeof path === 'string' && path.length <= 256 && /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(path)
    && path.split('/').every(p=>p!=='.'&&p!=='..'), 'package path escapes root or is unsupported');
}
/** Preflight aggregate host package memory before reading any binary payload. */
export function assetPackageDecodedBytes(input:ModelPackage|ImageAssetDescriptor):number {
  assetCheck(input&&input.version===1,'unsupported package version');
  if(input.kind==='image')return imageBytes(input.width,input.height);
  assetCheck(input.kind==='model'&&Array.isArray(input.parts)&&input.parts.length>0&&input.parts.length<=ASSET_LIMITS.parts,'invalid model package parts');
  let bytes=0;
  for(const part of input.parts){
    assetCheck(part&&Number.isSafeInteger(part.vertexCount)&&part.vertexCount>0&&part.vertexCount<=ASSET_LIMITS.vertices&&Number.isSafeInteger(part.triangleCount)&&part.triangleCount>0&&part.triangleCount<=ASSET_LIMITS.triangles,'invalid package counts');
    bytes+=(part.vertexCount+part.triangleCount+(part.normals?part.vertexCount:0)+(part.uv0?part.vertexCount:0))*128;
    assetCheck(bytes<=ASSET_LIMITS.modelBytes,'decoded model memory limit exceeded');
  }
  return bytes;
}
/** Decode only native v1 float32 XYZ/uint32 triangles; no source-format guessing. */
export async function decodeModelPackage(input: ModelPackage, read: AssetBlobReader): Promise<PreparedModelInput> {
  assetCheck(input && input.kind==='model' && input.version===1, 'unsupported package kind/version');
  assetKeys(input,['kind','version','id','hash','units','provenance','parts']);
  assetId(input.id); assetHash(input.hash); validateAssetProvenance(input);
  assetCheck(Array.isArray(input.parts)&&input.parts.length>0&&input.parts.length<=ASSET_LIMITS.parts,'package part limit exceeded');
  let bytes=0,decodedBytes=0; const ids=new Set<string>();
  const blob=(ref:AssetBlobRef,expected:number)=> {
    assetCheck(ref && typeof ref==='object','missing blob'); assetKeys(ref,['path','hash','byteLength']);
    validateAssetPath(ref.path); assetHash(ref.hash);
    assetCheck(Number.isSafeInteger(ref.byteLength)&&ref.byteLength===expected,'blob declared byte length mismatch');
    bytes+=expected; assetCheck(bytes<=ASSET_LIMITS.modelBytes,'package memory limit exceeded');
  };
  for(const part of input.parts) {
    assetKeys(part,['id','vertexCount','triangleCount','positions','indices','normals','uv0','imageTexture']);
    assetId(part.id); assetCheck(!ids.has(part.id),'duplicate package part ID'); ids.add(part.id);
    assetCheck(Number.isInteger(part.vertexCount)&&part.vertexCount>0&&part.vertexCount<=ASSET_LIMITS.vertices,'package vertex count limit exceeded');
    assetCheck(Number.isInteger(part.triangleCount)&&part.triangleCount>0&&part.triangleCount<=ASSET_LIMITS.triangles,'package triangle count limit exceeded');
    decodedBytes+=(part.vertexCount+part.triangleCount+(part.normals?part.vertexCount:0)+(part.uv0?part.vertexCount:0))*128;
    assetCheck(decodedBytes<=ASSET_LIMITS.modelBytes,'decoded model memory limit exceeded');
    blob(part.positions,part.vertexCount*12); blob(part.indices,part.triangleCount*12);
    if(part.normals) blob(part.normals,part.vertexCount*12);
    if(part.uv0)blob(part.uv0,part.vertexCount*8);
    if(part.imageTexture){validateImageTexture(part.imageTexture);assetCheck(part.uv0,'image texture requires UV0');}
  }
  // Snapshot before the first await: caller cannot swap hashes or paths mid-load.
  const manifest=structuredClone(input), {hash,...content}=manifest;
  assetCheck(await hashAssetContent(content)===hash,'manifest content hash mismatch');
  const decode=async(ref:AssetBlobRef,float:boolean,size=3):Promise<number[][]>=> {
    const bytes=await read(ref.path,ref.byteLength);
    assetCheck(bytes instanceof Uint8Array && bytes.byteLength===ref.byteLength,'blob exact byte length mismatch');
    const owned=new Uint8Array(bytes); assetCheck(await hashAssetBytes(owned)===ref.hash,'blob content hash mismatch');
    const view=new DataView(owned.buffer), result:number[][]=[];
    for(let i=0;i<owned.length;i+=size*4) result.push(Array.from({length:size},(_,j)=>j*4).map(offset=>float?view.getFloat32(i+offset,true):view.getUint32(i+offset,true)) as Vec3);
    return result;
  };
  const parts:PreparedModelInput['parts']=[];
  for(const part of manifest.parts) parts.push({id:part.id, vertices:await decode(part.positions,true) as Vec3[],triangles:await decode(part.indices,false) as Vec3[],
    ...(part.normals?{normals:await decode(part.normals,true) as Vec3[]}:{}),...(part.uv0?{uv0:await decode(part.uv0,true,2) as Vec2[]}:{}),...(part.imageTexture?{imageTexture:part.imageTexture}:{})});
  const model:PreparedModelInput={id:manifest.id,kind:'model',version:1,units:manifest.units,provenance:manifest.provenance,parts};
  return validatePreparedModel(model).model;
}

/** Decode native RGBA8 only. Source-format decoders remain offline preparation tools. */
export async function decodeImagePackage(input:ImageAssetDescriptor,read:AssetBlobReader):Promise<PreparedImageInput> {
  assetCheck(input&&input.kind==='image'&&input.version===1,'unsupported image package kind/version');
  assetKeys(input,['id','kind','version','hash','width','height','storage','encoding','origin','alpha','colorPolicy','pixels','provenance']);
  const bytes=validateImageHeader(input);assetHash(input.hash);
  const ref=input.pixels;assetCheck(ref&&typeof ref==='object','missing pixel blob');assetKeys(ref,['path','hash','byteLength']);validateAssetPath(ref.path);assetHash(ref.hash);
  assetCheck(ref.byteLength===bytes,'image pixel declared byte length mismatch');
  const manifest=structuredClone(input),{hash,...content}=manifest;
  assetCheck(await hashAssetContent(content)===hash,'manifest content hash mismatch');
  const loaded=await read(manifest.pixels.path,bytes);
  assetCheck(loaded instanceof Uint8Array&&loaded.byteLength===bytes,'image pixel exact byte length mismatch');
  const pixels=new Uint8Array(loaded);assetCheck(await hashAssetBytes(pixels)===manifest.pixels.hash,'image pixel content hash mismatch');
  return validatePreparedImage({...content,pixels});
}
