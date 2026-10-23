import type { RenderCommand } from './composition.js';

const vertex = `#version 300 es
void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.-1.,0.,1.);}`;
const fragment = `#version 300 es
precision highp float;
uniform sampler2D image;
uniform sampler2D depthImage;
uniform float opacity;
uniform float receiverLight;
uniform float receiverShadow;
uniform vec4 receiverColor;
out vec4 outputColor;
void main(){ivec2 p=ivec2(gl_FragCoord.xy);vec4 color=texelFetch(image,p,0)*opacity;
if(color.a<=0.000001)discard;
vec3 rgb=color.rgb*receiverLight;
if(receiverColor.a>0.)rgb=receiverColor.rgb*max(vec3(0.),vec3(color.a*receiverLight)-color.rgb*receiverShadow);
outputColor=vec4(rgb,color.a);gl_FragDepth=texelFetch(depthImage,p,0).r;}`;
interface Layer { framebuffer: WebGLFramebuffer; resolved: WebGLFramebuffer; color: WebGLTexture; depth: WebGLTexture; colorBuffer: WebGLRenderbuffer; depthBuffer: WebGLRenderbuffer; }

export class GLCompositor {
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private opacity: WebGLUniformLocation;
  private receiverLight: WebGLUniformLocation;
  private receiverShadow: WebGLUniformLocation;
  private receiverColor: WebGLUniformLocation;
  private layers: Layer[] = [];
  private width = 0;
  private height = 0;
  constructor(private gl: WebGL2RenderingContext) {
    const shaders: WebGLShader[] = [];
    const program = gl.createProgram()!;
    try {
      for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]] as const) {
        const shader = gl.createShader(type)!; shaders.push(shader);gl.shaderSource(shader,source);gl.compileShader(shader);
        if (!gl.getShaderParameter(shader,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'Compositor shader failed');
        gl.attachShader(program,shader);
      }
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'Compositor linking failed');
      this.program = program;this.vao = gl.createVertexArray()!;
      this.opacity = gl.getUniformLocation(program,'opacity')!;
      this.receiverLight = gl.getUniformLocation(program,'receiverLight')!;
      this.receiverShadow = gl.getUniformLocation(program,'receiverShadow')!;
      this.receiverColor = gl.getUniformLocation(program,'receiverColor')!;
      gl.useProgram(program);gl.uniform1i(gl.getUniformLocation(program,'image'),0);gl.uniform1i(gl.getUniformLocation(program,'depthImage'),1);
    } catch (error) { gl.deleteProgram(program);throw error; }
    finally { for (const shader of shaders) gl.deleteShader(shader); }
  }
  private layer(level: number, width: number, height: number): Layer {
    const gl = this.gl;
    if (width !== this.width || height !== this.height) { this.releaseLayers();this.width = width;this.height = height; }
    if (!this.layers[level]) {
      const framebuffer = gl.createFramebuffer()!, resolved = gl.createFramebuffer()!;
      const color = gl.createTexture()!, depth = gl.createTexture()!, colorBuffer = gl.createRenderbuffer()!, depthBuffer = gl.createRenderbuffer()!;
      const layer = { framebuffer,resolved,color,depth,colorBuffer,depthBuffer };this.layers[level] = layer;
      const samples = Math.min(4, gl.getParameter(gl.MAX_SAMPLES));
      gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);
      for (const [buffer,format,attachment] of [[colorBuffer,gl.RGBA8,gl.COLOR_ATTACHMENT0],[depthBuffer,gl.DEPTH_COMPONENT24,gl.DEPTH_ATTACHMENT]] as const) {
        gl.bindRenderbuffer(gl.RENDERBUFFER,buffer);gl.renderbufferStorageMultisample(gl.RENDERBUFFER,samples,format,width,height);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER,attachment,gl.RENDERBUFFER,buffer);
      }
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Isolated group framebuffer is incomplete');
      gl.bindFramebuffer(gl.FRAMEBUFFER,resolved);
      for (const [texture,format,attachment] of [[color,gl.RGBA8,gl.COLOR_ATTACHMENT0],[depth,gl.DEPTH_COMPONENT24,gl.DEPTH_ATTACHMENT]] as const) {
        gl.bindTexture(gl.TEXTURE_2D,texture);gl.texStorage2D(gl.TEXTURE_2D,1,format,width,height);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
        gl.framebufferTexture2D(gl.FRAMEBUFFER,attachment,gl.TEXTURE_2D,texture,0);
      }
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Isolated group resolve framebuffer is incomplete');
    }
    return this.layers[level];
  }
  render(commands: RenderCommand[], rect: number[] | undefined, width: number, height: number,
    draw: (command: Extract<RenderCommand,{first:number}>) => void, parent: WebGLFramebuffer | null = null, level = 0): void {
    const gl = this.gl, [x,top,w,h] = rect ?? [0,0,width,height], y = height-top-h;
    for (const command of commands) {
      if ('first' in command) { draw(command);continue; }
      const layer = this.layer(level,width,height);
      gl.bindFramebuffer(gl.FRAMEBUFFER,layer.framebuffer);
      gl.disable(gl.SCISSOR_TEST);gl.depthMask(true);gl.clearColor(0,0,0,0);gl.clearDepth(1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
      gl.viewport(x,y,w,h);gl.enable(gl.SCISSOR_TEST);gl.scissor(x,y,w,h);
      this.render(command.children,rect,width,height,draw,layer.framebuffer,level+1);
      gl.disable(gl.SCISSOR_TEST);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER,layer.framebuffer);gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,layer.resolved);
      gl.blitFramebuffer(0,0,width,height,0,0,width,height,gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT,gl.NEAREST);
      gl.bindFramebuffer(gl.FRAMEBUFFER,parent);
      gl.viewport(0,0,width,height);gl.enable(gl.SCISSOR_TEST);gl.scissor(x,y,w,h);
      gl.useProgram(this.program);gl.bindVertexArray(this.vao);gl.depthMask(command.opaque);
      gl.blendFuncSeparate(gl.ONE,command.additive?gl.ONE:gl.ONE_MINUS_SRC_ALPHA,gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
      gl.activeTexture(gl.TEXTURE0);gl.bindSampler(0,null);gl.bindTexture(gl.TEXTURE_2D,layer.color);
      gl.activeTexture(gl.TEXTURE1);gl.bindSampler(1,null);gl.bindTexture(gl.TEXTURE_2D,layer.depth);
      gl.uniform1f(this.opacity,command.opacity);gl.uniform1f(this.receiverLight,command.receiverLight ?? 1);gl.uniform1f(this.receiverShadow,command.receiverShadow ?? 0);
      gl.uniform4f(this.receiverColor,...(command.receiverColor ?? [1,1,1] as const),command.receiverColor?1:0);
      gl.drawArrays(gl.TRIANGLES,0,3);
      gl.viewport(x,y,w,h);
    }
    if (level > 0) {
      gl.colorMask(false,false,false,false);
      const depth = (commands: RenderCommand[]) => { for (const command of commands) {
        if ('first' in command) draw({...command,opaque:true}); else depth(command.children);
      } };
      depth(commands);gl.colorMask(true,true,true,true);
    }
  }
  private releaseLayers(): void {
    const gl = this.gl;
    for (const layer of this.layers) {
      gl.deleteFramebuffer(layer.framebuffer);gl.deleteFramebuffer(layer.resolved);gl.deleteTexture(layer.color);gl.deleteTexture(layer.depth);
      gl.deleteRenderbuffer(layer.colorBuffer);gl.deleteRenderbuffer(layer.depthBuffer);
    }
    this.layers = [];
  }
  dispose(): void { this.releaseLayers();this.gl.deleteProgram(this.program);this.gl.deleteVertexArray(this.vao); }
}
