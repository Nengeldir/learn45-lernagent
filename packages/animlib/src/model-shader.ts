/** Both backends sample imported maps in linear space, then encode their final color to sRGB. */
export const modelWGSL = `
struct ModelMaterial { base:vec4f, emission:vec4f, factors:vec4f, flags:vec4f, maps:array<vec4f,10> };
@group(2) @binding(0) var<uniform> model:ModelMaterial;
${Array.from({length:5},(_,i)=>`@group(2) @binding(${1+i*2}) var map${i}:texture_2d<f32>;\n@group(2) @binding(${2+i*2}) var sampler${i}:sampler;`).join('\n')}
fn modelUV(uv:vec4f,index:u32)->vec2f {
  let a=model.maps[index*2u];let b=model.maps[index*2u+1u];
  let p=select(uv.xy,uv.zw,b.y>0.5)*a.zw;
  return a.xy+vec2f(cos(b.x)*p.x-sin(b.x)*p.y,sin(b.x)*p.x+cos(b.x)*p.y);
}
fn toLinear(c:vec3f)->vec3f {return select(c/12.92,pow((c+vec3f(0.055))/1.055,vec3f(2.4)),c>vec3f(0.04045));}
fn toSRGB(c:vec3f)->vec3f {let v=max(c,vec3f(0));return select(12.92*v,1.055*pow(v,vec3f(1./2.4))-vec3f(0.055),v>vec3f(0.0031308));}
fn importedColor(color:vec4f,uv:vec4f,vertexAlpha:f32,baseNormal:vec3f,position:vec3f,view:vec3f,front:bool,light:vec4f,ambient:f32)->vec4f {
  if(model.flags.w<0.5){return color;}
  ${Array.from({length:5},(_,i)=>`let uv${i}=modelUV(uv,${i}u);let sample${i}=textureSample(map${i},sampler${i},uv${i});`).join('\n')}
  let dx=dpdx(position);let dy=dpdy(position);let tx=dpdx(uv2);let ty=dpdy(uv2);
  if(!front && model.flags.z<0.5){discard;}
  var base=model.base*vec4f(toLinear(sample0.rgb),sample0.a*vertexAlpha);
  if(model.flags.x<0.5){base.a=1.;}
  if(model.flags.x>0.5 && model.flags.x<1.5){if(base.a<model.flags.y){discard;}base.a=1.;}
  base=vec4f(base.rgb*color.rgb,base.a*color.a);
  var n=normalize(baseNormal);
  let determinant=tx.x*ty.y-tx.y*ty.x;
  if(model.maps[5].z>0.5 && abs(determinant)>1e-10) {
    let tangent=(dx*ty.y-dy*tx.y)/determinant;
    let projected=tangent-n*dot(n,tangent);
    if(length(projected)>1e-10) {
      let t=normalize(projected);let rawB=(-dx*ty.x+dy*tx.x)/determinant;
      let b=cross(n,t)*select(-1.,1.,dot(cross(n,t),rawB)>=0.);
      let mapped=vec3f((sample2.xy*2.-vec2f(1.))*model.factors.z,sample2.z*2.-1.);
      n=normalize(t*mapped.x+b*mapped.y+n*mapped.z);
    }
  }
  if(!front){n=-n;}
  var rgb=base.rgb;
  if(model.emission.w<0.5) {
    let factors=vec3f(model.factors.x*sample1.b,max(0.05,model.factors.y*sample1.g),0.5);
    rgb=materialColor(rgb,n,normalize(view),factors,light,ambient)*mix(1.,sample3.r,model.factors.w);
    rgb+=model.emission.rgb*toLinear(sample4.rgb);
  }
  return vec4f(toSRGB(rgb),base.a);
}
`;
export const modelGLSL = `
uniform vec4 modelBase,modelEmission,modelFactors,modelFlags;
uniform vec4 modelMaps[10];
${Array.from({length:5},(_,i)=>`uniform sampler2D modelMap${i};`).join('\n')}
vec2 modelUV(vec4 uv,int index) {
  vec4 a=modelMaps[index*2],b=modelMaps[index*2+1];
  vec2 p=(b.y>0.5?uv.zw:uv.xy)*a.zw;
  return a.xy+vec2(cos(b.x)*p.x-sin(b.x)*p.y,sin(b.x)*p.x+cos(b.x)*p.y);
}
vec3 toLinear(vec3 c){return mix(c/12.92,pow((c+vec3(0.055))/1.055,vec3(2.4)),greaterThan(c,vec3(0.04045)));}
vec3 toSRGB(vec3 c){vec3 v=max(c,vec3(0));return mix(12.92*v,1.055*pow(v,vec3(1./2.4))-vec3(0.055),greaterThan(v,vec3(0.0031308)));}
vec4 importedColor(vec4 color,vec4 uv,float vertexAlpha,vec3 baseNormal,vec3 position,vec3 view,bool front,vec4 light,float ambient) {
  if(modelFlags.w<0.5)return color;
  ${Array.from({length:5},(_,i)=>`vec2 uv${i}=modelUV(uv,${i});vec4 sample${i}=texture(modelMap${i},uv${i});`).join('\n')}
  vec3 dx=dFdx(position),dy=dFdy(position);vec2 tx=dFdx(uv2),ty=dFdy(uv2);
  if(!front && modelFlags.z<0.5)discard;
  vec4 base=modelBase*vec4(toLinear(sample0.rgb),sample0.a*vertexAlpha);
  if(modelFlags.x<0.5)base.a=1.;
  if(modelFlags.x>0.5 && modelFlags.x<1.5){if(base.a<modelFlags.y)discard;base.a=1.;}
  base.rgb*=color.rgb; base.a*=color.a;
  vec3 n=normalize(baseNormal);
  float determinant=tx.x*ty.y-tx.y*ty.x;
  if(modelMaps[5].z>0.5 && abs(determinant)>1e-10){
    vec3 tangent=(dx*ty.y-dy*tx.y)/determinant;
    vec3 projected=tangent-n*dot(n,tangent);
    if(length(projected)>1e-10){
      vec3 t=normalize(projected),rawB=(-dx*ty.x+dy*tx.x)/determinant;
      vec3 b=cross(n,t)*(dot(cross(n,t),rawB)>=0.?1.:-1.);
      vec3 mapped=vec3((sample2.xy*2.-vec2(1.))*modelFactors.z,sample2.z*2.-1.);
      n=normalize(t*mapped.x+b*mapped.y+n*mapped.z);
    }
  }
  if(!front)n=-n;
  vec3 rgb=base.rgb;
  if(modelEmission.w<0.5){
    vec3 factors=vec3(modelFactors.x*sample1.b,max(0.05,modelFactors.y*sample1.g),0.5);
    rgb=materialColor(rgb,n,normalize(view),factors,light,ambient)*mix(1.,sample3.r,modelFactors.w);
    rgb+=modelEmission.rgb*toLinear(sample4.rgb);
  }
  return vec4(toSRGB(rgb),base.a);
}
`;
