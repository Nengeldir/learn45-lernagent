import { GeometryCache } from './cache.js';
import { vec3 } from './geometry.js';
import { assetGeometryIdentity } from './asset-geometry.js';
import type { Geometry, Vec3 } from './types.js';

interface MeshTriangles { points: Vec3[]; normals?: Vec3[] }

// Frames are cloned by the evaluator. Content keys reuse their geometry across
// frames while still detecting edits made by direct frame callers.
const meshes = new GeometryCache<MeshTriangles>(16 * 1024 * 1024);
const unit = (normal: Vec3, fallback: Vec3 = [0, 0, 1]): Vec3 => {
  const length = Math.hypot(...normal);
  return length > 0 && Number.isFinite(length)
    ? normal.map(value => value / length) as Vec3 : fallback;
};

/** Expand an indexed mesh, computing flat or area-weighted smooth local normals. */
export function meshTriangles(geometry: Geometry): MeshTriangles {
  const shading = geometry.shading ?? 'unlit';
  const identity=assetGeometryIdentity(geometry);
  const key = identity ? `asset:${identity}:${shading}` : JSON.stringify([geometry.vertices, geometry.triangles, shading, shading === 'smooth' ? geometry.normals : undefined]);
  const cached = meshes.get(key);
  if (cached) return cached;

  const vertices = (geometry.vertices ?? []).map(point => [...vec3(point)] as Vec3);
  const triangles = (geometry.triangles ?? []).filter(face => face.length === 3 && face.every(index => vertices[index]));
  const points = triangles.flatMap(face => face.map(index => vertices[index]));
  if (shading === 'unlit') return meshes.set(key, { points }, (vertices.length + points.length) * 64);

  const faceNormal = ([a, b, c]: number[]): Vec3 => {
    const u = vertices[b].map((value, axis) => value - vertices[a][axis]);
    const v = vertices[c].map((value, axis) => value - vertices[a][axis]);
    return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  };
  let normals: Vec3[];
  if (shading === 'flat') {
    normals = triangles.flatMap(face => { const n = unit(faceNormal(face)); return [n, n, n]; });
  } else {
    const sums: Vec3[] = geometry.normals ? [] : vertices.map(() => [0, 0, 0]);
    const faceNormals = geometry.normals ? undefined : triangles.map(faceNormal);
    if (!geometry.normals) {
      for (let face = 0; face < triangles.length; face++) {
        for (const vertex of triangles[face]) {
          for (let axis = 0; axis < 3; axis++) sums[vertex][axis] += faceNormals![face][axis];
        }
      }
    }
    // A canceled smooth normal (opposing faces), a zero normal in a direct
    // frame, or a degenerate face must never send NaNs into either shader.
    const smooth = (geometry.normals ?? sums).map(normal => unit(normal, [0, 0, 0]));
    // Normalized finite vectors are usable exactly when any component is nonzero.
    // Check each shared vertex once; authored normals need no geometric fallback
    // unless a particular face references a missing or canceled normal.
    const usable = smooth.map(normal => normal.some(value => value !== 0));
    normals = triangles.flatMap((face, index) => {
      let fallback: Vec3 | undefined;
      return face.map(vertex => usable[vertex] ? smooth[vertex] :
        (fallback ??= unit(faceNormals?.[index] ?? faceNormal(face))));
    });
  }
  return meshes.set(key, { points, normals }, (vertices.length + points.length + normals.length) * 64);
}

/** Expanded corner normals preserve each face's fallback at canceled smooth vertices. */
export function morphMeshNormals(from: Geometry, to: Geometry, progress: number): Vec3[] | undefined {
  if (to.shading !== 'smooth' || !from.normals && !to.normals) return undefined;
  // Mesh morphs use the target topology. With matching topology this also
  // exactly preserves the endpoint renderer's per-face degeneracy fallback.
  const endpoint = (geometry: Geometry): Vec3[] => meshTriangles({ ...geometry, triangles: to.triangles, shading: 'smooth' }).normals!;
  const source = endpoint(from), target = endpoint(to);
  return source.map((normal, index) => {
    const a = unit(normal), b = unit(target[index] ?? normal);
    const blended = a.map((value, axis) => value + (b[axis] - value) * progress) as Vec3;
    // Exactly opposing directions have no unique normalized midpoint. Keep a
    // finite unit direction instead of allowing normalization of a zero vector.
    return unit(blended, a);
  });
}
