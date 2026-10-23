import { modelBoundsGeometry } from './models.js';
import type { ResolvedModelGeometry } from './model-store.js';
/** CPU tessellation shared by rendering and overlap inspection; no browser or GPU required. */
import { RetainedGeometry, retainableElement, canonicalPrimitive, retainedPrecisionSafe, normalFloat32 } from './retained-geometry.js';
import { VERTEX_FLOATS, texturePatterns } from './texture-shader.js';
import earcut from 'earcut';
import { GeometryCache } from './cache.js';
import { parseColor } from './palette.js';
import type { PaletteResolver } from './palette.js';
import type { CameraState, ColorValue, ElementState, Frame, Geometry, Material, ProceduralTexture, Vec2, Vec3 } from './types.js';
import type { DrawItem, ImageBinding } from './composition.js';
import { lerp, matchPoints, morphOutline, outline, project, rotate, vec3, strokeTriangles, sphereTriangles, tubeTriangles, coneTriangles } from './geometry.js';
import { layoutLatex, layoutLatexGeometry } from './latex.js';
import type { LatexPath } from './latex.js';
import { morphPathContours, pathContours } from './path.js';
import type { PathContour } from './path.js';
import { strokeContours } from './path-stroke.js';
import { meshTriangles, morphMeshNormals } from './mesh-shading.js';
import { explainMesh, outlineEdges, scalarVertexColors, morphExplanatory, type Corner, type RGBA } from './explanatory.js';
import { cameraRay, dot } from './spatial.js';
import { applyLabelOcclusion, type LabelAnchor } from './label-occlusion.js';
import { resolveAssetGeometry } from './asset-geometry.js';
import type { AssetGeometryResolver } from './asset-types.js';

