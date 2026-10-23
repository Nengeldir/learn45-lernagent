import type { PathContour } from './path.js';
import type { Geometry, PathStrokeStyle, Vec3 } from './types.js';

export function validatePathStroke(style: PathStrokeStyle, kind: Geometry['kind']): void {
  if (['strokeStart','strokeEnd','dashArray','dashOffset'].some(k=>Object.hasOwn(style,k)) && !['path','line','arrow'].includes(kind)) throw new Error('Stroke range and dashes require a path, line, or arrow');
  for (const key of ['strokeStart','strokeEnd'] as const) if (style[key] !== undefined && !(typeof style[key]==='number' && Number.isFinite(style[key]) && style[key]!>=0 && style[key]!<=1)) throw new Error(`${key} must be in [0,1]`);
  if (style.dashOffset !== undefined && !(typeof style.dashOffset==='number' && Number.isFinite(style.dashOffset) && Math.abs(style.dashOffset)<=1e6)) throw new Error('dashOffset must be finite with magnitude <= 1,000,000');
  if (style.dashArray !== undefined && !(Array.isArray(style.dashArray) && style.dashArray.length>0 && style.dashArray.length<=32 && style.dashArray.every(n=>typeof n==='number' && Number.isFinite(n) && n>0 && n<=1e6))) throw new Error('dashArray requires 1–32 positive finite lengths <= 1,000,000');
}

/** Clip/dash in local arc length before transformation. Contour gaps consume no length. */
export function strokeContours(contours: PathContour[], style: PathStrokeStyle): PathContour[] {
  validatePathStroke(style, 'path');
  const start=style.strokeStart??0,end=style.strokeEnd??1;
  if (start>=end) return [];
  const distance=(a:Vec3,b:Vec3)=>Math.hypot(b[0]-a[0],b[1]-a[1],b[2]-a[2]);
  const original=contours;
  contours=contours.map(c=>c.closed && c.points.length>1 && distance(c.points[0],c.points.at(-1)!)>0 ? {...c,points:[...c.points,c.points[0]]} : c);
  const lengths=contours.map(c=>c.points.slice(1).reduce((sum,p,i)=>sum+distance(c.points[i],p),0));
  const total=lengths.reduce((a,b)=>a+b,0);
  if (!total) return [];
  if (!style.dashArray && start===0 && end===1) return original.filter((_,i)=>lengths[i]>0);
  const lo=start*total, hi=end*total;
  const pattern=style.dashArray ? (style.dashArray.length%2 ? [...style.dashArray,...style.dashArray] : style.dashArray) : undefined;
  const period=pattern?.reduce((a,b)=>a+b,0)??0;
  // Conservative upper bound before allocating fragments or iterating tiny dashes.
  if (pattern && (Math.ceil((hi-lo)/period)+2)*pattern.length/2+contours.length>20000) throw new Error('Dashed path fragment limit exceeded (20000)');
  const result:PathContour[]=[];
  let contourOffset=0, outputPoints=0;
  const mix=(a:Vec3,b:Vec3,t:number):Vec3=>t<=0?[...a]:t>=1?[...b]:a.map((v,i)=>v+(b[i]-v)*t) as Vec3;
  for (let ci=0;ci<contours.length;ci++) {
    const contour=contours[ci], length=lengths[ci], from=Math.max(lo,contourOffset),to=Math.min(hi,contourOffset+length);
    if (to<=from) {contourOffset+=length;continue;}
    if (!pattern && from===contourOffset && to===contourOffset+length) {result.push(contour);contourOffset+=length;continue;}
    let patternIndex=0, remaining=Infinity;
    if(pattern) {
      let phase=((from+(style.dashOffset??0))%period+period)%period;
      while(patternIndex<pattern.length-1 && phase>=pattern[patternIndex]) phase-=pattern[patternIndex++];
      remaining=pattern[patternIndex]-phase;
    }
    const firstFragment=result.length;
    let offset=contourOffset, active:PathContour|undefined;
    for(let i=1;i<contour.points.length;i++) {
      const a=contour.points[i-1],b=contour.points[i],segmentLength=distance(a,b),segmentEnd=offset+segmentLength;
      if(segmentLength>0 && segmentEnd>from && offset<to) {
        let cursor=Math.max(offset,from),stop=Math.min(segmentEnd,to);
        while(cursor<stop) {
          const next=Math.min(stop,cursor+remaining);
          if(!(next>cursor)) throw new Error('Dash spacing is below path numeric precision');
          if(patternIndex%2===0) {
            if(!active) {
              if(result.length>=20000)throw new Error('Dashed path fragment limit exceeded (20000)');
              active={closed:false,points:[mix(a,b,(cursor-offset)/segmentLength)]};result.push(active);outputPoints++;
            }
            if(++outputPoints>60000)throw new Error('Dashed path point limit exceeded (60000)');
            active.points.push(mix(a,b,(next-offset)/segmentLength));
          }
          remaining-=next-cursor;cursor=next;
          if(pattern && remaining<=Number.EPSILON*Math.max(1,Math.abs(cursor))) {patternIndex=(patternIndex+1)%pattern.length;remaining=pattern[patternIndex];active=undefined;}
        }
      }
      offset=segmentEnd;
    }
    // The authored start of a closed contour is not a cap boundary. If paint
    // reaches it from both sides, retain the join even across a dash period.
    if(contour.closed && from===contourOffset && to===contourOffset+length && result.length>firstFragment) {
      const first=result[firstFragment],last=result.at(-1)!,origin=contour.points[0];
      if(distance(first.points[0],origin)===0 && distance(last.points.at(-1)!,origin)===0) {
        if(first===last) first.closed=true;
        else {first.points=[...last.points,...first.points.slice(1)];result.pop();}
      }
    }
    contourOffset+=length;
  }
  return result;
}
