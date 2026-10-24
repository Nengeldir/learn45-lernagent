// Mind-map layout in the style of classic mind-map tools: start in the middle, skills to the right and left,
// each branch growing outward in columns (skill, track, lessons). Every subtree gets its own band of rows,
// so branches never overlap, however many tracks, lessons and forks there are. A chain of lessons stays on one
// row; at a fork the children take a row each and the parent sits between them.
import type { MapNode } from '@l45/shared';

export interface Placed {
  node: MapNode;
  x: number;
  y: number;
  /** 1 = right of the start, -1 = left; branches grow away from the start */
  side: 1 | -1;
  depth: number;
}

export const TRACK_COLOR: Record<string, string> = {
  't-info': 'var(--c-info)',
  't-komm': 'var(--c-komm)',
  't-inhalte': 'var(--c-inhalte)',
  't-sicherheit': 'var(--c-sicherheit)',
  't-problem': 'var(--c-problem)',
  't-analysis': 'var(--c-math)',
  't-physik': 'var(--c-science)',
};

const OWN_COLORS = [1, 2, 3, 4, 5, 6].map((i) => `var(--c-own${i})`);

/** Colour per track: fixed for prepared tracks, own tracks take the next colour in the order they were added. */
export function trackColors(nodes: MapNode[]): Map<string, string> {
  const out = new Map<string, string>();
  let own = 0;
  for (const n of nodes) {
    if (n.kind !== 'track' || !n.trackId) continue;
    out.set(n.trackId, TRACK_COLOR[n.trackId] ?? OWN_COLORS[own++ % OWN_COLORS.length]);
  }
  return out;
}

/** Horizontal distance from the parent's column: the widest labels of both columns plus a gap for the edges. */
const COLUMN: Record<MapNode['kind'], number> = { start: 0, skill: 240, track: 290, lesson: 260 };
/** Height of one row: a node with its tag above and two label lines plus the meta line below. */
export const ROW = 116;
/** Extra space between sibling subtrees, so skills and tracks read as groups. */
const GAP: Record<MapNode['kind'], number> = { start: 0, skill: 48, track: 18, lesson: 0 };

export function layout(nodes: MapNode[]): Map<string, Placed> {
  const placed = new Map<string, Placed>();
  const children = new Map<string, MapNode[]>();
  for (const n of nodes) {
    if (!n.parentId) continue;
    const list = children.get(n.parentId) ?? [];
    list.push(n);
    children.set(n.parentId, list);
  }
  const start = nodes.find((n) => n.kind === 'start');
  if (!start) return placed;
  placed.set(start.id, { node: start, x: 0, y: 0, side: 1, depth: 0 });

  // Height of a subtree: one row per leaf, plus the gaps between sibling subtrees.
  const heights = new Map<string, number>();
  const height = (n: MapNode): number => {
    const known = heights.get(n.id);
    if (known !== undefined) return known;
    const kids = children.get(n.id) ?? [];
    const h = kids.length ? kids.reduce((sum, k) => sum + height(k), 0) + (kids.length - 1) * GAP[kids[0].kind] : ROW;
    heights.set(n.id, h);
    return h;
  };

  // Puts a subtree into the band that starts at `top`; returns the y of its root.
  const place = (n: MapNode, x: number, top: number, side: 1 | -1, depth: number): number => {
    const kids = children.get(n.id) ?? [];
    let y = top + ROW / 2;
    if (kids.length) {
      let at = top;
      const ys = kids.map((k) => {
        const ky = place(k, x + side * COLUMN[k.kind], at, side, depth + 1);
        at += height(k) + GAP[k.kind];
        return ky;
      });
      y = (ys[0] + ys[ys.length - 1]) / 2;
    }
    placed.set(n.id, { node: n, x, y, side, depth });
    return y;
  };

  // Skills go to the side with less height so far, in the order they were added. Ties go right.
  const skills = children.get(start.id) ?? [];
  const sides: Record<1 | -1, MapNode[]> = { 1: [], [-1]: [] };
  const used = { 1: 0, [-1]: 0 };
  for (const s of skills) {
    const side = used[-1] < used[1] ? -1 : 1;
    sides[side].push(s);
    used[side] += height(s) + (sides[side].length > 1 ? GAP.skill : 0);
  }
  for (const side of [1, -1] as const) {
    let top = -used[side] / 2;
    for (const s of sides[side]) {
      place(s, side * COLUMN.skill, top, side, 1);
      top += height(s) + GAP.skill;
    }
  }
  return placed;
}

