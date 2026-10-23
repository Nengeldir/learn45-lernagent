import type { ElementHandle, SceneContext } from '../types.js';
import type { GraphData, GraphDiagram, GraphOptions, GraphState, SearchTrace, FrontierCandidate, SearchEvent } from './graph-types.js';

/** Pure, bounded, immutable algorithm data, independent of scene styling. */
export function createGraphAlgorithms() {
  const graph=(input:GraphData):GraphData=>{
    if(!input||!Array.isArray(input.nodes)||!Array.isArray(input.edges)||input.nodes.length>256||input.edges.length>2048)throw new Error('Graph budget is 256 nodes and 2048 edges');
    if(input.directed!==undefined&&typeof input.directed!=='boolean')throw new Error('Graph directed must be boolean');
    const ids=new Set<string>(),edgeIds=new Set<string>(),pairs=new Set<string>();
    const validId=(id:string)=>typeof id==='string'&&id.length>0&&id.length<=100&&!id.startsWith('@');
    const nodes=Array.from(input.nodes,n=>{if(!n||!validId(n.id)||ids.has(n.id))throw new Error('Invalid or duplicate node ID');ids.add(n.id);if(!Array.isArray(n.position)||n.position.length!==2||![n.position[0],n.position[1]].every((v:number)=>Number.isFinite(v)&&Math.abs(v)<=1e6))throw new Error('Invalid node position');if(n.label!==undefined&&typeof n.label!=='string')throw new Error('Invalid node label');return Object.freeze({id:n.id,...(n.label===undefined?{}:{label:n.label}),position:Object.freeze([...n.position]) as readonly [number,number]});});
    const edges=Array.from(input.edges,e=>{
      if(!validId(e.id)||edgeIds.has(e.id))throw new Error('Invalid or duplicate edge ID');edgeIds.add(e.id);
      if(!ids.has(e.from)||!ids.has(e.to))throw new Error('Edge endpoint ID is missing');if(e.from===e.to)throw new Error('Self-loops are unsupported');
      if(!Number.isFinite(e.weight)||e.weight<0||e.weight>1e6)throw new Error('Edge weight must be finite and nonnegative <= 1,000,000');
      const pair=JSON.stringify([e.from,e.to].sort());if(pairs.has(pair))throw new Error('Parallel or opposite-direction overlapping edges are unsupported');pairs.add(pair);return Object.freeze({id:e.id,from:e.from,to:e.to,weight:e.weight});
    });
    return Object.freeze({directed:input.directed??false,nodes:Object.freeze(nodes),edges:Object.freeze(edges)});
  };
  const dijkstra=(input:GraphData,source:string):SearchTrace=>{
    const g=graph(input);if(!g.nodes.some(n=>n.id===source))throw new Error('Source node ID is missing');
    const distances:Record<string,number>=Object.create(null),predecessors:Record<string,{node:string;edge:string}|null>=Object.create(null);
    for(const n of g.nodes){distances[n.id]=Infinity;predecessors[n.id]=null;}distances[source]=0;
    let serial=0,records=0;const queue:(FrontierCandidate & {serial:number})[]=[{node:source,cost:0,serial:serial++}],settled=new Set<string>(),events:SearchEvent[]=[];
    const sort=()=>queue.sort((a,b)=>a.cost-b.cost||a.serial-b.serial);
    const emit=(event:Omit<SearchEvent,'frontier'>)=>{records+=queue.length;if(records>100000)throw new Error('Search trace frontier budget exceeds 100,000 records');sort();events.push(Object.freeze({...event,frontier:Object.freeze(queue.map(({serial:_serial,...q})=>Object.freeze(q)))}));};
    while(queue.length){sort();const current=queue.shift()!;
      if(settled.has(current.node)||current.cost!==distances[current.node]){emit({type:'stale',node:current.node,cost:current.cost});continue;}
      settled.add(current.node);emit({type:'pop',node:current.node,cost:current.cost});
      for(const e of g.edges){const next=e.from===current.node?e.to:!g.directed&&e.to===current.node?e.from:null;if(next===null)continue;
        const cost=current.cost+e.weight,accepted=!settled.has(next)&&cost<distances[next];
        if(accepted){distances[next]=cost;predecessors[next]=Object.freeze({node:current.node,edge:e.id});queue.push({node:next,cost,predecessor:current.node,edge:e.id,serial:serial++});}
        emit({type:'relax',node:next,cost,predecessor:current.node,edge:e.id,accepted});
      }
      emit({type:'frontier',node:current.node,cost:current.cost});
    }
    return Object.freeze({distances:Object.freeze(distances),predecessors:Object.freeze(predecessors),events:Object.freeze(events)});
  };
  return {graph,dijkstra};
}

