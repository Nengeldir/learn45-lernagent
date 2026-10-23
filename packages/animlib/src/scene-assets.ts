import type { AssetGeometryRef, AssetImageRef, AssetGeometryResolver, AssetLease, AssetRegistry } from './asset-types.js';
import type { CompiledScene } from './types.js';
import { sceneAssetRefs } from './asset-geometry.js';
import { validateCompiledScene } from './compiler.js';

/** Owns candidate and committed scene leases, released at every transaction boundary. */
export class SceneAssets implements AssetGeometryResolver {
  private held = new Map<CompiledScene,{lease:AssetLease; keys:Set<string>}>();
  private disposed = false;
  constructor(readonly registry?: AssetRegistry) {}
  prepare(scene: CompiledScene): void {
    if(this.disposed) throw new Error('Scene assets are disposed');
    if(this.held.has(scene)) return;
    const refs=sceneAssetRefs([scene]);
    if(!refs.length) return;
    if(!this.registry) throw new Error('Referenced models require a host asset registry');
    // Recheck live counts as well as identity; a forged descriptor cannot evade host work budgets.
    validateCompiledScene(scene,this.registry.catalog);
    for(const ref of [...refs])if('part' in ref){
      const model=this.registry.catalog.find(a=>a.id===ref.id&&a.hash===ref.hash);
      const image=model?.kind==='model'?model.parts.find(p=>p.id===ref.part)?.imageTexture?.image:undefined;
      if(image)refs.push(image);
    }
    const lease=this.registry.acquire(refs);
    this.held.set(scene,{lease,keys:new Set(refs.map(ref=>JSON.stringify([ref.id,ref.hash,'part' in ref?ref.part:undefined])))});
  }
  resolve(ref:AssetGeometryRef) {
    if(this.disposed) throw new Error('Scene assets are disposed');
    const key=JSON.stringify([ref.id,ref.hash,ref.part]);
    for(const entry of this.held.values()) if(entry.keys.has(key)) return entry.lease.resolve(ref);
    throw new Error(`Model reference has no prepared scene lease: ${ref.id}/${ref.part}`);
  }
  resolveImage(ref:AssetImageRef) {
    if(this.disposed)throw new Error('Scene assets are disposed');
    const key=JSON.stringify([ref.id,ref.hash,undefined]);
    for(const entry of this.held.values())if(entry.keys.has(key))return entry.lease.resolveImage!(ref);
    throw new Error('Image reference has no prepared scene lease: '+ref.id);
  }
  retain(scenes:readonly CompiledScene[]):void {
    const keep=new Set(scenes);
    for(const [scene,entry] of this.held) if(!keep.has(scene)) { entry.lease.dispose(); this.held.delete(scene); }
  }
  dispose():void { this.disposed=true; this.retain([]); }
}
