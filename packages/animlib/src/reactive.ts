import { validateSurfaceAppearance } from './appearance-validation.js';
import { paletteResolver } from './palette.js';
import type { CompiledScene, ElementState, ReactiveProperties, ReactiveUpdate, Vec3 } from './types.js';

const keys = new Set(['radius', 'position', 'rotation', 'scale', 'opacity', 'fill', 'vertices', 'normals', 'material', 'texture', 'scalarColors', 'points', 'strokeStart', 'strokeEnd', 'dashOffset']);
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e6;

/** Validate every callback result after it crosses the untrusted VM boundary. */
export function validateReactiveProperties(properties: ReactiveProperties, target: ElementState, scene: CompiledScene): void {
  check(properties && typeof properties === 'object' && !Array.isArray(properties), 'Invalid reactive properties');
  check(Object.keys(properties).length > 0 && Object.keys(properties).every(key => keys.has(key)), 'Unsupported reactive property');
  for (const [key, value] of Object.entries(properties)) {
    check(!target.geometry.asset || !['vertices','normals','scalarColors'].includes(key), 'Referenced model assets cannot deform');
    if (key === 'fill') paletteResolver(scene.options.palette).validate(value);
    else if (key === 'points') {
      check(['path','line','arrow'].includes(target.geometry.kind) && target.geometry.d === undefined, 'Reactive points requires a point-authored path, line, or arrow');
      check(!scene.bindings?.some(b=>b.type==='connect' && b.target===target.id), 'Reactive points conflicts with connected endpoints');
      check(Array.isArray(value) && value.length === target.geometry.points?.length && value.length <= 20000, 'Reactive points must preserve point count and topology');
      for (const point of value) check(Array.isArray(point) && (point.length===2 || point.length===3) && point.every(finite), 'Invalid reactive points');
    }
    else if (key === 'strokeStart' || key === 'strokeEnd' || key === 'dashOffset') {
      check(['path','line','arrow'].includes(target.geometry.kind), `Reactive ${key} requires a path, line, or arrow`);
      check(finite(value) && (key==='dashOffset' || value>=0 && value<=1), `Invalid reactive ${key}`);
    }
    else if (key === 'scalarColors') {
      check(target.geometry.kind === 'mesh', 'Reactive scalarColors requires a mesh');
      if (value === null) continue;
      const ramp = properties.scalarColors!;
      check(ramp && typeof ramp === 'object' && !Array.isArray(ramp) && Object.keys(ramp).every(k => ['values', 'domain', 'colors'].includes(k)), 'Invalid reactive scalarColors');
      check(Array.isArray(ramp.values) && ramp.values.length === target.geometry.vertices?.length && ramp.values.every(finite), 'Scalar values must match mesh vertices');
      check(Array.isArray(ramp.domain) && ramp.domain.length === 2 && ramp.domain.every(finite) && ramp.domain[0] < ramp.domain[1], 'Invalid scalar domain');
      check(Array.isArray(ramp.colors) && ramp.colors.length >= 2 && ramp.colors.length <= 16, 'Invalid scalar ramp');
      for (const color of ramp.colors as unknown[]) {
        check(typeof color === 'string' && color !== 'none', 'Scalar ramp requires opaque palette tokens');
        paletteResolver(scene.options.palette).validate(color);
      }
    }
    else if (key === 'vertices' || key === 'normals') {
      check(target.geometry.kind === 'mesh', `Reactive ${key} requires a mesh`);
      if (key === 'normals' && value === null) continue;
      check(Array.isArray(value) && value.length === target.geometry.vertices?.length && value.length <= 20000, 'Reactive mesh updates must preserve vertex count and topology');
      for (const point of value) {
        check(Array.isArray(point) && (point.length === 3 || key === 'vertices' && point.length === 2) && point.every(finite), `Invalid reactive ${key}`);
        if (key === 'normals') check(Math.hypot(...point) > 0, 'Reactive normals must be nonzero');
      }
    } else if (key === 'material' || key === 'texture') {
      check(['sphere', 'mesh'].includes(target.geometry.kind), `Reactive ${key} requires a sphere or mesh`);
      if (value === null) continue;
      check(value !== undefined, `Invalid reactive ${key}`);
      validateSurfaceAppearance({ kind: target.geometry.kind, [key]: value });
      const palette = paletteResolver(scene.options.palette);
      if (key === 'material' && properties.material?.emissive !== undefined) palette.validate(properties.material.emissive);
      if (key === 'texture') palette.validate(properties.texture!.color);
    }
    else if (key === 'position' || key === 'rotation') check(Array.isArray(value) && value.length === 3 && value.every(finite), `Invalid reactive ${key}`);
    else {
      check(finite(value) && value >= 0, `Invalid reactive ${key}`);
      if (key === 'opacity') check(value <= 1, 'Reactive opacity must be <= 1');
      if (key === 'radius') check(['sphere', 'circle'].includes(target.geometry.kind), 'Reactive radius requires a sphere or circle');
    }
  }
}

