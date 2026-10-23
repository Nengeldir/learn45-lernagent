import type { ModelMaterial } from './models.js';
import { vec3 } from './geometry.js';
import type { CameraState, ElementState, Frame, Geometry, Vec3 } from './types.js';
import type { GeometryDrawItem } from './render-geometry.js';
import { VERTEX_FLOATS } from './texture-shader.js';
import type { ImageBinding } from './composition.js';

/** Geometry is immutable once submitted; backends key resources by this identity. */
export interface RetainedMesh {
  imageBinding?:ImageBinding;
  modelMaterial?: ModelMaterial;
  vertices: Float32Array<ArrayBuffer>;
  indices: Uint32Array<ArrayBuffer>;
  centers: Vec3[];
  /** Absolute local position bounds, used before submitting float32 transforms. */
  magnitude: Vec3;
  component: GeometryDrawItem['component'];
}
export const INSTANCE_FLOATS = 20;
export const MAX_INSTANCES = 32;
const FLOAT32_MIN_NORMAL = 2**-126, FLOAT32_MAX = (2-2**-23)*2**127;
const ROUNDING_UNIT = 2**-24;
// GPUs may flush subnormal inputs/results to zero. Relative roundoff alone
// cannot bound that error. Reserve an absolute allowance for the affine dot
// products and subsequent camera arithmetic, including cancellation to zero.
const FLUSH_ERROR = 32*FLOAT32_MIN_NORMAL;
export function normalFloat32(value: number): boolean {
  return value === 0 || Math.abs(value) >= FLOAT32_MIN_NORMAL && Math.abs(value) <= FLOAT32_MAX;
}
// Column-major affine transform; layer, signed uniform scale, viewport offset.
export const IDENTITY_INSTANCE = new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1, 0,1,0,0]);

/** Central opt-out for tessellation that depends on projected scale or camera.
 * New camera/scene-dependent geometry features must join this predicate (or pass
 * no retention cache to buildDrawItems), rather than caching their derived state.
 */
export function cameraDependentGeometry(geometry: Geometry): boolean {
  return ['clipPlanes','outline','scalarColors','labelOcclusion'].some(key => key in geometry)
    || geometry.kind === 'path' && (geometry.d !== undefined || geometry.curve === 'smooth');
}
export function retainableElement(element: ElementState): boolean {
  return !element.morph && !cameraDependentGeometry(element.geometry)
    && !(element.geometry.kind === 'mesh' && element.stroke !== 'none' && element.strokeWidth > 0);
}

/** Deduplicate complete vertices, including normals/UVs: hard edges remain split. */
export function indexGeometry(items: GeometryDrawItem[]): RetainedMesh {
  const values: number[] = [], indices: number[] = [], unique = new Map<string, number>();
  const centers: Vec3[] = [], magnitude: Vec3 = [0,0,0];
  for (const item of items) {
    const center: Vec3 = [0,0,0];
    let count = 0;
    for (let i = 0; i < item.vertices.length; i += VERTEX_FLOATS) {
      const vertex = item.vertices.subarray(i, i + VERTEX_FLOATS);
      const key = vertex.join(',');
      let index = unique.get(key);
      if (index === undefined) { index = values.length / VERTEX_FLOATS; unique.set(key, index); values.push(...vertex); }
      indices.push(index);
      for (let axis = 0; axis < 3; axis++) {
        center[axis] += vertex[axis];
        magnitude[axis] = Math.max(magnitude[axis], Math.abs(vertex[axis]));
      }
      count++;
    }
    if (count) for (let axis = 0; axis < 3; axis++) center[axis] /= count;
    centers.push(center);
  }
  return { imageBinding: items[0]?.imageBinding, modelMaterial: items[0]?.modelMaterial, vertices: new Float32Array(values), indices: new Uint32Array(indices), centers, magnitude, component: items[0]?.component ?? 'fill' };
}

/** Narrowing local coordinates and a compensating transform separately can erase
 * detail that the double-precision CPU world transform preserves. Bound that
 * additional error before GPU submission, using cached local magnitudes rather
 * than walking every vertex on camera-only frames. Precision-sensitive elements
 * stream through the original world packing path, including authored texture UVs.
 */
