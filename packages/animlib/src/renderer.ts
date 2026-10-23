import { GPUImages } from './image-resources.js';
import { modelWGSL } from './model-shader.js';
import { GPUModelTextures } from './model-textures.js';
import type { ModelStore } from './model-store.js';
/// <reference types="@webgpu/types" />
import { VertexBufferLimitError, vertexBufferCapacity } from './vertex-buffer.js';
import { lightingUniform } from './lighting.js';
import { addPlanarShadows } from './planar-shadows.js';
import { RetainedGeometry, retentionForFrame } from './retained-geometry.js';
import { GPURetained } from './gpu-retained.js';
import { materialWGSL } from './material-shader.js';
import { VERTEX_FLOATS, textureWGSL } from './texture-shader.js';
import { WebGLBackend } from './webgl.js';
import { ViewInteraction } from './interaction.js';
import { paletteResolver, parseColor } from './palette.js';
import type { CameraState, ColorPalette, CompiledScene, Frame, InteractionSnapshot, Vec3 } from './types.js';
import { add, sub, cameraRay, planePoint, pick } from './spatial.js';
import { composeItems } from './composition.js';
import type { DrawItem } from './composition.js';
import { GPUCompositor } from './gpu-compositor.js';
import { rotate } from './geometry.js';
import { buildDrawItems } from './render-geometry.js';
export { triangulateContours } from './render-geometry.js';
import { validateRenderableScene } from './render-validation.js';
import type { AssetGeometryResolver } from './asset-types.js';
import {sceneAssetRefs} from './asset-geometry.js';
import {apertureSamples,normalizeFocus,focusPreflight,FocusBudgetError} from './depth-focus.js';
import {GPUDepthFocus} from './gpu-depth-focus.js';

