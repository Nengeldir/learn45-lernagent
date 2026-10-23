/// <reference types="@webgpu/types" />
const shader=`
@group(0) @binding(0) var image:texture_2d<f32>;
@group(0) @binding(1) var<uniform> weight:vec4f;
@vertex fn vertex(@builtin(vertex_index) i:u32)->@builtin(position) vec4f {
 let p=array<vec2f,3>(vec2f(-1.,-1.),vec2f(3.,-1.),vec2f(-1.,3.));return vec4f(p[i],0.,1.);
}
@fragment fn fragment(@builtin(position) p:vec4f)->@location(0) vec4f{return textureLoad(image,vec2i(p.xy),0)*weight.x;}`;
type Surfaces={color:GPUTexture;depth:GPUTexture;resolved:GPUTexture;sum:GPUTexture};
/** Reuses one sample target and one half-float sum; storage is independent of sample count. */
export class GPUDepthFocus {
 private surfaces?:Surfaces;
 private add:GPURenderPipeline;
 private composite:GPURenderPipeline;
 private weights=new Map<number,GPUBuffer>();
 constructor(private device:GPUDevice,private format:GPUTextureFormat){
  const module=device.createShaderModule({code:shader});
  const base={layout:'auto' as const,vertex:{module,entryPoint:'vertex'},primitive:{topology:'triangle-list' as const}};
  this.add=device.createRenderPipeline({...base,fragment:{module,entryPoint:'fragment',targets:[{format:'rgba16float',blend:{color:{srcFactor:'one',dstFactor:'one'},alpha:{srcFactor:'one',dstFactor:'one'}}}]}});
  this.composite=device.createRenderPipeline({...base,multisample:{count:4},depthStencil:{format:'depth24plus',depthWriteEnabled:false,depthCompare:'always'},fragment:{module,entryPoint:'fragment',targets:[{format,blend:{color:{srcFactor:'one',dstFactor:'one-minus-src-alpha'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha'}}}]}});
 }
 private weight(value:number):GPUBuffer {let buffer=this.weights.get(value);if(!buffer){buffer=this.device.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});this.device.queue.writeBuffer(buffer,0,new Float32Array([value,0,0,0]));this.weights.set(value,buffer);}return buffer;}
 private ensure(width:number,height:number):Surfaces {
  if(this.surfaces?.color.width===width&&this.surfaces.color.height===height)return this.surfaces;
  this.release();const made:GPUTexture[]=[];
  const texture=(format:GPUTextureFormat,samples=1)=>{const t=this.device.createTexture({size:[width,height],format,sampleCount:samples,usage:GPUTextureUsage.RENDER_ATTACHMENT|(samples===1?GPUTextureUsage.TEXTURE_BINDING:0)});made.push(t);return t;};
  try {return this.surfaces={color:texture(this.format,4),depth:texture('depth24plus',4),resolved:texture(this.format),sum:texture('rgba16float')};}
  catch(e){for(const t of made)t.destroy();throw e;}
 }
 private quad(encoder:GPUCommandEncoder,descriptor:GPURenderPassDescriptor,pipeline:GPURenderPipeline,image:GPUTexture,weight:number,rect:number[]|undefined,width:number,height:number){
  const group=this.device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:image.createView()},{binding:1,resource:{buffer:this.weight(weight)}}]});
  const pass=encoder.beginRenderPass(descriptor);pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.setViewport(0,0,width,height,0,1);pass.setScissorRect(...(rect??[0,0,width,height]) as [number,number,number,number]);pass.draw(3);pass.end();
 }
 render(encoder:GPUCommandEncoder,parent:GPURenderPassDescriptor,rect:number[]|undefined,width:number,height:number,count:number,draw:(descriptor:GPURenderPassDescriptor,index:number)=>void):void {
  const s=this.ensure(width,height);
  for(let i=0;i<count;i++){
   draw({colorAttachments:[{view:s.color.createView(),resolveTarget:s.resolved.createView(),loadOp:'clear',storeOp:'store',clearValue:[0,0,0,0]}],depthStencilAttachment:{view:s.depth.createView(),depthLoadOp:'clear',depthStoreOp:'store',depthClearValue:1}},i);
   this.quad(encoder,{colorAttachments:[{view:s.sum.createView(),loadOp:i===0?'clear':'load',storeOp:'store',clearValue:[0,0,0,0]}]},this.add,s.resolved,1/count,rect,width,height);
  }
  this.quad(encoder,parent,this.composite,s.sum,1,rect,width,height);
 }
 private release(){if(this.surfaces)for(const texture of Object.values(this.surfaces))texture.destroy();this.surfaces=undefined;}
 dispose(){this.release();for(const buffer of this.weights.values())buffer.destroy();this.weights.clear();}
}
