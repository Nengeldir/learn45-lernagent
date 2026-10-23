import { mathjax } from 'mathjax-full/js/mathjax.js';
import { TeX } from 'mathjax-full/js/input/tex.js';
import { SVG } from 'mathjax-full/js/output/svg.js';
import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js';
import 'mathjax-full/js/input/tex/ams/AmsConfiguration.js';
import 'mathjax-full/js/input/tex/newcommand/NewcommandConfiguration.js';
import 'mathjax-full/js/input/tex/html/HtmlConfiguration.js';
import { flattenSvgPath } from './path.js';
export { flattenSvgPath } from './path.js';
import type { Geometry, Vec3 } from './types.js';

export interface LatexPath { contours: Vec3[][]; part?: string }
export interface LatexNumericSlot { id:string; contours:Vec3[][]; baseline:number; scale:number; part?:string }
export interface LatexLayout { paths: LatexPath[]; parts: Set<string>; width: number; height: number; baseline:number; numericSlots:LatexNumericSlot[] }

type Matrix = [number,number,number,number,number,number];
const identity: Matrix = [1,0,0,1,0,0];
function multiply(a:Matrix,b:Matrix): Matrix {
  return [a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];
}
function transform(source:string): Matrix {
  let result=identity;
  for(const match of source.matchAll(/(matrix|translate|scale|rotate)\(([^)]*)\)/g)) {
    const n=match[2].trim().split(/[\s,]+/).map(Number);
    let next=identity;
    if(match[1]==='matrix') next=n as Matrix;
    if(match[1]==='translate') next=[1,0,0,1,n[0],n[1]??0];
    if(match[1]==='scale') next=[n[0],0,0,n[1]??n[0],0,0];
    if(match[1]==='rotate') { const a=n[0]*Math.PI/180;next=[Math.cos(a),Math.sin(a),-Math.sin(a),Math.cos(a),0,0]; }
    result=multiply(result,next);
  }
  return result;
}

/** Rewrites named markers without splitting the formula's TeX layout. */
export function rewriteParts(source:string): {tex:string; parts:Set<string>} {
  const parts=new Set<string>();
  function braced(start:number): [string,number] {
    while(/\s/.test(source[start]??'')) start++;
    if(source[start]!=='{') throw new Error('\\animpart requires {id}{TeX}.');
    const begin=++start; let depth=1;
    while(start<source.length) {
      if(source[start]==='\\') { start+=2;continue; }
      if(source[start]==='{') depth++;
      if(source[start]==='}' && --depth===0) return [source.slice(begin,start),start+1];
      start++;
    }
    throw new Error('Unclosed \\animpart argument.');
  }
  let result='',cursor=0;
  while(cursor<source.length) {
    const start=source.indexOf('\\animpart',cursor);
    if(start<0) {result+=source.slice(cursor);break;}
    result+=source.slice(cursor,start);
    const [id,afterId]=braced(start+9),[body,afterBody]=braced(afterId);
    if(!/^[A-Za-z][A-Za-z0-9_-]*$/.test(id)) throw new Error(`Invalid LaTeX part name: ${id}`);
    if(parts.has(id)) throw new Error(`Duplicate LaTeX part: ${id}`);
    if(body.includes('\\animpart')) throw new Error('Nested LaTeX named parts are not supported.');
    parts.add(id);result+=`\\class{animpart-${id}}{${body}}`;cursor=afterBody;
  }
  return {tex:result,parts};
}
const adaptor=liteAdaptor();
RegisterHTMLHandler(adaptor);
const document=mathjax.document('',{InputJax:new TeX({packages:['base','ams','newcommand','html'],maxBuffer:20000}),OutputJax:new SVG({fontCache:'none'})});
const cache=new Map<string,LatexLayout>();
export function layoutLatex(source:string): LatexLayout {
  const existing=cache.get(source);if(existing)return existing;
  if(source.length>20000)throw new Error('LaTeX exceeds 20,000 characters.');
  const {tex,parts}=rewriteParts(source);
  const root=document.convert(tex,{display:true,em:16,ex:8,containerWidth:80*16});
  const markup=adaptor.outerHTML(root);
  if(markup.includes('data-mjx-error') || markup.includes('data-mml-node="merror"')) throw new Error(`Invalid LaTeX: ${source}`);
  const svg=adaptor.tags(root,'svg')[0];
  if(!svg)throw new Error('MathJax did not produce SVG.');
  const box=(adaptor.getAttribute(svg,'viewBox')??'0 0 1000 1000').split(/\s+/).map(Number);
  const paths:LatexPath[]=[];
  const numericSlots:LatexNumericSlot[]=[];
  type Node=typeof svg;
  function visit(node:Node,parent:Matrix,part?:string,slot?:LatexNumericSlot,hidden=false):void {
    const matrix=multiply(parent,transform(adaptor.getAttribute(node,'transform')??''));
    const names=(adaptor.getAttribute(node,'class')??'').split(/\s+/);
    const named=names.find((name:string)=>name.startsWith('animpart-'));
    if(named)part=named.slice(9);
    hidden ||= adaptor.getAttribute(node,'visibility')==='hidden'||adaptor.getAttribute(node,'display')==='none';
    const kind=adaptor.kind(node);
    if(kind==='text')throw new Error('This character has no bundled MathJax vector glyph. Use supported mathematical/Latin characters.');
    let contours:Vec3[][]=[];
    const point=(x:number,y:number):Vec3=>[(matrix[0]*x+matrix[2]*y+matrix[4]-(box[0]+box[2]/2))/1000,-(matrix[1]*x+matrix[3]*y+matrix[5]-(box[1]+box[3]/2))/1000,0];
    const slotName=names.find((name:string)=>name.startsWith('animslot-'));
    if(slotName) {slot={id:slotName.slice(9),contours:[],baseline:point(0,0)[1],scale:Math.hypot(matrix[0],matrix[1]),part};numericSlots.push(slot);}
    if(kind==='path') {
      const d=adaptor.getAttribute(node,'d')??'';
      contours=flattenSvgPath(d).map(contour=>contour.map(p=>point(p[0],p[1])));
    } else if(kind==='rect') {
      const x=Number(adaptor.getAttribute(node,'x')??0),y=Number(adaptor.getAttribute(node,'y')??0),w=Number(adaptor.getAttribute(node,'width')??0),h=Number(adaptor.getAttribute(node,'height')??0);
      contours=[[point(x,y),point(x+w,y),point(x+w,y+h),point(x,y+h)]];
    }
    if(contours.length&&!hidden) {if(slot)slot.contours.push(...contours);else paths.push({contours,part});}
    for(const child of adaptor.childNodes(node))if(adaptor.kind(child)!=='#text' && adaptor.kind(child)!=='#comment')visit(child as Node,matrix,part,slot,hidden);
  }
  visit(svg,identity);
  const layout={paths,parts,width:box[2]/1000,height:box[3]/1000,baseline:(box[1]+box[3]/2)/1000,numericSlots};
  if(cache.size>256)cache.delete(cache.keys().next().value!);
  cache.set(source,layout);return layout;
}

