import type { ParametricSurfaceProps, SurfaceProps } from "./surface-types.js";
import type { Geometry, Vec3 } from "./types.js";

/** Self-contained so the compiler can install the same builders in QuickJS. */
export function createSurfaceBuilders() {
  const limit = 20_000;
  const coordinateLimit = 1e6;

  function range(value: [number, number] | undefined, fallback: [number, number], name: string): [number, number] {
    const result = value === undefined ? fallback : value;
    if (!Array.isArray(result) || result.length !== 2 || [0, 1].some(i => typeof result[i] !== "number" || !Number.isFinite(result[i]) || Math.abs(result[i]) > coordinateLimit) || result[0] >= result[1]) {
      throw new Error(`${name} must contain two finite increasing numbers within ±${coordinateLimit}`);
    }
    return result;
  }

  function segments(value: number | undefined, closed: boolean, name: string): number {
    const result = value === undefined ? 32 : value;
    const minimum = closed ? 3 : 1;
    if (!Number.isInteger(result) || result < minimum || result > limit) {
      throw new Error(`${name} must be an integer from ${minimum} to ${limit}`);
    }
    return result;
  }

  function build(props: ParametricSurfaceProps): Geometry {
    if (!props || typeof props.fn !== "function") throw new Error("parametricSurface requires an fn(u, v) callback");
    for (const key of ["closedU", "closedV"] as const) {
      if (props[key] !== undefined && typeof props[key] !== "boolean") throw new Error(`${key} must be a boolean`);
    }
    const closedU = props.closedU ?? false, closedV = props.closedV ?? false;
    const uRange = range(props.uRange, [0, 1], "uRange"), vRange = range(props.vRange, [0, 1], "vRange");
    const nu = segments(props.uSegments, closedU, "uSegments"), nv = segments(props.vSegments, closedV, "vSegments");
    const columns = nu + (closedU ? 0 : 1), rows = nv + (closedV ? 0 : 1);
    if (columns * rows > limit || 2 * nu * nv > limit) throw new Error("Surface exceeds the 20000 vertex or triangle budget; reduce segment counts");
    const shading = props.shading ?? "smooth";
    if (shading !== "unlit" && shading !== "flat" && shading !== "smooth") throw new Error("Invalid surface shading");

    const vertices: Vec3[] = [];
    const values: number[] = [];
    if (props.scalar && typeof props.scalar.fn !== "function") throw new Error("scalar requires fn(x, y, z)");
    const indices = new Int32Array(columns * rows);
    indices.fill(-1);
    for (let j = 0; j < rows; j++) {
      const v = j === nv ? vRange[1] : vRange[0] + (vRange[1] - vRange[0]) * j / nv;
      for (let i = 0; i < columns; i++) {
        const u = i === nu ? uRange[1] : uRange[0] + (uRange[1] - uRange[0]) * i / nu;
        let point: Vec3;
        try { point = props.fn(u, v); }
        catch (error) { throw new Error(`Surface callback failed at (${u}, ${v}): ${error instanceof Error ? error.message : String(error)}`); }
        if (!Array.isArray(point) || point.length !== 3 || typeof point[0] !== "number" || typeof point[1] !== "number" || typeof point[2] !== "number") throw new Error(`Surface callback must return a Vec3 at (${u}, ${v})`);
        // Undefined parts of a mathematical domain form holes, never long bridges.
        if (!point.every(Number.isFinite)) continue;
        if (point.some(x => Math.abs(x) > coordinateLimit)) throw new Error(`Surface coordinate exceeds ±${coordinateLimit} at (${u}, ${v})`);
        indices[j * columns + i] = vertices.length;
        // Callbacks may reuse their result array; retain each sampled position.
        vertices.push([point[0], point[1], point[2]]);
        if (props.scalar) {
          const value = props.scalar.fn(point[0], point[1], point[2]);
          if (!Number.isFinite(value) || Math.abs(value) > coordinateLimit) throw new Error("Invalid scalar sample");
          values.push(value);
        }
      }
    }

    const triangles: [number, number, number][] = [];
    function triangle(a: number, b: number, c: number) {
      const p = vertices[a], q = vertices[b], r = vertices[c];
      const ux = q[0] - p[0], uy = q[1] - p[1], uz = q[2] - p[2];
      const vx = r[0] - p[0], vy = r[1] - p[1], vz = r[2] - p[2];
      const area = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
      // Relative tolerance removes collapsed poles without discarding tiny surfaces.
      if (area > 1e-12 * Math.hypot(ux, uy, uz) * Math.hypot(vx, vy, vz)) triangles.push([a, b, c]);
    }
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const nextI = (i + 1) % columns, nextJ = (j + 1) % rows;
      const a = indices[j * columns + i], b = indices[j * columns + nextI];
      const c = indices[nextJ * columns + nextI], d = indices[nextJ * columns + i];
      // Omit the entire adjoining cell when any sample is outside the domain.
      if (a < 0 || b < 0 || c < 0 || d < 0) continue;
      triangle(a, b, c);
      triangle(a, c, d);
    }
    return { kind: "mesh", vertices, triangles, shading, ...(props.scalar ? { scalarColors: { values, domain: props.scalar.domain, colors: props.scalar.colors } } : {}) };
  }

  function surface(props: SurfaceProps): Geometry {
    if (!props || typeof props.fn !== "function") throw new Error("surface requires an fn(x, y) callback");
    const xRange = range(props.xRange, [-2, 2], "xRange"), yRange = range(props.yRange, [-2, 2], "yRange");
    const xSegments = segments(props.xSegments, false, "xSegments"), ySegments = segments(props.ySegments, false, "ySegments");
    return build({
      fn(x, y) {
        const z = props.fn(x, y);
        if (typeof z !== "number") throw new Error("surface fn(x, y) must return a number");
        return [x, y, z];
      },
      scalar: props.scalar,
      uRange: xRange, vRange: yRange, uSegments: xSegments, vSegments: ySegments, shading: props.shading,
    });
  }

  return { surface, parametricSurface: build };
}
