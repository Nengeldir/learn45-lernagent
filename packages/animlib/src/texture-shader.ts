/** Packed vertex layout shared by tessellation, composition, inspection and both GPUs. */
// UV0.xy and UV1.xy occupy floats 31-34 (location 14); prepared-image alpha mode is float 35 (location 15).
export const VERTEX_FLOATS = 36;
export const texturePatterns = ['checker', 'stripes', 'noise', 'marble', 'wood'] as const;

// Equivalent bounded value-noise and filtered pattern functions for the two backends.
// Texture coordinates are local, interpolated per fragment (no extra tessellation).
export const textureWGSL = `
fn bumpNormal(n:vec3f,dx:vec3f,dy:vec3f,dh:vec2f,strength:f32)->vec3f {
  let rx=cross(dy,n);let ry=cross(n,dx);let determinant=dot(dx,rx);
  // Degenerate projections and grazing faces keep their finite base normal.
  if(abs(determinant)<=0.000001*max(length(dx)*length(dy),1e-20)){return n;}
  let gradient=(rx*dh.x+ry*dh.y)/determinant;
  return normalize(n-strength*gradient);
}

fn textureHash(cell:vec3f,seed:f32)->f32 {
  var p=fract(cell*0.1031+vec3f(seed*0.001));
  p+=vec3f(dot(p,p.yzx+vec3f(33.33)));
  return fract((p.x+p.y)*p.z);
}
fn textureNoise(p:vec3f,seed:f32)->f32 {
  let cell=floor(p);let f=fract(p);let u=f*f*(vec3f(3.)-2.*f);
  return mix(mix(mix(textureHash(cell,seed),textureHash(cell+vec3f(1,0,0),seed),u.x),
    mix(textureHash(cell+vec3f(0,1,0),seed),textureHash(cell+vec3f(1,1,0),seed),u.x),u.y),
    mix(mix(textureHash(cell+vec3f(0,0,1),seed),textureHash(cell+vec3f(1,0,1),seed),u.x),
    mix(textureHash(cell+vec3f(0,1,1),seed),textureHash(cell+vec3f(1,1,1),seed),u.x),u.y),u.z);
}
fn textureBand(x:f32,width:f32)->f32 {
  let edge=max(0.0001,min(width,1.)*3.14159265);
  return mix(smoothstep(-edge,edge,sin(x*3.14159265)),0.5,clamp(width-0.5,0.,1.));
}
// Center each octave before filtering, so unresolved detail contributes only its
// mean. Different offsets keep the three lattices from lining up.
fn textureNoiseLayer(p:vec3f,seed:f32,width:f32)->f32 {
  let visibility=1.-smoothstep(0.25,1.,width);
  if(visibility<=0.){return 0.;}
  return (textureNoise(p,seed)-0.5)*visibility;
}
// x is color mix; y is height. Relief uses only the finer layers, with small
// amplitudes to avoid turning broad color variation into inflated lumps.
fn textureNoiseSample(p:vec3f,seed:f32,width:f32)->vec2f {
  let broad=textureNoiseLayer(p,seed,width);
  let medium=textureNoiseLayer(p*2.03+vec3f(19.1,7.7,3.4),seed,width*2.03);
  let fine=textureNoiseLayer(p*4.11+vec3f(5.3,23.8,11.6),seed,width*4.11);
  return vec2f(0.5+0.55*(0.6*broad+0.28*medium+0.12*fine),0.035*medium+0.065*fine);
}
fn textureMix(p:vec3f,kind:f32,seed:f32,footprint:vec3f)->f32 {
  let width=max(footprint.x,max(footprint.y,footprint.z));
  if(kind<1.5){
    let bands=vec3f(textureBand(p.x,footprint.x),textureBand(p.y,footprint.y),textureBand(p.z,footprint.z))*2.-vec3f(1.);
    return 0.5-0.5*bands.x*bands.y*bands.z;
  }
  if(kind<2.5){return 1.-textureBand(p.x,footprint.x);}
  let noise=textureNoise(p,seed);
  if(kind<4.5){return textureBand(p.x+4.*noise,width*5.);}
  return textureBand(length(p.xz)*2.+2.*noise,width*4.);
}
fn proceduralSample(p:vec3f,kind:f32,seed:f32,footprint:vec3f)->vec2f {
  if(kind>2.5&&kind<3.5){return textureNoiseSample(p,seed,max(footprint.x,max(footprint.y,footprint.z)));}
  let value=textureMix(p,kind,seed,footprint);
  return vec2f(value,value);
}
`;

