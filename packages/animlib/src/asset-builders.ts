import type { AssetDescriptor, ImageProps, ModelAssetDescriptor, PreparedModelProps } from './asset-types.js';
import type { Geometry } from './types.js';

/** Self-contained descriptor-only factory installed verbatim in QuickJS. */
export function createAssetBuilders(catalog: AssetDescriptor[] = []) {
  return {
    modelInfo(id: string): ModelAssetDescriptor {
      const asset=catalog.find(asset=>asset.id===id);
      if(!asset||asset.kind!=='model') throw new Error(`Missing model asset: ${id}`);
      return JSON.parse(JSON.stringify(asset));
    },
    model(props: PreparedModelProps): {id:string; geometry:Geometry}[] {
      const asset=catalog.find(asset=>asset.id===props?.asset);
      if(!asset||asset.kind!=='model') throw new Error(`Missing model asset: ${props?.asset}`);
      return asset.parts.map(part=>({id:part.id,geometry:{kind:'mesh',asset:{id:asset.id,hash:asset.hash,part:part.id},shading:props.shading??'smooth',...(part.imageTexture?{imageTexture:JSON.parse(JSON.stringify(part.imageTexture))}:{})}}));
    },
    image(props:ImageProps):Geometry {
      const asset=catalog.find(asset=>asset.id===props?.asset);
      if(!asset||asset.kind!=='image')throw new Error(`Missing image asset: ${props?.asset}`);
      const width=props.width??(props.height===undefined?1:props.height*asset.width/asset.height),height=props.height??width*asset.height/asset.width;
      if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)throw new Error('Image width and height must be positive');
      return {kind:'mesh',vertices:[[-width/2,height/2,0],[-width/2,-height/2,0],[width/2,-height/2,0],[width/2,height/2,0]],triangles:[[0,1,2],[0,2,3]],uv0:[[0,0],[0,1],[1,1],[1,0]],shading:'unlit',
        imageTexture:{image:{id:asset.id,hash:asset.hash},alphaMode:props.alphaMode??'blend',filter:props.filter??'linear',wrap:props.wrap??'clamp',...(props.tint!==undefined?{tint:props.tint}:{})}};
    },
  };
}
