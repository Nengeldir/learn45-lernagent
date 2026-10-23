import type { ImageTexture, PreparedImageInput } from './asset-types.js';
import {assetCheck,assetId,assetHash,assetKeys,validateAssetProvenance} from './asset-validation.js';
import {validateColor} from './palette.js';
import type {Geometry} from './types.js';

export function imageBytes(width:number,height:number):number {
  assetCheck(Number.isSafeInteger(width)&&Number.isSafeInteger(height)&&width>0&&height>0&&width<=4096&&height<=4096,'image dimension limit exceeded');
  return width*height*4;
}
export function validateImageHeader(input:Omit<PreparedImageInput,'pixels'>):number {
  assetCheck(input&&input.kind==='image'&&input.version===1,'unsupported image kind/version');
  assetId(input.id);const bytes=imageBytes(input.width,input.height);
  assetCheck(input.storage==='rgba8'&&input.encoding==='srgb'&&input.origin==='top-left'&&input.alpha==='straight'&&input.colorPolicy==='source','unsupported image storage, encoding, origin, alpha or color policy');
  validateAssetProvenance({units:'pixel',provenance:input.provenance});
  return bytes;
}
export function validatePreparedImage(input:PreparedImageInput):PreparedImageInput {
  const bytes=validateImageHeader(input);
  assetKeys(input,['id','kind','version','width','height','storage','encoding','origin','alpha','colorPolicy','pixels','provenance']);
  assetCheck(input.pixels instanceof Uint8Array&&input.pixels.byteLength===bytes,'image exact pixel byte length mismatch');
  return {...structuredClone({...input,pixels:undefined}),pixels:new Uint8Array(input.pixels)};
}
export function validateImageTexture(texture:ImageTexture):void {
  assetCheck(texture&&typeof texture==='object','invalid image texture');
  assetKeys(texture,['image','alphaMode','filter','wrap','tint']);
  assetCheck(texture.image&&typeof texture.image==='object','missing image reference');
  assetKeys(texture.image,['id','hash']);assetId(texture.image.id);assetHash(texture.image.hash);
  assetCheck(['opaque','blend'].includes(texture.alphaMode),'unsupported image alpha mode');
  assetCheck(['nearest','linear'].includes(texture.filter),'unsupported image filter');
  assetCheck(['clamp','repeat'].includes(texture.wrap),'unsupported image wrap');
  if(texture.tint!==undefined)validateColor(texture.tint);
}
export function validateImageGeometry(g:Geometry,vertexCount=g.vertices?.length,hasUV0=Boolean(g.uv0)):void {
  if(g.uv0!==undefined) {
    assetCheck(g.kind==='mesh'&&Array.isArray(g.uv0)&&g.uv0.length===vertexCount,'UV0 count must match mesh vertices');
    for(const uv of g.uv0)assetCheck(Array.isArray(uv)&&uv.length===2&&Array.from(uv).every(v=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=1e6),'invalid UV0 coordinates');
  }
  if(!g.imageTexture)return;
  validateImageTexture(g.imageTexture);
  assetCheck(g.kind==='mesh'&&hasUV0,'image texture requires mesh UV0');
  assetCheck(!g.texture&&!g.scalarColors&&!g.clipPlanes&&!g.outline,'image texture does not support procedural texture, scalar colors, clipping or outlines');
}
