import { SpatialFrame, add, sub, mul, cross, unit } from './spatial.js';
import { connectorLabel } from './connector-bounds.js';
import type { BindingDeclaration, Frame, Vec3 } from './types.js';

/** Resolve parent/source dependencies, optionally updating unbound elements as visited. */
export function applyBindings(frame: Frame, bindings: BindingDeclaration[] = [], update?: (id: string) => void): Frame {
  if (!bindings.length && !update) return frame;
  const space = new SpatialFrame(frame), byTarget = new Map(bindings.map(b => [b.target, b]));
  const done = new Set<string>();
  const visit = (id: string): void => {
    if (done.has(id)) return; done.add(id);
    const parent = space.parents.get(id); if (parent) visit(parent);
    const b = byTarget.get(id), e = space.elements.get(id); if (!e) return;
    if (!b) { update?.(id); return; }
    const ids = b.type === 'attach' ? [b.source] : [b.from, b.to];
    for (const source of ids) { visit(source); if (!space.elements.has(source)) { e.opacity = 0; return; } }
    if (b.type === 'attach') {
      const points = space.elements.get(b.source)!.geometry.points;
      const midpoint: Vec3 = b.anchor === 'midpoint' && points?.length
        ? [0,1,2].map(axis => ((points[0][axis] ?? 0) + (points.at(-1)![axis] ?? 0))/2) as Vec3 : [0,0,0];
      e.position = space.local(id, add(space.world(b.source, midpoint), b.offset ?? [0, 0, 0]), true);
    } else {
      const trimLabels = b.endpoints === undefined || b.endpoints === 'bounds';
      const labelA = trimLabels ? connectorLabel(space, b.from) : undefined;
      const labelB = trimLabels ? connectorLabel(space, b.to) : undefined;
      const from = labelA?.center ?? space.world(b.from), to = labelB?.center ?? space.world(b.to);
      const delta = sub(to, from), length = Math.hypot(...delta);
      const direction = unit(delta), reference: Vec3 = Math.abs(direction[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
      const offset = b.offset ?? 0, side = mul(unit(cross(direction, reference)), offset);
      const radiusA = b.endpoints === 'surface' ? space.radius(b.from) : 0;
      const radiusB = b.endpoints === 'surface' ? space.radius(b.to) : 0;
      let a = Math.sqrt(Math.max(0, radiusA*radiusA-offset*offset));
      let z = Math.sqrt(Math.max(0, radiusB*radiusB-offset*offset));
      if (labelA || labelB) {
        const scale = Math.abs(space.chain(id).reduce((n, state) => n * state.scale, 1));
        const width = e.strokeWidth * scale, screen = e.space === 'screen';
        const minimum = e.geometry.kind === 'arrow'
          ? 2 * Math.max((screen ? 6 : 0.16) * scale, width * 4)
          : Math.max((screen ? 3 : 0.08) * scale, width * 4);
        const trims = (padding: number): [number, number] => [
          labelA?.trim(add(from, side), direction, width / 2 + labelA.padding * padding) ?? 0,
          labelB?.trim(add(to, side), mul(direction, -1), width / 2 + labelB.padding * padding) ?? 0,
        ];
        [a, z] = trims(0);
        if (length - a - z < minimum) { e.opacity = 0; return; }
        // Spend only the available room on whitespace, keeping a readable shaft.
        let low = 0, high = 1;
        const padded = trims(1);
        if (length - padded[0] - padded[1] >= minimum) [a, z] = padded;
        else {
          for (let i = 0; i < 24; i++) {
            const mid = (low + high) / 2, candidate = trims(mid);
            if (length - candidate[0] - candidate[1] >= minimum) { low = mid; [a, z] = candidate; }
            else high = mid;
          }
        }
      }
      if (length <= a+z || b.endpoints === 'surface' && (Math.abs(offset) > radiusA || Math.abs(offset) > radiusB)) { e.opacity = 0; return; }
      e.geometry = { ...e.geometry, points: [space.local(id, add(add(from, side), mul(direction, a))), space.local(id, sub(add(to, side), mul(direction, z)))] };
      // A connector's live endpoints own its shape, including during source morphs.
      delete e.morph;
    }
  };
  for (const id of update ? space.elements.keys() : byTarget.keys()) visit(id);
  return frame;
}
