import { rotate } from './geometry.js';
import type { CameraState, Vec2, Vec3 } from './types.js';

/** Camera X/Y with positive Y up; Z is positive depth from the eye. */
export function cameraPoint(point: Vec3, camera: CameraState): Vec3 {
  const [x, y, z] = cameraCoordinates(point, camera);
  return [x, y, camera.distance - z];
}

function cameraCoordinates(point: Vec3, camera: CameraState): Vec3 {
  return rotate(rotate(point.map((v, i) => v - camera.target[i]) as Vec3, [0, -camera.yaw, 0]), [-camera.pitch, 0, 0]);
}

/** Clip a convex polygon against a half-plane; retains positive-area intersections. */
export function clip<P extends number[]>(points: P[], distance: (point: P) => number): P[] {
  const result: P[] = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length], da = distance(a), db = distance(b);
    if (da >= 0) result.push(a);
    if ((da >= 0) !== (db >= 0)) {
      const t = da / (da - db);
      result.push(a.map((v, axis) => v + (b[axis] - v) * t) as P);
    }
  }
  return result;
}
export function projectedTriangle(points: Vec3[], screen: boolean, camera: CameraState, width: number, height: number, offset: Vec2, clipToViewport = true): Vec2[] {
  let projected: Vec2[];
  if (screen) projected = points.map(p => [width / 2 + p[0], height / 2 - p[1]]);
  else {
    const perspective = Math.max(0, Math.min(1, camera.perspective));
    let local = points.map(p => cameraCoordinates(p, camera));
    // Clip before division: a triangle crossing the near plane still contributes visible ink.
    local = clip(local, p => camera.distance - p[2] - 0.01);
    local = clip(local, p => camera.distance * 100 - (camera.distance - p[2]));
    projected = local.map(p => {
      const divisor = 1 - perspective + perspective * (camera.distance - p[2]) / camera.distance;
      const scale = height / camera.height / divisor;
      return [width / 2 + p[0] * scale, height / 2 - p[1] * scale];
    });
  }
  projected = projected.map(([x, y]) => [x + offset[0] * width, y - offset[1] * height]);
  if (!clipToViewport) return projected;
  // The renderer clips each view independently, including screen-space elements in that view.
  projected = clip(projected, p => p[0]);
  projected = clip(projected, p => width - p[0]);
  projected = clip(projected, p => p[1]);
  return clip(projected, p => height - p[1]);
}