export function retainedPrecisionSafe(meshes: RetainedMesh[], origin: Vec3, basis: Vec3[], instance: Float32Array, camera: CameraState, height: number, screen: boolean): boolean {
  // A finite double-precision product does not imply a representable GPU
  // transform: tiny local coordinates may compensate for a scale above FLT_MAX.
  // Check the actual packed matrix AND metadata (including the normal divisor).
  if (!instance.every(normalFloat32) || instance[17] === 0
    || !origin.every(normalFloat32) || !basis.every(axis=>axis.every(normalFloat32))) return false;
  // Normal dot-product underflow is amplified by division by the object scale.
  // Stream if that absolute error could exceed one normal float32 rounding unit.
  if (FLUSH_ERROR/Math.abs(instance[17]) > ROUNDING_UNIT) return false;
  // Shader division may lower to multiplication by an approximate reciprocal.
  // A large *normal* scale can then erase a finite normal numerator. Keep the
  // reciprocal above the subnormal boundary, with the same roundoff margin.
  if (1/Math.abs(instance[17]) < FLOAT32_MIN_NORMAL*(1+8*ROUNDING_UNIT)) return false;
  const local: Vec3 = [0,0,0];
  for (const mesh of meshes) for (let axis=0;axis<3;axis++) local[axis]=Math.max(local[axis],mesh.magnitude[axis]);
  const extent=origin.map((_,axis)=>local.reduce((sum,v,i)=>sum+v*Math.abs(basis[i][axis]),0)) as Vec3;
  // Bound intermediate sums too, even if their final value would cancel. Local
  // normals are unit vectors; their transformed dot products use the same basis.
  if (extent.some((v,i)=>v+Math.abs(origin[i]) > FLOAT32_MAX/(1+8*ROUNDING_UNIT))
    || origin.some((_,i)=>basis.reduce((sum,axis)=>sum+Math.abs(axis[i]),0) > FLOAT32_MAX/(1+8*ROUNDING_UNIT))) return false;
  // Eight float32 roundoff units cover input/basis narrowing and the affine
  // multiply-adds, including a small margin for the already-rounded bounds.
  const error=8*ROUNDING_UNIT*Math.hypot(...extent.map((v,i)=>v+Math.abs(origin[i])))+FLUSH_ERROR;
  let pixelsPerUnit=1;
  if (!screen) {
    const sy=Math.sin(camera.yaw),cy=Math.cos(camera.yaw),sp=Math.sin(camera.pitch),cp=Math.cos(camera.pitch);
    const depthAxis: Vec3 = [-sy*cp,sp,-cy*cp];
    const delta=origin.map((v,i)=>v-camera.target[i]);
    const centerDepth=camera.distance+delta.reduce((sum,v,i)=>sum+v*depthAxis[i],0);
    const depthRadius=extent.reduce((sum,v,i)=>sum+v*Math.abs(depthAxis[i]),0);
    const far=camera.distance*100,range=far-0.01;
    // Include camera/clip arithmetic roundoff, including GL's [0,w] -> [-w,w]
    // conversion. A subpixel position bound alone cannot protect visibility at
    // a clipping discontinuity. Layer bias moves both depth clipping planes.
    const depthError=error+8*2**-24*(far+Math.hypot(...delta)+Math.hypot(...camera.target));
    const nearestDepth=centerDepth-depthRadius-depthError,farthestDepth=centerDepth+depthRadius+depthError;
    const layerBias=instance[16]*0.00000002*range;
    if ([0.01+layerBias,far+layerBias].some(plane=>nearestDepth<=plane && farthestDepth>=plane)) return false;
    // Match the shader's homogeneous w, without project()'s UI-only .01 floor.
    // Nonpositive/uncertain w also uses CPU packing, even for clipped geometry.
    const perspective=camera.perspective;
    const divisor=1-perspective+perspective*nearestDepth/camera.distance;
    if (!(divisor>0)) return false;
    // Perspective depth error also moves projected x/y; bound that amplification
    // over the whole local box, including near-plane intersections.
    const radius=Math.hypot(...delta.map((v,i)=>Math.abs(v)+extent[i]));
    pixelsPerUnit=height/camera.height/divisor*(1+perspective*radius/(camera.distance*divisor));
  }
  return Number.isFinite(error*pixelsPerUnit) && error*pixelsPerUnit <= 1/64;
}