/** Algorithms passed explicitly so both factories remain independently serializable. */
export function createGraphBuilders(s:SceneContext, algorithms:ReturnType<typeof createGraphAlgorithms>) {
  return {graph(id:string,input:GraphData,options:GraphOptions={}):GraphDiagram {
    const data=algorithms.graph(input),nodes=new Map<string,ElementHandle>(),edges=new Map<string,ElementHandle>(),labels=new Map<string,ElementHandle>(),weights=new Map<string,ElementHandle>(),costs=new Map<string,ElementHandle>(),states=new Map<string,GraphState>();
    const radius=options.radius??.25;if(!Number.isFinite(radius)||radius<=0)throw new Error('Graph radius must be positive');
    const precision=(value:number)=>{for(let n=0;n<4;n++)if(Number(value.toFixed(n))===value)return n;return 4;};
    const costFormat={decimals:options.costFormat?.decimals??Math.max(0,...data.edges.map(e=>precision(e.weight))),digits:options.costFormat?.digits??6};
    if(!Number.isInteger(costFormat.decimals)||costFormat.decimals<0||costFormat.decimals>4||!Number.isInteger(costFormat.digits)||costFormat.digits<1||costFormat.digits>6)throw new Error('Graph cost format requires 0–4 decimals and 1–6 integer digits');
    for(const n of data.nodes){const node=s.circle(`${id}/node/${n.id}`,{radius,fill:'GREY',...options.nodeStyle,position:[...n.position]});nodes.set(n.id,node);
      const label=s.text(`${id}/label/${n.id}`,{text:n.label??n.id,fontSize:options.fontSize??.24});s.attach(label,node);labels.set(n.id,label);
      const cost=s.latex(`${id}/cost/${n.id}`,{tex:'\\animnum{cost}',numbers:{cost:0},numberFormat:{...costFormat},fontSize:options.fontSize??.24,opacity:0});s.attach(cost,node,{offset:options.costOffset??[0,-radius-.22]});costs.set(n.id,cost);states.set(n.id,'neutral');
    }
    for(const e of data.edges){const edge=s[data.directed?'arrow':'line'](`${id}/edge/${e.id}`,{points:[[0,0],[1,0]],stroke:'GREY',strokeWidth:.025,...options.edgeStyle});s.connect(edge,nodes.get(e.from)!,nodes.get(e.to)!,{endpoints:'surface'});edges.set(e.id,edge);
      // Exact static weights; mutable costs use reserved native numeric slots.
      const weight=s.text(`${id}/weight/${e.id}`,{text:String(e.weight),fontSize:options.fontSize??.24});
      // The engine integration supplies midpoint attachment after connected endpoints resolve.
      const attachment={offset:options.weightOffset??[0,.18] as [number,number],anchor:'midpoint' as const};
      s.attach(weight,edge,attachment);weights.set(e.id,weight);
    }
    return {data,nodes,edges,labels,weights,costs,states,state(node,state,style={}){const h=nodes.get(node);if(!h)throw new Error('Node ID is missing');if(!['neutral','source','goal','frontier','active','settled'].includes(state))throw new Error('Invalid semantic graph state');states.set(node,state);return h.animate(style);}};
  }};
}
