import type { AssetGeometryRef, AssetImageRef, AssetRef, AssetRegistry, ImageDescriptor, ModelAssetDescriptor, PreparedImageInput, PreparedModelInput, ResolvedImage } from './asset-types.js';
import { ASSET_LIMITS, assetCheck, freezeAsset, hashAssetBytes, hashAssetContent, validatePreparedModel } from './asset-validation.js';
import {validatePreparedImage} from './image-validation.js';
export interface AssetRegistryOptions { maxBytes?:number; colorPolicy?:'palette'|'source' }
export function createAssetRegistry(inputs:PreparedModelInput[],options?:AssetRegistryOptions):Promise<AssetRegistry<ModelAssetDescriptor>>;
export function createAssetRegistry(inputs:(PreparedModelInput|PreparedImageInput)[],options?:AssetRegistryOptions):Promise<AssetRegistry>;
/** Caller-owned immutable registry. Pixels and mesh arrays never enter the scene VM. */
export async function createAssetRegistry(inputs:(PreparedModelInput|PreparedImageInput)[],options:AssetRegistryOptions={}):Promise<AssetRegistry> {
  assetCheck(Array.isArray(inputs)&&inputs.length<=ASSET_LIMITS.models,'registry asset limit exceeded');
  const limit=options.maxBytes??ASSET_LIMITS.registryBytes;
  assetCheck(Number.isSafeInteger(limit)&&limit>0&&limit<=ASSET_LIMITS.registryBytes,'invalid registry memory limit');
  assetCheck(options.colorPolicy===undefined||['palette','source'].includes(options.colorPolicy),'invalid host color policy');
  const models=new Map<string,ReturnType<typeof validatePreparedModel>&{hash:string;pins:number}>();
  const images=new Map<string,{image:ResolvedImage;bytes:number;pins:number}>();
  let decodedBytes=0,leases=0;const ids=new Set<string>();
  // Snapshot ALL caller data before the first await, including later entries.
  const snapshots=inputs.map(input=>{
    assetCheck(input&&!ids.has(input.id),'duplicate asset ID');ids.add(input.id);
    if(input.kind==='image') {
      assetCheck(options.colorPolicy==='source','source image colors require host colorPolicy source');
      const image=validatePreparedImage(input);decodedBytes+=image.pixels.byteLength;
      assetCheck(decodedBytes<=limit,'registry memory limit exceeded');return image;
    }
    const model=validatePreparedModel(input);decodedBytes+=model.bytes;
    assetCheck(decodedBytes<=limit,'registry memory limit exceeded');return model;
  });
  const order=snapshots.map(entry=>'pixels' in entry?{id:entry.id,kind:entry.kind}:{id:entry.model.id,kind:entry.model.kind});
  for(const entry of snapshots) {
    if('pixels' in entry) {
      const {pixels,id,...metadata}=entry,hash=await hashAssetContent({...metadata,pixels:await hashAssetBytes(pixels as Uint8Array<ArrayBuffer>)});
      const image=Object.freeze({id,kind:'image' as const,hash,width:entry.width,height:entry.height,copyPixels:()=>new Uint8Array(pixels)});
      images.set(id,{image,bytes:pixels.byteLength,pins:0});
    } else {
      const {id:_id,...content}=entry.model;models.set(entry.model.id,{...entry,hash:await hashAssetContent(content),pins:0});
    }
  }
  const checkImage=(ref:AssetImageRef)=>{
    const entry=images.get(ref.id);assetCheck(entry&&entry.image.hash===ref.hash,'missing or stale image '+ref.id);return entry;
  };
  for(const entry of models.values())for(const part of entry.model.parts)if(part.imageTexture)checkImage(part.imageTexture.image);
  const catalog=freezeAsset(order.map(input=>{
    if(input.kind==='image'){const {copyPixels:_copy,...descriptor}=images.get(input.id)!.image;return descriptor as ImageDescriptor;}
    const entry=models.get(input.id)!;return {...entry.descriptor,hash:entry.hash};
  }));
  assetCheck(JSON.stringify(catalog).length<=ASSET_LIMITS.catalogBytes,'descriptor catalog size limit exceeded');
  return Object.freeze({catalog,
    acquire(refs:readonly AssetRef[]) {
      const allowed=new Map<string,Set<string>>(),imageIds=new Set<string>();
      for(const ref of refs) {
        if(!('part' in ref)){checkImage(ref);imageIds.add(ref.id);continue;}
        const entry=models.get(ref.id);assetCheck(entry&&entry.hash===ref.hash,'missing or stale model '+ref.id);
        const mesh=entry.meshes.get(ref.part);assetCheck(mesh,'missing part '+ref.id+'/'+ref.part);
        const parts=allowed.get(ref.id)??new Set<string>();parts.add(ref.part);allowed.set(ref.id,parts);
        if(mesh.imageTexture){checkImage(mesh.imageTexture.image);imageIds.add(mesh.imageTexture.image.id);}
      }
      for(const id of allowed.keys())models.get(id)!.pins++;
      for(const id of imageIds)images.get(id)!.pins++;
      leases++;let disposed=false;
      return Object.freeze({
        resolve(ref:AssetGeometryRef) {
          assetCheck(!disposed,'lease is disposed');const entry=models.get(ref.id);
          assetCheck(entry&&entry.hash===ref.hash&&allowed.get(ref.id)?.has(ref.part),'reference not held by lease: '+ref.id+'/'+ref.part);
          return entry.meshes.get(ref.part)!;
        },
        resolveImage(ref:AssetImageRef) {
          assetCheck(!disposed,'lease is disposed');const entry=checkImage(ref);
          assetCheck(imageIds.has(ref.id),'image reference not held by lease: '+ref.id);return entry.image;
        },
        dispose(){if(disposed)return;disposed=true;leases--;for(const id of allowed.keys())models.get(id)!.pins--;for(const id of imageIds)images.get(id)!.pins--;},
      });
    },
    stats(){return {decodedBytes,pinnedBytes:[...models.values(),...images.values()].reduce((sum,e)=>sum+(e.pins?e.bytes:0),0),leases,models:models.size};},
  });
}
