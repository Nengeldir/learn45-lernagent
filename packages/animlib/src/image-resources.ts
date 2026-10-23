/// <reference types="@webgpu/types" />
import {imageBindingKey,type ImageBinding} from './composition.js';
const MAX_IMAGE_BYTES=256*1024*1024;

/** Renderer/device-owned uploads. CPU pixels remain immutable registry data. */
export class GPUImages {
  private images=new Map<string,{texture:GPUTexture;bytes:number}>();
  private bindings=new Map<string,{sampler:GPUSampler;groups:Map<GPURenderPipeline,GPUBindGroup>}>();
  private used=new Set<string>();
  private bytes=0;
  constructor(private device:GPUDevice){}
  beginFrame(){this.used.clear();}
  bind(pass:GPURenderPassEncoder,pipeline:GPURenderPipeline,binding:ImageBinding){
    const {image,texture:policy}=binding,device=this.device,key=imageBindingKey(binding);this.used.add(key);
    let resource=this.images.get(image.hash);
    if(!resource) {
      if(image.width>device.limits.maxTextureDimension2D||image.height>device.limits.maxTextureDimension2D)throw new Error('Image exceeds device texture dimension limit');
      const bytes=image.width*image.height*4;
      // A replacement frame may fit even when its previous working set is full.
      // Sweep only images unused by commands already encoded in this frame.
      if(this.bytes+bytes>MAX_IMAGE_BYTES)this.endFrame();
      if(this.bytes+bytes>MAX_IMAGE_BYTES)throw new Error('Image GPU memory limit exceeded');
      const texture=device.createTexture({size:[image.width,image.height],format:'rgba8unorm',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
      try{device.queue.writeTexture({texture},image.copyPixels(),{bytesPerRow:image.width*4},[image.width,image.height]);}catch(error){texture.destroy();throw error;}
      resource={texture,bytes};this.images.set(image.hash,resource);this.bytes+=bytes;
    }
    let entry=this.bindings.get(key);
    if(!entry){entry={sampler:device.createSampler({magFilter:policy.filter,minFilter:policy.filter,addressModeU:policy.wrap==='repeat'?'repeat':'clamp-to-edge',addressModeV:policy.wrap==='repeat'?'repeat':'clamp-to-edge'}),groups:new Map()};this.bindings.set(key,entry);}
    let group=entry.groups.get(pipeline);
    if(!group){group=device.createBindGroup({layout:pipeline.getBindGroupLayout(2),entries:[{binding:0,resource:resource.texture.createView()},{binding:1,resource:entry.sampler}]});entry.groups.set(pipeline,group);}
    pass.setBindGroup(2,group);
  }
  endFrame(){
    for(const key of this.bindings.keys())if(!this.used.has(key))this.bindings.delete(key);
    const hashes=new Set([...this.used].map(key=>JSON.parse(key)[0] as string));
    for(const [hash,image] of this.images)if(!hashes.has(hash)){image.texture.destroy();this.bytes-=image.bytes;this.images.delete(hash);}
  }
  dispose(){for(const image of this.images.values())image.texture.destroy();this.images.clear();this.bindings.clear();this.bytes=0;}
}

export class GLImages {
  private images=new Map<string,{texture:WebGLTexture;bytes:number}>();
  private samplers=new Map<string,WebGLSampler>();
  private used=new Set<string>();private bytes=0;
  constructor(private gl:WebGL2RenderingContext){}
  beginFrame(){this.used.clear();}
  bind(binding:ImageBinding){
    const gl=this.gl,{image,texture:policy}=binding,key=imageBindingKey(binding);this.used.add(key);
    gl.activeTexture(gl.TEXTURE3);
    let entry=this.images.get(image.hash);
    if(!entry){
      if(image.width>gl.getParameter(gl.MAX_TEXTURE_SIZE)||image.height>gl.getParameter(gl.MAX_TEXTURE_SIZE))throw new Error('Image exceeds WebGL texture dimension limit');
      const bytes=image.width*image.height*4;
      if(this.bytes+bytes>MAX_IMAGE_BYTES)this.endFrame();
      if(this.bytes+bytes>MAX_IMAGE_BYTES)throw new Error('Image GPU memory limit exceeded');
      const texture=gl.createTexture();if(!texture)throw new Error('WebGL could not allocate image texture');
      gl.bindTexture(gl.TEXTURE_2D,texture);gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,image.width,image.height,0,gl.RGBA,gl.UNSIGNED_BYTE,image.copyPixels());
      if(gl.getError()!==gl.NO_ERROR){gl.deleteTexture(texture);throw new Error('WebGL image upload failed');}
      entry={texture,bytes};this.images.set(image.hash,entry);this.bytes+=bytes;
    }
    gl.bindTexture(gl.TEXTURE_2D,entry.texture);
    let sampler=this.samplers.get(key);
    if(!sampler){
      sampler=gl.createSampler()??undefined;if(!sampler)throw new Error('WebGL could not allocate image sampler');
      const filter=policy.filter==='nearest'?gl.NEAREST:gl.LINEAR,wrap=policy.wrap==='repeat'?gl.REPEAT:gl.CLAMP_TO_EDGE;
      gl.samplerParameteri(sampler,gl.TEXTURE_MIN_FILTER,filter);gl.samplerParameteri(sampler,gl.TEXTURE_MAG_FILTER,filter);
      gl.samplerParameteri(sampler,gl.TEXTURE_WRAP_S,wrap);gl.samplerParameteri(sampler,gl.TEXTURE_WRAP_T,wrap);this.samplers.set(key,sampler);
    }
    gl.bindSampler(3,sampler);
  }
  endFrame(){
    for(const [key,sampler] of this.samplers)if(!this.used.has(key)){this.gl.deleteSampler(sampler);this.samplers.delete(key);}
    const hashes=new Set([...this.used].map(key=>JSON.parse(key)[0] as string));
    for(const [hash,image] of this.images)if(!hashes.has(hash)){this.gl.deleteTexture(image.texture);this.bytes-=image.bytes;this.images.delete(hash);}
  }
  dispose(){for(const image of this.images.values())this.gl.deleteTexture(image.texture);for(const sampler of this.samplers.values())this.gl.deleteSampler(sampler);this.images.clear();this.samplers.clear();this.bytes=0;}
}
