import { project, rotate } from './geometry.js';
import { resolveAssetGeometry } from './asset-geometry.js';
import type { AssetGeometryResolver } from './asset-types.js';
import type { CameraState, ElementState, Frame, Ray, Vec3 } from './types.js';

export const add = (a: Vec3, b: Vec3): Vec3 => a.map((v, i) => v + b[i]) as Vec3;
export const sub = (a: Vec3, b: Vec3): Vec3 => a.map((v, i) => v - b[i]) as Vec3;
export const mul = (a: Vec3, n: number): Vec3 => a.map(v => v * n) as Vec3;
export const dot = (a: Vec3, b: Vec3): number => a.reduce((n, v, i) => n + v * b[i], 0);
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
export const unit = (a: Vec3): Vec3 => mul(a, 1 / (Math.hypot(...a) || 1));
export function inverseRotate(p: Vec3, r: Vec3): Vec3 {
  return rotate(rotate(rotate(p, [0, 0, -r[2]]), [0, -r[1], 0]), [-r[0], 0, 0]);
}

/** Matches renderer transforms, including nested uniform scales and rotations. */
export class SpatialFrame {
  readonly elements: Map<string, ElementState>;
  readonly parents = new Map<string, string>();
  constructor(readonly frame: Frame) {
    this.elements = new Map(frame.elements.map(e => [e.id, e]));
    for (const e of frame.elements) for (const child of e.geometry.children ?? []) this.parents.set(child, e.id);
  }
  chain(id: string): ElementState[] {
    const result: ElementState[] = [], seen = new Set<string>();
    while (!seen.has(id)) {
      seen.add(id); const e = this.elements.get(id); if (!e) break;
      result.push(e); const parent = this.parents.get(id); if (!parent) break; id = parent;
    }
    return result;
  }
  world(id: string, point: Vec3 = [0, 0, 0]): Vec3 {
    for (const e of this.chain(id)) point = add(rotate(mul(point, e.scale), e.rotation), e.position);
    return point;
  }
  local(id: string, point: Vec3, parentOnly = false): Vec3 {
    const chain = this.chain(id); if (parentOnly) chain.shift();
    for (const e of chain.reverse()) point = mul(inverseRotate(sub(point, e.position), e.rotation), 1 / (e.scale || 1e-12));
    return point;
  }
  radius(id: string): number {
    const e = this.elements.get(id)!;
    const radius = e.morph && ['sphere', 'circle'].includes(e.morph.to.kind)
      ? (e.morph.from.radius ?? 0.5) * (1-e.morph.progress) + (e.morph.to.radius ?? 0.5) * e.morph.progress
      : e.geometry.radius ?? 0;
    return radius * this.chain(id).reduce((n, e) => n * e.scale, 1);
  }
}

/** Ray through logical viewport coordinates for orthographic, perspective and blended cameras. */
export function cameraRay(x: number, y: number, camera: CameraState, width: number, height: number): Ray {
  const cx = (x-width/2)*camera.height/height, cy = (height/2-y)*camera.height/height;
  const p = camera.perspective, z = camera.distance - 0.01;
  const divisor = 1 - p*z/camera.distance;
  const origin: Vec3 = [cx*divisor, cy*divisor, z];
  const direction: Vec3 = [cx*p/camera.distance, cy*p/camera.distance, -1];
  const turn = (v: Vec3) => rotate(v, [camera.pitch, camera.yaw, 0]);
  return { origin: add(turn(origin), camera.target), direction: unit(turn(direction)) };
}
export function planePoint(ray: Ray, point: Vec3, normal: Vec3): Vec3 | undefined {
  const denominator = dot(ray.direction, normal); if (Math.abs(denominator) < 1e-8) return;
  const t = dot(sub(point, ray.origin), normal) / denominator;
  if (t < 0) return;
  return add(ray.origin, mul(ray.direction, t));
}

