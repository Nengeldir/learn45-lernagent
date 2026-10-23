import { GLImages } from './image-resources.js';
import { modelGLSL } from './model-shader.js';
import { GLModelTextures } from './model-textures.js';
import type { ModelImage } from './models.js';
import type { DecodedModelImage } from './model-store.js';
import { lightingUniform } from './lighting.js';
import { IDENTITY_INSTANCE, MAX_INSTANCES } from './retained-geometry.js';
import type { RetainedMesh } from './retained-geometry.js';
import { materialGLSL } from './material-shader.js';
import { VERTEX_FLOATS, textureGLSL } from './texture-shader.js';
import type { CameraState, Frame } from './types.js';
import type { RenderCommand } from './composition.js';
import { GLCompositor } from './gl-compositor.js';
import {GLDepthFocus} from './gl-depth-focus.js';
import {apertureSamples,normalizeFocus} from './depth-focus.js';

/** The same packed triangles and camera data are submitted by both backends. */
export interface RenderBatch {
  camera: CameraState;
  lighting?: Frame['lighting'];
  width: number;
  height: number;
  rect?: number[];
  opaqueVertices: number;
  floatCount: number;
  commands?: RenderCommand[];
  screen?:boolean;
}

/** Compact contiguous fields without changing the shared 36-float vertex buffer.
 * Leave headroom for Safari/Metal's internal gl_InstanceID attribute. */
export const WEBGL_VERTEX_ATTRIBUTES = [
  [0,3,0], [1,4,12], [2,1,28], [3,3,32], [4,4,44], [5,4,60],
  [6,4,76], [7,4,92], [8,4,108], [9,4,124], [10,1,140],
] as const;

