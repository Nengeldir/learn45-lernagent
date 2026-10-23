import type { Geometry, Vec3 } from './types.js';
import type { BoxProps, CylinderProps, ConeProps, TorusProps, TubeProps } from './solid-types.js';

/** Self-contained so the compiler can install this factory in its sandbox. */
export function createSolidBuilders() {
  const limit = 20_000;
  const tau = Math.PI * 2;
  type Mesh = Omit<Geometry, 'vertices' | 'triangles'> & { vertices: Vec3[]; triangles: [number, number, number][]; shading: 'unlit' | 'flat' | 'smooth' };
  function positive(value: number, label: string) {
    if (!Number.isFinite(value) || value <= 0 || value > 1e6) throw new Error(`${label} must be positive and finite, at most 1,000,000`);
    return value;
  }
  function segments(value: number, label: string) {
    if (!Number.isInteger(value) || value < 3 || value > limit) throw new Error(`${label} must be an integer from 3 to ${limit}`);
    return value;
  }
  function budget(vertices: number, triangles: number) {
    if (vertices > limit || triangles > limit) throw new Error(`Solid geometry is limited to ${limit} vertices and ${limit} triangles`);
  }
  function flag(value: boolean | undefined, fallback: boolean, label: string) {
    if (value !== undefined && typeof value !== 'boolean') throw new Error(`${label} must be a boolean`);
    return value ?? fallback;
  }
  function mesh(shading: Mesh['shading'] | undefined, fallback: Mesh['shading'] = 'smooth'): Mesh {
    if (shading !== undefined && !['unlit', 'flat', 'smooth'].includes(shading)) throw new Error('shading must be unlit, flat, or smooth');
    return { kind: 'mesh', vertices: [], triangles: [], shading: shading ?? fallback };
  }
  function vertex(result: Mesh, point: Vec3) {
    if (point.some(value => !Number.isFinite(value) || Math.abs(value) > 1e6)) throw new Error('Solid vertices must have finite coordinates with magnitude at most 1,000,000');
    result.vertices.push(point);
  }
  const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  function unit(a: Vec3): Vec3 {
    const length = Math.hypot(...a);
    return [a[0] / length, a[1] / length, a[2] / length];
  }
  function rotate(a: Vec3, axis: Vec3, angle: number): Vec3 {
    const c = Math.cos(angle), s = Math.sin(angle), d = dot(axis, a), v = cross(axis, a);
    return [a[0] * c + v[0] * s + axis[0] * d * (1 - c), a[1] * c + v[1] * s + axis[1] * d * (1 - c), a[2] * c + v[2] * s + axis[2] * d * (1 - c)];
  }
  function transport(normal: Vec3, from: Vec3, to: Vec3): Vec3 {
    const axis = cross(from, to), length = Math.hypot(...axis), cosine = Math.max(-1, Math.min(1, dot(from, to)));
    // Opposite tangents have no unique minimal rotation; preserve the normal.
    const moved = length > 1e-12 ? rotate(normal, unit(axis), Math.atan2(length, cosine)) : normal;
    const projection = dot(moved, to);
    return unit([moved[0] - to[0] * projection, moved[1] - to[1] * projection, moved[2] - to[2] * projection]);
  }
  function box(props: BoxProps = {}): Geometry {
    const x = positive(props.width ?? 1, 'width') / 2, y = positive(props.height ?? 1, 'height') / 2, z = positive(props.depth ?? 1, 'depth') / 2;
    const result = mesh(props.shading, 'flat');
    const faces: Vec3[][] = [
      [[x,-y,-z],[x,y,-z],[x,y,z],[x,-y,z]],
      [[-x,-y,z],[-x,y,z],[-x,y,-z],[-x,-y,-z]],
      [[-x,y,-z],[-x,y,z],[x,y,z],[x,y,-z]],
      [[-x,-y,z],[-x,-y,-z],[x,-y,-z],[x,-y,z]],
      [[-x,-y,z],[x,-y,z],[x,y,z],[-x,y,z]],
      [[x,-y,-z],[-x,-y,-z],[-x,y,-z],[x,y,-z]],
    ];
    for (const face of faces) {
      const i = result.vertices.length;
      result.vertices.push(...face);
      result.triangles.push([i, i + 1, i + 2], [i, i + 2, i + 3]);
    }
    return result;
  }
  function roundSolid(props: CylinderProps, pointed: boolean): Geometry {
    const radius = positive(props.radius ?? 1, 'radius'), half = positive(props.height ?? 2, 'height') / 2;
    const count = segments(props.radialSegments ?? 32, 'radialSegments'), capped = flag(props.capped, true, 'capped');
    budget(pointed ? count + 1 + (capped ? count + 1 : 0) : 2 * count + (capped ? 2 * (count + 1) : 0), count * (pointed ? 1 + Number(capped) : 2 + 2 * Number(capped)));
    const result = mesh(props.shading);
    for (let i = 0; i < count; i++) vertex(result, [radius * Math.cos(tau * i / count), -half, radius * Math.sin(tau * i / count)]);
    if (pointed) vertex(result, [0, half, 0]);
    else for (let i = 0; i < count; i++) vertex(result, [result.vertices[i][0], half, result.vertices[i][2]]);
    for (let i = 0; i < count; i++) {
      const next = (i + 1) % count;
      if (pointed) result.triangles.push([i, count, next]);
      else result.triangles.push([i, count + i, next], [next, count + i, count + next]);
    }
    if (capped) for (let top = 0; top < (pointed ? 1 : 2); top++) {
      const start = result.vertices.length, center = start + count, height = top ? half : -half;
      for (let i = 0; i < count; i++) vertex(result, [result.vertices[i][0], height, result.vertices[i][2]]);
      vertex(result, [0, height, 0]);
      for (let i = 0; i < count; i++) {
        const next = (i + 1) % count;
        result.triangles.push(top ? [center, start + next, start + i] : [center, start + i, start + next]);
      }
    }
    return result;
  }
  function cylinder(props: CylinderProps = {}) { return roundSolid(props, false); }
  function cone(props: ConeProps = {}) { return roundSolid(props, true); }
  function torus(props: TorusProps = {}): Geometry {
    const radius = positive(props.radius ?? 1, 'radius'), tubeRadius = positive(props.tubeRadius ?? 0.25, 'tubeRadius');
    if (tubeRadius >= radius) throw new Error('tubeRadius must be smaller than radius');
    const radial = segments(props.radialSegments ?? 32, 'radialSegments'), tubular = segments(props.tubularSegments ?? 12, 'tubularSegments');
    budget(radial * tubular, 2 * radial * tubular);
    const result = mesh(props.shading);
    for (let i = 0; i < radial; i++) for (let j = 0; j < tubular; j++) {
      const u = tau * i / radial, v = tau * j / tubular, r = radius + tubeRadius * Math.cos(v);
      vertex(result, [r * Math.cos(u), tubeRadius * Math.sin(v), r * Math.sin(u)]);
      const a = i * tubular + j, b = i * tubular + (j + 1) % tubular;
      const c = (i + 1) % radial * tubular + j, d = (i + 1) % radial * tubular + (j + 1) % tubular;
      result.triangles.push([a, b, c], [b, d, c]);
    }
    return result;
  }
  function tube(props: TubeProps): Geometry {
    const radius = positive(props.radius ?? 0.1, 'radius'), radial = segments(props.radialSegments ?? 12, 'radialSegments');
    const closed = flag(props.closed, false, 'closed'), capped = flag(props.capped, true, 'capped') && !closed;
    if (!Array.isArray(props.points) || props.points.length > limit) throw new Error(`points must be an array with at most ${limit} points`);
    const points: Vec3[] = [];
    for (const point of props.points) {
      if (!Array.isArray(point) || point.length !== 3) throw new Error('Tube points must be finite 3D coordinates with magnitude at most 1,000,000');
      // Indexed checks reject missing coordinates before distance-based deduplication.
      for (let axis = 0; axis < 3; axis++) {
        if (!Number.isFinite(point[axis]) || Math.abs(point[axis]) > 1e6) throw new Error('Tube points must be finite 3D coordinates with magnitude at most 1,000,000');
      }
      const coordinates: Vec3 = [point[0], point[1], point[2]];
      if (!points.length || Math.hypot(...sub(coordinates, points[points.length - 1])) > 1e-10) points.push(coordinates);
    }
    if (closed && points.length > 1 && Math.hypot(...sub(points[0], points[points.length - 1])) <= 1e-10) points.pop();
    const count = points.length, spans = closed ? count : count - 1;
    if (count < (closed ? 3 : 2)) throw new Error(`Tube needs at least ${closed ? 3 : 2} distinct consecutive points`);
    budget(count * radial + (capped ? 2 * (radial + 1) : 0), spans * radial * 2 + (capped ? 2 * radial : 0));
    const directions: Vec3[] = [], lengths: number[] = [], distances = [0];
    for (let i = 0; i < spans; i++) {
      const delta = sub(points[(i + 1) % count], points[i]);
      lengths.push(Math.hypot(...delta)); directions.push(unit(delta)); distances.push(distances[i] + lengths[i]);
    }
    const tangents: Vec3[] = [];
    for (let i = 0; i < count; i++) {
      if (!closed && i === 0) tangents.push(directions[0]);
      else if (!closed && i === count - 1) tangents.push(directions[spans - 1]);
      else {
        const before = directions[(i - 1 + spans) % spans], after = directions[i % spans];
        const sum: Vec3 = [before[0] + after[0], before[1] + after[1], before[2] + after[2]];
        if (Math.hypot(...sum) < 1e-6) throw new Error('Tube centerline cannot reverse direction at a point');
        tangents.push(unit(sum));
      }
    }
    const first = tangents[0], axis: Vec3 = Math.abs(first[0]) <= Math.abs(first[1]) && Math.abs(first[0]) <= Math.abs(first[2]) ? [1,0,0] : Math.abs(first[1]) <= Math.abs(first[2]) ? [0,1,0] : [0,0,1];
    const normals: Vec3[] = [unit(cross(first, axis))];
    for (let i = 1; i < count; i++) normals.push(transport(normals[i - 1], tangents[i - 1], tangents[i]));
    if (closed) {
      const end = transport(normals[count - 1], tangents[count - 1], first);
      const correction = Math.atan2(dot(first, cross(end, normals[0])), dot(end, normals[0]));
      for (let i = 1; i < count; i++) normals[i] = rotate(normals[i], tangents[i], correction * distances[i] / distances[spans]);
    }
    const result = mesh(props.shading);
    for (let i = 0; i < count; i++) {
      const normal = normals[i], binormal = cross(tangents[i], normal), point = points[i];
      for (let j = 0; j < radial; j++) {
        const c = radius * Math.cos(tau * j / radial), s = radius * Math.sin(tau * j / radial);
        vertex(result, [point[0] + normal[0] * c + binormal[0] * s, point[1] + normal[1] * c + binormal[1] * s, point[2] + normal[2] * c + binormal[2] * s]);
      }
    }
    for (let i = 0; i < spans; i++) for (let j = 0; j < radial; j++) {
      const a = i * radial + j, b = i * radial + (j + 1) % radial;
      const c = (i + 1) % count * radial + j, d = (i + 1) % count * radial + (j + 1) % radial;
      result.triangles.push([a, b, c], [b, d, c]);
    }
    if (capped) for (let end = 0; end < 2; end++) {
      const ring = end ? (count - 1) * radial : 0, start = result.vertices.length, center = start + radial;
      for (let j = 0; j < radial; j++) vertex(result, [...result.vertices[ring + j]]);
      vertex(result, [...points[end ? count - 1 : 0]]);
      for (let j = 0; j < radial; j++) {
        const next = (j + 1) % radial;
        result.triangles.push(end ? [center, start + j, start + next] : [center, start + next, start + j]);
      }
    }
    return result;
  }
  return { box, cylinder, cone, torus, tube };
}