export const textureGLSL = `
vec3 bumpNormal(vec3 n,vec3 dx,vec3 dy,vec2 dh,float strength) {
  vec3 rx=cross(dy,n),ry=cross(n,dx);float determinant=dot(dx,rx);
  if(abs(determinant)<=0.000001*max(length(dx)*length(dy),1e-20)){return n;}
  vec3 gradient=(rx*dh.x+ry*dh.y)/determinant;
  return normalize(n-strength*gradient);
}

float textureHash(vec3 cell,float seed) {
  vec3 p=fract(cell*0.1031+vec3(seed*0.001));
  p+=vec3(dot(p,p.yzx+vec3(33.33)));
  return fract((p.x+p.y)*p.z);
}
float textureNoise(vec3 p,float seed) {
  vec3 cell=floor(p),f=fract(p),u=f*f*(vec3(3.)-2.*f);
  return mix(mix(mix(textureHash(cell,seed),textureHash(cell+vec3(1,0,0),seed),u.x),
    mix(textureHash(cell+vec3(0,1,0),seed),textureHash(cell+vec3(1,1,0),seed),u.x),u.y),
    mix(mix(textureHash(cell+vec3(0,0,1),seed),textureHash(cell+vec3(1,0,1),seed),u.x),
    mix(textureHash(cell+vec3(0,1,1),seed),textureHash(cell+vec3(1,1,1),seed),u.x),u.y),u.z);
}
float textureBand(float x,float width) {
  float edge=max(0.0001,min(width,1.)*3.14159265);
  return mix(smoothstep(-edge,edge,sin(x*3.14159265)),0.5,clamp(width-0.5,0.,1.));
}
float textureNoiseLayer(vec3 p,float seed,float width) {
  float visibility=1.-smoothstep(0.25,1.,width);
  if(visibility<=0.){return 0.;}
  return (textureNoise(p,seed)-0.5)*visibility;
}
vec2 textureNoiseSample(vec3 p,float seed,float width) {
  float broad=textureNoiseLayer(p,seed,width);
  float medium=textureNoiseLayer(p*2.03+vec3(19.1,7.7,3.4),seed,width*2.03);
  float fine=textureNoiseLayer(p*4.11+vec3(5.3,23.8,11.6),seed,width*4.11);
  return vec2(0.5+0.55*(0.6*broad+0.28*medium+0.12*fine),0.035*medium+0.065*fine);
}
float textureMix(vec3 p,float kind,float seed,vec3 footprint) {
  float width=max(footprint.x,max(footprint.y,footprint.z));
  if(kind<1.5){
    vec3 bands=vec3(textureBand(p.x,footprint.x),textureBand(p.y,footprint.y),textureBand(p.z,footprint.z))*2.-vec3(1.);
    return 0.5-0.5*bands.x*bands.y*bands.z;
  }
  if(kind<2.5){return 1.-textureBand(p.x,footprint.x);}
  float noise=textureNoise(p,seed);
  if(kind<4.5){return textureBand(p.x+4.*noise,width*5.);}
  return textureBand(length(p.xz)*2.+2.*noise,width*4.);
}
vec2 proceduralSample(vec3 p,float kind,float seed,vec3 footprint) {
  if(kind>2.5&&kind<3.5){return textureNoiseSample(p,seed,max(footprint.x,max(footprint.y,footprint.z)));}
  float value=textureMix(p,kind,seed,footprint);
  return vec2(value,value);
}
`;
