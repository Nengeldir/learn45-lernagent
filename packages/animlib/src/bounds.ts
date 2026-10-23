import { buildDrawItems } from './render-geometry.js';
import { paletteResolver } from './palette.js';
import { cameraPoint, clip, projectedTriangle } from './projection.js';
import { SpatialFrame } from './spatial.js';
import { VERTEX_FLOATS } from './texture-shader.js';
import type { Bounds2D, Bounds3D, BoundsOptions, CameraState, ElementState, Frame, Geometry, ScreenBoundsOptions, Vec2, Vec3 } from './types.js';

function dimensions(options: BoundsOptions): [number, number] {
  const width = options.width ?? 800, height = options.height ?? 450;
  if (![width, height].every(n => Number.isFinite(n) && n > 0)) throw new Error('Bounds require positive finite width and height.');
  return [width, height];
}

function selection(frame: Frame, id: string): { root: ElementState; ids: Set<string> } | undefined {
  const elements = new Map(frame.elements.map(e => [e.id, e])), root = elements.get(id);
  if (!root) return;
  const ids = new Set<string>();
  const visit = (id: string): void => {
    if (ids.has(id)) return;
    ids.add(id);
    for (const child of elements.get(id)?.geometry.children ?? []) visit(child);
  };
  visit(id);
  return { root, ids };
}

function cameraFor(frame: Frame, root: ElementState, options: BoundsOptions): CameraState {
  const camera = options.camera ?? (root.view === undefined ? frame.camera : frame.views?.find(v => v.id === root.view)?.camera);
  if (!camera) throw new Error(`Unknown bounds view: ${root.view}`);
  if (![camera.yaw, camera.pitch, ...camera.target, camera.height, camera.distance, camera.perspective].every(Number.isFinite)
    || camera.height <= 0 || camera.distance <= 0) throw new Error('Bounds require a finite camera with positive height and distance.');
  return camera;
}

/** Ignore visibility for layout, while retaining paint selection and morph endpoint fades. */
function presentation(frame: Frame, options: BoundsOptions): Frame {
  if (!options.includeInvisible) return frame;
  const geometry = (g: Geometry): Geometry => g.texture ? { ...g, texture: { ...g.texture,
    color: typeof g.texture.color === 'string' ? g.texture.color : g.texture.color.color,
  } } : g;
  return { ...frame, elements: frame.elements.map(e => ({
    ...e, opacity: 1,
    fill: typeof e.fill === 'string' ? e.fill : e.fill.color,
    stroke: typeof e.stroke === 'string' ? e.stroke : e.stroke.color,
    geometry: geometry(e.geometry),
    ...(e.morph ? { morph: { ...e.morph, from: geometry(e.morph.from), to: geometry(e.morph.to) } } : {}),
  })) };
}

function nondegenerate([a, b, c]: Vec3[]): boolean {
  const u = b.map((v, i) => v - a[i]), v = c.map((x, i) => x - a[i]);
  return Math.hypot(u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]) > 0;
}

function triangles(frame: Frame, ids: Set<string>, root: ElementState, camera: CameraState, width: number, height: number, options: BoundsOptions,
  consume: (triangle: Vec3[], screen: boolean, offset: Vec2) => void): void {
  for (const item of buildDrawItems(presentation(frame, options), camera, width, height, paletteResolver(options.palette), root.view, false, undefined, ids, options.assetGeometry)) {
    if (options.includeStroke === false && item.component === 'stroke') continue;
    const data = item.vertices;
    for (let i = 0; i < data.length; i += 3 * VERTEX_FLOATS) {
      const triangle: Vec3[] = [0, VERTEX_FLOATS, 2 * VERTEX_FLOATS].map(j => [data[i+j], data[i+j+1], data[i+j+2]]);
      if (triangle.every(p => p.every(Number.isFinite)) && nondegenerate(triangle)) consume(triangle, item.screen, [data[i+13], data[i+14]]);
    }
  }
}