export function textTex(text:string):string {
  const umlauts:Record<string,string>={ä:'a',ö:'o',ü:'u',Ä:'A',Ö:'O',Ü:'U'};
  const escape=(run:string)=>run.replace(/[\\{}$&#%_^~]/g,c=>({'\\':String.raw`\backslash `,'{':String.raw`\{`,'}':String.raw`\}`,'$':String.raw`\$`,'&':String.raw`\&`,'#':String.raw`\#`,'%':String.raw`\%`,'_':String.raw`\_`,'^':String.raw`\textasciicircum `,'~':String.raw`\textasciitilde `}[c]!));
  // The bundled TeX configuration has math accents, but no text-accent macros.
  // Place accents outside text runs so MathJax emits actual vector glyphs.
  return text.normalize('NFC').split(/([äöüÄÖÜ])/).map(run=>umlauts[run]
    ? String.raw`\ddot{\text{${umlauts[run]}}}`
    : String.raw`\text{${escape(run)}}`).join('');
}
function contains(contour:Vec3[],point:Vec3):boolean {
  let inside=false;
  for(let i=0,j=contour.length-1;i<contour.length;j=i++) {
    const a=contour[i],b=contour[j];
    if((a[1]>point[1])!==(b[1]>point[1])&&point[0]<(b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;
  }
  return inside;
}
const triangulations = new GeometryCache<Vec3[]>();
/** Triangulates compound contours, preserving glyph holes and nested islands. */
export function triangulateContours(contours:Vec3[][]):Vec3[] {
  const key=JSON.stringify(contours),cached=triangulations.get(key);
  if(cached)return cached;
  const loops=contours.map(c=>c.length>1&&Math.hypot(...c[0].map((v,i)=>v-c.at(-1)![i]))<1e-8?c.slice(0,-1):c).filter(c=>c.length>=3);
  const parents=loops.map((loop,i)=>loops.map((outer,j)=>j!==i&&contains(outer,loop[0])?j:-1).filter(j=>j>=0));
  const result:Vec3[]=[];
  for(let i=0;i<loops.length;i++) {
    if(parents[i].length%2!==0)continue;
    const holes=loops.filter((_,j)=>parents[j].length===parents[i].length+1&&parents[j].includes(i));
    const rings=[loops[i],...holes],vertices=rings.flat(),indices:number[]=[];let count=loops[i].length;
    for(const hole of holes){indices.push(count);count+=hole.length;}
    const triangles=earcut(vertices.flat(),indices,3);for(const index of triangles)result.push(vertices[index]);
  }
  // The cache owns its points; later edits to an input contour must not alter
  // a triangulation retained for a previous frame or scene.
  return triangulations.set(key,result.map(p=>[...p] as Vec3),result.length*64);
}
type DrawComponent = 'content' | 'fill' | 'stroke';
export interface GeometryDrawItem extends DrawItem { elementId: string; castShadow?: boolean; retentionUnsafe?: boolean; component: DrawComponent; cameraDependentGeometry?: boolean; }
const isText = (geometry: Geometry): boolean => geometry.kind === 'text' || geometry.kind === 'latex';

/** textOnly skips shape tessellation while retaining groups and the text portions of mixed morphs. */
export function buildDrawItems(frame:Frame,camera:CameraState,width:number,height:number,palette:PaletteResolver,view?:string,textOnly=false,retained?:RetainedGeometry,elementIds?:ReadonlySet<string>,assetGeometry?:AssetGeometryResolver):GeometryDrawItem[] {
  // Anchor visibility needs opaque occluders even during text overlap inspection.
  if((textOnly || elementIds) && frame.elements.some(e=>e.view===view && (!elementIds || elementIds.has(e.id)) && [e.geometry,e.morph?.from,e.morph?.to].some(g=>g?.labelOcclusion && g.labelOcclusion!=='depth'))) {
    return buildDrawItems(frame,camera,width,height,palette,view,false,retained,undefined,assetGeometry)
      .filter(item=>(!textOnly || item.component==='content') && (!elementIds || elementIds.has(item.elementId)));
  }
  const parents=new Map<string,ElementState>();
  for(const e of frame.elements)if(e.geometry.kind==='group')for(const child of e.geometry.children??[])parents.set(child,e);
  const items:GeometryDrawItem[]=[];
  const labels = new Map<string, LabelAnchor>();
  const paletteKey=retained?JSON.stringify(palette.palette):'';
  // Camera depth is affine in world position. Reuse its coefficients when
  // sorting translucent triangles, including after the viewer orbits a view.
  const sy=Math.sin(camera.yaw),cy=Math.cos(camera.yaw),sp=Math.sin(camera.pitch),cp=Math.cos(camera.pitch);
  const depthAt=(x:number,y:number,z:number):number=>camera.distance
    -(x-camera.target[0])*sy*cp+(y-camera.target[1])*sp-(z-camera.target[2])*cy*cp;
  for(const [elementIndex,element] of frame.elements.entries()) {
    if(element.geometry.kind==='group'||element.view!==view)continue;
    if(elementIds&&!elementIds.has(element.id))continue;
    if(textOnly && !(element.morph ? isText(element.morph.from)||isText(element.morph.to) : isText(element.geometry)))continue;
    // Check the live lease even on a retained-cache hit; cached GPU geometry is not authorization.
    const liveGeometry=resolveAssetGeometry(element.geometry,assetGeometry);
    if(liveGeometry.imageTexture) {
      if(!assetGeometry?.resolveImage)throw new Error('Image texture requires a held image lease');
      assetGeometry.resolveImage(liveGeometry.imageTexture.image);
    }
    const chain:ElementState[]=[element];let parent=parents.get(element.id);const seen=new Set([element.id]);
    while(parent&&!seen.has(parent.id)){chain.push(parent);seen.add(parent.id);parent=parents.get(parent.id);}
    const viewportOffset=[0,1].map(axis=>chain.reduce((sum,e)=>sum+(e.viewportOffset?.[axis]??0),0));
    const imported=(element.geometry as ResolvedModelGeometry)._model;
    const castShadow=chain.every(e=>e.castShadow!==false)&&!element.billboard&&viewportOffset.every(v=>v===0)
      &&["mesh","sphere"].includes(element.geometry.kind);
    const groups:{id:string;opacity:number}[]=[];
    let opacity=1;
    for(const e of [...chain].reverse()) {
      opacity*=e.opacity;
      if(e.geometry.kind==='group'&&e.geometry.isolated){groups.push({id:e.id,opacity});opacity=1;}
    }
    if(opacity<=0||groups.some(g=>g.opacity<=0))continue;
    const applyTransforms=(point:Vec3):Vec3=>{let p=point;for(const state of chain){p=rotate(p.map(v=>v*state.scale) as Vec3,state.rotation);p=p.map((v,i)=>v+state.position[i]) as Vec3;}return p;};
    const world=(point:Vec3):Vec3=> {
      if(!element.billboard||element.space==='screen')return applyTransforms(point);
      const center=applyTransforms([0,0,0]),scale=chain.reduce((product,state)=>product*state.scale,1);
      let local=rotate(point.map(v=>v*scale) as Vec3,[0,0,element.rotation[2]]);
      const offset=element.billboardOffset??[0,0,0];local=local.map((v,i)=>v+(offset[i]??0)) as Vec3;
      local=rotate(local,[camera.pitch,camera.yaw,0]);
      return local.map((v,i)=>v+center[i]) as Vec3;
    };
    // Each element's transform is affine. Evaluate it once, rather than
    // allocating vectors and recomputing trigonometry for every vertex.
    const origin=world([0,0,0]);
    const labelGeometry = element.morph ? (element.morph.progress <= 0 || !isText(element.morph.to) ? element.morph.from : element.morph.to) : element.geometry;
    if (isText(labelGeometry) && labelGeometry.labelOcclusion && labelGeometry.labelOcclusion !== 'depth' && element.space !== 'screen') {
      labels.set(element.id, { point: origin, offset: viewportOffset, mode: labelGeometry.labelOcclusion });
    }
    let cameraDependentGeometry = false;
    const axes:Vec3[]=[[1,0,0],[0,1,0],[0,0,1]];
    const normalBasis=element.billboard&&element.space!=='screen'
      ?axes.map(axis=>rotate(rotate(axis,[0,0,element.rotation[2]]),[camera.pitch,camera.yaw,0]))
      :axes.map(axis=>{let normal=axis;for(const state of chain)normal=rotate(normal,state.rotation);return normal;});
    const scale=chain.reduce((product,state)=>product*state.scale,1);
    // Subpixel local error at the element's projected scale. Power-of-two buckets
    // let nearby zoom levels share tessellation without ever exceeding 0.25px here.
    const pixelsPerUnit=element.space==='screen'?scale:project(origin,camera,width,height).scale*scale;
    const pathTolerance=2**Math.floor(Math.log2(0.25/Math.max(1e-9,pixelsPerUnit)));
    // Transform directions separately to avoid subtracting nearly equal
    // translated points when a small object is far from the world origin.
    const basis=normalBasis.map(axis=>axis.map(v=>v*scale) as Vec3);
    const opaqueColor=(color:ColorValue):boolean=>color==='none'||parseColor(palette.resolve(color))[3]>=0.999999;
    if(retained && retainableElement(element) && scale !== 0 && opacity>=0.999999
      && opaqueColor(element.fill) && opaqueColor(element.stroke)
      && (!element.geometry.texture || opaqueColor(element.geometry.texture.color))) {
      // Tessellate once in object space. Groups, billboards, layer and navigation
      // remain live instance state; full geometry/style/palette content is keyed.
      const primitive=canonicalPrimitive(element);
      const local:ElementState={...element,geometry:primitive.geometry,id:'',view:undefined,position:[0,0,0],rotation:[0,0,0],scale:1,
        opacity,billboard:false,billboardOffset:undefined,viewportOffset:undefined};
      const key=paletteKey+JSON.stringify([(local.geometry as ResolvedModelGeometry)._modelKey ?? local.geometry,local.fill,local.stroke,local.strokeWidth,local.strokeProfile,local.space,opacity,local.strokeStart,local.strokeEnd,local.dashArray,local.dashOffset]);
      const meshes=retained.get(key,()=>buildDrawItems({...frame,elements:[local]},camera,width,height,palette,undefined,false,undefined,undefined,assetGeometry),element.geometry.kind==='arrow',JSON.stringify([view,element.id]));
      const instanceBasis=primitive.axes.map(p=>p.map((_,axis)=>p.reduce((sum,v,i)=>sum+v*basis[i][axis],0)) as Vec3);
      const instanceOrigin=origin.map((v,axis)=>v+primitive.origin.reduce((sum,p,i)=>sum+p*basis[i][axis],0)) as Vec3;
      const instance=new Float32Array([...instanceBasis[0],0,...instanceBasis[1],0,...instanceBasis[2],0,...instanceOrigin,1,elementIndex,scale*primitive.scale,...viewportOffset]);
      if(meshes && retainedPrecisionSafe(meshes,instanceOrigin,instanceBasis,instance,camera,height,element.space==='screen')) {
        for(const mesh of meshes) {
          const depth=Math.min(...mesh.centers.map(center=>depthAt(...center.map((_,axis)=>instanceOrigin[axis]+center.reduce((sum,v,i)=>sum+v*instanceBasis[i][axis],0)) as Vec3)));
          items.push({depth:element.space==='screen'?-1e9:depth,vertices:new Float32Array(0),
            transparent:false,screen:element.space==='screen',groups,elementId:element.id,component:mesh.component,modelMaterial:mesh.modelMaterial,imageBinding:mesh.imageBinding,mesh,instance});
        }
        continue;
      }
    }
    const addTriangles=(points:Vec3[],color:ColorValue,alpha=1,normals?:Vec3[],component:DrawComponent='fill',twoSided=false,texture?:ProceduralTexture,material?:Material,colors?:RGBA[],uvs?:number[][],imageBinding?:ImageBinding):void=> {
      const rgba=imageBinding?(imageBinding.texture.tint?parseColor(palette.resolve(imageBinding.texture.tint)):[1,1,1,1]):parseColor(palette.resolve(color));
      const secondary=texture?parseColor(palette.resolve(texture.color)):rgba;
      if(!points.length||Math.max(rgba[3],secondary[3])*opacity*alpha<=0)return;
      const emission=material?.emissive?parseColor(palette.resolve(material.emissive)):[0,0,0,0];
      const emissionStrength=(material?.emissiveIntensity??1)*emission[3];
      const textureKind=texture?texturePatterns.indexOf(texture.pattern)+1:0;
      const textureScale=typeof texture?.scale==='number'?[texture.scale,texture.scale,texture.scale]:texture?.scale??[1,1,1];
      const vertices=new Float32Array(points.length*VERTEX_FLOATS),screen=element.space==='screen',a=rgba[3]*opacity*alpha;
      let sumX=0,sumY=0,sumZ=0,retentionUnsafe=false;
      for(let i=0;i<points.length;i++) {
        const p=points[i],j=i*VERTEX_FLOATS;
        if(uvs)vertices.set(uvs[i],j+31);
        const x=origin[0]+p[0]*basis[0][0]+p[1]*basis[1][0]+p[2]*basis[2][0];
        const y=origin[1]+p[0]*basis[0][1]+p[1]*basis[1][1]+p[2]*basis[2][1];
        const z=origin[2]+p[0]*basis[0][2]+p[1]*basis[1][2]+p[2]*basis[2][2];
        retentionUnsafe ||= !normalFloat32(x)||!normalFloat32(y)||!normalFloat32(z);
        sumX+=x;sumY+=y;sumZ+=z;
        vertices[j]=x;vertices[j+1]=y;vertices[j+2]=z;
        const vertexColor=colors?.[i]??rgba;
        const tint=imported && element.fill!=='WHITE' ? rgba.slice(0,3).map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4) : [1,1,1];
        vertices[j+3]=vertexColor[0]*tint[0];vertices[j+4]=vertexColor[1]*tint[1];vertices[j+5]=vertexColor[2]*tint[2];vertices[j+6]=vertexColor[3]*opacity*alpha*(colors?rgba[3]:1);vertices[j+7]=screen?1:0;
        if(imported){vertices[j+6]=rgba[3]*opacity*alpha;vertices[j+23]=vertexColor[3];}
        if(normals) {
          const n=normals[i];
          for(let axis=0;axis<3;axis++) {
            const value=n[0]*normalBasis[0][axis]+n[1]*normalBasis[1][axis]+n[2]*normalBasis[2][axis];
            retentionUnsafe ||= !normalFloat32(value);vertices[j+8+axis]=value;
          }
        } else {vertices[j+8]=normalBasis[2][0];vertices[j+9]=normalBasis[2][1];vertices[j+10]=normalBasis[2][2];}
        vertices[j+11]=normals?(twoSided?2:1):0;vertices[j+12]=elementIndex;vertices[j+13]=viewportOffset[0];vertices[j+14]=viewportOffset[1];
        if(texture) {
          for(let axis=0;axis<3;axis++)vertices[j+15+axis]=p[axis]*textureScale[axis]+(texture.offset?.[axis]??0);
          vertices[j+18]=textureKind;
          vertices[j+19]=secondary[0];vertices[j+20]=secondary[1];vertices[j+21]=secondary[2];vertices[j+22]=secondary[3]*opacity*alpha;
          const bump=(texture.bumpStrength??0)*scale;retentionUnsafe ||= !normalFloat32(bump);
          vertices[j+23]=texture.seed??0;vertices[j+30]=bump;
        }
        // UV0/UV1 occupy floats 31–34; image alpha has its own final lane.
        if(imageBinding)vertices[j+35]=imageBinding.texture.alphaMode==='opaque'?1:2;
        if(material) {
          vertices[j+24]=material.metalness??0;vertices[j+25]=material.roughness??0.45;vertices[j+26]=material.specular??0.5;
          for(let axis=0;axis<3;axis++)vertices[j+27+axis]=emission[axis]*emissionStrength;
        }
      }
      const transparent=imageBinding?.texture.alphaMode==='blend' || imported?.material.alpha==='BLEND' || Math.min(a,secondary[3]*opacity*alpha)<0.999999 || Boolean(!imported && colors?.some(c=>c[3]*opacity*alpha<0.999999));
      if(transparent&&!screen) {
        // Whole-object sorting lets rear sphere/tube faces blend over front
        // faces, and cannot place another surface between them. Sort complete
        // packed triangles globally; composeItems merges the resulting draws.
        for(let j=0;j<vertices.length;j+=3*VERTEX_FLOATS) {
          const depth=depthAt((vertices[j]+vertices[j+VERTEX_FLOATS]+vertices[j+2*VERTEX_FLOATS])/3,
            (vertices[j+1]+vertices[j+VERTEX_FLOATS+1]+vertices[j+2*VERTEX_FLOATS+1])/3,(vertices[j+2]+vertices[j+VERTEX_FLOATS+2]+vertices[j+2*VERTEX_FLOATS+2])/3);
          items.push({depth,vertices:vertices.subarray(j,j+3*VERTEX_FLOATS),transparent,screen,groups,imageBinding,modelMaterial:imported?.material,castShadow:castShadow&&component==='fill',elementId:element.id,component,retentionUnsafe,...(cameraDependentGeometry?{cameraDependentGeometry:true}:{})});
        }
      } else {
        const depth=screen?-1e9:project([sumX/points.length,sumY/points.length,sumZ/points.length],camera,width,height).depth;
        items.push({depth,vertices,transparent,screen,groups,imageBinding,modelMaterial:imported?.material,castShadow:castShadow&&component==='fill',elementId:element.id,component,retentionUnsafe,...(cameraDependentGeometry?{cameraDependentGeometry:true}:{})});
      }
    };
    const contours=(paths:Vec3[][],alpha=1,color=element.fill,component:DrawComponent='fill'):void=>{if(color!=='none')addTriangles(triangulateContours(paths),color,alpha,undefined,component);};
    const stroke=(points:Vec3[],closed:boolean,alpha=1,capEnd=true):void=> {
      if(element.stroke==='none'||element.strokeWidth<=0)return;
      if(element.strokeProfile==='round') {
        const tube=tubeTriangles(points,element.strokeWidth,closed,capEnd);
        addTriangles(tube.points,element.stroke,alpha,tube.normals,'stroke');
      } else addTriangles(strokeTriangles(points,element.strokeWidth,closed),element.stroke,alpha,undefined,'stroke');
    };
    const drawPath=(paths:PathContour[],alpha=1):void=> {
      contours(paths.filter(path=>path.closed).map(path=>path.points),alpha);
      for(const path of strokeContours(paths,element))stroke(path.points,path.closed,alpha);
    };
    const latexPaths=(paths:LatexPath[],size:number,alpha:number,offset:Vec3=[0,0,0]):void=> {
      const color=element.fill==='none'?element.stroke:element.fill;
      if(color==='none')return;
      for(const path of paths)addTriangles(triangulateContours(path.contours).map(p=>p.map((v,i)=>v*size+offset[i]) as Vec3),color,alpha,undefined,'content');
    };
    const addMesh=(geometry:Geometry,alpha=1,normalOverride?:Vec3[],twoSided=true):void=> {
      const mesh=meshTriangles(normalOverride?{...geometry,shading:'unlit'}:geometry);
      const normals=normalOverride??mesh.normals;
      const uv0=geometry.uv0?geometry.triangles!.flatMap(face=>face.map(i=>geometry.uv0![i])):undefined;
      const imageBinding:ImageBinding|undefined=geometry.imageTexture?{texture:geometry.imageTexture,image:assetGeometry!.resolveImage!(geometry.imageTexture.image)}:undefined;
      if (geometry.clipPlanes?.length || geometry.outline || geometry.scalarColors) {
        const scalar = geometry.scalarColors ? scalarVertexColors(geometry.scalarColors,palette) : undefined;
        const colors = scalar ? geometry.triangles!.flatMap(face=>face.map(i=>scalar[i])) : undefined;
        const corners:Corner[]=mesh.points.map((p,i)=>({p,n:normals?.[i],c:colors?.[i]}));
        const explained=explainMesh(corners,geometry.clipPlanes);
        const fill=(cs:Corner[],color:ColorValue,cap=false)=> {
          if(color!=='none')addTriangles(cs.map(c=>c.p),color,alpha,cs[0]?.n?cs.map(c=>c.n!):undefined,'fill',cap||twoSided,cap?undefined:geometry.texture,cap?undefined:geometry.material,cs[0]?.c?cs.map(c=>c.c!):undefined);
        };
        fill(explained.corners,element.fill);
        if(element.fill!=='none')for(const cap of explained.caps)fill(cap.corners,cap.color,true);
        // Round unlit tubes remain visible for cuts in any local plane.
        const edges=(points:Vec3[],color:ColorValue,width:number)=> {
          if(color==='none')return;
          for(let i=0;i<points.length;i+=2) {
            const tube=tubeTriangles(points.slice(i,i+2),width,false);
            addTriangles(tube.points,color,alpha,undefined,'stroke');
          }
        };
        if(element.stroke!=='none')for(let i=0;i<explained.corners.length;i+=3)stroke(explained.corners.slice(i,i+3).map(c=>c.p),true,alpha);
        for(const section of explained.sections)edges(section.points,section.color,section.width);
        if(geometry.outline) {
          cameraDependentGeometry=true;
          const points=outlineEdges([...explained.corners,...explained.caps.flatMap(c=>c.corners)],geometry,(p,n)=> {
            const wp=world(p),projection=project(wp,camera,width,height),ray=cameraRay(projection.x,projection.y,camera,width,height);
            const wn=normalBasis[0].map((_,axis)=>n[0]*normalBasis[0][axis]+n[1]*normalBasis[1][axis]+n[2]*normalBasis[2][axis]) as Vec3;
            return -dot(wn,ray.direction);
          });
          edges(points,geometry.outline.color,geometry.outline.width??0.025);
          cameraDependentGeometry=false;
        }
        return;
      }
      if(element.stroke!=='none'&&element.strokeWidth>0) {
        // Keep each fill next to its wireframe in depth order. Batching fills
        // across depths can otherwise cover the inner half of a rear stroke.
        for(let i=0;i<mesh.points.length;i+=3) {
          const triangle=mesh.points.slice(i,i+3);
          if(element.fill!=='none')addTriangles(triangle,element.fill,alpha,normals?.slice(i,i+3),'fill',true,geometry.texture,geometry.material,undefined,uv0?.slice(i,i+3),imageBinding);
          stroke(triangle,true,alpha);
        }
        return;
      }
      if(element.fill!=='none')addTriangles(mesh.points,element.fill,alpha,normals,'fill',true,geometry.texture,geometry.material,imported ? geometry.triangles!.flatMap(face=>face.map(i=>imported.colors?.[i]??[1,1,1,1] as RGBA)) : undefined,imported ? geometry.triangles!.flatMap(face=>face.map(i=>[...(imported.uv0[i]??[0,0]),...(imported.uv1[i]??[0,0])])) : uv0,imageBinding);
    };
    const drawGeometry=(geometry:Geometry,alpha=1):void=> {
      geometry=resolveAssetGeometry(geometry,assetGeometry);
      if(textOnly&&!isText(geometry))return;
      if(geometry.kind==='text'||geometry.kind==='latex'){latexPaths((geometry.kind==='text'?layoutLatex(textTex(geometry.text??'')):layoutLatexGeometry(geometry)).paths,geometry.fontSize??(element.space==='screen'?(geometry.kind==='text'?16:24):(geometry.kind==='text'?0.4:0.6)),alpha);return;}
      if(geometry.kind==='model'){addMesh(modelBoundsGeometry(geometry.model!.bounds),alpha);return;}
      if(geometry.kind==='mesh'){addMesh(geometry,alpha);return;}
      if(geometry.kind==='sphere'){
        if(geometry.clipPlanes?.length||geometry.outline){
          const sphere=sphereTriangles(geometry.radius??1);
          addMesh({...geometry,kind:'mesh',vertices:sphere.points,triangles:Array.from({length:sphere.points.length/3},(_,i)=>[i*3,i*3+1,i*3+2]),shading:'smooth',normals:sphere.normals},alpha,undefined,false);return;
        }
        if(element.fill==='none')return;const sphere=sphereTriangles(geometry.radius??1);addTriangles(sphere.points,element.fill,alpha,sphere.normals,'fill',false,geometry.texture,geometry.material);return;}
      if(geometry.kind==='path'&&(geometry.d!==undefined||geometry.curve==='smooth')){drawPath(pathContours(geometry,pathTolerance),alpha);return;}
      const shape=outline(geometry);if(!shape||!shape.points.length)return;
      if(geometry.kind==='arrow'&&shape.points.length>1) {
        const visible=strokeContours([shape],element);
        for(const fragment of visible.slice(0,-1))stroke(fragment.points,false,alpha);
        const tip=visible.at(-1);if(!tip || element.stroke==='none' || element.strokeWidth<=0)return;
        const points=tip.points.filter((p,i)=>!i||Math.hypot(...p.map((v,j)=>v-tip.points[i-1][j]))>1e-10),end=points.at(-1)!;
        const lengths=points.slice(1).map((p,i)=>Math.hypot(...p.map((v,j)=>v-points[i][j]))),length=lengths.reduce((a,b)=>a+b,0);
        if(length>1e-10) {
          const headLength=Math.min(length*0.45,Math.max(element.space==='screen'?6:0.16,element.strokeWidth*4));
          let remaining=headLength,index=points.length-2;
          while(index>0&&remaining>lengths[index]){remaining-=lengths[index];index--;}
          const a=points[index],b=points[index+1],ratio=1-remaining/lengths[index];
          const base=a.map((v,i)=>lerp(v,b[i],ratio)) as Vec3;
          const delta=end.map((v,i)=>v-base[i]),xy=Math.hypot(delta[0],delta[1]),headWidth=Math.max(element.strokeWidth*2.6,headLength*0.7);
          const side:Vec3=xy>1e-10?[-delta[1]/xy*headWidth/2,delta[0]/xy*headWidth/2,0]:[headWidth/2,0,0];
          stroke([...points.slice(0,index+1),base],false,alpha,element.strokeProfile!=='round');
          if(element.strokeProfile==='round') {
            const head=coneTriangles(base,end,headWidth/2);
            addTriangles(head.points,element.stroke,alpha,head.normals,'stroke');
          } else addTriangles([end,base.map((v,i)=>v+side[i]) as Vec3,base.map((v,i)=>v-side[i]) as Vec3],element.stroke,alpha,undefined,'stroke');
        }
      } else {if(shape.closed)contours([shape.points],alpha);for(const part of strokeContours([shape],element))stroke(part.points,part.closed,alpha);}

    };
    const morph=element.morph;
    if(!morph){drawGeometry(element.geometry);continue;}
    const {from,to,progress:t}=morph;
    if(t<=0){drawGeometry(from);continue;}if(t>=1){drawGeometry(to);continue;}
    if(from.kind==='text'&&to.kind==='text'&&(from.text??'')===(to.text??'')) {
      const defaultSize=element.space==='screen'?16:0.4;
      drawGeometry({...from,fontSize:lerp(from.fontSize??defaultSize,to.fontSize??defaultSize,t)});
      continue;
    }
    const curved=morphPathContours(from,to,t,pathTolerance);
    if(curved){drawPath(curved);continue;}
    const shape=morphOutline(from,to,t,pathTolerance);
    if(shape){drawGeometry({kind:from.kind==='arrow'&&to.kind==='arrow'?'arrow':'path',points:shape.points,closed:shape.closed});continue;}
    if(from.kind==='sphere'&&to.kind==='sphere'){drawGeometry({...to,...morphExplanatory(from,to,t),kind:'sphere',radius:lerp(from.radius??1,to.radius??1,t)});continue;}
    if(from.kind==='mesh'&&to.kind==='mesh'&&from.vertices&&to.vertices&&from.vertices.length===to.vertices.length){const target=to.vertices!;addMesh({...to,...morphExplanatory(from,to,t),normals:undefined,vertices:from.vertices!.map((p,i)=>vec3(p).map((v,j)=>lerp(v,vec3(target[i])[j],t)) as Vec3)},1,morphMeshNormals(from,to,t));continue;}
    if(from.kind==='latex'&&to.kind==='latex') {
      const a=layoutLatexGeometry(from),b=layoutLatexGeometry(to),map=morph.map??{},targets=new Set(Object.values(map));
      const sizeA=from.fontSize??(element.space==='screen'?24:0.6),sizeB=to.fontSize??(element.space==='screen'?24:0.6);
      for(const path of a.paths)if(!path.part||!map[path.part])latexPaths([path],sizeA,1-t);
      for(const path of b.paths)if(!path.part||!targets.has(path.part))latexPaths([path],sizeB,t);
      const bounds=(paths:LatexPath[],size:number):Vec3=>{const points=paths.flatMap(p=>p.contours.flat());return [0,1,2].map(i=>points.length?(Math.min(...points.map(p=>p[i]))+Math.max(...points.map(p=>p[i])))*size/2:0) as Vec3;};
      for(const [start,end] of Object.entries(map)) {
        const pathsA=a.paths.filter(p=>p.part===start),pathsB=b.paths.filter(p=>p.part===end);
        if(pathsA.length===pathsB.length&&pathsA.every((p,i)=>p.contours.length===pathsB[i].contours.length)) {
          for(let i=0;i<pathsA.length;i++)contours(pathsA[i].contours.map((c,j)=>{
            const a=c.map(p=>p.map(v=>v*sizeA) as Vec3),b=pathsB[i].contours[j].map(p=>p.map(v=>v*sizeB) as Vec3);
            // Preserve all exact corners when a glyph merely translates/scales. Sampling even
            // an unchanged contour changes its silhouette and makes symbols pop at endpoints.
            let equivalent=a.length===b.length;
            if(equivalent) {
              const center=(points:Vec3[])=>[0,1,2].map(axis=>points.reduce((sum,p)=>sum+p[axis],0)/points.length) as Vec3;
              const ca=center(a),cb=center(b);let dot=0,length=0;
              for(let k=0;k<a.length;k++)for(let axis=0;axis<3;axis++){dot+=(a[k][axis]-ca[axis])*(b[k][axis]-cb[axis]);length+=(a[k][axis]-ca[axis])**2;}
              const scale=length>1e-12?dot/length:1;
              equivalent=scale>0&&a.every((p,k)=>p.every((v,axis)=>Math.abs((v-ca[axis])*scale+cb[axis]-b[k][axis])<1e-7));
            }
            const [source,target]=equivalent?[a,b]:matchPoints(a,b,true,96);
            return source.map((p,k)=>p.map((v,l)=>lerp(v,target[k][l],t)) as Vec3);
          }),1,element.fill==='none'?element.stroke:element.fill,'content');
        } else {
          const centerA=bounds(pathsA,sizeA),centerB=bounds(pathsB,sizeB),delta=centerA.map((v,i)=>centerB[i]-v) as Vec3;
          latexPaths(pathsA,sizeA,1-t,delta.map(v=>v*t) as Vec3);latexPaths(pathsB,sizeB,t,delta.map(v=>-v*(1-t)) as Vec3);
        }
      }
      continue;
    }
    drawGeometry(from,1-t);drawGeometry(to,t);
  }
  return applyLabelOcclusion(items,labels,camera,width,height);
}
