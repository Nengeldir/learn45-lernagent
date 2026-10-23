import {FocusBudgetError} from './depth-focus.js';
const vertex=`#version 300 es
void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.-1.,0.,1.);}`;
const fragment=`#version 300 es
precision highp float;uniform sampler2D image;uniform float weight;out vec4 color;
void main(){color=texelFetch(image,ivec2(gl_FragCoord.xy),0)*weight;}`;
type Surface={sample:WebGLFramebuffer;resolved:WebGLFramebuffer;sum:WebGLFramebuffer;color:WebGLTexture;accum:WebGLTexture;colorBuffer:WebGLRenderbuffer;depth:WebGLRenderbuffer};
export class GLDepthFocus {
 private program:WebGLProgram;private vao:WebGLVertexArrayObject;private weight:WebGLUniformLocation;
 private surface?:Surface;private width=0;private height=0;
 static validate(gl:WebGL2RenderingContext){if(!gl.getExtension('EXT_color_buffer_float'))throw new FocusBudgetError('Optical focus requires WebGL2 EXT_color_buffer_float. Use zero aperture or a capable graphics backend.');}
 constructor(private gl:WebGL2RenderingContext){
  GLDepthFocus.validate(gl);const shaders:WebGLShader[]=[];const p=gl.createProgram()!;
  try{for(const [type,source] of [[gl.VERTEX_SHADER,vertex],[gl.FRAGMENT_SHADER,fragment]] as const){const s=gl.createShader(type)!;shaders.push(s);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s)??'Focus shader failed');gl.attachShader(p,s);}gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(p)??'Focus program failed');this.program=p;this.vao=gl.createVertexArray()!;this.weight=gl.getUniformLocation(p,'weight')!;gl.useProgram(p);gl.uniform1i(gl.getUniformLocation(p,'image'),0);}
  catch(e){gl.deleteProgram(p);throw e;}finally{for(const s of shaders)gl.deleteShader(s);}
 }
 private ensure(width:number,height:number):Surface {
  if(this.surface&&width===this.width&&height===this.height)return this.surface;this.release();const gl=this.gl;
  const s:Surface={sample:gl.createFramebuffer()!,resolved:gl.createFramebuffer()!,sum:gl.createFramebuffer()!,color:gl.createTexture()!,accum:gl.createTexture()!,colorBuffer:gl.createRenderbuffer()!,depth:gl.createRenderbuffer()!};this.surface=s;
  try{
   gl.bindFramebuffer(gl.FRAMEBUFFER,s.sample);
   for(const [buffer,format,attachment] of [[s.colorBuffer,gl.RGBA8,gl.COLOR_ATTACHMENT0],[s.depth,gl.DEPTH_COMPONENT24,gl.DEPTH_ATTACHMENT]] as const){gl.bindRenderbuffer(gl.RENDERBUFFER,buffer);gl.renderbufferStorageMultisample(gl.RENDERBUFFER,Math.min(4,gl.getParameter(gl.MAX_SAMPLES)),format,width,height);gl.framebufferRenderbuffer(gl.FRAMEBUFFER,attachment,gl.RENDERBUFFER,buffer);}
   this.complete();
   for(const [framebuffer,texture,format] of [[s.resolved,s.color,gl.RGBA8],[s.sum,s.accum,gl.RGBA16F]] as const){gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,texture);gl.texStorage2D(gl.TEXTURE_2D,1,format,width,height);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);this.complete();}
   this.width=width;this.height=height;return s;
  }catch(e){this.release();throw e;}
 }
 private complete(){if(this.gl.checkFramebufferStatus(this.gl.FRAMEBUFFER)!==this.gl.FRAMEBUFFER_COMPLETE)throw new FocusBudgetError('Optical focus framebuffer is incomplete.');}
 prepare(width:number,height:number){this.ensure(width,height);this.gl.bindFramebuffer(this.gl.FRAMEBUFFER,null);}
 render(rect:number[]|undefined,width:number,height:number,count:number,draw:(target:WebGLFramebuffer,index:number)=>void){
  const gl=this.gl,s=this.ensure(width,height),[x,top,w,h]=rect??[0,0,width,height],y=height-top-h;
  const quad=(texture:WebGLTexture,weight:number)=>{gl.useProgram(this.program);gl.bindVertexArray(this.vao);gl.activeTexture(gl.TEXTURE0);gl.bindSampler(0,null);gl.bindTexture(gl.TEXTURE_2D,texture);gl.uniform1f(this.weight,weight);gl.disable(gl.DEPTH_TEST);gl.depthMask(false);gl.viewport(0,0,width,height);gl.enable(gl.SCISSOR_TEST);gl.scissor(x,y,w,h);gl.drawArrays(gl.TRIANGLES,0,3);};
  for(let i=0;i<count;i++){
   gl.bindFramebuffer(gl.FRAMEBUFFER,s.sample);gl.disable(gl.SCISSOR_TEST);gl.depthMask(true);gl.enable(gl.DEPTH_TEST);gl.clearColor(0,0,0,0);gl.clearDepth(1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.viewport(x,y,w,h);gl.enable(gl.SCISSOR_TEST);gl.scissor(x,y,w,h);draw(s.sample,i);
   gl.disable(gl.SCISSOR_TEST);gl.bindFramebuffer(gl.READ_FRAMEBUFFER,s.sample);gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,s.resolved);gl.blitFramebuffer(0,0,width,height,0,0,width,height,gl.COLOR_BUFFER_BIT,gl.NEAREST);
   gl.bindFramebuffer(gl.FRAMEBUFFER,s.sum);if(i===0){gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);}gl.enable(gl.BLEND);gl.blendFuncSeparate(gl.ONE,gl.ONE,gl.ONE,gl.ONE);quad(s.color,1/count);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.blendFuncSeparate(gl.ONE,gl.ONE_MINUS_SRC_ALPHA,gl.ONE,gl.ONE_MINUS_SRC_ALPHA);quad(s.accum,1);gl.enable(gl.DEPTH_TEST);gl.depthMask(true);
 }
 private release(){const s=this.surface,gl=this.gl;if(s){gl.deleteFramebuffer(s.sample);gl.deleteFramebuffer(s.resolved);gl.deleteFramebuffer(s.sum);gl.deleteTexture(s.color);gl.deleteTexture(s.accum);gl.deleteRenderbuffer(s.colorBuffer);gl.deleteRenderbuffer(s.depth);}this.surface=undefined;}
 dispose(){this.release();this.gl.deleteProgram(this.program);this.gl.deleteVertexArray(this.vao);}
}