/** Anchors a formula to an authored named part and fills stable-width numeric slots. */
export function layoutLatexGeometry(geometry:Geometry):LatexLayout {
  const source=geometry.tex??'',numbers=geometry.numbers??{};
  const format=geometry.numberFormat;
  if(format!==undefined&&(!format||typeof format!=='object'||Array.isArray(format)))throw new Error('Invalid numeric format');
  const decimals=format?.decimals===undefined?2:format.decimals,digits=format?.digits===undefined?1:format.digits;
  if(!Number.isInteger(decimals)||decimals<0||decimals>4||!Number.isInteger(digits)||digits<1||digits>6)throw new Error('Invalid numeric format');
  const reserved=`-${'0'.repeat(digits)}${decimals?'.'+'0'.repeat(decimals):''}`;
  const used=new Set<string>();
  const template=source.replace(/\\animnum\s*\{([A-Za-z][A-Za-z0-9_-]{0,31})\}/g,(_match,id:string)=>{
    if(!Object.hasOwn(numbers,id))throw new Error(`Missing numeric slot value: ${id}`);
    used.add(id);return `\\class{animslot-${id}}{${reserved}}`;
  });
  if(Object.keys(numbers).some(id=>!used.has(id)))throw new Error('Numeric values must correspond to \\animnum{name} slots');
  const base=layoutLatex(template);
  let anchor:Vec3=[0,0,0];
  if(geometry.anchor) {
    if(!base.parts.has(geometry.anchor))throw new Error(`Unknown LaTeX anchor: ${geometry.anchor}`);
    const points=[...base.paths.filter(p=>p.part===geometry.anchor).flatMap(p=>p.contours.flat()),...base.numericSlots.filter(s=>s.part===geometry.anchor).flatMap(s=>s.contours.flat())];
    if(!points.length)throw new Error(`LaTeX anchor ${geometry.anchor} has no visible geometry`);
    anchor=[(Math.min(...points.map(p=>p[0]))+Math.max(...points.map(p=>p[0])))/2,(Math.min(...points.map(p=>p[1]))+Math.max(...points.map(p=>p[1])))/2,0];
  }
  const translate=(contours:Vec3[][],offset:Vec3):Vec3[][]=>contours.map(c=>c.map(p=>p.map((v,i)=>v+offset[i]-anchor[i]) as Vec3));
  const paths=base.paths.map(path=>({...path,contours:translate(path.contours,[0,0,0])}));
  for(const slot of base.numericSlots) {
    const value=numbers[slot.id];
    if(!Number.isFinite(value)||Math.abs(Number(value.toFixed(decimals)))>=10**digits)throw new Error(`Numeric slot ${slot.id} exceeds its reserved digit width`);
    const formatted=Number(value.toFixed(decimals)).toFixed(decimals),glyphs=layoutLatex(formatted),slotPoints=slot.contours.flat(),glyphPoints=glyphs.paths.flatMap(p=>p.contours.flat());
    const right=Math.max(...slotPoints.map(p=>p[0])),glyphRight=Math.max(...glyphPoints.map(p=>p[0]))*slot.scale;
    const offset:Vec3=[right-glyphRight,slot.baseline-glyphs.baseline*slot.scale,0];
    for(const path of glyphs.paths)paths.push({part:slot.part,contours:translate(path.contours.map(contour=>contour.map(p=>p.map(v=>v*slot.scale) as Vec3)),offset)});
  }
  return {...base,paths,baseline:base.baseline-anchor[1],numericSlots:base.numericSlots.map(slot=>({...slot,contours:translate(slot.contours,[0,0,0]),baseline:slot.baseline-anchor[1]}))};
}
export function validateLatexMap(from:LatexLayout,to:LatexLayout,map:Record<string,string>={}):void {
  const targets=new Set<string>();
  for(const [a,b] of Object.entries(map)) {
    if(!from.parts.has(a))throw new Error(`Unknown source LaTeX part: ${a}`);
    if(!to.parts.has(b))throw new Error(`Unknown target LaTeX part: ${b}`);
    if(targets.has(b))throw new Error(`LaTeX morph target mapped more than once: ${b}`);
    targets.add(b);
  }
}
