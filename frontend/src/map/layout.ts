// Radial mind-map layout, following the team sketch:
// Start in the middle, "Digitale Kompetenz" above with its 5 tracks around it,
// Mathematik bottom left, Naturwissenschaften bottom right. Lessons grow outward along each branch.
import type { MapNode } from '@l45/shared';

export interface Placed {
  node: MapNode;
  x: number;
  y: number;
  /** direction (radians) the branch grows in */
  dir: number;
  depth: number;
}

const deg = (d: number) => (d * Math.PI) / 180;

const SKILL_POS: Record<string, [number, number]> = {
  digital: [0, -210],
  math: [-300, 190],
  science: [300, 190],
};

/** Angle of each digital track around the "Digitale Kompetenz" node, as in the sketch. */
const TRACK_ANGLE: Record<string, number> = {
  't-info': -122,
  't-problem': -58,
  't-sicherheit': 8,
  't-inhalte': 188,
  't-komm': 148,
};

export const TRACK_COLOR: Record<string, string> = {
  't-info': 'var(--c-info)',
  't-komm': 'var(--c-komm)',
  't-inhalte': 'var(--c-inhalte)',
  't-sicherheit': 'var(--c-sicherheit)',
  't-problem': 'var(--c-problem)',
  't-analysis': 'var(--c-math)',
  't-physik': 'var(--c-science)',
};

const LESSON_STEP = 132;
/** Angle between two siblings at a fork. Wide enough that their labels do not touch. */
const FORK_SPREAD = deg(64);
/** Forked children sit a bit further out, which separates the labels further. */
const FORK_STEP = LESSON_STEP * 1.25;

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
  placed.set(start.id, { node: start, x: 0, y: 0, dir: deg(-90), depth: 0 });

  for (const skill of children.get(start.id) ?? []) {
    const [sx, sy] = SKILL_POS[skill.skillId ?? ''] ?? [0, 300];
    const skillDir = Math.atan2(sy, sx);
    placed.set(skill.id, { node: skill, x: sx, y: sy, dir: skillDir, depth: 1 });

    const tracks = children.get(skill.id) ?? [];
    tracks.forEach((track, i) => {
      const angle = TRACK_ANGLE[track.trackId ?? ''] !== undefined
        ? deg(TRACK_ANGLE[track.trackId!])
        : skillDir + (i - (tracks.length - 1) / 2) * deg(40);
      const r = skill.skillId === 'digital' ? 235 : 165;
      const t: Placed = { node: track, x: sx + Math.cos(angle) * r, y: sy + Math.sin(angle) * r, dir: angle, depth: 2 };
      placed.set(track.id, t);
      placeLessons(t, children, placed);
    });
  }
  return placed;
}

function placeLessons(parent: Placed, children: Map<string, MapNode[]>, placed: Map<string, Placed>) {
  const kids = children.get(parent.node.id) ?? [];
  const fork = kids.length > 1;
  kids.forEach((kid, i) => {
    const offset = fork ? (i - (kids.length - 1) / 2) * FORK_SPREAD : 0;
    // A gentle zig-zag keeps labels of a long chain from lining up on one straight line.
    const wobble = fork ? 0 : parent.depth % 2 === 0 ? deg(7) : -deg(7);
    const dir = parent.dir + offset + wobble;
    const step = fork ? FORK_STEP : parent.node.kind === 'track' ? LESSON_STEP * 0.9 : LESSON_STEP;
    // After a fork the branch bends half way back, so forked chains do not run into neighbouring tracks.
    const p: Placed = { node: kid, x: parent.x + Math.cos(dir) * step, y: parent.y + Math.sin(dir) * step, dir: parent.dir + offset * 0.5, depth: parent.depth + 1 };
    placed.set(kid.id, p);
    placeLessons(p, children, placed);
  });
}

export function bounds(placed: Map<string, Placed>) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of placed.values()) {
    minX = Math.min(minX, p.x - 110);
    maxX = Math.max(maxX, p.x + 110);
    minY = Math.min(minY, p.y - 50);
    maxY = Math.max(maxY, p.y + 60);
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
  let second = words.join(' ');
  if (second.length > max + 4) second = second.slice(0, max + 1).trimEnd() + '…';
  return second ? [first, second] : [first];
}