function spatialBounds(frame: Frame, id: string, space: 'local' | 'world' | 'camera', options: BoundsOptions): Bounds3D | undefined {
  const [width, height] = dimensions(options), selected = selection(frame, id);
  if (!selected) return;
  const { root, ids } = selected;
  const members = frame.elements.filter(e => ids.has(e.id) && e.geometry.kind !== 'group');
  if (new Set(members.map(e => e.space)).size > 1) throw new Error('Mixed world/screen groups require getScreenBounds.');
  if (space !== 'local' && members.some(e => e.space === 'screen')) return;
  const camera = cameraFor(frame, root, options);
  if (space === 'local') {
    // Rebase the subtree rather than inverting a potentially zero scale. Local
    // bounds describe authored axes, so camera-facing rotations do not apply.
    const opacity = new SpatialFrame(frame).chain(id).reduce((n, e) => n * e.opacity, 1);
    frame = { ...frame, elements: frame.elements.filter(e => ids.has(e.id)).map(e => ({
      ...e, billboard: false,
      ...(e.id === id ? { position: [0, 0, 0] as Vec3, rotation: [0, 0, 0] as Vec3, scale: 1, opacity } : {}),
    })) };
  }
  let result: Bounds3D | undefined;
  triangles(frame, ids, root, camera, width, height, options, points => {
    for (const point of points) {
      const p = space === 'camera' ? cameraPoint(point, camera) : point;
      if (!result) result = { min: [...p], max: [...p] };
      else for (let axis = 0; axis < 3; axis++) {
        result.min[axis] = Math.min(result.min[axis], p[axis]);
        result.max[axis] = Math.max(result.max[axis], p[axis]);
      }
    }
  });
  return result;
}

/** Painted geometry in the element's own axes, including group descendants. */
export function getLocalBounds(frame: Frame, id: string, options: BoundsOptions = {}): Bounds3D | undefined {
  return spatialBounds(frame, id, 'local', options);
}

/** Unclipped painted geometry after ancestor transforms. Screen elements have no world bounds. */
export function getWorldBounds(frame: Frame, id: string, options: BoundsOptions = {}): Bounds3D | undefined {
  return spatialBounds(frame, id, 'world', options);
}

/** Unclipped camera X/Y and positive depth from the eye; screen elements have no camera bounds. */
export function getCameraBounds(frame: Frame, id: string, options: BoundsOptions = {}): Bounds3D | undefined {
  return spatialBounds(frame, id, 'camera', options);
}

/** Projected painted geometry in full-canvas CSS pixels, including view and viewport offsets. */
export function getScreenBounds(frame: Frame, id: string, options: ScreenBoundsOptions): Bounds2D | undefined {
  if (!options || options.width === undefined || options.height === undefined) throw new Error('Screen bounds require canvas width and height.');
  const [canvasWidth, canvasHeight] = dimensions(options), selected = selection(frame, id);
  if (!selected) return;
  const { root, ids } = selected, camera = cameraFor(frame, root, options);
  const region = root.view === undefined ? undefined : frame.views?.find(v => v.id === root.view);
  if (root.view !== undefined && !region) throw new Error(`Unknown bounds view: ${root.view}`);
  const [left, top, w, h] = region?.rect ?? [0, 0, 1, 1];
  if (![left, top, w, h].every(Number.isFinite) || w < 0 || h < 0) throw new Error('Bounds require a finite view rectangle with nonnegative dimensions.');
  if (w === 0 || h === 0) return;
  const width = w * canvasWidth, height = h * canvasHeight;
  let result: Bounds2D | undefined;
  triangles(frame, ids, root, camera, width, height, options, (points, screen, offset) => {
    let projected = projectedTriangle(points, screen, camera, width, height, offset, options.clip !== false)
      .map(([x, y]): Vec2 => [x + left * canvasWidth, y + top * canvasHeight]);
    if (options.clip !== false) projected = clip(clip(clip(clip(projected, p => p[0]), p => canvasWidth-p[0]), p => p[1]), p => canvasHeight-p[1]);
    if (!projected.every(p => p.every(Number.isFinite)) || projected.length < 3) return;
    const [x, y] = projected[0];
    const area = projected.reduce((sum, p, i) => { const q = projected[(i+1)%projected.length]; return sum + (p[0]-x)*(q[1]-y)-(q[0]-x)*(p[1]-y); }, 0);
    if (area === 0) return;
    for (const [x, y] of projected) {
      if (!result) result = { left: x, top: y, right: x, bottom: y };
      else {
        result.left = Math.min(result.left, x); result.right = Math.max(result.right, x);
        result.top = Math.min(result.top, y); result.bottom = Math.max(result.bottom, y);
      }
    }
  });
  return result;
}