const vertex = `#version 300 es
precision highp float;
layout(location=0) in vec3 localWorld;
layout(location=1) in vec4 color;
layout(location=2) in float screen;
layout(location=3) in vec3 localNormal;
layout(location=4) in vec4 lightingLayerViewport;
layout(location=5) in vec4 texturePositionKind;
layout(location=6) in vec4 texColor;
layout(location=7) in vec4 textureSeedMaterial;
layout(location=8) in vec4 emissionBump;
layout(location=9) in vec4 uv;
layout(location=10) in float imageAlphaMode;
out vec4 vUV;
uniform mat4 objectTransform[${MAX_INSTANCES}];
uniform vec4 objectInfo[${MAX_INSTANCES}];
uniform vec4 focus;
uniform vec4 angles;
uniform vec4 viewport;
uniform vec4 lens;
out vec4 vColor;
out vec3 vNormal;
out float vLit;
out vec3 vTexPosition;
out float vTexKind;
out vec4 vTexColor;
out float vTexSeed;
out vec3 vViewDirection;
out vec3 vMaterial;
out vec3 vEmission;
out vec3 vViewPosition;
out float vBumpStrength;
out float vImageAlphaMode;
void main() {
  float lit=lightingLayerViewport.x;
  float localLayer=lightingLayerViewport.y;
  vec2 localViewportOffset=lightingLayerViewport.zw;
  vec3 texPosition=texturePositionKind.xyz;
  float texKind=texturePositionKind.w;
  float texSeed=textureSeedMaterial.x;
  vec3 material=textureSeedMaterial.yzw;
  vec3 emission=emissionBump.xyz;
  float bumpStrength=emissionBump.w;
  mat4 transform=objectTransform[gl_InstanceID];
  vec4 info=objectInfo[gl_InstanceID];
  vec3 world=(transform*vec4(localWorld,1.)).xyz;
  vec3 normal=(transform*vec4(localNormal,0.)).xyz/info.y;
  float layer=localLayer+info.x;
  vec2 viewportOffset=localViewportOffset+info.zw;
  vec3 p=world-focus.xyz;
  float cy=cos(-angles.x), sy=sin(-angles.x);
  p=vec3(p.x*cy+p.z*sy,p.y,-p.x*sy+p.z*cy);
  float cp=cos(-angles.y), sp=sin(-angles.y);
  p=vec3(p.x,p.y*cp-p.z*sp,p.y*sp+p.z*cp);
  float depth=angles.z-p.z;
  float divisor=mix(1.,depth/angles.z,angles.w);
  float halfHeight=viewport.z/2.;
  vec4 position=vec4(p.x/halfHeight*viewport.y/viewport.x,p.y/halfHeight,(depth-0.01)/(angles.z*100.-0.01)*divisor,divisor);
  if(lens.z>0.&&screen<0.5){vec2 shift=lens.xy*(depth/lens.z-1.);position.xy+=vec2(shift.x/halfHeight*viewport.y/viewport.x,shift.y/halfHeight);}
  if(screen>0.5) position=vec4(world.x*2./viewport.x,world.y*2./viewport.y,0.0001,1.);
  position.z-=layer*0.00000002*position.w;
  position.xy+=viewportOffset*2.*position.w;
  // WebGPU clip depth is [0,w]; OpenGL clip depth is [-w,w].
  position.z=2.*position.z-position.w;
  gl_Position=position;
  vec3 n=vec3(normal.x*cy+normal.z*sy,normal.y,-normal.x*sy+normal.z*cy);
  vUV=uv;vImageAlphaMode=imageAlphaMode;vNormal=vec3(n.x,n.y*cp-n.z*sp,n.y*sp+n.z*cp);
  vLit=lit; vColor=color;
  vTexPosition=texPosition;vTexKind=texKind;vTexColor=texColor;vTexSeed=texSeed;
  vMaterial=material;vEmission=emission;vViewPosition=p;vBumpStrength=bumpStrength*info.y;vViewDirection=mix(vec3(0.,0.,1.),vec3(-p.x,-p.y,depth),angles.w);
  if(lens.z>0.&&screen<0.5)vViewDirection=mix(vec3(lens.xy/lens.z,1.),vec3(lens.xy-p.xy,depth),angles.w);
}`;
const fragment = `#version 300 es
precision highp float;
in vec4 vUV;
in vec4 vColor;
in vec3 vNormal;
in float vLit;
in vec3 vTexPosition;
in float vTexKind;
in vec4 vTexColor;
in float vTexSeed;
in vec3 vViewDirection;
in vec3 vMaterial;
in vec3 vEmission;
in vec3 vViewPosition;
in float vBumpStrength;
in float vImageAlphaMode;
uniform sampler2D imageColor;
out vec4 outputColor;
uniform vec4 light;
uniform vec4 ambient;
${textureGLSL}
${materialGLSL}
${modelGLSL}
void main() {
  vec4 color=vColor;
  vec4 imported=importedColor(color,vUV,vTexSeed,vNormal,vViewPosition,vViewDirection,gl_FrontFacing,light,ambient.x);
  if(modelFlags.w>0.5){outputColor=imported;return;}
  if(vImageAlphaMode>0.5){vec4 sampled=texture(imageColor,vUV.xy);color*=vec4(sampled.rgb,vImageAlphaMode<1.5?1.:sampled.a);}
  vec3 footprint=fwidth(vTexPosition);
  float height=0.;
  if(vTexKind>0.5){
    vec2 surface=proceduralSample(vTexPosition,vTexKind,vTexSeed,footprint);
    color=mix(color,vTexColor,surface.x);height=surface.y;
  }
  vec3 dx=dFdx(vViewPosition),dy=dFdy(vViewPosition);
  vec2 dh=vec2(dFdx(height),dFdy(height));
  if(color.a<=0.){discard;}
  if(vLit>0.5) {
    vec3 n=vNormal;
    n=n/max(length(n),0.000001);
    if(vBumpStrength!=0.){n=bumpNormal(n,dx,dy,dh,vBumpStrength);}
    if(vLit>1.5&&!gl_FrontFacing){n=-n;}
    if(vMaterial.y>0.){color=vec4(materialColor(color.rgb,n,normalize(vViewDirection),vMaterial,light,ambient.x),color.a);}
    else {float amount=0.32*ambient.x+0.68*light.w*max(0.,dot(n,normalize(light.xyz)));
    color=vec4(color.rgb*amount,color.a);}
  }
  outputColor=vec4(color.rgb+vEmission,color.a);
}`;

/** WebGL2 submission only; scene evaluation, tessellation and ordering live in CanvasRenderer. */
export class WebGLBackend {
  private modelTextures:GLModelTextures;
  private program: WebGLProgram;
  private images?:GLImages;
  private buffer: WebGLBuffer;
  private vao: WebGLVertexArrayObject;
  private focus: WebGLUniformLocation;
  private angles: WebGLUniformLocation;
  private viewport: WebGLUniformLocation;
  private light: WebGLUniformLocation;
  private ambient: WebGLUniformLocation;
  private lens:WebGLUniformLocation;
  private depthFocus?:GLDepthFocus;
  private capacity = 0;
  private objectTransform: WebGLUniformLocation;
  private objectInfo: WebGLUniformLocation;
  private meshes = new Map<RetainedMesh, { vertices: WebGLBuffer; indices: WebGLBuffer; vao: WebGLVertexArrayObject }>();
  private compositor?: GLCompositor;
  readonly maxSize: number;