/** Content keys survive fresh evaluated frames and catch in-place author edits.
 * Only the active frame's working set survives endFrame; changes release GPU
 * handles on the same frame through each backend's resource sweep.
 */
export class RetainedGeometry {
  private meshes = new Map<string, RetainedMesh[] | null>();
  private used = new Set<string>();
  private previous = new Map<string,string>();
  private current = new Map<string,string>();
  beginFrame(): void { this.used.clear(); this.current.clear(); }
  endFrame(): void {
    for (const key of this.meshes.keys()) if (!this.used.has(key)) this.meshes.delete(key);
    this.previous = this.current; this.current = new Map();
  }
  clear(): void { this.meshes.clear(); this.used.clear(); this.previous.clear(); this.current.clear(); }
  get(key: string, build: () => GeometryDrawItem[], combine = false, slot?: string): RetainedMesh[] | undefined {
    if (slot !== undefined) {
      const previous = this.previous.get(slot); this.current.set(slot,key);
      // A changing geometry/style stream must not pay indexing + allocation on
      // every frame. A stable subsequent sample promotes it back to retention.
      if (previous !== undefined && previous !== key && !this.meshes.has(key)) return;
    }
    this.used.add(key);
    if (!this.meshes.has(key)) {
      const items = build();
      this.meshes.set(key, items.some(item => item.transparent || item.cameraDependentGeometry || item.retentionUnsafe) ? null : combine && items.length ? [indexGeometry(items)] : items.map(item => indexGeometry([item])));
    }
    return this.meshes.get(key) ?? undefined;
  }
}

/** Shadows and occlusion inspection consume final world-space triangles. */
export function retentionForFrame(frame: Frame): boolean {
  const lighting = (frame as Frame & { lighting?: { receiver?: unknown } }).lighting;
  if (lighting?.receiver) return false;
  const dependentLabel = (geometry: Geometry): boolean => {
    if (geometry.kind !== 'text' && geometry.kind !== 'latex') return false;
    const mode = (geometry as Geometry & { labelOcclusion?: string }).labelOcclusion;
    return mode !== undefined && mode !== 'depth';
  };
  return !frame.elements.some(element => element.space === 'world' &&
    (dependentLabel(element.geometry) || Boolean(element.morph &&
      (dependentLabel(element.morph.from) || dependentLabel(element.morph.to)))));
}

/** Canonical round two-point bonds/arrows share geometry across translations and
 * orientations. Match geometry.ts's radial seam exactly, including vertical axes.
 * Sphere radius is a GPU scale when there are no object-coordinate textures.
 */
export function canonicalPrimitive(element: ElementState): { geometry: Geometry; origin: Vec3; axes: Vec3[]; scale: number } {
  const identity = { geometry: element.geometry, origin: [0,0,0] as Vec3, axes: [[1,0,0],[0,1,0],[0,0,1]] as Vec3[], scale: 1 };
  const g = element.geometry;
  if (g.kind === 'sphere' && !g.texture && (g.radius ?? 1) > 0) {
    const radius = g.radius ?? 1;
    return { ...identity, geometry: { ...g, radius: 1 }, axes: identity.axes.map(p => p.map(v => v*radius) as Vec3), scale: radius };
  }
  if (element.strokeProfile !== 'round' || !['line','arrow'].includes(g.kind) || g.points?.length !== 2) return identity;
  const a = vec3(g.points[0]), b = vec3(g.points[1]);
  const delta = b.map((v,i) => v-a[i]) as Vec3, length = Math.hypot(...delta);
  if (length < 1e-10) return identity;
  const axis = delta.map(v => v/length) as Vec3, reference: Vec3 = [0,0,0];
  reference[axis.map(Math.abs).indexOf(Math.min(...axis.map(Math.abs)))] = 1;
  const cross = (a: Vec3,b: Vec3): Vec3 => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const radial = cross(axis,reference), magnitude = Math.hypot(...radial), u = radial.map(v => v/magnitude) as Vec3, v = cross(axis,u);
  return { geometry: { ...g, points: [[0,0,0],[0,0,length]] }, origin: a, axes: [v.map(n => -n) as Vec3,u,axis], scale: 1 };
}
