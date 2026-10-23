import type {SceneContext,Vec2,ElementHandle} from '../types.js';
import type {CollectionItem} from './collection-types.js';
import type {CompactQueueOptions,CompactQueueTransition,CompactQueueDiagram} from './compact-queue-types.js';

/** Compact subset changes, separate from the collection's arbitrary permutations. */
export function createCompactQueueBuilders(s:SceneContext){
  return {compactQueue(id:string,input:readonly CollectionItem[],options:CompactQueueOptions={}):CompactQueueDiagram {
    if(!Array.isArray(input)||input.length>256)throw Error('Compact queue budget is 256 records');
    const known=new Set<string>();
    const data=Object.freeze(Array.from(input,item=>{
      if(!item||typeof item.id!=='string'||!item.id||item.id.length>100||known.has(item.id))throw Error('Invalid or duplicate queue ID');
      if(typeof item.value!=='string'&&!(typeof item.value==='number'&&Number.isFinite(item.value)))throw Error('Invalid queue value');
      known.add(item.id);return Object.freeze({...item});
    }));
    const vector=(v:Vec2):Vec2=>{if(!Array.isArray(v)||v.length!==2||[0,1].some(k=>!Number.isFinite(v[k])||Math.abs(v[k])>100000))throw Error('Queue requires a dense bounded Vec2');return [v[0],v[1]];};
    const width=options.width??1.2,height=options.height??.65,gap=options.gap??.14,origin=vector(options.origin??[0,0]);
    if(![width,height,gap].every(Number.isFinite)||width<=0||height<=0||gap<0)throw Error('Invalid queue dimensions');
    if(options.orientation!==undefined&&!['horizontal','vertical'].includes(options.orientation))throw Error('Invalid queue orientation');
    const vertical=options.orientation!=='horizontal',step=(vertical?height:width)+gap;
    if(Math.max(width,height,step*data.length)+Math.max(...origin.map(Math.abs))>100000)throw Error('Queue layout exceeds coordinate bound');
    const validate=(order:readonly string[])=>{
      if(!Array.isArray(order)||order.length>data.length)throw Error('Invalid queue order');
      const copy=Array.from(order);if(new Set(copy).size!==copy.length||copy.some(key=>typeof key!=='string'||!known.has(key)))throw Error('Queue order needs distinct known IDs');return copy;
    };
    const initial=validate(options.initialOrder??data.map(item=>item.id));let current=[...initial];
    const indices=(order:string[])=>new Map(order.map((key,i)=>[key,i]));
    const initialSlots=indices(initial),position=(slot:number):Vec2=>vertical?[origin[0],origin[1]-slot*step]:[origin[0]+slot*step,origin[1]];
    type Change={start:number;end:number;before:Map<string,number>;after:Map<string,number>;entry:Vec2;exit:Vec2};
    const changes:Change[]=[],items=new Map<string,ElementHandle>();
    s.validateGroup(data.flatMap(item=>item.handle?[item.handle]:[]),data.flatMap(item=>[
      `${id}/item/${item.id}`,...(item.handle?[]:[`${id}/cell/${item.id}`,`${id}/label/${item.id}`])
    ]));
    const smooth=(u:number)=>{u=Math.max(0,Math.min(1,u));return u*u*(3-2*u);};
    for(const item of data){
      const children=item.handle?[item.handle]:[
        s.rectangle(`${id}/cell/${item.id}`,{width,height,fill:'none',stroke:'WHITE',...options.style}),
        s.text(`${id}/label/${item.id}`,{text:String(item.value),fontSize:options.fontSize??.3})
      ];
      const group=s.group(`${id}/item/${item.id}`,children);items.set(item.id,group);
      s.bind(group,[s.time],time=>{
        let lo=0,hi=changes.length;while(lo<hi){const mid=(lo+hi)>>>1;if(changes[mid].start<=time)lo=mid+1;else hi=mid;}
        const change=changes[lo-1];
        if(!change){const slot=initialSlots.get(item.id);return {position:position(slot??0),opacity:slot===undefined?0:1};}
        const from=change.before.get(item.id),to=change.after.get(item.id);
        if(time>=change.end)return {position:position(to??from??0),opacity:to===undefined?0:1};
        const u=(time-change.start)/(change.end-change.start);
        if(from!==undefined&&to!==undefined){const a=position(from),b=position(to),p=smooth(u);return {position:[a[0]+(b[0]-a[0])*p,a[1]+(b[1]-a[1])*p],opacity:1};}
        if(from!==undefined){const p=smooth(u/.8),a=position(from);return {position:[a[0]+change.exit[0]*p,a[1]+change.exit[1]*p],opacity:1-p};}
        if(to!==undefined){const p=smooth((u-.2)/.8),b=position(to);return {position:[b[0]+change.entry[0]*(1-p),b[1]+change.entry[1]*(1-p)],opacity:p};}
        return {position:position(0),opacity:0};
      });
    }
    const transition=(order:readonly string[],timing:CompactQueueTransition)=>{
      const after=validate(order);
      if(!timing||![timing.start,timing.duration].every(Number.isFinite)||timing.start<0||timing.duration<=0||timing.start+timing.duration<=timing.start||timing.start+timing.duration>86400)throw Error('Invalid compact queue timing');
      if(changes.length>=256)throw Error('Compact queue budget is 256 transitions');
      if(changes.length&&changes[changes.length-1].end>timing.start)throw Error('Queue schedules overlap or are out of order');
      const beforeSet=new Set(current),afterSet=new Set(after),survivors=current.filter(key=>afterSet.has(key));
      if(after.filter(key=>beforeSet.has(key)).some((key,i)=>key!==survivors[i]))throw Error('Compact queue preserves survivor order; use collection.reorder for permutations');
      const entry=vector(timing.entryOffset??(vertical?[-width*.35,0]:[0,height*.35]));
      const exit=vector(timing.exitOffset??(vertical?[width*.85,0]:[0,-height*.85]));
      for(const offset of [entry,exit])for(const slot of [0,Math.max(0,data.length-1)]){
        const p=position(slot);if(p.some((v,k)=>Math.abs(v+offset[k])>100000))throw Error('Queue transition exceeds coordinate bound');
      }
      changes.push({start:timing.start,end:timing.start+timing.duration,before:indices(current),after:indices(after),entry,exit});current=after;
    };
    return {items,data,get order(){return [...current];},transition,
      insert(key,index,timing){if(!known.has(key)||current.includes(key)||!Number.isInteger(index)||index<0||index>current.length)throw Error('Invalid queue insertion');const next=[...current];next.splice(index,0,key);transition(next,timing);},
      remove(key,timing){if(!current.includes(key))throw Error('Queue removal needs an active ID');transition(current.filter(id=>id!==key),timing);}
    };
  }};
}