  constructor(readonly gl: WebGL2RenderingContext,images:Map<ModelImage,DecodedModelImage>=new Map()) {
    const shaders: WebGLShader[] = [];
    let program: WebGLProgram | null = null, buffer: WebGLBuffer | null = null, vao: WebGLVertexArrayObject | null = null;
    try {
      const compile = (type: number, source: string) => {
        const shader = gl.createShader(type);
        if (!shader) throw new Error('WebGL2 could not allocate a shader.');
        shaders.push(shader); gl.shaderSource(shader, source); gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(`WebGL2 shader: ${gl.getShaderInfoLog(shader)}`);
        return shader;
      };
      program = gl.createProgram();
      if (!program) throw new Error('WebGL2 could not allocate a program.');
      gl.attachShader(program, compile(gl.VERTEX_SHADER, vertex));
      gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragment));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`WebGL2 program: ${gl.getProgramInfoLog(program)}`);
      buffer = gl.createBuffer(); vao = gl.createVertexArray();
      if (!buffer || !vao) throw new Error('WebGL2 could not allocate geometry resources.');
      this.program = program;this.modelTextures=new GLModelTextures(gl,images,program); this.buffer = buffer; this.vao = vao;
      const uniform = (name: string) => {
        const value = gl.getUniformLocation(program!, name);
        if (value === null) throw new Error(`WebGL2 camera uniform missing: ${name}`);
        return value;
      };
      this.focus = uniform('focus'); this.angles = uniform('angles'); this.viewport = uniform('viewport');
      this.light = uniform('light'); this.ambient = uniform('ambient');
      this.lens=uniform('lens');
      this.objectTransform = uniform('objectTransform[0]'); this.objectInfo = uniform('objectInfo[0]');
      gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      this.attributes();
      gl.bindVertexArray(null);
      const viewportLimits = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array;
      this.maxSize = Math.min(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), viewportLimits[0], viewportLimits[1]);
      if (gl.isContextLost() || gl.getError() !== gl.NO_ERROR) throw new Error('WebGL2 initialization failed.');
    } catch (error) {
      if (vao) gl.deleteVertexArray(vao);
      if (buffer) gl.deleteBuffer(buffer);
      if (program) gl.deleteProgram(program);
      throw error;
    } finally { for (const shader of shaders) gl.deleteShader(shader); }
  }

  private attributes(): void {
    const gl = this.gl;
    for (const [location, size, offset] of WEBGL_VERTEX_ATTRIBUTES) {
      gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location, size, gl.FLOAT, false, VERTEX_FLOATS*4, offset);
    }
  }

  private retainedMesh(mesh: RetainedMesh) {
    const gl = this.gl;
    let resource = this.meshes.get(mesh);
    if (resource) return resource;
    const vertices = gl.createBuffer(), indices = gl.createBuffer(), vao = gl.createVertexArray();
    if (!vertices || !indices || !vao) {
      if (vertices) gl.deleteBuffer(vertices); if (indices) gl.deleteBuffer(indices); if (vao) gl.deleteVertexArray(vao);
      throw new Error('WebGL2 could not allocate retained geometry.');
    }
    resource = { vertices, indices, vao }; this.meshes.set(mesh, resource);
    gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, vertices);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.vertices, gl.STATIC_DRAW); this.attributes();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indices); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
    return resource;
  }

  render(data: Float32Array, batches: RenderBatch[], clear: number[], width: number, height: number): void {
    const gl = this.gl;
    if (gl.isContextLost()) return;
    const focuses=batches.map(b=>b.screen?undefined:normalizeFocus(b.camera.focus));
    if(focuses.some(f=>f?.aperture)){GLDepthFocus.validate(gl);this.depthFocus??=new GLDepthFocus(gl);this.depthFocus.prepare(width,height);}
    gl.useProgram(this.program); gl.bindVertexArray(this.vao); gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    if (data.byteLength > this.capacity) {
      this.capacity = Math.max(256, data.byteLength * 2);
      gl.bufferData(gl.ARRAY_BUFFER, this.capacity, gl.DYNAMIC_DRAW);
      if (!gl.isContextLost() && gl.getError() !== gl.NO_ERROR) throw new Error('WebGL2 could not allocate the scene vertex buffer.');
    }
    if (data.length) gl.bufferSubData(gl.ARRAY_BUFFER, 0, data);
    gl.disable(gl.CULL_FACE); gl.disable(gl.SCISSOR_TEST);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true);
    gl.enable(gl.BLEND); gl.blendEquation(gl.FUNC_ADD);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(clear[0], clear[1], clear[2], 1); gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    this.images?.beginFrame();
    const used = new Set<RetainedMesh>();
    let first = 0;
    for (const [batchIndex,batch] of batches.entries()) {
      gl.useProgram(this.program);
      // Match WebGPU's independent depth attachment clear for every view/overlay.
      gl.disable(gl.SCISSOR_TEST); gl.depthMask(true); gl.clear(gl.DEPTH_BUFFER_BIT);
      const [x, top, w, h] = batch.rect ?? [0, 0, width, height];
      const y = height - top - h;
      gl.viewport(x, y, w, h); gl.enable(gl.SCISSOR_TEST); gl.scissor(x, y, w, h);
      const c = batch.camera;
      gl.uniform4f(this.focus, ...c.target, 0);
      gl.uniform4f(this.angles, c.yaw, c.pitch, c.distance, c.perspective);
      gl.uniform4f(this.viewport, batch.width, batch.height, c.height, 0);
      gl.uniform4f(this.lens,0,0,0,0);
      const light = lightingUniform(batch.lighting, c);
      gl.uniform4f(this.light, light[0], light[1], light[2], light[3]);
      gl.uniform4f(this.ambient, light[4], 0, 0, 0);
      const count = batch.floatCount / VERTEX_FLOATS;
      const commands = batch.commands ?? [{ first, count: batch.opaqueVertices, opaque: true }, { first: first+batch.opaqueVertices, count: count-batch.opaqueVertices, opaque: false }];
      const draw = (command: Extract<RenderCommand,{first:number}>) => {
        gl.useProgram(this.program);gl.bindVertexArray(this.vao);gl.depthMask(command.opaque);
        gl.blendFuncSeparate(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA,gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
        this.modelTextures.bind(command.modelMaterial);
        if(command.imageBinding){this.images??=new GLImages(gl);this.images.bind(command.imageBinding);gl.uniform1i(gl.getUniformLocation(this.program,'imageColor'),3);}
        const instances = command.instances ?? [IDENTITY_INSTANCE];
        const matrices = new Float32Array(instances.length*16), info = new Float32Array(instances.length*4);
        instances.forEach((instance,i) => { matrices.set(instance.subarray(0,16),i*16); info.set(instance.subarray(16,20),i*4); });
        gl.uniformMatrix4fv(this.objectTransform,false,matrices); gl.uniform4fv(this.objectInfo,info);
        if (command.mesh) {
          used.add(command.mesh);
          gl.bindVertexArray(this.retainedMesh(command.mesh).vao);
          gl.drawElementsInstanced(gl.TRIANGLES,command.mesh.indices.length,gl.UNSIGNED_INT,0,instances.length);
        } else gl.drawArrays(gl.TRIANGLES,command.first,command.count);
      };
      const renderCommands=(parent:WebGLFramebuffer|null)=>{
      if (commands.some(command => 'children' in command)) {
        this.compositor ??= new GLCompositor(gl);
        this.compositor.render(commands,batch.rect,width,height,draw,parent);
      } else for (const command of commands) if ('first' in command) draw(command);
      };
      const focus=focuses[batchIndex];
      if(focus?.aperture){this.depthFocus??=new GLDepthFocus(gl);const samples=apertureSamples(focus.samples);this.depthFocus.render(batch.rect,width,height,focus.samples,(parent,i)=>{gl.useProgram(this.program);gl.uniform4f(this.lens,samples[i][0]*focus.aperture,samples[i][1]*focus.aperture,focus.distance,0);renderCommands(parent);});}
      else renderCommands(null);
      first += count;
    }
    this.images?.endFrame();
    gl.depthMask(true); gl.disable(gl.SCISSOR_TEST); gl.bindVertexArray(null);
    for (const [mesh,resource] of this.meshes) if (!used.has(mesh)) {
      gl.deleteBuffer(resource.vertices); gl.deleteBuffer(resource.indices); gl.deleteVertexArray(resource.vao); this.meshes.delete(mesh);
    }
  }

  dispose(): void {
    this.depthFocus?.dispose();
    this.images?.dispose();
    this.modelTextures.dispose();
    this.compositor?.dispose();
    for (const resource of this.meshes.values()) {
      this.gl.deleteBuffer(resource.vertices); this.gl.deleteBuffer(resource.indices); this.gl.deleteVertexArray(resource.vao);
    }
    this.meshes.clear();
    this.gl.deleteBuffer(this.buffer); this.gl.deleteVertexArray(this.vao); this.gl.deleteProgram(this.program);
  }
}
