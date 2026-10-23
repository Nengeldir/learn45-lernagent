/// <reference types="@webgpu/types" />
import type { RenderCommand } from './composition.js';

const shader = `
@group(0) @binding(0) var color: texture_2d<f32>;
@group(0) @binding(1) var depth: texture_depth_multisampled_2d;
@group(0) @binding(2) var<uniform> effect: Effect;
struct Effect { opacity: vec4f, receiverColor: vec4f }
@vertex fn vertex(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
  let points = array<vec2f,3>(vec2f(-1.,-1.),vec2f(3.,-1.),vec2f(-1.,3.));
  return vec4f(points[index],0.,1.);
}
struct Result { @location(0) color: vec4f, @builtin(frag_depth) depth: f32 }
@fragment fn fragment(@builtin(position) position: vec4f) -> Result {
  let p = vec2i(position.xy);
  let rgba = textureLoad(color,p,0)*effect.opacity.x;
  if(rgba.a<=0.000001){discard;}
  var z = 1.;
  for(var i=0;i<4;i++){z=min(z,textureLoad(depth,p,i));}
  var rgb = rgba.rgb*effect.opacity.y;
  if(effect.receiverColor.a>0.) {
    rgb = effect.receiverColor.rgb * max(vec3f(0.),vec3f(rgba.a*effect.opacity.y)-rgba.rgb*effect.opacity.z);
  }
  return Result(vec4f(rgb,rgba.a),z);
}`;
interface Layer { color: GPUTexture; resolved: GPUTexture; depth: GPUTexture; }
type Draw = Extract<RenderCommand, { first: number }>;

/** Lazily allocated layers pooled by nesting depth, reused across groups and frames. */
export class GPUCompositor {
  private layers: Layer[] = [];
  private uniforms: GPUBuffer[] = [];
  private uniformIndex = 0;
  private width = 0;
  private height = 0;
  private opaque: GPURenderPipeline;
  private transparent: GPURenderPipeline;
  private additive: GPURenderPipeline;
  constructor(private device: GPUDevice, private format: GPUTextureFormat) {
    const module = device.createShaderModule({ code: shader });
    const descriptor: GPURenderPipelineDescriptor = {
      layout: 'auto', vertex: { module, entryPoint: 'vertex' },
      fragment: { module, entryPoint: 'fragment', targets: [{ format, blend: {
        color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
        alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
      } }] },
      primitive: { topology: 'triangle-list' }, multisample: { count: 4 },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less-equal' },
    };
    this.opaque = device.createRenderPipeline(descriptor);
    this.transparent = device.createRenderPipeline({ ...descriptor, depthStencil: { ...descriptor.depthStencil!, depthWriteEnabled: false } });
    this.additive = device.createRenderPipeline({ ...descriptor,
      fragment: { ...descriptor.fragment!, targets: [{ format, blend: {
        color: { srcFactor: 'one', dstFactor: 'one' },
        alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
      } }] }, depthStencil: { ...descriptor.depthStencil!, depthWriteEnabled: false },
    });
  }
  beginFrame(): void { this.uniformIndex = 0; }
  private layer(level: number, width: number, height: number): Layer {
    if (width !== this.width || height !== this.height) {
      this.releaseLayers(); this.width = width; this.height = height;
    }
    if (!this.layers[level]) {
      const color = this.device.createTexture({ size: [width,height], format: this.format, sampleCount: 4, usage: GPUTextureUsage.RENDER_ATTACHMENT });
      const resolved = this.device.createTexture({ size: [width,height], format: this.format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
      const depth = this.device.createTexture({ size: [width,height], format: 'depth24plus', sampleCount: 4, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
      this.layers[level] = { color, resolved, depth };
    }
    return this.layers[level];
  }
  render(encoder: GPUCommandEncoder, commands: RenderCommand[], descriptor: GPURenderPassDescriptor, rect: number[] | undefined,
    width: number, height: number, draw: (pass: GPURenderPassEncoder, command: Draw, depthOnly?: boolean) => void, level = 0): void {
    const viewport = (pass: GPURenderPassEncoder) => {
      const [x,y,w,h] = rect ?? [0,0,width,height]; pass.setViewport(x,y,w,h,0,1); pass.setScissorRect(x,y,w,h);
    };
    let pass = encoder.beginRenderPass(descriptor); viewport(pass);
    for (const command of commands) {
      if ('first' in command) { draw(pass, command); continue; }
      pass.end();
      const layer = this.layer(level,width,height);
      this.render(encoder,command.children,{
        colorAttachments: [{ view: layer.color.createView(), resolveTarget: layer.resolved.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0,0,0,0] }],
        depthStencilAttachment: { view: layer.depth.createView(), depthLoadOp: 'clear', depthStoreOp: 'store', depthClearValue: 1 },
      },rect,width,height,draw,level+1);
      pass = encoder.beginRenderPass({ ...descriptor,
        colorAttachments: [...descriptor.colorAttachments].map(a => a ? { ...a, loadOp: 'load' } : a),
        depthStencilAttachment: { ...descriptor.depthStencilAttachment!, depthLoadOp: 'load' },
      });
      const pipeline = command.additive ? this.additive : command.opaque ? this.opaque : this.transparent;
      const index = this.uniformIndex++;
      const uniform = this.uniforms[index] ??= this.device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      this.device.queue.writeBuffer(uniform,0,new Float32Array([command.opacity,command.receiverLight ?? 1,command.receiverShadow ?? 0,0,...(command.receiverColor ?? [1,1,1]),command.receiverColor ? 1 : 0]));
      const bindGroup = this.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
        { binding: 0, resource: layer.resolved.createView() }, { binding: 1, resource: layer.depth.createView() }, { binding: 2, resource: { buffer: uniform } },
      ] });
      pass.setPipeline(pipeline);pass.setBindGroup(0,bindGroup);
      pass.setViewport(0,0,width,height,0,1);
      const [x,y,w,h] = rect ?? [0,0,width,height];pass.setScissorRect(x,y,w,h);
      pass.draw(3); viewport(pass);
    }
    if (level > 0) {
      // Transparent draws preserve rear color contributions. After blending, collect
      // nearest surface depth independently for this layer's eventual composite.
      const depth = (commands: RenderCommand[]) => { for (const command of commands) {
        if ('first' in command) draw(pass, command, true); else depth(command.children);
      } };
      depth(commands);
    }
    pass.end();
  }
  private releaseLayers(): void { for (const layer of this.layers) { layer.color.destroy();layer.resolved.destroy();layer.depth.destroy(); } this.layers = []; }
  dispose(): void { this.releaseLayers();for (const uniform of this.uniforms) uniform.destroy();this.uniforms = []; }
}
