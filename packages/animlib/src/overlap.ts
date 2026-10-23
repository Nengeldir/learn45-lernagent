import { VERTEX_FLOATS } from './texture-shader.js';
import { clip, projectedTriangle } from './projection.js';
import { paletteResolver } from './palette.js';
import { buildDrawItems } from './render-geometry.js';
import { SpatialFrame } from './spatial.js';
import { evaluateScene } from './timeline.js';
import type { CompiledScene, Frame, OverlapBounds, OverlapDiagnostic, OverlapOptions, SceneOverlapOptions, SceneOverlapSample, Vec2, Vec3 } from './types.js';

interface Primitive { points: Vec2[]; bounds: OverlapBounds; }
interface Footprint { id: string; ancestors: Set<string>; bounds: OverlapBounds; primitives: Primitive[]; }
const AREA_EPSILON = 1e-7; // CSS pixels squared; excludes edge contact and floating-point slivers.
const MAX_SAMPLES = 100_000;

function bounds(points: Vec2[]): OverlapBounds {
  return points.reduce((box, [x, y]) => ({ left: Math.min(box.left, x), top: Math.min(box.top, y), right: Math.max(box.right, x), bottom: Math.max(box.bottom, y) }),
    { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity });
}
function union(a: OverlapBounds, b: OverlapBounds): OverlapBounds {
  return { left: Math.min(a.left, b.left), top: Math.min(a.top, b.top), right: Math.max(a.right, b.right), bottom: Math.max(a.bottom, b.bottom) };
}
function intersects(a: OverlapBounds, b: OverlapBounds): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}
function signedArea(points: Vec2[]): number {
  if (points.length < 3) return 0;
  // Translate to the first vertex to avoid cancellation far from the origin.
  const [x, y] = points[0];
  return points.reduce((sum, p, i) => { const q = points[(i + 1) % points.length]; return sum + (p[0] - x) * (q[1] - y) - (q[0] - x) * (p[1] - y); }, 0) / 2;
}

function intersection(a: Vec2[], b: Vec2[]): Vec2[] {
  const sign = signedArea(b) >= 0 ? 1 : -1;
  for (let i = 0; i < b.length && a.length; i++) {
    const p = b[i], q = b[(i + 1) % b.length];
    a = clip(a, r => sign * ((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])));
  }
  return a;
}

function validateOptions(options: OverlapOptions): number {
  if (![options.width, options.height].every(n => Number.isFinite(n) && n > 0)) throw new Error('Overlap detection requires positive finite width and height.');
  const minOpacity = options.minOpacity ?? 0.01;
  if (!Number.isFinite(minOpacity) || minOpacity < 0 || minOpacity > 1) throw new Error('minOpacity must be between 0 and 1.');
  return minOpacity;
}

/** Snapshot glyph checks; a Frame alone does not describe active animation tracks. */
export function detectOverlaps(frame: Frame, options: OverlapOptions): OverlapDiagnostic[] {
  return inspectFrame(frame, options);
}

function inspectFrame(frame: Frame, options: OverlapOptions, excluded: ReadonlySet<string> = new Set()): OverlapDiagnostic[] {
  const minOpacity = validateOptions(options), palette = paletteResolver(options.palette), space = new SpatialFrame(frame);
  const footprints = new Map<string, Footprint>();
  const regions = [{ camera: frame.camera, rect: [0, 0, 1, 1], id: undefined as string | undefined },
    ...(frame.views ?? []).map(view => ({ camera: view.camera, rect: view.rect, id: view.id }))];
  for (const region of regions) {
    const [left, top, w, h] = region.rect, width = w * options.width, height = h * options.height;
    if (width <= 0 || height <= 0) continue;
    for (const item of buildDrawItems(frame, region.camera, width, height, palette, region.id, true, undefined, undefined, options.assetGeometry)) {
      if (item.component !== 'content' || excluded.has(item.elementId)) continue;
      const data = item.vertices, opacity = data[6] * (item.groups ?? []).reduce((n, group) => n * group.opacity, 1);
      if (opacity <= 0 || opacity < minOpacity) continue;
      for (let i = 0; i < data.length; i += 3 * VERTEX_FLOATS) {
        const triangle: Vec3[] = [0, VERTEX_FLOATS, 2 * VERTEX_FLOATS].map(j => [data[i + j], data[i + j + 1], data[i + j + 2]]);
        let points = projectedTriangle(triangle, data[i + 7] > 0.5, region.camera, width, height, [data[i + 13], data[i + 14]])
          .map(([x, y]): Vec2 => [x + left * options.width, y + top * options.height]);
        points = clip(clip(clip(clip(points, p => p[0]), p => options.width - p[0]), p => p[1]), p => options.height - p[1]);
        if (!points.every(p => p.every(Number.isFinite)) || Math.abs(signedArea(points)) <= AREA_EPSILON) continue;
        const box = bounds(points), primitive = { points, bounds: box };
        const footprint = footprints.get(item.elementId);
        if (footprint) { footprint.primitives.push(primitive); footprint.bounds = union(footprint.bounds, box); }
        else footprints.set(item.elementId, { id: item.elementId, ancestors: new Set(space.chain(item.elementId).map(e => e.id)), bounds: box, primitives: [primitive] });
      }
    }
  }
  const ordered = [...footprints.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0), diagnostics: OverlapDiagnostic[] = [];
  for (const footprint of ordered) footprint.primitives.sort((a, b) => a.bounds.left - b.bounds.left);
  for (let i = 0; i < ordered.length; i++) for (let j = i + 1; j < ordered.length; j++) {
    const a = ordered[i], b = ordered[j];
    if (!intersects(a.bounds, b.bounds) || options.ignorePairs?.some(([x, y]) =>
      a.ancestors.has(x) && b.ancestors.has(y) || a.ancestors.has(y) && b.ancestors.has(x))) continue;
    let overlapBounds: OverlapBounds | undefined, witness: Vec2 | undefined;
    for (const pa of a.primitives) for (const pb of b.primitives) {
      if (pb.bounds.left >= pa.bounds.right) break;
      if (!intersects(pa.bounds, pb.bounds)) continue;
      const polygon = intersection(pa.points, pb.points);
      if (Math.abs(signedArea(polygon)) <= AREA_EPSILON) continue;
      const box = bounds(polygon);
      overlapBounds = overlapBounds ? union(overlapBounds, box) : box;
      witness ??= polygon.reduce<Vec2>((sum, p) => [sum[0] + p[0] / polygon.length, sum[1] + p[1] / polygon.length], [0, 0]);
    }
    if (!overlapBounds || !witness) continue;
    diagnostics.push({ elements: [a.id, b.id], severity: 'unacceptable', kind: 'text-overlap',
      bounds: overlapBounds, elementBounds: [a.bounds, b.bounds], witness });
  }
  return diagnostics;
}

