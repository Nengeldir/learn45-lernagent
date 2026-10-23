import { SVGPathData, SVGPathDataTransformer } from 'svg-pathdata';
import { GeometryCache } from './cache.js';
import type { Geometry, Position, Vec3 } from './types.js';

type Segment = { kind: 'line'; end: Vec3 } | { kind: 'cubic'; c1: Vec3; c2: Vec3; end: Vec3 };
interface CurveContour { start: Vec3; segments: Segment[]; closed: boolean }
export interface PathContour { points: Vec3[]; closed: boolean }
const parsed = new GeometryCache<CurveContour[]>();
const flattened = new GeometryCache<PathContour[]>();
const v3 = (p: Position): Vec3 => [p[0], p[1], p[2] ?? 0];
const mix = (a: Vec3, b: Vec3, t: number): Vec3 => a.map((v, i) => v + (b[i] - v) * t) as Vec3;
const equal = (a: Vec3, b: Vec3): boolean => a.every((v, i) => v === b[i]);
const MAX_POINTS = 20000;

function svgContours(source: string): CurveContour[] {
  const cached = parsed.get(source);
  if (cached) return cached;
  const path = new SVGPathData(source);
  if (!path.commands.length) return [];
  const checkNumbers = () => {
    for (const command of path.commands) for (const value of Object.values(command)) {
      if (typeof value === 'number' && (!Number.isFinite(value) || Math.abs(value) > 1e6)) {
        throw new Error('Invalid path coordinate: expected finite magnitude <= 1,000,000');
      }
    }
  };
  checkNumbers();
  if (path.commands[0]?.type !== SVGPathData.MOVE_TO) throw new Error('Path data must start with M');
  path.toAbs().normalizeST().qtToC()
    // Preserve straight cubic segments: their controls may bend in a later morph.
    .transform(SVGPathDataTransformer.NORMALIZE_HVZ(false, true, true, false))
    .transform(SVGPathDataTransformer.INFO((command, x, y) =>
      command.type === SVGPathData.ARC && command.x === x && command.y === y
        ? { type: SVGPathData.LINE_TO, relative: false, x, y } : command));
  const arcToCubic = SVGPathDataTransformer.A_TO_C();
  path.transform(command => {
    const converted = arcToCubic(command);
    // Arc conversion uses trigonometry; retain the exact authored endpoint.
    if (command.type === SVGPathData.ARC && Array.isArray(converted) && converted.length) {
      Object.assign(converted.at(-1)!, { x: command.x, y: command.y });
    }
    return converted;
  });
  checkNumbers();
  const contours: CurveContour[] = [];
  let contour: CurveContour | undefined, current: Vec3 = [0, 0, 0];
  for (const command of path.commands) {
    if (command.type === SVGPathData.MOVE_TO) {
      current = [command.x, command.y, 0];
      contour = { start: current, segments: [], closed: false };
      contours.push(contour);
    } else if (command.type === SVGPathData.CLOSE_PATH) {
      if (contour) { contour.closed = true; current = contour.start; }
    } else if (command.type === SVGPathData.LINE_TO || command.type === SVGPathData.CURVE_TO) {
      // SVG permits drawing again after Z without another explicit M.
      if (!contour || contour.closed) {
        contour = { start: current, segments: [], closed: false };
        contours.push(contour);
      }
      current = [command.x, command.y, 0];
      contour.segments.push(command.type === SVGPathData.LINE_TO
        ? { kind: 'line', end: current }
        : { kind: 'cubic', c1: [command.x1, command.y1, 0], c2: [command.x2, command.y2, 0], end: current });
    }
  }
  return parsed.set(source, contours, path.commands.length * 256);
}

function pointContours(geometry: Geometry): CurveContour[] {
  const points = (geometry.points ?? []).map(v3);
  const closed = !!geometry.closed;
  if (closed && points.length > 1 && equal(points[0], points.at(-1)!)) points.pop();
  if (!points.length) return [];
  const segments: Segment[] = [];
  if (geometry.curve !== 'smooth') {
    for (const end of points.slice(1)) segments.push({ kind: 'line', end });
  } else {
    const at = (i: number) => points[closed ? (i + points.length) % points.length : Math.max(0, Math.min(points.length - 1, i))];
    for (let i = 0; i < (closed ? points.length : points.length - 1); i++) {
      const [a, b, c, d] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
      segments.push({ kind: 'cubic',
        c1: b.map((v, k) => v + (c[k] - a[k]) / 6) as Vec3,
        c2: c.map((v, k) => v - (d[k] - b[k]) / 6) as Vec3, end: c });
    }
  }
  return [{ start: points[0], segments, closed }];
}

function curves(geometry: Geometry): CurveContour[] {
  return geometry.d !== undefined ? svgContours(geometry.d) : pointContours(geometry);
}

