import { getLocalBounds } from './bounds.js';
import { GeometryCache } from './cache.js';
import { rotate } from './geometry.js';
import { add, inverseRotate, mul, SpatialFrame, sub } from './spatial.js';
import type { Bounds3D, ElementState, Vec3 } from './types.js';

const boundsCache = new GeometryCache<Bounds3D | null>();
const isLabel = (e: ElementState): boolean => e.geometry.kind === 'latex' || e.geometry.kind === 'text';

/** Measure the same glyph geometry as the renderer, including named-part morphs.
 * Cache in local coordinates so moving/scaling a label does not tessellate it again. */
function labelBounds(space: SpatialFrame, e: ElementState): Bounds3D | undefined {
  const key = JSON.stringify([e.space, e.geometry, e.morph]);
  const cached = boundsCache.get(key);
  if (cached !== undefined) return cached ?? undefined;
  const geometry = { ...e.geometry, labelOcclusion: 'depth' as const };
  const label: ElementState = { ...e, geometry, view: undefined, viewportOffset: undefined,
    fill: 'WHITE', stroke: 'none', opacity: 1,
    ...(e.morph ? { morph: { ...e.morph,
      from: { ...e.morph.from, labelOcclusion: 'depth' },
      to: { ...e.morph.to, labelOcclusion: 'depth' },
    } } : {}),
  };
  const bounds = getLocalBounds({ ...space.frame, elements: [label] }, e.id);
  return boundsCache.set(key, bounds ?? null, 128) ?? undefined;
}

export interface ConnectorLabel {
  center: Vec3;
  padding: number;
  /** Distance along a unit world-space ray to the label rectangle's exit. */
  trim(origin: Vec3, direction: Vec3, padding: number): number;
}

export function connectorLabel(space: SpatialFrame, id: string): ConnectorLabel | undefined {
  const e = space.elements.get(id)!;
  if (!isLabel(e)) return;
  const bounds = labelBounds(space, e);
  if (!bounds) return;
  const scale = space.chain(id).reduce((n, state) => n * state.scale, 1);
  if (Math.abs(scale) < 1e-12) return;
  const camera = (e.view === undefined ? space.frame.camera : space.frame.views?.find(v => v.id === e.view)?.camera)!;
  const billboard = e.billboard && e.space !== 'screen';
  const angles: Vec3 = [camera.pitch, camera.yaw, 0];
  const offset = e.billboardOffset ?? [0, 0, 0];
  const world = (p: Vec3): Vec3 => billboard
    ? add(space.world(id), rotate(add(rotate(mul(p, scale), [0, 0, e.rotation[2]]), offset), angles))
    : space.world(id, p);
  const local = (p: Vec3): Vec3 => billboard
    ? mul(inverseRotate(sub(inverseRotate(sub(p, space.world(id)), angles), offset), [0, 0, e.rotation[2]]), 1 / scale)
    : space.local(id, p);
  return {
    center: world(mul(add(bounds.min, bounds.max), 0.5)),
    padding: (bounds.max[1] - bounds.min[1]) * Math.abs(scale) * 0.15,
    trim(origin, direction, padding) {
      const p = local(origin), d = sub(local(add(origin, direction)), p);
      const gap = padding / Math.abs(scale);
      let near = 0, far = Infinity;
      // Labels are planar. Clip in their own XY axes, including rotated groups
      // and camera-facing labels, rather than against an oversized world AABB.
      for (const axis of [0, 1]) {
        const low = bounds.min[axis] - gap, high = bounds.max[axis] + gap;
        if (Math.abs(d[axis]) < 1e-12) {
          if (p[axis] < low || p[axis] > high) return 0;
        } else {
          const a = (low - p[axis]) / d[axis], b = (high - p[axis]) / d[axis];
          near = Math.max(near, Math.min(a, b));
          far = Math.min(far, Math.max(a, b));
        }
      }
      return near <= far ? Math.max(0, far) : 0;
    },
  };
}
