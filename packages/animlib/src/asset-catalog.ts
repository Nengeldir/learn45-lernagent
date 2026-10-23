import type { AssetDescriptor, AssetGeometryRef, AssetImageRef, ModelPartDescriptor, ImageDescriptor } from './asset-types.js';
import {imageBytes,validateImageTexture} from './image-validation.js';
import { ASSET_LIMITS, assetCheck, assetHash, assetId, assetKeys } from './asset-validation.js';

export function validateAssetCatalog(catalog: AssetDescriptor[] = []): void {
  assetCheck(Array.isArray(catalog) && catalog.length <= ASSET_LIMITS.models, 'catalog model limit exceeded');
  const ids=new Set<string>();
  for(const asset of catalog) {
    if(asset.kind==='image') {
      assetKeys(asset,['id','kind','hash','width','height']);assetId(asset.id);assetHash(asset.hash);imageBytes(asset.width,asset.height);
      assetCheck(!ids.has(asset.id),'duplicate catalog asset');ids.add(asset.id);continue;
    }
    assetKeys(asset,['id','kind','hash','bounds','parts']); assetId(asset.id); assetHash(asset.hash);
    assetCheck(asset.kind==='model'&&!ids.has(asset.id),'invalid or duplicate catalog asset'); ids.add(asset.id);
    assetCheck(Array.isArray(asset.parts)&&asset.parts.length>0&&asset.parts.length<=ASSET_LIMITS.parts,'catalog part limit exceeded');
    const parts=new Set<string>();
    for(const part of asset.parts) {
      assetKeys(part,['id','vertexCount','triangleCount','bounds','hasUV0','imageTexture']); assetId(part.id);
      if(part.hasUV0!==undefined)assetCheck(part.hasUV0===true,'invalid UV0 descriptor');
      if(part.imageTexture){validateImageTexture(part.imageTexture);assetCheck(part.hasUV0,'image texture requires UV0');catalogImage(part.imageTexture.image,catalog);}
      assetCheck(!parts.has(part.id),'duplicate catalog part'); parts.add(part.id);
      assetCheck(Number.isInteger(part.vertexCount)&&part.vertexCount>0&&part.vertexCount<=ASSET_LIMITS.vertices,'catalog vertex count limit exceeded');
      assetCheck(Number.isInteger(part.triangleCount)&&part.triangleCount>0&&part.triangleCount<=ASSET_LIMITS.triangles,'catalog triangle count limit exceeded');
    }
    for(const bounds of [asset.bounds,...asset.parts.map(part=>part.bounds)]) {
      assetCheck(bounds&&typeof bounds==='object','missing catalog bounds'); assetKeys(bounds,['min','max']);
      for(const p of [bounds.min,bounds.max]) assetCheck(Array.isArray(p)&&p.length===3&&p.every(v=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=1e6),'invalid catalog bounds');
      assetCheck(bounds.min.every((v,i)=>v<=bounds.max[i]),'reversed catalog bounds');
    }
  }
  assetCheck(JSON.stringify(catalog).length<=ASSET_LIMITS.catalogBytes,'catalog size limit exceeded');
}
export function catalogPart(ref: AssetGeometryRef, catalog: AssetDescriptor[]): ModelPartDescriptor {
  assetCheck(ref&&typeof ref==='object','invalid model reference'); assetKeys(ref,['id','hash','part']); assetId(ref.id);assetId(ref.part);assetHash(ref.hash);
  const asset=catalog.find(a=>a.id===ref.id&&a.hash===ref.hash), part=asset?.kind==='model'?asset.parts.find(p=>p.id===ref.part):undefined;
  assetCheck(part,`missing or stale model reference: ${ref.id}/${ref.part}`); return part;
}
export function catalogImage(ref:AssetImageRef,catalog:AssetDescriptor[]):ImageDescriptor {
  const asset=catalog.find(a=>a.id===ref.id&&a.hash===ref.hash);
  assetCheck(asset?.kind==='image',`missing or stale image reference: ${ref.id}`);return asset;
}