/** Follow active tracks through the frame's parent and binding dependencies. */
function animatingElements(scene: CompiledScene, frame: Frame, time: number): Set<string> {
  const animated = new Set<string>(), dependents = new Map<string, string[]>();
  const dependsOn = (target: string, source: string): void => {
    const targets = dependents.get(source) ?? [];
    targets.push(target); dependents.set(source, targets);
  };
  for (const element of frame.elements) {
    for (const child of element.geometry.children ?? []) dependsOn(child, element.id);
  }
  for (const binding of scene.bindings ?? []) {
    const sources = binding.type === 'attach' ? [binding.source] : [binding.from, binding.to];
    for (const source of sources) dependsOn(binding.target, source);
  }
  for (const track of scene.tracks) {
    // Half-open intervals include the first animation frame but allow the settled endpoint.
    if (track.action.type !== 'camera' && track.start <= time && time < track.start + track.duration) {
      for (const id of track.action.ids) animated.add(id);
    }
  }
  const queue = [...animated];
  for (let i = 0; i < queue.length; i++) {
    for (const target of dependents.get(queue[i]) ?? []) {
      if (!animated.has(target)) { animated.add(target); queue.push(target); }
    }
  }
  // Camera motion changes projected world text, but leaves screen-space text stationary.
  const animatedViews = new Set(frame.views?.filter(view => view.cameraAnimated).map(view => view.id));
  for (const element of frame.elements) {
    if (element.space !== 'screen' && (element.view === undefined ? frame.cameraAnimated : animatedViews.has(element.view))) animated.add(element.id);
  }
  return animated;
}

/** Check settled text by default, returning only sample times with overlaps. */
export function detectSceneOverlaps(scene: CompiledScene, options: SceneOverlapOptions): SceneOverlapSample[] {
  validateOptions(options);
  if (!Number.isFinite(scene.duration) || scene.duration < 0) throw new Error('Scene duration must be finite and nonnegative.');
  const sampleRate = options.sampleRate ?? 10;
  if (!options.times && (!Number.isFinite(sampleRate) || sampleRate <= 0)) throw new Error('sampleRate must be positive and finite.');
  let times: number[];
  if (options.times) {
    if (options.times.length > MAX_SAMPLES) throw new Error(`Overlap sampling supports at most ${MAX_SAMPLES} samples per call.`);
    if (!options.times.every(t => Number.isFinite(t) && t >= 0 && t <= scene.duration)) throw new Error('Overlap sample times must be within the scene duration.');
    times = [...options.times];
  } else {
    const count = Math.ceil(scene.duration * sampleRate);
    if (!Number.isFinite(count) || count + scene.lifecycle.length + scene.tracks.length * 2 + 2 > MAX_SAMPLES) {
      throw new Error(`Overlap sampling supports at most ${MAX_SAMPLES} samples per call; lower sampleRate or provide times.`);
    }
    times = [0, scene.duration, ...scene.lifecycle.map(event => event.time), ...scene.tracks.flatMap(track => [track.start, track.start + track.duration])];
    for (let i = 1; i < count; i++) times.push(i / sampleRate);
  }
  const samples: SceneOverlapSample[] = [];
  for (const time of [...new Set(times)].sort((a, b) => a - b)) {
    const frame = evaluateScene(scene, time);
    const excluded = options.includeAnimating ? undefined : animatingElements(scene, frame, time);
    const overlaps = inspectFrame(frame, { ...options, palette: options.palette ?? scene.options.palette }, excluded);
    if (overlaps.length) samples.push({ time, overlaps });
  }
  return samples;
}
