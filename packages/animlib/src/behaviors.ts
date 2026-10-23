import { applyBindings } from './bindings.js';
import { SpatialFrame, add, sub, mul, dot, planePoint } from './spatial.js';
import type { Behavior, BehaviorContext, BehaviorFactory, BehaviorInput, BehaviorSpec, CompiledScene, ElementState, Frame, Vec3 } from './types.js';

function drag(spec: Extract<BehaviorSpec, { type: 'drag' }>): Behavior {
  let held: Vec3 | undefined, origin: Vec3 = [0,0,0], normal: Vec3 = [0,0,1], grab: Vec3 = [0,0,0];
  const points = spec.path?.points;
  const segments = points ? points.length - (spec.path?.closed ? 0 : 1) : 0;
  let segment = 0, pathT = 0;
  const projectSegment = (position: Vec3, index: number) => {
    const a=points![index], direction=sub(points![(index+1)%points!.length],a);
    const t=Math.max(0,Math.min(1,dot(sub(position,a),direction)/dot(direction,direction)));
    const positionOnPath=add(a,mul(direction,t));
    return {index,t,position:positionOnPath,distance:Math.hypot(...sub(position,positionOnPath))};
  };
  const constrain = (position: Vec3, initial = false): Vec3 => {
    if (spec.bounds) return position.map((v,i)=>Math.max(spec.bounds!.min[i],Math.min(spec.bounds!.max[i],v))) as Vec3;
    if (!points) return position;
    let best=projectSegment(position,segment);
    if (initial) {
      for(let i=0;i<segments;i++){const candidate=projectSegment(position,i);if(candidate.distance<best.distance-1e-9)best=candidate;}
    } else {
      // Only enter a neighboring segment after reaching the shared endpoint.
      // A distant pointer event cannot select an unrelated road across the block.
      const neighbor=pathT<=1e-9?segment-1:pathT>=1-1e-9?segment+1:undefined;
      if(neighbor!==undefined&&(spec.path?.closed||neighbor>=0&&neighbor<segments)) {
        const candidate=projectSegment(position,(neighbor+segments)%segments);
        if(candidate.distance<best.distance-1e-9)best=candidate;
      }
    }
    segment=best.index;pathT=best.t;return best.position;
  };
  const axis: Vec3 | undefined = spec.axis ? spec.axis === 'x' ? [1,0,0] : spec.axis === 'y' ? [0,1,0] : [0,0,1] : undefined;
  const point = (event: BehaviorInput): Vec3 | undefined => {
    if (!event.ray) return;
    if (!axis) return planePoint(event.ray, origin, normal);
    // Closest point on the constrained world axis to the pointer ray.
    const d = event.ray.direction, delta = sub(event.ray.origin, origin), a = dot(axis, d), denominator = 1-a*a;
    if (denominator < 1e-8) return;
    return add(origin, mul(axis, (dot(axis, delta)-a*dot(d,delta))/denominator));
  };
  return {
    input(event, context) {
      if (event.type === 'start') {
        origin = context.worldPosition();
        if (spec.bounds) {
          const movable=spec.axis?[spec.axis==='x'?0:spec.axis==='y'?1:2]:spec.plane==='xy'?[0,1]:spec.plane==='xz'?[0,2]:[1,2];
          if(origin.some((v,i)=>!movable.includes(i)&&(v<spec.bounds!.min[i]||v>spec.bounds!.max[i])))return false;
        }
        if(points)origin=constrain(origin,true);
        normal = spec.plane === 'xy' ? [0,0,1] : spec.plane === 'xz' ? [0,1,0] : spec.plane === 'yz' ? [1,0,0] : event.normal ?? [0,0,1];
        const p = point(event); if (!p) return false;
        grab = sub(origin, p); held = constrain(origin,true); context.setWorldPosition(held); return true;
      }
      if (event.type === 'move' && held) { const p = point(event); if (p) { held = constrain(add(p, grab)); context.setWorldPosition(held); } }
      if (event.type === 'end' || event.type === 'cancel') held = undefined;
    },
    update(context) { if (held) context.setWorldPosition(held); },
  };
}