export function validateReactiveBindings(scene: CompiledScene): void {
  const bindings = scene.reactiveBindings ?? [];
  check(Array.isArray(bindings) && bindings.length <= 2000, 'Invalid reactive bindings');
  const elements = new Map([...scene.initial, ...scene.lifecycle.flatMap(e => e.elements ?? [])].map(e => [e.id, e]));
  const targets = new Set<string>();
  const owners = new Map<string, Set<string>>();
  if (scene.reactiveTime !== undefined) check(finite(scene.reactiveTime) && scene.reactiveTime >= 0 && scene.reactiveTime <= scene.duration, 'Invalid reactive snapshot time');
  for (const binding of bindings) {
    const target = elements.get(binding.target);
    const identity = JSON.stringify([binding.target, binding.slot]);
    check(binding.slot === undefined || Number.isInteger(binding.slot) && binding.slot >= 0, 'Invalid reactive binding slot');
    check(target && !targets.has(identity), 'Invalid or duplicate reactive target');
    targets.add(identity);
    check(Array.isArray(binding.controls) && (binding.controls.length > 0 || binding.time === true) && binding.controls.length <= 100
      && binding.controls.every(id => scene.controls.some(c => c.id === id && c.kind === 'slider' && c.reactive === true)), 'Invalid reactive control dependency');
    check(binding.time === undefined || binding.time === true, 'Invalid reactive time dependency');
    validateReactiveProperties(binding.properties, target, scene);
    const properties = Object.keys(binding.properties);
    const owned = owners.get(binding.target) ?? new Set<string>();
    // Vertices implicitly own generated normals as well.
    const writes = [...properties, ...(properties.includes('vertices') ? ['normals'] : [])];
    check(writes.every(key => !owned.has(key)), 'Reactive bindings cannot own the same property');
    for (const key of writes) owned.add(key);
    owners.set(binding.target, owned);
    for (const track of scene.tracks) if (track.action.ids.includes(binding.target)) {
      check(!properties.some(key => Object.hasOwn(track.action.properties ?? {}, key)
        || ['radius', 'vertices', 'normals', 'material', 'texture', 'scalarColors', 'points'].includes(key) && track.action.type === 'morph'), 'A reactive binding and timeline cannot own the same property');
      if (properties.some(key=>['strokeStart','strokeEnd','dashOffset'].includes(key)) && track.action.type==='morph') check(['path','line','arrow'].includes(track.action.geometry!.kind), 'Reactive stroke controls require path, line, or arrow morph destinations');
    }
    if (properties.includes('position')) {
      check(!scene.bindings?.some(b => b.target === binding.target) && !scene.behaviors?.some(b => b.target === binding.target), 'Reactive position conflicts with an attachment or behavior');
    }
  }
}

export function mergeReactiveUpdates(scene: CompiledScene, updates: ReactiveUpdate[], changed: string[], time?: number): NonNullable<CompiledScene['reactiveBindings']> {
  const expected = (scene.reactiveBindings ?? []).filter(b => time !== undefined && b.time || b.controls.some(id => changed.includes(id)));
  check(Array.isArray(updates) && updates.length === expected.length, 'Invalid reactive update count');
  const elements = new Map([...scene.initial, ...scene.lifecycle.flatMap(e => e.elements ?? [])].map(e => [e.id, e]));
  const byTarget = new Map<string, ReactiveProperties>();
  for (const update of updates) {
    const binding = expected.find(b => b.target === update.target && b.slot === update.slot);
    check(binding && !byTarget.has(JSON.stringify([update.target, update.slot])), 'Invalid reactive update target');
    check(JSON.stringify(Object.keys(update.properties ?? {}).sort()) === JSON.stringify(Object.keys(binding.properties).sort()), 'Reactive property keys changed');
    validateReactiveProperties(update.properties, elements.get(update.target)!, scene);
    byTarget.set(JSON.stringify([update.target, update.slot]), update.properties);
  }
  return (scene.reactiveBindings ?? []).map(b => byTarget.has(JSON.stringify([b.target, b.slot])) ? { ...b, properties: byTarget.get(JSON.stringify([b.target, b.slot]))! } : b);
}

/** Apply absolute values to the freshly evaluated authored frame, before attachments. */
export function applyReactiveProperties(element: ElementState, properties: ReactiveProperties): void {
  // Moving vertices invalidates authored normals unless this patch replaces them.
  if (properties.vertices !== undefined) delete element.geometry.normals;
  for (const [key, value] of Object.entries(properties)) {
    if (['vertices', 'normals', 'material', 'texture', 'scalarColors', 'points'].includes(key)) {
      if (value === null) delete (element.geometry as unknown as Record<string, unknown>)[key];
      else Object.assign(element.geometry, { [key]: structuredClone(value) });
    }
    else if (key === 'radius') element.geometry.radius = value as number;
    else if (key === 'position' || key === 'rotation') element[key] = [...value as Vec3];
    else Object.assign(element, { [key]: structuredClone(value) });
  }
}
