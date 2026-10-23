import { parseModelGLB, MODEL_LIMITS } from './models.js';
import type { ModelData, ModelImage, ModelPrimitive } from './models.js';
import { validateModelMetadata } from './model-metadata.js';
import type { Asset, CompiledScene, Frame, Geometry } from './types.js';
import type { ModelAsset, ModelMetadata } from './model-types.js';
export type ResolvedModelGeometry = Geometry & { _model?: ModelPrimitive; _modelKey?: string };
export interface DecodedModelImage { width: number; height: number; pixels: Uint8Array<ArrayBuffer> }
export class ModelStore {
  readonly metadata: Record<string,ModelMetadata> = Object.create(null);
  readonly images = new Map<ModelImage,DecodedModelImage>();
  private assets = new Map<string,ModelAsset>();
  private data = new Map<string,ModelData>();
  private pending = new Map<string,Promise<ModelData>>();
  private abort = new AbortController();
  private disposed = false;
  private decodedPixels = 0;
  private decodedVertices = 0;
  constructor(assets:Record<string,Asset>={}, private io?: {
    read?: (asset:ModelAsset,signal:AbortSignal)=>Promise<Uint8Array<ArrayBuffer>>;
    decode?: (image:ModelImage)=>Promise<DecodedModelImage>;
  }) { this.register(assets); }
  register(assets:Record<string,Asset>):void {
    if(this.disposed)throw new Error('Model store is disposed');
    const candidates=Object.entries(assets).filter((e):e is [string,ModelAsset]=>e[1].kind==='model');
    for(const [id,a] of candidates) {
      if(!id||id.length>256||!a.url||a.sha256!==undefined&&!/^[a-f0-9]{64}$/.test(a.sha256))throw new Error('Invalid model asset');
      validateModelMetadata(a.metadata);
      const previous=this.assets.get(id);
      if(previous && (previous.sha256 ? previous.sha256!==a.sha256 : previous.url!==a.url) || previous && JSON.stringify(previous.metadata)!==JSON.stringify(a.metadata))throw new Error(`Model asset is immutable: ${id}`);
    }
    for(const [id,a] of candidates) { this.assets.set(id,structuredClone(a));this.metadata[id]=structuredClone(a.metadata); }
  }
  private async load(id:string):Promise<ModelData> {
    const a=this.assets.get(id);if(!a)throw new Error(`Unknown model asset: ${id}`);
    const key=a.sha256??a.url,cached=this.data.get(key);
    if(cached) {
      if(JSON.stringify(cached.metadata)!==JSON.stringify(a.metadata))throw new Error(`Model metadata mismatch: ${id}`);
      return cached;
    }
    let pending=this.pending.get(key);
    if(!pending) {
      pending=(async()=>{
        const bytes=this.io?.read ? await this.io.read(a,this.abort.signal) : await (async()=>{
        const response=await fetch(a.url,{signal:this.abort.signal});
        if(!response.ok)throw new Error(`Model ${id} failed to load (${response.status})`);
        if(Number(response.headers.get('content-length'))>MODEL_LIMITS.bytes)throw new Error('Model download exceeds 32 MB');
        const reader=response.body?.getReader();if(!reader)throw new Error('Model response has no body');
        const chunks:Uint8Array[]=[];let size=0;
        try { while(true) { const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>MODEL_LIMITS.bytes)throw new Error('Model download exceeds 32 MB');chunks.push(value); } }
        catch(error) { await reader.cancel().catch(()=>{});throw error; }
        finally { reader.releaseLock(); }
        const result=new Uint8Array(size);let offset=0;for(const c of chunks){result.set(c,offset);offset+=c.length;}
        return result;
        })();
        if(bytes.length>MODEL_LIMITS.bytes)throw new Error('Model exceeds 32 MB');
        if(a.sha256) { const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(v=>v.toString(16).padStart(2,'0')).join('');if(hash!==a.sha256)throw new Error('Model hash mismatch'); }
        const data=await parseModelGLB(bytes);
        if(JSON.stringify(data.metadata)!==JSON.stringify(a.metadata))throw new Error(`Model metadata mismatch: ${id}`);
        const vertexCount=data.primitives.reduce((sum,p)=>sum+(p.geometry.vertices?.length??0),0);
        if(this.decodedVertices+vertexCount>1000000)throw new Error('Player models exceed the 1,000,000 resident vertex budget');
        const imagePixels=data.images.reduce((sum,image)=>sum+image.width*image.height,0);
        if(this.decodedPixels+imagePixels>32*1024*1024)throw new Error('Player model textures exceed the 32-megapixel resident budget');
        this.decodedPixels+=imagePixels;this.decodedVertices+=vertexCount;
        const decoded: [ModelImage,DecodedModelImage][]=[];
        try {
        for(const image of data.images) {
          if(this.io?.decode) {
            const pixels=await this.io.decode(image);
            if(pixels.width!==image.width||pixels.height!==image.height||pixels.pixels.length!==image.width*image.height*4)throw new Error('Model image dimensions mismatch');
            decoded.push([image,pixels]);continue;
          }
          const bitmap=await createImageBitmap(new Blob([image.bytes],{type:image.mime}),{colorSpaceConversion:'none',premultiplyAlpha:'none'});
          try {
            if(bitmap.width!==image.width||bitmap.height!==image.height)throw new Error('Model image dimensions mismatch');
            const canvas=new OffscreenCanvas(bitmap.width,bitmap.height),context=canvas.getContext('2d');if(!context)throw new Error('Image decoder unavailable');
            context.drawImage(bitmap,0,0);
            decoded.push([image,{width:image.width,height:image.height,pixels:new Uint8Array(context.getImageData(0,0,image.width,image.height).data)}]);
          } finally {bitmap.close();}
        }
        if(this.disposed)throw new Error('Model store is disposed');
        for(const [image,pixels] of decoded)this.images.set(image,pixels);
        this.data.set(key,data);return data;
        } catch(error) { this.decodedPixels-=imagePixels;this.decodedVertices-=vertexCount;throw error; }
      })().finally(()=>this.pending.delete(key));
      this.pending.set(key,pending);
    }
    const data=await pending;
    if(JSON.stringify(data.metadata)!==JSON.stringify(a.metadata))throw new Error(`Model metadata mismatch: ${id}`);
    return data;
  }
  async prepare(scenes:CompiledScene[]):Promise<void> {
    const ids=new Set<string>();
    for(const scene of scenes)for(const e of [...scene.initial,...scene.lifecycle.flatMap(e=>e.elements??[])])if(e.geometry.model)ids.add(e.geometry.model.asset);
    for(const id of ids)await this.load(id);
  }
  resolve(frame:Frame):Frame {
    return {...frame,elements:frame.elements.map(e=>{
      const ref=e.geometry.model;if(!ref)return e;
      const a=this.assets.get(ref.asset),key=a?.sha256??a?.url,primitive=key?this.data.get(key)?.primitives[ref.primitive]:undefined;
      if(!primitive)throw new Error(`Model is not prepared: ${ref.asset}`);
      return {...e,geometry:{...primitive.geometry,_model:primitive,_modelKey:`${key}/${ref.primitive}`} as ResolvedModelGeometry};
    })};
  }
  dispose():void {this.disposed=true;this.abort.abort();this.data.clear();this.images.clear();this.pending.clear();this.assets.clear();}
}