/** Built-in hit shapes: spheres, planar circles/rectangles and triangle meshes. */
export function pick(frame: Frame, ray: Ray, targets: Set<string>, camera: CameraState, width: number, height: number, view?: string, screenPoint?: [number, number], assetGeometry?:AssetGeometryResolver): { id: string; element: string; point: Vec3; distance: number } | undefined {
  const space = new SpatialFrame(frame);
  let best: { id: string; element: string; point: Vec3; distance: number } | undefined;
  for (const element of frame.elements) {
    if (element.view !== view || element.geometry.kind === 'group') continue;
    const chain = space.chain(element.id);
    const target = chain.find(e => targets.has(e.id));
    if (!target || chain.reduce((a, e) => a * e.opacity, 1) < 0.01 || chain.some(e => e.scale === 0)) continue;
    const screen = element.space === 'screen';
    const offset = chain.reduce((a, e) => [a[0]+(e.viewportOffset?.[0] ?? 0), a[1]+(e.viewportOffset?.[1] ?? 0)], [0, 0]);
    let r = ray;
    if (screenPoint) {
      const x = screenPoint[0]-offset[0]*width, y = screenPoint[1]+offset[1]*height;
      r = screen ? { origin: [x-width/2, height/2-y, 1e6], direction: [0, 0, -1] } : cameraRay(x, y, camera, width, height);
    } else if (screen) continue;
    const toLocal = (p: Vec3): Vec3 => {
      if (!element.billboard || screen) return space.local(element.id, p);
      const scale = chain.reduce((n, e) => n * e.scale, 1);
      const local = sub(inverseRotate(sub(p, space.world(element.id)), [camera.pitch, camera.yaw, 0]), element.billboardOffset ?? [0, 0, 0]);
      return mul(inverseRotate(local, [0, 0, element.rotation[2]]), 1/scale);
    };
    const o = toLocal(r.origin), d = sub(toLocal(add(r.origin, r.direction)), o);
    let t = Infinity;
    const g = resolveAssetGeometry(element.geometry,assetGeometry);
    if (g.kind === 'sphere') {
      const radius = space.radius(element.id)/chain.reduce((n, e) => n * e.scale, 1);
      const a = dot(d,d), b = dot(o,d), c = dot(o,o)-radius*radius, discriminant = b*b-a*c;
      if (discriminant >= 0 && a > 0) { const near = (-b-Math.sqrt(discriminant))/a, far = (-b+Math.sqrt(discriminant))/a; t = near >= 0 ? near : far; }
    } else if (g.kind === 'circle' || g.kind === 'rectangle') {
      if (Math.abs(d[2]) > 1e-10) {
        const distance = -o[2]/d[2], p = add(o, mul(d, distance));
        const dimension = (key: 'radius' | 'width' | 'height', fallback: number): number => {
          const m = element.morph;
          return m && m.from.kind === g.kind && m.to.kind === g.kind
            ? (m.from[key] ?? fallback)*(1-m.progress)+(m.to[key] ?? fallback)*m.progress
            : g[key] ?? fallback;
        };
        // Match outline() defaults for raw morph geometry, not builder option defaults.
        const inside = g.kind === 'circle' ? p[0]**2+p[1]**2 <= dimension('radius', 1)**2 : Math.abs(p[0]) <= dimension('width', 2)/2 && Math.abs(p[1]) <= dimension('height', 1)/2;
        if (inside) t = distance;
      }
    } else if (g.kind === 'model') {
      const bounds=g.model!.bounds;let near=0,far=Infinity;
      for(let axis=0;axis<3;axis++) {
        if(Math.abs(d[axis])<1e-12) { if(o[axis]<bounds.min[axis]||o[axis]>bounds.max[axis]){near=Infinity;break;} }
        else {const a=(bounds.min[axis]-o[axis])/d[axis],b=(bounds.max[axis]-o[axis])/d[axis];near=Math.max(near,Math.min(a,b));far=Math.min(far,Math.max(a,b));}
      }
      if(near<=far)t=near;
    } else if (g.kind === 'mesh') {
      for (const indices of g.triangles ?? []) {
        const [a,b,c] = indices.map(i => { const p = g.vertices![i]; return [p[0],p[1],p[2] ?? 0] as Vec3; });
        const e1 = sub(b,a), e2 = sub(c,a), h = cross(d,e2), det = dot(e1,h); if (Math.abs(det) < 1e-10) continue;
        const s = sub(o,a), u = dot(s,h)/det, q = cross(s,e1), v = dot(d,q)/det, distance = dot(e2,q)/det;
        if (u >= 0 && v >= 0 && u+v <= 1 && distance >= 0) t = Math.min(t, distance);
      }
    }
    if (t < 0 || !Number.isFinite(t)) continue;
    const point = add(r.origin, mul(r.direction, t));
    if (!screen && !project(point, camera, width, height).visible) continue;
    const distance = screen ? -1e6 : t;
    if (!best || distance <= best.distance) best = { id: target.id, element: element.id, point, distance };
  }
  return best;
}