/**
 * Edge from a parent to a child: level out of the parent, an S-curve that changes rows only in the free gap
 * between the parent's labels and the children's labels, level into the child. Labels sit above and below
 * their node, so an edge never runs through text, and edges of different subtrees stay in their own rows.
 */
function route(from: Placed, to: Placed) {
  const side = to.side;
  const out = from.x + side * extent(from.node.kind).right;
  const into = to.x - side * extent(to.node.kind).left;
  const gx = (out + into) / 2;
  const half = Math.min(Math.abs(into - out) / 2 - 2, 26);
  return { a: gx - side * half, gx, b: gx + side * half };
}

export function edgePath(from: Placed, to: Placed): string {
  if (Math.abs(to.y - from.y) < 0.5) return `M${from.x} ${from.y} L${to.x} ${to.y}`;
  const { a, gx, b } = route(from, to);
  return `M${from.x} ${from.y} L${a} ${from.y} C${gx} ${from.y} ${gx} ${to.y} ${b} ${to.y} L${to.x} ${to.y}`;
}

/** Points along the same edge as edgePath, for checking the layout. */
export function edgePoints(from: Placed, to: Placed, n = 24): { x: number; y: number }[] {
  const { a, gx, b } = Math.abs(to.y - from.y) < 0.5 ? { a: to.x, gx: to.x, b: to.x } : route(from, to);
  const line = (x0: number, x1: number, y: number) => Array.from({ length: n + 1 }, (_, i) => ({ x: x0 + ((x1 - x0) * i) / n, y }));
  const curve = Array.from({ length: n }, (_, k) => {
    const t = (k + 1) / n;
    const u = 1 - t;
    // Cubic Bézier from (a, from.y) via (gx, from.y) and (gx, to.y) to (b, to.y)
    return { x: u * u * u * a + 3 * u * t * gx + t * t * t * b, y: (u * u * u + 3 * u * u * t) * from.y + (3 * u * t * t + t * t * t) * to.y };
  });
  return [...line(from.x, a, from.y), ...curve, ...line(b, to.x, to.y)];
}

/** Space a node takes on the map, relative to its centre: the disc, tags above and labels below. */
export function extent(kind: MapNode['kind']) {
  switch (kind) {
    case 'start': return { left: 42, right: 42, top: 42, bottom: 42 };
    case 'skill': return { left: 125, right: 125, top: 30, bottom: 62 };
    case 'track': return { left: 105, right: 105, top: 24, bottom: 80 };
    default: return { left: 100, right: 100, top: 42, bottom: 66 };
  }
}

export function bounds(placed: Map<string, Placed>) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of placed.values()) {
    const e = extent(p.node.kind);
    minX = Math.min(minX, p.x - e.left);
    maxX = Math.max(maxX, p.x + e.right);
    minY = Math.min(minY, p.y - e.top);
    maxY = Math.max(maxY, p.y + e.bottom);
  }
  return { minX, minY, maxX, maxY };
}

/** Splits a label into at most two lines of about `max` characters. */
export function wrap(label: string, max = 20): string[] {
  if (label.length <= max) return [label];
  const words = label.split(' ');
  let first = '';
  while (words.length && (first + ' ' + words[0]).trim().length <= max) first = (first + ' ' + words.shift()).trim();
  if (!first) first = words.shift() ?? '';
  // A single word longer than the line is cut, so no label grows wider than its column.
  if (first.length > max + 2) {
    words.unshift(first.slice(max));
    first = first.slice(0, max);
  }
  let second = words.join(' ');
  if (second.length > max + 2) second = second.slice(0, max + 1).trimEnd() + '…';
  return second ? [first, second] : [first];
}