/** Called at the VM boundary, including for morph destinations. */
export function validatePath(geometry: Geometry): number {
  if (geometry.curve !== undefined && geometry.curve !== 'linear' && geometry.curve !== 'smooth') {
    throw new Error('Path curve must be linear or smooth');
  }
  if (geometry.closed !== undefined && typeof geometry.closed !== 'boolean') throw new Error('Path closed must be boolean');
  if (geometry.d !== undefined) {
    if (typeof geometry.d !== 'string' || !geometry.d.trim() || geometry.d.length > 20000) throw new Error('Invalid or oversized path data');
    if (geometry.points !== undefined || geometry.curve !== undefined || geometry.closed !== undefined) {
      throw new Error('Path data d cannot be combined with points, curve, or closed; use Z to close contours');
    }
    const contours = svgContours(geometry.d);
    const count = contours.reduce((n, c) => n + 1 + c.segments.reduce((n, s) => n + (s.kind === 'cubic' ? 3 : 1), 0), 0);
    if (!contours.some(c => c.segments.length)) throw new Error('Path data requires a drawing segment');
    if (count > MAX_POINTS) throw new Error('Path control point limit exceeded (20000)');
    return count;
  }
  const count = geometry.points?.length ?? 0;
  if (count < 2) throw new Error('Path requires at least two points');
  if (geometry.curve === 'smooth' && geometry.closed && count < 3) throw new Error('Closed smooth paths require at least three points');
  return count;
}

function flatten(contours: CurveContour[], tolerance: number): PathContour[] {
  if (!(tolerance > 0) || !Number.isFinite(tolerance)) throw new Error('Path tolerance must be finite and positive');
  const segments = contours.reduce((n, c) => n + c.segments.length, 0);
  // Bound work even for extreme zooms; always retain authored segment endpoints.
  const maxDepth = Math.min(12, Math.max(0, Math.floor(Math.log2(MAX_POINTS / Math.max(1, segments)))));
  let total = 0;
  return contours.map(contour => {
    const points: Vec3[] = [];
    const push = (point: Vec3) => {
      if (++total > MAX_POINTS + 2 * contours.length) throw new Error('Tessellated path point limit exceeded (20000)');
      points.push([...point]);
    };
    const distance = (p: Vec3, a: Vec3, b: Vec3) => {
      const delta = b.map((v, i) => v - a[i]);
      const length = delta.reduce((sum, v) => sum + v * v, 0);
      const t = length ? Math.max(0, Math.min(1, delta.reduce((sum, v, i) => sum + v * (p[i] - a[i]), 0) / length)) : 0;
      return p.reduce((sum, v, i) => sum + (v - a[i] - t * delta[i]) ** 2, 0);
    };
    const cubic = (a: Vec3, b: Vec3, c: Vec3, d: Vec3, depth = 0): void => {
      if (depth >= maxDepth || Math.max(distance(b, a, d), distance(c, a, d)) <= tolerance * tolerance) { push(d); return; }
      const ab = mix(a, b, 0.5), bc = mix(b, c, 0.5), cd = mix(c, d, 0.5);
      const abc = mix(ab, bc, 0.5), bcd = mix(bc, cd, 0.5), center = mix(abc, bcd, 0.5);
      cubic(a, ab, abc, center, depth + 1); cubic(center, bcd, cd, d, depth + 1);
    };
    let current = contour.start;
    push(current);
    for (const segment of contour.segments) {
      if (segment.kind === 'line') push(segment.end);
      else cubic(current, segment.c1, segment.c2, segment.end);
      current = segment.end;
    }
    if (contour.closed && !equal(current, contour.start)) push(contour.start);
    return { points, closed: contour.closed };
  });
}

/** Shared with MathJax; preserves command endpoints and each subpath's origin. */
export function flattenSvgPath(source: string, tolerance = 1.2): Vec3[][] {
  return flatten(svgContours(source), tolerance).map(contour => contour.points);
}

export function pathContours(geometry: Geometry, tolerance = 0.002): PathContour[] {
  const key = JSON.stringify([geometry.d, geometry.points, geometry.curve, geometry.closed, tolerance]);
  const cached = flattened.get(key);
  if (cached) return cached;
  const result = flatten(curves(geometry), tolerance);
  return flattened.set(key, result, result.reduce((n, c) => n + c.points.length * 64, 0));
}

/** Compatible authored segments retain their identity; never match sampled vertices. */
export function morphPathContours(from: Geometry, to: Geometry, progress: number, tolerance = 0.002): PathContour[] | null {
  if (from.kind !== 'path' || to.kind !== 'path') return null;
  const sameInput = from.d !== undefined && to.d !== undefined || from.curve === 'smooth' && to.curve === 'smooth';
  if (!sameInput) return null;
  const a = curves(from), b = curves(to);
  if (a.length !== b.length || a.some((c, i) => c.closed !== b[i].closed || c.segments.length !== b[i].segments.length ||
    c.segments.some((s, j) => s.kind !== b[i].segments[j].kind))) return null;
  if (progress <= 0) return pathContours(from, tolerance);
  if (progress >= 1) return pathContours(to, tolerance);
  return flatten(a.map((c, i) => ({ start: mix(c.start, b[i].start, progress), closed: c.closed,
    segments: c.segments.map((s, j): Segment => {
      const target = b[i].segments[j];
      const end = mix(s.end, target.end, progress);
      return s.kind === 'cubic' && target.kind === 'cubic'
        ? { kind: 'cubic', c1: mix(s.c1, target.c1, progress), c2: mix(s.c2, target.c2, progress), end }
        : { kind: 'line', end };
    }),
  })), tolerance);
}