const shader=`
struct Camera { focus: vec4f, angles: vec4f, viewport: vec4f, light: vec4f, ambient: vec4f, lens: vec4f };
@group(0) @binding(0) var<uniform> camera: Camera;
struct ObjectState { transform: mat4x4f, info: vec4f };
@group(1) @binding(0) var<uniform> objects: array<ObjectState,32>;
struct Output { @builtin(position) position: vec4f, @location(0) color: vec4f, @location(1) normal: vec3f, @location(2) lit: f32, @location(3) texPosition: vec3f, @location(4) texKind: f32, @location(5) texColor: vec4f, @location(6) texSeed: f32, @location(7) viewDirection: vec3f, @location(8) material: vec3f, @location(9) emission: vec3f, @location(10) viewPosition: vec3f, @location(11) bumpStrength: f32, @location(12) uv:vec4f, @location(13) imageAlphaMode:f32 };
@vertex fn vertex(@builtin(instance_index) instanceIndex:u32, @location(0) localWorld: vec3f, @location(1) color: vec4f, @location(2) screen: f32, @location(3) localNormal: vec3f, @location(4) lit: f32, @location(5) localLayer: f32, @location(6) localViewportOffset: vec2f, @location(7) texPosition: vec3f, @location(8) texKind: f32, @location(9) texColor: vec4f, @location(10) texSeed: f32, @location(11) material: vec3f, @location(12) emission: vec3f, @location(13) bumpStrength: f32, @location(14) uv:vec4f, @location(15) imageAlphaMode:f32) -> Output {
  let object=objects[instanceIndex];
  let world=(object.transform*vec4f(localWorld,1.)).xyz;
  let normal=(object.transform*vec4f(localNormal,0.)).xyz/object.info.y;
  let layer=localLayer+object.info.x;
  let viewportOffset=localViewportOffset+object.info.zw;
  var p=world-camera.focus.xyz;
  let cy=cos(-camera.angles.x); let sy=sin(-camera.angles.x);
  p=vec3f(p.x*cy+p.z*sy,p.y,-p.x*sy+p.z*cy);
  let cp=cos(-camera.angles.y); let sp=sin(-camera.angles.y);
  p=vec3f(p.x,p.y*cp-p.z*sp,p.y*sp+p.z*cp);
  let depth=camera.angles.z-p.z;
  let divisor=mix(1.,depth/camera.angles.z,camera.angles.w);
  let halfHeight=camera.viewport.z/2.;
  var output:Output;
  output.position=vec4f(p.x/halfHeight*camera.viewport.y/camera.viewport.x,p.y/halfHeight,(depth-0.01)/(camera.angles.z*100.-0.01)*divisor,divisor);
  if(camera.lens.z>0. && screen<0.5){let shift=camera.lens.xy*(depth/camera.lens.z-1.);output.position.x+=shift.x/halfHeight*camera.viewport.y/camera.viewport.x;output.position.y+=shift.y/halfHeight;}
  if(screen>0.5) { output.position=vec4f(world.x*2./camera.viewport.x,world.y*2./camera.viewport.y,0.0001,1.); }
  // Tiny deterministic tie bias fixes coplanar painter order while preserving 3D depth.
  output.position.z-=layer*0.00000002*output.position.w;
  output.position=vec4f(output.position.xy+viewportOffset*2.*output.position.w,output.position.zw);
  var n=normal;
  n=vec3f(n.x*cy+n.z*sy,n.y,-n.x*sy+n.z*cy);
  n=vec3f(n.x,n.y*cp-n.z*sp,n.y*sp+n.z*cp);
  output.uv=uv;output.imageAlphaMode=imageAlphaMode;output.normal=n;output.lit=lit;output.color=color;
  output.texPosition=texPosition;output.texKind=texKind;output.texColor=texColor;output.texSeed=texSeed;
  output.material=material;output.emission=emission;output.viewPosition=p;output.bumpStrength=bumpStrength*object.info.y;
  output.viewDirection=mix(vec3f(0.,0.,1.),vec3f(-p.x,-p.y,depth),camera.angles.w);
  if(camera.lens.z>0. && screen<0.5){output.viewDirection=mix(vec3f(camera.lens.xy/camera.lens.z,1.),vec3f(camera.lens.xy-p.xy,depth),camera.angles.w);}
  return output;
}
${textureWGSL}
${materialWGSL}
@fragment fn fragment(input:Output,@builtin(front_facing) frontFacing:bool) -> @location(0) vec4f { var color=input.color;
  let footprint=fwidth(input.texPosition);
  var height=0.;
  if(input.texKind>0.5){
    let surface=proceduralSample(input.texPosition,input.texKind,input.texSeed,footprint);
    color=mix(color,input.texColor,surface.x);height=surface.y;
  }
  // Derivatives must be evaluated before divergent lighting/discard branches.
  let dx=dpdx(input.viewPosition);let dy=dpdy(input.viewPosition);
  let dh=vec2f(dpdx(height),dpdy(height));
  if(color.a<=0.){discard;}
  if(input.lit>0.5){
    let n=input.normal;
    var normal=n/max(length(n),0.000001);
    if(input.bumpStrength!=0.){normal=bumpNormal(normal,dx,dy,dh,input.bumpStrength);}
    if(input.lit>1.5&&!frontFacing){normal=-normal;}
    if(input.material.y>0.){color=vec4f(materialColor(color.rgb,normal,normalize(input.viewDirection),input.material,camera.light,camera.ambient.x),color.a);}
    else {let amount=0.32*camera.ambient.x+0.68*camera.light.w*max(0.,dot(normal,normalize(camera.light.xyz)));color=vec4f(color.rgb*amount,color.a);}
  }
  return vec4f(color.rgb+input.emission,color.a); }
`;
const modelShader=shader.replace('@fragment', `${modelWGSL}\n@fragment`).replace('var color=input.color;', 'var color=input.color; let imported=importedColor(color,input.uv,input.texSeed,input.normal,input.viewPosition,input.viewDirection,frontFacing,camera.light,camera.ambient.x); if(model.flags.w>0.5){return imported;}');
const imageShader=shader.replace('struct Camera', '@group(2) @binding(0) var imageColor: texture_2d<f32>;\n@group(2) @binding(1) var imageSampler: sampler;\nstruct Camera').replace('var color=input.color;', 'var color=input.color; let sample=textureSample(imageColor,imageSampler,input.uv.xy); color*=vec4f(sample.rgb,select(sample.a,1.,input.imageAlphaMode<1.5));');
export class CanvasRenderer {
  onCanvasChange:((canvas:HTMLCanvasElement)=>void)|undefined;
  onRecovered:(()=>void)|undefined;
  private gl:WebGLBackend|undefined;
  private retained=new RetainedGeometry();
  private modelTextures:GPUModelTextures|undefined;
  private gpuRetained:GPURetained|undefined;
  private gpuImages:GPUImages|undefined;
  private imagePipeline:GPURenderPipeline|undefined;
  private imageTransparentPipeline:GPURenderPipeline|undefined;
  private imageDepthPipeline:GPURenderPipeline|undefined;
  private imageDescriptor:GPURenderPipelineDescriptor|undefined;
  private imageCameras=new Map<GPURenderPipeline,Map<GPUBuffer,GPUBindGroup>>();
  private contextLost=false;
  private ready=false;
  private errorKind:'budget'|'backend'|undefined;
  private errorGeneration=0;
  private originalCanvas:HTMLCanvasElement;
  get backend():'webgpu'|'webgl2'|undefined {return this.gl?'webgl2':this.ready?'webgpu':undefined;}
  get canvasElement():HTMLCanvasElement {return this.canvas;}
  setPalette(palette:ColorPalette):void {this.hostPalette=paletteResolver(palette).palette;}
  onOrbitChange:(()=>void)|undefined;
  onInvalidate:(()=>void)|undefined;
  onError:((error:Error)=>void)|undefined;
  private size={width:1,height:1};
  private observer:ResizeObserver;
  private interaction=new ViewInteraction();
  private interactionScene: string | undefined;
  private regions:NonNullable<Frame["views"]>=[];
  private viewResources=new Map<string,{uniform:GPUBuffer;bindGroup:GPUBindGroup;transparentBindGroup:GPUBindGroup}>();
  private orbitEnabled=false;
  private drag:{id:number;x:number;y:number;view:string;pan?:boolean}|null=null;
  private pans = new Map<string, Vec3>();
  private navigationMode: 'orbit' | 'pan' = 'orbit';
  private lastFrame:Frame|undefined;
  private lastOptions:CompiledScene['options']|undefined;
  private device:GPUDevice|undefined;
  private context:GPUCanvasContext|undefined;
  private pipeline:GPURenderPipeline|undefined;
  private transparentPipeline:GPURenderPipeline|undefined;
  private transparentBindGroup:GPUBindGroup|undefined;
  private compositor:GPUCompositor|undefined;
  private depthFocus:GPUDepthFocus|undefined;
  private focusCameras:GPUBuffer[]=[];
  private pipelineDescriptor:GPURenderPipelineDescriptor|undefined;
  private depthOnlyPipeline:GPURenderPipeline|undefined;
  private uniform:GPUBuffer|undefined;
  private bindGroup:GPUBindGroup|undefined;
  private vertices:GPUBuffer|undefined;
  private capacity=0;
  private depthTexture:GPUTexture|undefined;
  private colorTexture:GPUTexture|undefined;
  private format:GPUTextureFormat|undefined;
  private initializing:Promise<void>|undefined;
  private disposed=false;
  private assetGeometry?:AssetGeometryResolver;
  private models?:ModelStore;
  constructor(private canvas:HTMLCanvasElement, private hostPalette?:ColorPalette, assetsOrModels?:AssetGeometryResolver|ModelStore, models?:ModelStore) {
    // Preserve both pre-merge constructor forms; combined hosts pass models fourth.
    if(assetsOrModels && 'images' in assetsOrModels)this.models=assetsOrModels;
    else {this.assetGeometry=assetsOrModels;this.models=models;}
    this.originalCanvas=canvas;
    if(hostPalette)this.hostPalette=paletteResolver(hostPalette).palette;
    this.observer=new ResizeObserver(()=>{this.resize();if(this.onInvalidate)this.onInvalidate();else if(this.lastFrame&&this.lastOptions)this.render(this.lastFrame,this.lastOptions);});
    this.observer.observe(canvas);this.resize();
    this.listen(true);
  }
  private listen(add:boolean):void {
    const events = {pointerdown:this.pointerDown,pointermove:this.pointerMove,pointerup:this.pointerUp,pointercancel:this.pointerUp,lostpointercapture:this.pointerUp,contextmenu:this.contextMenu};
    for(const [name,handler] of Object.entries(events)) {
      if(add)this.canvas.addEventListener(name,handler as EventListener);
      else this.canvas.removeEventListener(name,handler as EventListener);
    }
  }
  private replaceCanvas():void {
    // Context types are permanent, even after unconfigure()/device.destroy().
    // Keep attributes/layout, but give the fallback a fresh drawing surface.
    const previous=this.canvas, next=previous.cloneNode(false) as HTMLCanvasElement;
    this.pointerUp();this.listen(false);this.observer.disconnect();
    previous.replaceWith(next);this.canvas=next;this.listen(true);this.observer.observe(next);
    this.onCanvasChange?.(next);
  }
  private releaseGPU():void {
    this.depthFocus?.dispose();this.depthFocus=undefined;for(const buffer of this.focusCameras)buffer.destroy();this.focusCameras=[];
    this.modelTextures?.dispose();this.modelTextures=undefined;
    this.gpuRetained?.dispose();this.gpuRetained=undefined;
    this.gpuImages?.dispose();this.gpuImages=undefined;this.imagePipeline=undefined;this.imageTransparentPipeline=undefined;this.imageDepthPipeline=undefined;this.imageDescriptor=undefined;this.imageCameras.clear();
    this.compositor?.dispose();this.compositor=undefined;
    this.depthOnlyPipeline=undefined;this.pipelineDescriptor=undefined;
    for(const resource of this.viewResources.values())resource.uniform.destroy();this.viewResources.clear();
    this.vertices?.destroy();this.uniform?.destroy();this.depthTexture?.destroy();this.colorTexture?.destroy();
    const device=this.device;this.device=undefined;
    this.context?.unconfigure();this.context=undefined;device?.destroy();
    this.vertices=undefined;this.uniform=undefined;this.depthTexture=undefined;this.colorTexture=undefined;
    this.pipeline=undefined;this.transparentPipeline=undefined;this.bindGroup=undefined;this.transparentBindGroup=undefined;this.capacity=0;
  }
  private initializeGL():void {
    if(this.disposed)throw new Error('Renderer is disposed.');
    const acquire=()=>this.canvas.getContext('webgl2',{alpha:false,antialias:true,depth:true,premultipliedAlpha:false});
    let gl=acquire();
    // The caller may reuse a canvas locked by an earlier renderer/context type.
    if(!gl&&this.canvas===this.originalCanvas&&typeof this.canvas.cloneNode==='function'){this.replaceCanvas();gl=acquire();}
    if(!gl)throw new Error('No WebGL2 context is available.');
    this.gl=new WebGLBackend(gl,this.models?.images);
    this.canvas.addEventListener('webglcontextlost',this.glLost);
    this.canvas.addEventListener('webglcontextrestored',this.glRestored);
    this.contextLost=false;this.ready=true;this.resize();
  }
  private glLost=(event:Event):void=>{
    event.preventDefault();
    if(this.disposed)return;
    this.contextLost=true;
    this.reportError(new Error('WebGL2 context lost. Playback is paused while the graphics context recovers; retry if it does not recover.'));
  };
  private glRestored=():void=>{
    if(this.disposed||!this.gl)return;
    const generation=this.errorGeneration;
    this.errorKind='backend';
    try {
      // Restored contexts have already invalidated every old GL handle.
      const gl=this.gl.gl;this.gl=new WebGLBackend(gl,this.models?.images);this.contextLost=false;this.ready=true;this.resize();
      if(this.lastFrame&&this.lastOptions)this.render(this.lastFrame,this.lastOptions);
      this.backendRecovered(generation);
    } catch(error){this.reportError(error instanceof Error?error:new Error(String(error)));}
  };
  private fallback(reason:unknown):void {
    const locked=Boolean(this.context);
    this.ready=false;this.releaseGPU();
    try {
      if(locked)this.replaceCanvas();
      this.initializeGL();
    } catch(error) {
      throw new Error(`Neither WebGPU nor WebGL2 could initialize. WebGPU: ${reason instanceof Error?reason.message:String(reason)} WebGL2: ${error instanceof Error?error.message:String(error)}`);
    }
  }
  get orbit():{yaw:number;pitch:number} {return this.interaction.get();}
  setOrbit(orbit:{yaw:number;pitch:number},view=''):void {this.interaction.set(orbit,view);}
  getOrbit(view=''):{yaw:number;pitch:number} {return this.interaction.get(view);}
  getPan(view=''):Vec3 { return [...(this.pans.get(JSON.stringify([this.interactionScene,view])) ?? [0,0,0])] as Vec3; }
  setPan(value:Vec3,view=''):void {
    if(value.length!==3||!value.every(Number.isFinite))throw new Error('Pan requires three finite coordinates');
    this.pans.set(JSON.stringify([this.interactionScene,view]),[...value]);
  }
  setNavigationMode(mode:'orbit'|'pan'):void { if(mode!=='orbit'&&mode!=='pan')throw new Error('Invalid navigation mode');this.pointerUp();this.navigationMode=mode; }
  private effectiveCamera(camera:CameraState,enabled:boolean,view=''):CameraState {
    const orbit=this.interaction.get(view);
    return {...camera,target:add(camera.target,this.getPan(view)),yaw:camera.yaw+(enabled?orbit.yaw*camera.perspective:0),pitch:camera.pitch+(enabled?orbit.pitch*camera.perspective:0)};
  }
  interactionSnapshot(view=''):InteractionSnapshot|undefined {
    if(!this.lastFrame||!this.lastOptions)return;
    const region=view?this.lastFrame.views?.find(v=>v.id===view):undefined;
    if(view&&!region)return;
    const rect=region?.rect??[0,0,1,1];
    const width=region?this.size.width*(Math.round((rect[0]+rect[2])*this.canvas.width)-Math.round(rect[0]*this.canvas.width))/this.canvas.width:this.size.width;
    const height=region?this.size.height*(Math.round((rect[1]+rect[3])*this.canvas.height)-Math.round(rect[1]*this.canvas.height))/this.canvas.height:this.size.height;
    return {frame:structuredClone(this.lastFrame),camera:structuredClone(this.effectiveCamera(region?.camera??this.lastFrame.camera,region?.orbit??this.lastOptions.orbit,view)),width,height,rect:[...rect] as [number,number,number,number]};
  }
  syncInteraction(scene:string,time:number,compiled:CompiledScene,frame:Frame):void {
    if(this.interactionScene!==scene)this.pointerUp();
    this.interactionScene=scene;
    this.interaction.sync(scene,time,compiled);
    this.regions=frame.views??[];
    if(this.drag&&!this.drag.pan&&!this.canOrbit(this.drag.view))this.pointerUp();
  }
  resetInteraction():void {this.pointerUp();this.interaction.reset();this.pans.clear();this.interactionScene=undefined;}
  setOrbitEnabled(enabled:boolean):void {this.orbitEnabled=enabled;if(this.drag&&!this.drag.pan&&!this.canOrbit(this.drag.view))this.pointerUp();this.canvas.style.cursor=enabled||this.regions.some(v=>this.canOrbit(v.id))?'grab':'';}
  private canOrbit(view:string):boolean {
    if(!view)return this.orbitEnabled;
    const region=this.regions.find(v=>v.id===view);
    return Boolean(region?.orbit&&region.camera.perspective>0&&!region.cameraAnimated);
  }
  private hitView(event:PointerEvent,pan=false):string|undefined {
    const bounds=this.canvas.getBoundingClientRect();
    const x=(event.clientX-bounds.left)/bounds.width,y=(event.clientY-bounds.top)/bounds.height;
    for(const region of [...this.regions].reverse()) {
      const [left,top,width,height]=region.rect;
      if(x>=left&&x<left+width&&y>=top&&y<top+height) {
        if(pan)return region.id;
        if(!this.canOrbit(region.id))return;
        if(region.orbitHitTest==='geometry') {
          const snapshot=this.interactionSnapshot(region.id);if(!snapshot)return;
          const px=(x-left)/width*snapshot.width,py=(y-top)/height*snapshot.height;
          const targets=new Set(snapshot.frame.elements.filter(e=>e.view===region.id).map(e=>e.id));
          if(!pick(snapshot.frame,cameraRay(px,py,snapshot.camera,snapshot.width,snapshot.height),targets,snapshot.camera,snapshot.width,snapshot.height,region.id,[px,py],this.assetGeometry))return;
        }
        return region.id;
      }
    }
    return pan||this.canOrbit('')?'':undefined;
  }
  private pointerDown=(event:PointerEvent):void=>{
    if(event.defaultPrevented||event.button>2||this.drag)return;
    const pan=event.shiftKey||event.button===1||event.button===2||this.navigationMode==='pan';
    const view=this.hitView(event,pan);if(view===undefined)return;
    event.preventDefault();
    this.drag={id:event.pointerId,x:event.clientX,y:event.clientY,view,pan};this.canvas.setPointerCapture(event.pointerId);
    this.canvas.style.cursor='grabbing';
  };
  private pointerMove=(event:PointerEvent):void=> {
    if(!this.drag){this.canvas.style.cursor=this.hitView(event)!==undefined?'grab':'';return;}
    if(event.pointerId!==this.drag.id||!this.drag.pan&&!this.canOrbit(this.drag.view))return;
    if(this.drag.pan) {
      const snapshot=this.interactionSnapshot(this.drag.view);if(!snapshot)return;
      const bounds=this.canvas.getBoundingClientRect(),[left,top,w,h]=snapshot.rect;
      const point=(x:number,y:number)=>planePoint(cameraRay(((x-bounds.left)/bounds.width-left)/w*snapshot.width,((y-bounds.top)/bounds.height-top)/h*snapshot.height,snapshot.camera,snapshot.width,snapshot.height),snapshot.camera.target,rotate([0,0,1],[snapshot.camera.pitch,snapshot.camera.yaw,0]));
      const before=point(this.drag.x,this.drag.y),after=point(event.clientX,event.clientY);
      if(before&&after)this.setPan(add(this.getPan(this.drag.view),sub(before,after)),this.drag.view);
      this.drag.x=event.clientX;this.drag.y=event.clientY;this.onOrbitChange?.();return;
    }
    const orbit=this.interaction.get(this.drag.view);
    const region=this.regions.find(v=>v.id===this.drag!.view);
    const bounds=this.canvas.getBoundingClientRect();
    // Half a turn across the shorter view dimension, independent of CSS size/DPR.
    const sensitivity=Math.PI/Math.max(1,Math.min(bounds.width*(region?.rect[2]??1),bounds.height*(region?.rect[3]??1)));
    orbit.yaw-=(event.clientX-this.drag.x)*sensitivity;
    const camera=region?.camera??this.lastFrame?.camera;
    const authoredPitch=camera?.pitch??0;
    orbit.pitch=Math.max(-Math.PI/2+0.02-authoredPitch,Math.min(Math.PI/2-0.02-authoredPitch,orbit.pitch-(event.clientY-this.drag.y)*sensitivity));
    this.interaction.set(orbit,this.drag.view);
    this.drag.x=event.clientX;this.drag.y=event.clientY;this.onOrbitChange?.();
  };
  private pointerUp=(event?:PointerEvent):void=>{
    if(!this.drag||event&&event.pointerId!==this.drag.id)return;
    const id=this.drag.id;this.drag=null;
    if(this.canvas.hasPointerCapture?.(id))this.canvas.releasePointerCapture(id);
    this.canvas.style.cursor=this.orbitEnabled||this.regions.some(v=>this.canOrbit(v.id))?'grab':'';
  };
  private contextMenu=(event:Event):void=>{event.preventDefault();};
  private resize():void {
    const rect=this.canvas.getBoundingClientRect();this.size={width:Math.max(1,rect.width||this.canvas.width||800),height:Math.max(1,rect.height||this.canvas.height||450)};
    const ratio=globalThis.devicePixelRatio||1;
    const max=this.gl?.maxSize??this.device?.limits.maxTextureDimension2D??8192;
    const width=Math.min(max,Math.max(1,Math.round(this.size.width*ratio))),height=Math.min(max,Math.max(1,Math.round(this.size.height*ratio)));
    if(this.canvas.width!==width)this.canvas.width=width;if(this.canvas.height!==height)this.canvas.height=height;
    if(this.device && this.context && (!this.depthTexture||this.depthTexture.width!==width||this.depthTexture.height!==height)) { this.depthTexture?.destroy();this.depthTexture=this.device.createTexture({size:[width,height],format:'depth24plus',sampleCount:4,usage:GPUTextureUsage.RENDER_ATTACHMENT});this.colorTexture?.destroy();this.colorTexture=this.device.createTexture({size:[width,height],format:this.format!,sampleCount:4,usage:GPUTextureUsage.RENDER_ATTACHMENT}); }
  }
  private async initialize():Promise<void> {
    try {await this.initializeGPU();}
    catch(error) {if(this.disposed)throw error;this.fallback(error);}
  }
  private async initializeGPU():Promise<void> {
    if(this.disposed)throw new Error('Renderer is disposed.');
    if(globalThis.isSecureContext===false)throw new Error('This page is using an insecure connection. Open it over HTTPS (or localhost): browsers hide WebGPU on remote HTTP pages.');
    if(!globalThis.navigator?.gpu)throw new Error('WebGPU is unavailable.');
    const adapter=await navigator.gpu.requestAdapter();
    if(this.disposed)throw new Error('Renderer is disposed.');
    if(!adapter)throw new Error('No WebGPU adapter is available.');
    const device=await adapter.requestDevice();if(this.disposed){device.destroy();throw new Error('Renderer is disposed.');}
    this.device=device;
    let lost:string|undefined;
    device.addEventListener('uncapturederror',event=>{if(!this.disposed&&this.device===device)this.reportError(new Error(event.error.message));});
    void device.lost.then(info=>{
      lost=`WebGPU device lost: ${info.message||info.reason}`;
      if(this.disposed||this.device!==device||!this.ready)return;
      const generation=this.errorGeneration;
      this.errorKind='backend';
      try {this.fallback(new Error(lost));if(this.lastFrame&&this.lastOptions)this.render(this.lastFrame,this.lastOptions);this.backendRecovered(generation);}
      catch(error){this.reportError(error instanceof Error?error:new Error(String(error)));}
    });
    const module=device.createShaderModule({code:modelShader});
    const compilation=await module.getCompilationInfo();
    // Navigation/retry can dispose this renderer during any GPU initialization
    // await. Never let a stale renderer reconfigure a replacement's canvas.
    if(this.disposed)throw new Error('Renderer is disposed.');
    const errors=compilation.messages.filter(m=>m.type==='error');if(errors.length)throw new Error(errors.map(m=>m.message).join('\n'));
    this.format=navigator.gpu.getPreferredCanvasFormat();
    const descriptor:GPURenderPipelineDescriptor={layout:'auto',vertex:{module,entryPoint:'vertex',buffers:[{arrayStride:VERTEX_FLOATS*4,attributes:[{shaderLocation:0,offset:0,format:'float32x3'},{shaderLocation:1,offset:12,format:'float32x4'},{shaderLocation:2,offset:28,format:'float32'},{shaderLocation:3,offset:32,format:'float32x3'},{shaderLocation:4,offset:44,format:'float32'},{shaderLocation:5,offset:48,format:'float32'},{shaderLocation:6,offset:52,format:'float32x2'},{shaderLocation:7,offset:60,format:'float32x3'},{shaderLocation:8,offset:72,format:'float32'},{shaderLocation:9,offset:76,format:'float32x4'},{shaderLocation:10,offset:92,format:'float32'},{shaderLocation:11,offset:96,format:'float32x3'},{shaderLocation:12,offset:108,format:'float32x3'},{shaderLocation:13,offset:120,format:'float32'},{shaderLocation:14,offset:124,format:'float32x4'},{shaderLocation:15,offset:140,format:'float32'}]}]},fragment:{module,entryPoint:'fragment',targets:[{format:navigator.gpu.getPreferredCanvasFormat(),blend:{color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}}}]},primitive:{topology:'triangle-list',cullMode:'none'},depthStencil:{format:'depth24plus',depthWriteEnabled:true,depthCompare:'less-equal'},multisample:{count:4}};
    this.pipelineDescriptor=descriptor;
    const pipeline=await device.createRenderPipelineAsync(descriptor);
    if(this.disposed)throw new Error('Renderer is disposed.');
    this.pipeline=pipeline;
    const transparentPipeline=await device.createRenderPipelineAsync({...descriptor,depthStencil:{...descriptor.depthStencil!,depthWriteEnabled:false}});
    if(this.disposed)throw new Error('Renderer is disposed.');
    this.transparentPipeline=transparentPipeline;
    const imageModule=device.createShaderModule({code:imageShader});
    const imageInfo=await imageModule.getCompilationInfo();
    if(this.disposed)throw new Error('Renderer is disposed.');
    if(imageInfo.messages.some(m=>m.type==='error'))throw new Error(imageInfo.messages.filter(m=>m.type==='error').map(m=>m.message).join('\n'));
    this.imageDescriptor={...descriptor,vertex:{...descriptor.vertex,module:imageModule},fragment:{...descriptor.fragment!,module:imageModule}};
    this.imagePipeline=await device.createRenderPipelineAsync(this.imageDescriptor);
    if(this.disposed)throw new Error('Renderer is disposed.');
    this.imageTransparentPipeline=await device.createRenderPipelineAsync({...this.imageDescriptor,depthStencil:{...descriptor.depthStencil!,depthWriteEnabled:false}});
    if(this.disposed)throw new Error('Renderer is disposed.');
    this.uniform=device.createBuffer({size:96,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
    this.bindGroup=device.createBindGroup({layout:this.pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.uniform}}]});
    this.transparentBindGroup=device.createBindGroup({layout:this.transparentPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.uniform}}]});
    if(lost)throw new Error(lost);
    // Complete fallible async device/pipeline setup before locking the host canvas.
    const context=this.canvas.getContext('webgpu');
    if(!context)throw new Error('The canvas cannot create a WebGPU context.');
    this.context=context;
    context.configure({device,format:this.format,alphaMode:'opaque'});
    this.resize();this.ready=true;
  }
  async prepare(scenes:CompiledScene[], assetGeometry:AssetGeometryResolver|undefined=this.assetGeometry):Promise<void> {
    if(this.disposed)throw new Error('Renderer is disposed.');
    for(const scene of scenes)validateRenderableScene(scene,this.hostPalette,assetGeometry);
    this.assetGeometry=assetGeometry;
    if(!this.initializing)this.initializing=this.initialize().catch(error=>{this.initializing=undefined;throw error;});
    await this.initializing;
    for(const ref of sceneAssetRefs(scenes))if(!('part' in ref)) {
      const image=assetGeometry!.resolveImage!(ref),limit=this.device?.limits.maxTextureDimension2D??this.gl!.gl.getParameter(this.gl!.gl.MAX_TEXTURE_SIZE);
      if(image.width>limit||image.height>limit)throw new Error('Image exceeds device texture dimension limit');
    }
  }
  private drawGPU(pass:GPURenderPassEncoder,command:Extract<import('./composition.js').RenderCommand,{first:number}>,camera:GPUBuffer,pipeline:GPURenderPipeline,depthOnly:boolean):void {
    if(command.imageBinding){
      if(depthOnly)this.imageDepthPipeline??=this.device!.createRenderPipeline({...this.imageDescriptor!,fragment:{...this.imageDescriptor!.fragment!,targets:[{format:this.format!,writeMask:0}]}});
      pipeline=depthOnly?this.imageDepthPipeline!:command.opaque?this.imagePipeline!:this.imageTransparentPipeline!;
      let cameras=this.imageCameras.get(pipeline);if(!cameras){cameras=new Map();this.imageCameras.set(pipeline,cameras);}
      let group=cameras.get(camera);if(!group){group=this.device!.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:camera}}]});cameras.set(camera,group);}
      pass.setPipeline(pipeline);pass.setBindGroup(0,group);
      this.gpuImages??=new GPUImages(this.device!);this.gpuImages.bind(pass,pipeline,command.imageBinding);
    }
    else this.modelTextures!.bind(pass,pipeline,command.modelMaterial);
    this.gpuRetained!.draw(pass,pipeline,command,this.vertices);
  }
  private reportError(error:Error):void {
    this.errorGeneration++;
    if(error instanceof VertexBufferLimitError||error instanceof FocusBudgetError){
      // A scene retry cannot replace an outstanding backend failure with a
      // recoverable budget error, even if that retry is itself oversized.
      if(this.errorKind==='backend')return;
      this.errorKind='budget';
    }else this.errorKind='backend';
    this.onError?.(error);
  }
  private backendRecovered(generation:number):void {
    // Resource recreation may report a new error or invoke host callbacks that
    // reenter rendering. Only acknowledge the recovery attempt's own generation.
    if(this.disposed||!this.ready||this.contextLost||generation!==this.errorGeneration)return;
    this.errorKind=undefined;
    this.onRecovered?.();
  }
  private frameRendered():void {
    // Successful submission resolves only a scene budget rejection. Uncaptured
    // GPU errors require actual backend recovery. Clear before reentrant callbacks.
    if(this.errorKind==='budget'){this.errorKind=undefined;this.onRecovered?.();}
  }
  render(frame:Frame,options:CompiledScene['options']):void {
    if(!this.ready||this.contextLost||this.disposed)return;
    this.lastFrame=frame;this.lastOptions=options;this.regions=frame.views??[];
    frame=this.models?.resolve(frame)??frame;
    const {width,height}=this.size;
    const camera=this.effectiveCamera(frame.camera,options.orbit);
    const palette=paletteResolver(this.hostPalette??options.palette);
    const lighting=frame.lighting??options.lighting;
    try {
      const focused=[camera,...this.regions.map(v=>v.camera)].map(c=>normalizeFocus(c.focus)).filter(f=>f&&f.aperture>0);
      focusPreflight(this.canvas.width,this.canvas.height,focused.map(f=>({samples:f!.samples,vertices:0})));
    }catch(error){this.reportError(error instanceof Error?error:new Error(String(error)));return;}
    this.retained.beginFrame();
    const retention=retentionForFrame({...frame,lighting})?this.retained:undefined;
    const mainItems=addPlanarShadows(buildDrawItems(frame,camera,width,height,palette,undefined,false,retention,undefined,this.assetGeometry),lighting,camera,palette);
    const batches=[{camera,width,height,rect:undefined as number[]|undefined,items:mainItems.filter(i=>!i.screen),id:'',screen:false}];
    for(const region of this.regions) {
      const [left,top,w,h]=region.rect;
      // Round shared edges once: adjacent regions neither overlap nor leave gaps at fractional DPR.
      const x=Math.round(left*this.canvas.width),y=Math.round(top*this.canvas.height);
      const pixelWidth=Math.round((left+w)*this.canvas.width)-x,pixelHeight=Math.round((top+h)*this.canvas.height)-y;
      if(pixelWidth<1||pixelHeight<1)continue;
      const viewWidth=width*pixelWidth/this.canvas.width,viewHeight=height*pixelHeight/this.canvas.height;
      const viewCamera=this.effectiveCamera(region.camera,region.orbit,region.id);
      const items=addPlanarShadows(buildDrawItems(frame,viewCamera,viewWidth,viewHeight,palette,region.id,false,retention,undefined,this.assetGeometry),lighting,viewCamera,palette);
      // Screen vertices bypass lens displacement; keep regional group/order semantics intact.
      batches.push({camera:viewCamera,width:viewWidth,height:viewHeight,rect:[x,y,pixelWidth,pixelHeight],items,id:region.id,screen:false});
    }
    // Scene-wide screen labels stay above every regional 3D view.
    if(mainItems.some(i=>i.screen))batches.push({camera,width,height,rect:undefined,items:mainItems.filter(i=>i.screen),id:'',screen:true});
    let vertexOffset=0;
    const ordered=batches.map(batch=>{
      const composition=composeItems(batch.items,vertexOffset);
      const floatCount=batch.items.reduce((n,i)=>n+i.vertices.length,0);vertexOffset+=floatCount/VERTEX_FLOATS;
      return {...batch,...composition,lighting,floatCount,opaqueVertices:composition.commands.filter(c=>'first' in c&&c.opaque).reduce((n,c)=>n+('count' in c?c.count:0),0)};
    });
    try {
    const submitted=(commands:import('./composition.js').RenderCommand[]):number=>commands.reduce((n,c)=>n+('children' in c?submitted(c.children)*2:(c.mesh?.indices.length??c.count)*(c.instances?.length??1)),0);
    const submissions=(commands:import('./composition.js').RenderCommand[]):number=>commands.reduce((n,c)=>n+('children' in c?submissions(c.children)*2+1:1),0);
    focusPreflight(this.canvas.width,this.canvas.height,ordered.flatMap(b=>{const f=normalizeFocus(b.camera.focus);return !b.screen&&f?.aperture?[{samples:f.samples,vertices:submitted(b.commands),draws:submissions(b.commands)}]:[];}));
    const floatCount=ordered.reduce((n,batch)=>n+batch.floatCount,0);
    // Reject oversized scene data before the combined CPU allocation or any GPU
    // allocation/write/submit. Keep the last good frame and allow a smaller retry.
    const capacity=this.device?vertexBufferCapacity(floatCount*4,this.device.limits.maxBufferSize):0;
    // Retained meshes bypass the flat upload. Validate their buffers as well,
    // before any allocation/write can partially mutate this frame's GPU state.
    if(this.device)for(const batch of ordered)for(const item of batch.items)if(item.mesh) {
      vertexBufferCapacity(item.mesh.vertices.byteLength,this.device.limits.maxBufferSize);
      vertexBufferCapacity(item.mesh.indices.byteLength,this.device.limits.maxBufferSize);
    }
    const data=new Float32Array(floatCount);
    let offset=0;
    for(const batch of ordered)for(const item of batch.items){data.set(item.vertices,offset);offset+=item.vertices.length;}
    this.retained.endFrame();
    const clear=parseColor(palette.resolve(options.background));
    if(this.gl){this.gl.render(data,ordered,clear,this.canvas.width,this.canvas.height);this.frameRendered();return;}
    const device=this.device!;
    this.modelTextures??=new GPUModelTextures(device,this.models?.images??new Map());
    this.gpuRetained??=new GPURetained(device);
    this.gpuRetained.beginFrame();this.gpuImages?.beginFrame();
    const viewIds=new Set(this.regions.map(v=>v.id));
    for(const [id,resource] of this.viewResources)if(!viewIds.has(id)){resource.uniform.destroy();for(const cameras of this.imageCameras.values())cameras.delete(resource.uniform);this.viewResources.delete(id);}
    if(data.byteLength>this.capacity){this.vertices?.destroy();this.capacity=capacity;this.vertices=device.createBuffer({size:this.capacity,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});}
    if(data.length)device.queue.writeBuffer(this.vertices!,0,data);
    const encoder=device.createCommandEncoder();
    const colorView=this.colorTexture!.createView(),target=this.context!.getCurrentTexture().createView(),depthView=this.depthTexture!.createView();
    this.compositor?.beginFrame();
    let focusCameraIndex=0;
    for(const [index,batch] of ordered.entries()) {
      let resources=batch.id?this.viewResources.get(batch.id):{uniform:this.uniform!,bindGroup:this.bindGroup!,transparentBindGroup:this.transparentBindGroup!};
      if(!resources){
        const uniform=device.createBuffer({size:96,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
        resources={uniform,bindGroup:device.createBindGroup({layout:this.pipeline!.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:uniform}}]}),transparentBindGroup:device.createBindGroup({layout:this.transparentPipeline!.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:uniform}}]})};
        this.viewResources.set(batch.id,resources);
      }
      const c=batch.camera;
      const cameraData=[...c.target,0,c.yaw,c.pitch,c.distance,c.perspective,batch.width,batch.height,c.height,0,...lightingUniform(lighting,c),0,0,0,0];
      device.queue.writeBuffer(resources.uniform,0,new Float32Array(cameraData));
      const descriptor:GPURenderPassDescriptor={colorAttachments:[{view:colorView,resolveTarget:target,clearValue:{r:clear[0],g:clear[1],b:clear[2],a:1},loadOp:index===0?'clear':'load',storeOp:'store'}],depthStencilAttachment:{view:depthView,depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'store'}};
      const renderBatch=(descriptor:GPURenderPassDescriptor,resources:{uniform:GPUBuffer;bindGroup:GPUBindGroup;transparentBindGroup:GPUBindGroup})=>{
      if(batch.commands.some(command=>'children' in command)) {
        this.compositor??=new GPUCompositor(device,this.format!);
        this.depthOnlyPipeline??=device.createRenderPipeline({...this.pipelineDescriptor!,fragment:{...this.pipelineDescriptor!.fragment!,targets:[{format:this.format!,writeMask:0}]}});
        const depthBindGroup=device.createBindGroup({layout:this.depthOnlyPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:resources.uniform}}]});
        this.compositor.render(encoder,batch.commands,descriptor,batch.rect,this.canvas.width,this.canvas.height,(pass,command,depthOnly)=>{
          pass.setPipeline(depthOnly?this.depthOnlyPipeline!:command.opaque?this.pipeline!:this.transparentPipeline!);pass.setBindGroup(0,depthOnly?depthBindGroup:command.opaque?resources!.bindGroup:resources!.transparentBindGroup);
          this.drawGPU(pass,command,resources!.uniform,depthOnly?this.depthOnlyPipeline!:command.opaque?this.pipeline!:this.transparentPipeline!,Boolean(depthOnly));
        });
      } else {
        const pass=encoder.beginRenderPass(descriptor);
        if(batch.rect){const [x,y,w,h]=batch.rect;pass.setViewport(x,y,w,h,0,1);pass.setScissorRect(x,y,w,h);}
        for(const command of batch.commands)if('first' in command){pass.setPipeline(command.opaque?this.pipeline!:this.transparentPipeline!);pass.setBindGroup(0,command.opaque?resources.bindGroup:resources.transparentBindGroup);this.drawGPU(pass,command,resources.uniform,command.opaque?this.pipeline!:this.transparentPipeline!,false);}
        pass.end();
      }
      };
      const focus=normalizeFocus(c.focus);
      if(!batch.screen&&focus?.aperture){
        this.depthFocus??=new GPUDepthFocus(device,this.format!);const samples=apertureSamples(focus.samples);
        this.depthFocus.render(encoder,descriptor,batch.rect,this.canvas.width,this.canvas.height,focus.samples,(sampleDescriptor,i)=>{
          const uniform=this.focusCameras[focusCameraIndex++]??=device.createBuffer({size:96,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
          device.queue.writeBuffer(uniform,0,new Float32Array([...cameraData.slice(0,20),samples[i][0]*focus.aperture,samples[i][1]*focus.aperture,focus.distance,0]));
          renderBatch(sampleDescriptor,{uniform,bindGroup:device.createBindGroup({layout:this.pipeline!.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:uniform}}]}),transparentBindGroup:device.createBindGroup({layout:this.transparentPipeline!.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:uniform}}]})});
        });
      }else renderBatch(descriptor,resources);
    }
    device.queue.submit([encoder.finish()]);
    this.gpuRetained.endFrame();this.gpuImages?.endFrame();
    this.frameRendered();
    } catch(error) {
      if(error instanceof VertexBufferLimitError||error instanceof FocusBudgetError){this.reportError(error);return;}
      this.errorKind='backend';
      // Frame acquisition can fail before device.lost reaches the playback loop.
      if(this.device&&!this.disposed) {
        const generation=this.errorGeneration;
        try {this.fallback(error);this.render(frame,options);this.backendRecovered(generation);return;}
        catch(fallbackError){error=fallbackError;}
      }
      this.ready=false;
      this.reportError(error instanceof Error?error:new Error(String(error)));
    }
  }
  dispose():void {
    if(this.disposed)return;
    this.pointerUp();this.disposed=true;this.ready=false;this.observer.disconnect();this.listen(false);
    if(this.gl){this.canvas.removeEventListener('webglcontextlost',this.glLost);this.canvas.removeEventListener('webglcontextrestored',this.glRestored);}
    if(!this.contextLost)this.gl?.dispose();this.gl=undefined;this.releaseGPU();
    // Restore caller ownership, including hosts that reuse the original canvas on retry.
    this.retained.clear();
    if(this.canvas!==this.originalCanvas)this.canvas.replaceWith(this.originalCanvas);
  }
}
