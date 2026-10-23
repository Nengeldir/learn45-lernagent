/// <reference types="@webgpu/types" />
import type { ModelImage, ModelMaterial } from './models.js';
import type { DecodedModelImage } from './model-store.js';
export function modelUniform(m?:ModelMaterial):Float32Array<ArrayBuffer> {
  const data=new Float32Array(56);
  data.set(m?.base??[1,1,1,1]);data.set([...(m?.emission??[0,0,0]),m?.unlit?1:0],4);
  data.set([m?.metal??0,m?.rough??1,m?.normalScale??1,m?.occlusion??1],8);
  data.set([m?['OPAQUE','MASK','BLEND'].indexOf(m.alpha):0,m?.cutoff??0.5,m?.doubleSided?1:0,m?1:0],12);
  for(let i=0;i<5;i++){const t=m?.maps[i];data.set([...(t?.offset??[0,0]),...(t?.scale??[1,1]),t?.rotation??0,t?.uv??0,t?1:0,0],16+i*8);}
  return data;
}
const white:DecodedModelImage={width:1,height:1,pixels:new Uint8Array([255,255,255,255])};
export class GPUModelTextures {
  private textures=new Map<ModelImage|undefined,GPUTexture>();
  private samplers=new Map<string,GPUSampler>();
  private materials=new Map<ModelMaterial|undefined,{buffer:GPUBuffer;groups:Map<GPURenderPipeline,GPUBindGroup>}>();
  constructor(private device:GPUDevice,private images:Map<ModelImage,DecodedModelImage>){}
  bind(pass:GPURenderPassEncoder,pipeline:GPURenderPipeline,material?:ModelMaterial):void {
    let resource=this.materials.get(material);
    if(!resource){const buffer=this.device.createBuffer({size:224,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});this.device.queue.writeBuffer(buffer,0,modelUniform(material));resource={buffer,groups:new Map()};this.materials.set(material,resource);}
    let group=resource.groups.get(pipeline);
    if(!group){
      const entries:GPUBindGroupEntry[]=[{binding:0,resource:{buffer:resource.buffer}}];
      for(let i=0;i<5;i++){
        const map=material?.maps[i],image=map?.image;let texture=this.textures.get(image);
        if(!texture){const decoded=image?this.images.get(image):white;if(!decoded)throw new Error('Model image is not decoded');
          texture=this.device.createTexture({size:[decoded.width,decoded.height],format:'rgba8unorm',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
          this.device.queue.writeTexture({texture},decoded.pixels,{bytesPerRow:decoded.width*4},[decoded.width,decoded.height]);this.textures.set(image,texture);
        }
        const key=JSON.stringify([map?.wrapS,map?.wrapT,map?.nearest,map?.minNearest]);let sampler=this.samplers.get(key);
        if(!sampler){const wrap=(n?:number):GPUAddressMode=>n===33071?'clamp-to-edge':n===33648?'mirror-repeat':'repeat';sampler=this.device.createSampler({addressModeU:wrap(map?.wrapS),addressModeV:wrap(map?.wrapT),magFilter:map?.nearest?'nearest':'linear',minFilter:map?.minNearest?'nearest':'linear'});this.samplers.set(key,sampler);}
        entries.push({binding:1+i*2,resource:texture.createView()},{binding:2+i*2,resource:sampler});
      }
      group=this.device.createBindGroup({layout:pipeline.getBindGroupLayout(2),entries});resource.groups.set(pipeline,group);
    }
    pass.setBindGroup(2,group);
  }
  dispose():void {for(const t of this.textures.values())t.destroy();for(const m of this.materials.values())m.buffer.destroy();this.textures.clear();this.materials.clear();this.samplers.clear();}
}
export class GLModelTextures {
  private textures=new Map<ModelImage|undefined,WebGLTexture>();
  private samplers=new Map<string,WebGLSampler>();
  constructor(private gl:WebGL2RenderingContext,private images:Map<ModelImage,DecodedModelImage>,private program:WebGLProgram){}
  bind(material?:ModelMaterial):void {
    const gl=this.gl,data=modelUniform(material);
    for(const [i,name] of ['modelBase','modelEmission','modelFactors','modelFlags'].entries())gl.uniform4fv(gl.getUniformLocation(this.program,name),data.subarray(i*4,i*4+4));
    gl.uniform4fv(gl.getUniformLocation(this.program,'modelMaps[0]'),data.subarray(16));
    for(let i=0;i<5;i++){
      const map=material?.maps[i],image=map?.image;let texture=this.textures.get(image);
      gl.activeTexture(gl.TEXTURE0+i);
      if(!texture){const decoded=image?this.images.get(image):white;if(!decoded)throw new Error('Model image is not decoded');
        texture=gl.createTexture()??undefined;if(!texture)throw new Error('Cannot allocate model texture');
        gl.bindTexture(gl.TEXTURE_2D,texture);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,decoded.width,decoded.height,0,gl.RGBA,gl.UNSIGNED_BYTE,decoded.pixels);this.textures.set(image,texture);
      } else gl.bindTexture(gl.TEXTURE_2D,texture);
      const key=JSON.stringify([map?.wrapS,map?.wrapT,map?.nearest,map?.minNearest]);let sampler=this.samplers.get(key);
      if(!sampler){sampler=gl.createSampler()??undefined;if(!sampler)throw new Error('Cannot allocate model sampler');
        gl.samplerParameteri(sampler,gl.TEXTURE_WRAP_S,map?.wrapS??gl.REPEAT);gl.samplerParameteri(sampler,gl.TEXTURE_WRAP_T,map?.wrapT??gl.REPEAT);
        gl.samplerParameteri(sampler,gl.TEXTURE_MIN_FILTER,map?.minNearest?gl.NEAREST:gl.LINEAR);gl.samplerParameteri(sampler,gl.TEXTURE_MAG_FILTER,map?.nearest?gl.NEAREST:gl.LINEAR);this.samplers.set(key,sampler);
      }
      gl.bindSampler(i,sampler);gl.uniform1i(gl.getUniformLocation(this.program,`modelMap${i}`),i);
    }
  }
  dispose():void {for(const t of this.textures.values())this.gl.deleteTexture(t);for(const s of this.samplers.values())this.gl.deleteSampler(s);this.textures.clear();this.samplers.clear();}
}
