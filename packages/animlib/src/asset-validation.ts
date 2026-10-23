import { validateImageGeometry } from './image-validation.js';
import type { Bounds3D, Geometry, Vec3 } from './types.js';
import type { PreparedModelInput, ModelAssetDescriptor } from './asset-types.js';

export const ASSET_LIMITS = Object.freeze({ models: 128, parts: 128, vertices: 20000, triangles: 20000,
  modelBytes: 32 * 1024 * 1024, registryBytes: 256 * 1024 * 1024, catalogBytes: 256000 });
export function assetCheck(value: unknown, message: string): asserts value { if (!value) throw new Error(`Asset: ${message}`); }
export function assetId(value: unknown): asserts value is string {
  assetCheck(typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(value), 'invalid ID');
}
export function assetHash(value: unknown): asserts value is string {
  assetCheck(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value), 'invalid SHA-256');
}
export function assetKeys(value: object, keys: string[]): void {
  assetCheck(Object.keys(value).every(key=>keys.includes(key)), 'unsupported property or unresolved dependency');
}
export function freezeAsset<T>(value: T): T {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freezeAsset(child); Object.freeze(value); }
  return value;
}
/** Canonical JSON is shared by package tools and browser registry identity. */
export function canonicalAssetJSON(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') { assetCheck(Number.isFinite(value), 'nonfinite content'); return JSON.stringify(value); }
  if (Array.isArray(value)) return '[' + value.map(canonicalAssetJSON).join(',') + ']';
  assetCheck(value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype, 'non-JSON content');
  return '{' + Object.keys(value).filter(key => (value as Record<string, unknown>)[key] !== undefined).sort()
    .map(key => JSON.stringify(key) + ':' + canonicalAssetJSON((value as Record<string, unknown>)[key])).join(',') + '}';
}
export async function hashAssetBytes(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2,'0')).join('');
}
export async function hashAssetContent(value: unknown): Promise<string> { return hashAssetBytes(new TextEncoder().encode(canonicalAssetJSON(value))); }
export function validateAssetProvenance(model: Pick<PreparedModelInput, 'units' | 'provenance'>): void {
  assetCheck(typeof model.units === 'string' && model.units.trim().length > 0 && model.units.length <= 256, 'missing units');
  const p = model.provenance;
  assetCheck(p && typeof p === 'object', 'missing provenance');
  for (const key of ['source','creator','license','preparedAt','selection','fidelity'] as const)
    assetCheck(typeof p[key] === 'string' && p[key].trim().length > 0 && p[key].length <= 8192, `missing or invalid provenance ${key}`);
  assetCheck(p.license.toLowerCase() !== 'unknown', 'unknown license is not permission to reuse');
  assetHash(p.sourceHash);
  assetCheck(/^\d{4}-\d{2}-\d{2}/.test(p.preparedAt) && Number.isFinite(Date.parse(p.preparedAt)), 'invalid preparation date');
  assetCheck(p.converter && typeof p.converter.name === 'string' && p.converter.name.length > 0 && typeof p.converter.version === 'string' && p.converter.version.length > 0, 'missing converter');
  assetCheck(p.converter.options && typeof p.converter.options === 'object' && !Array.isArray(p.converter.options), 'invalid converter options');
  assetCheck(Array.isArray(p.modifications) && p.modifications.length <= 128 && p.modifications.every(m => typeof m === 'string' && m.length <= 8192), 'invalid modifications');
  assetCheck(canonicalAssetJSON(p).length <= 65536, 'provenance size limit exceeded');
}
function bounds(vertices: Vec3[]): Bounds3D {
  const min: Vec3 = [...vertices[0]], max: Vec3 = [...vertices[0]];
  for (const point of vertices) for (let axis=0;axis<3;axis++) { min[axis]=Math.min(min[axis],point[axis]); max[axis]=Math.max(max[axis],point[axis]); }
  return { min, max };
}
export function validatePreparedModel(input: PreparedModelInput): { model: PreparedModelInput; descriptor: Omit<ModelAssetDescriptor,'hash'>; meshes: Map<string,Geometry>; bytes: number } {
  assetCheck(input && input.kind === 'model' && input.version === 1, 'unsupported model version or kind');
  assetKeys(input, ['id','kind','version','units','provenance','parts']);
  assetId(input.id); validateAssetProvenance(input);
  assetCheck(Array.isArray(input.parts) && input.parts.length > 0 && input.parts.length <= ASSET_LIMITS.parts, 'model part limit exceeded');
  const ids = new Set<string>(); let bytes = 0;
  for (const part of input.parts) {
    assetKeys(part, ['id','vertices','triangles','normals','uv0','imageTexture']);
    assetId(part.id); assetCheck(!ids.has(part.id), 'duplicate part ID'); ids.add(part.id);
    assetCheck(Array.isArray(part.vertices) && part.vertices.length > 0 && part.vertices.length <= ASSET_LIMITS.vertices, 'vertex count limit exceeded');
    assetCheck(Array.isArray(part.triangles) && part.triangles.length > 0 && part.triangles.length <= ASSET_LIMITS.triangles, 'triangle count limit exceeded');
    for (const point of part.vertices) assetCheck(Array.isArray(point) && point.length === 3 && Array.from(point).every(v => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e6), 'invalid coordinates');
    for (const face of part.triangles) assetCheck(Array.isArray(face) && face.length === 3 && Array.from(face).every(v => Number.isInteger(v) && v >= 0 && v < part.vertices.length), 'invalid indices');
    if (part.normals !== undefined) {
      assetCheck(Array.isArray(part.normals) && part.normals.length === part.vertices.length, 'normals count mismatch');
      for (const n of part.normals) assetCheck(Array.isArray(n) && n.length === 3 && Array.from(n).every(v=>typeof v === 'number' && Number.isFinite(v) && Math.abs(v)<=1e6) && Math.hypot(...n)>0, 'invalid normals');
    }
    validateImageGeometry({kind:'mesh',...part});
    // Conservative accounting for boxed JS triples, not just their packed wire size.
    bytes += (part.vertices.length + part.triangles.length + (part.normals?.length ?? 0) + (part.uv0?.length ?? 0)) * 128;
    assetCheck(bytes <= ASSET_LIMITS.modelBytes, 'decoded model memory limit exceeded');
  }
  const model = structuredClone(input), meshes = new Map<string,Geometry>();
  const parts = model.parts.map(part => {
    meshes.set(part.id, freezeAsset({kind:'mesh',vertices:part.vertices,triangles:part.triangles,...(part.normals?{normals:part.normals}:{}),...(part.uv0?{uv0:part.uv0}:{}),...(part.imageTexture?{imageTexture:part.imageTexture}:{})} as Geometry));
    return { id: part.id, vertexCount: part.vertices.length, triangleCount: part.triangles.length, bounds: bounds(part.vertices), ...(part.uv0?{hasUV0:true}:{}),...(part.imageTexture?{imageTexture:part.imageTexture}:{}) };
  });
  const overall = bounds(parts.flatMap(part=>[part.bounds.min,part.bounds.max]));
  return { model:freezeAsset(model), descriptor:{id:model.id,kind:'model',parts,bounds:overall}, meshes, bytes };
}
