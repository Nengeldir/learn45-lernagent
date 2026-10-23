import type { ElementHandle, ElementProps, ReactiveDependency, ReactiveProperties, SceneContext, Vec2 } from '../types.js';
import type { CoordinateMap, CoordinatePlane, PlaneOptions } from './coordinate-types.js';

/** Self-contained factory: safe to install inside the scene VM. */
export function createCoordinateBuilders(s: SceneContext) {
  const finite=(n:number)=>{if(!Number.isFinite(n)||Math.abs(n)>1e6)throw new Error('Coordinate must be finite with magnitude <= 1,000,000');return n;};
  const point=(p:Vec2):Vec2=>{if(!Array.isArray(p)||p.length!==2)throw new Error('Coordinate requires two numbers');return [finite(p[0]),finite(p[1])];};
  const range=(r:Vec2)=>{point(r);if(r[0]>=r[1])throw new Error('Coordinate range must increase');};
  return {plane(id:string, options:PlaneOptions):CoordinatePlane {
    range(options.xRange);range(options.yRange);
    const xr=point(options.xRange),yr=point(options.yRange),origin=point(options.origin??[0,0]);
    const scale=typeof options.scale==='number'?[options.scale,options.scale] as Vec2:point(options.scale??[1,1]);
    if(scale.some(n=>!Number.isFinite(n)||n<=0))throw new Error('Coordinate scale must be positive and finite');
    const step=options.step??1;if(!Number.isFinite(step)||step<=0)throw new Error('Grid step must be positive and finite');
    const counts=[xr,yr].map(r=>Math.max(0,Math.floor(r[1]/step)-Math.ceil(r[0]/step)+1));
    if(counts.some(n=>!Number.isSafeInteger(n))||counts[0]+counts[1]>512)throw new Error('Grid budget is 512 lines with finite safe counts');
    const toWorld=(p:Vec2):Vec2=>{point(p);return point([origin[0]+scale[0]*p[0],origin[1]+scale[1]*p[1]]);};
    type Member={handle:ElementHandle;points:Vec2[];offset?:Vec2};
    const members:Member[]=[];let mapping:{deps:ReactiveDependency[];fn:CoordinateMap}|undefined;
    const bind=(m:Member)=>{
      const {deps,fn}=mapping!;
      s.bind(m.handle,deps,(...values)=>{
        const mapped=m.points.map(p=>toWorld(point(fn([...p] as Vec2,...values))));
        return m.offset?{position:point([mapped[0][0]+m.offset[0],mapped[0][1]+m.offset[1]])}:{points:mapped} as ReactiveProperties;
      });
    };
    const add=(name:string,points:Vec2[],style:ElementProps={},kind:'path'|'arrow'|'line'='path')=>{
      if(!Array.isArray(points)||points.length<2||points.length>20000)throw new Error('Path sample limit is 2–20000');
      const captured=Array.from(points,point),handle=s[kind](`${id}/${name}`,{fill:'none',stroke:'WHITE',strokeWidth:.02,...style,points:captured.map(toWorld)});
      const member={handle,points:captured};members.push(member);if(mapping)bind(member);return handle;
    };
    const grid:ElementHandle[]=[],axes:ElementHandle[]=[],ticks:ElementHandle[]=[];
    if(options.grid!==false) {
      for(let i=0;i<counts[0];i++){const x=(Math.ceil(xr[0]/step)+i)*step;grid.push(add(`grid/x/${i}`,[[x,yr[0]],[x,yr[1]]],{stroke:'GREY',strokeWidth:.01,opacity:.3,...options.grid},'line'));}
      for(let i=0;i<counts[1];i++){const y=(Math.ceil(yr[0]/step)+i)*step;grid.push(add(`grid/y/${i}`,[[xr[0],y],[xr[1],y]],{stroke:'GREY',strokeWidth:.01,opacity:.3,...options.grid},'line'));}
    }
    if(options.axes!==false) {
      if(yr[0]<=0&&yr[1]>=0)axes.push(add('axis/x',[[xr[0],0],[xr[1],0]],{strokeWidth:.015,...options.axes},'line'));
      if(xr[0]<=0&&xr[1]>=0)axes.push(add('axis/y',[[0,yr[0]],[0,yr[1]]],{strokeWidth:.015,...options.axes},'line'));
    }
    if(options.ticks!==false)for(let axis=0;axis<2;axis++) {
      const r=axis===0?xr:yr,other=axis===0?yr:xr;if(other[0]>0||other[1]<0)continue;
      for(let i=0;i<counts[axis];i++){const n=(Math.ceil(r[0]/step)+i)*step;if(n===0)continue;
        const half=.04/scale[1-axis];ticks.push(add(`tick/${axis}/${i}`,axis===0?[[n,-half],[n,half]]:[[-half,n],[half,n]],{strokeWidth:.012,...options.ticks},'line'));
      }
    }
    return {toWorld,grid:Object.freeze(grid),axes:Object.freeze(axes),ticks:Object.freeze(ticks),
      path:(name,points,style)=>add(name,points,style),
      vector:(name,endpoint,style)=>add(name,[[0,0],point(endpoint)],style,'arrow'),
      components:(name,endpoint,styles={})=>{const [x,y]=point(endpoint);return {x:add(`${name}/x`,[[0,0],[x,0]],styles.x,'arrow'),y:add(`${name}/y`,[[x,0],[x,y]],styles.y,'arrow')};},
      curve:(name,fn,r,samples=128,style)=>{range(r);if(!Number.isInteger(samples)||samples<2||samples>20000)throw new Error('Curve samples must be 2–20000');return add(name,Array.from({length:samples},(_,i)=>point(fn(r[0]+(r[1]-r[0])*i/(samples-1)))),style);},
      label:(name,tex,p,offset=[0,0],style={})=>{const source=point(p),off=point(offset),world=toWorld(source);const handle=s.latex(`${id}/${name}`,{tex,fontSize:.28,...style,position:point([world[0]+off[0],world[1]+off[1]])});const member={handle,points:[source],offset:off};members.push(member);if(mapping)bind(member);return handle;},
      map:(deps,fn)=>{if(mapping)throw new Error('Coordinate map is already bound');mapping={deps:[...deps],fn};for(const m of members)bind(m);},
    };
  }};
}
