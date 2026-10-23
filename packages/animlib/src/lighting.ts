import type { CameraState, Frame, SceneLighting, Vec3 } from './types.js';
import { rotate } from './geometry.js';

/** Validate serialized VM output, including unknown options and bounded quality. */
export function validateLighting(value: Frame['lighting']): void {
  if (value === undefined || value === 'studio') return;
  const object = (v: unknown, keys: string[], label: string) => {
    if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).some(k => !keys.includes(k))) throw new Error(`Invalid ${label} options`);
  };
  const range = (v: unknown, min: number, max: number, label: string) => {
    if (v !== undefined && (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max)) throw new Error(`Invalid ${label} range`);
  };
  const vector = (v: unknown, size: number, label: string) => {
    if (!Array.isArray(v) || v.length !== size || !v.every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1e6)) throw new Error(`Invalid ${label}`);
  };
  object(value, ['ambient', 'directional', 'receiver'], 'lighting');
  range(value.ambient, 0, 4, 'ambient');
  const light = value.directional;
  if (light !== undefined) {
    object(light, ['direction', 'space', 'intensity', 'shadow'], 'directional light');
    if (light.direction !== undefined) {
      vector(light.direction, 3, 'light direction');
      if (Math.hypot(...light.direction) < 1e-6) throw new Error('Light direction must be nonzero');
    }
    if (light.space !== undefined && light.space !== 'world' && light.space !== 'camera') throw new Error('Invalid light space');
    range(light.intensity, 0, 4, 'light intensity');
    if (light.shadow !== undefined) {
      object(light.shadow, ['softness', 'quality', 'bias', 'opacity'], 'shadow');
      range(light.shadow.softness, 0, 0.25, 'shadow softness');
      range(light.shadow.bias, 0, 0.05, 'shadow bias');
      range(light.shadow.opacity, 0, 1, 'shadow opacity');
      if (light.shadow.quality !== undefined && !['low', 'medium', 'high'].includes(light.shadow.quality)) throw new Error('Invalid shadow quality');
      if (!value.receiver) throw new Error('Directional shadows require a receiver');
    }
  }
  if (value.receiver !== undefined) {
    const plane = value.receiver;
    object(plane, ['position', 'size', 'fill'], 'shadow receiver');
    if (plane.position !== undefined) vector(plane.position, 3, 'receiver position');
    vector(plane.size, 2, 'receiver size');
    if (plane.size.some(n => n <= 0 || n > 10000)) throw new Error('Receiver size must be in (0,10000]');
    // Palette membership is checked against the host palette at compile/prepare time.
    if (plane.fill !== undefined && (typeof plane.fill !== 'string' || (plane.fill as string) === 'none')) throw new Error('Receiver fill requires an opaque palette token');
  }
}

export function sceneLighting(value: Frame['lighting']): SceneLighting {
  return value && value !== 'studio' ? value : {};
}
const unit = (v: Vec3): Vec3 => { const length = Math.hypot(...v); return v.map(n => n / length) as Vec3; };
/** Direction toward the source in world coordinates, after the effective orbit. */
export function worldLightDirection(value: Frame['lighting'], camera: CameraState): Vec3 {
  const light = sceneLighting(value).directional;
  const direction = unit(light?.direction ?? [-0.4, 0.65, 1]);
  return light?.space === 'world' ? direction : rotate(direction, [camera.pitch, camera.yaw, 0]);
}
/** Two vec4s following the camera's three vec4s; default multipliers are exactly 1. */
export function lightingUniform(value: Frame['lighting'], camera: CameraState): number[] {
  const settings = sceneLighting(value), light = settings.directional;
  // Match the shader's yaw-then-pitch view transform (inverse of camera rotation).
  const world = worldLightDirection(value, camera);
  const direction = light?.space === 'world'
    ? rotate(rotate(world, [0, -camera.yaw, 0]), [-camera.pitch, 0, 0])
    : light?.direction ?? [-0.4, 0.65, 1];
  return [...direction, light?.intensity ?? 1, settings.ambient ?? 1, 0, 0, 0];
}