function spring(spec: Extract<BehaviorSpec, { type: 'spring' }>): Behavior {
  let velocity: Vec3 = [0,0,0];
  const stiffness = spec.stiffness ?? 65, damping = spec.damping ?? 9;
  return { update(context) {
    if (context.held) { velocity = [0,0,0]; return false; }
    const target = context.authoredWorldPosition();
    let offset = sub(context.worldPosition(), target);
    // Limit both damping and elastic terms per substep, including overdamped springs.
    const maxStep = Math.min(1/240, 0.5/damping, 0.5/Math.sqrt(stiffness));
    let remaining = Math.min(0.04, context.dt);
    while (remaining > 0) {
      const dt = Math.min(remaining, maxStep); remaining -= dt;
      velocity = add(velocity, mul(add(mul(offset, -stiffness), mul(velocity, -damping)), dt));
      offset = add(offset, mul(velocity, dt));
    }
    const active = Math.hypot(...offset) > 0.001 || Math.hypot(...velocity) > 0.008;
    if (!active) { offset = [0,0,0]; velocity = [0,0,0]; }
    context.setWorldPosition(add(target, offset));
    return active;
  } };
}

interface TargetState { offset: Vec3; instances: Behavior[]; held: boolean; }

/** Per-player live state, separate from compiled scenes and deterministic handoff frames. */
export class BehaviorRuntime {
  private scene?: CompiledScene;
  private targets = new Map<string, TargetState>();
  private authored?: Frame;
  private displayed?: Frame;
  private time = 0;
  active = false;
  constructor(private readonly factories: Record<string, BehaviorFactory> = {}) {}

  validate(scenes: CompiledScene[]): void {
    for (const scene of scenes) for (const { behavior: b } of scene.behaviors ?? []) {
      if (b.type === 'custom' && !Object.hasOwn(this.factories, b.name)) throw new Error(`Unregistered behavior: ${b.name}`);
    }
  }
  reset(): void {
    for (const target of this.targets.values()) for (const instance of target.instances) instance.dispose?.();
    this.targets.clear(); this.scene = undefined; this.authored = this.displayed = undefined; this.active = false;
  }
  private create(id: string): TargetState {
    const instances = (this.scene?.behaviors ?? []).filter(b => b.target === id).map(({ behavior: b }) => b.type === 'drag' ? drag(b) : b.type === 'spring' ? spring(b) : this.factories[b.name](structuredClone(b.options)));
    return { offset: [0,0,0], instances, held: false };
  }
  get inputTargets(): Set<string> { return new Set([...this.targets].filter(([, s]) => s.instances.some(b => b.input)).map(([id]) => id)); }
  get heldTarget(): string | undefined { return [...this.targets].find(([, s]) => s.held)?.[0]; }
  private context(id: string, dt: number): BehaviorContext {
    const frame = this.displayed!, element = frame.elements.find(e => e.id === id)!, authored = this.authored!.elements.find(e => e.id === id)!;
    const state = this.targets.get(id)!, spatial = new SpatialFrame(frame);
    return {
      time: this.time, dt, held: state.held, authored, element, frame,
      worldPosition: () => spatial.world(id),
      authoredWorldPosition: () => {
        // The baseline position follows the live parent transform, if any.
        const current = element.position; element.position = authored.position;
        const world = spatial.world(id); element.position = current; return world;
      },
      setWorldPosition: position => {
        if (!position.every(Number.isFinite)) throw new Error('Behavior position must be finite');
        element.position = spatial.local(id, position, true);
        state.offset = sub(element.position, authored.position);
      },
    };
  }
  evaluate(scene: CompiledScene, frame: Frame, time: number, dt: number): Frame {
    if (scene !== this.scene) { this.reset(); this.scene = scene; }
    if (!scene.behaviors?.length) { this.active = false; return applyBindings(frame, scene.bindings); }
    this.authored = frame; this.displayed = structuredClone(frame); this.time = time; this.active = false;
    const ids = new Set(frame.elements.map(e => e.id));
    for (const [id, target] of this.targets) if (!ids.has(id)) { for (const b of target.instances) b.dispose?.(); this.targets.delete(id); }
    for (const { target } of scene.behaviors ?? []) if (ids.has(target) && !this.targets.has(target)) this.targets.set(target, this.create(target));
    const space = new SpatialFrame(this.displayed);
    // Resolve live sources and bound ancestors before converting child world positions.
    return applyBindings(this.displayed, scene.bindings, id => {
      const state = this.targets.get(id); if (!state) return;
      const e = space.elements.get(id)!; e.position = add(e.position, state.offset);
      for (const behavior of state.instances) this.active = Boolean(behavior.update?.(this.context(id, dt))) || this.active;
    });
  }
  input(id: string, event: BehaviorInput): boolean {
    const target = this.targets.get(id); if (!target || !this.displayed || !this.authored) return false;
    let claimed = false;
    for (const instance of target.instances) claimed = Boolean(instance.input?.(event, this.context(id, 0))) || claimed;
    if (event.type === 'start' && claimed) target.held = true;
    if (event.type === 'end' || event.type === 'cancel') target.held = false;
    return claimed;
  }
}
