// Radial mind-map layout. Start in the middle, the learner's skills evenly around it in the order they were
// added (the first on top). With the three prepared skills this is the team sketch: "Digitale Kompetenz" above,
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

const SKILL_RADIUS = 260;

/** Angle of each digital track around the "Digitale Kompetenz" node when it sits on top, as in the sketch. */
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

  const skills = children.get(start.id) ?? [];
  skills.forEach((skill, k) => {
    // Counter-clockwise from the top: the second skill goes bottom left, the third bottom right.
    const skillDir = deg(-90 - (k * 360) / skills.length);
    const sx = Math.round(Math.cos(skillDir) * SKILL_RADIUS);
    const sy = Math.round(Math.sin(skillDir) * SKILL_RADIUS);
    placed.set(skill.id, { node: skill, x: sx, y: sy, dir: skillDir, depth: 1 });

    const tracks = children.get(skill.id) ?? [];
    const spread = tracks.length > 1 ? Math.min(40, 200 / (tracks.length - 1)) : 0;
    tracks.forEach((track, i) => {
      // The sketch angles assume the skill on top; turned with the skill when it sits elsewhere.
      const angle = TRACK_ANGLE[track.trackId ?? ''] !== undefined
        ? skillDir + deg(TRACK_ANGLE[track.trackId!] + 90)
        : skillDir + (i - (tracks.length - 1) / 2) * deg(spread);
      const r = skill.skillId === 'digital' ? 235 : 165;
      const t: Placed = { node: track, x: sx + Math.cos(angle) * r, y: sy + Math.sin(angle) * r, dir: angle, depth: 2 };
      placed.set(track.id, t);
      placeLessons(t, children, placed);
    });
  });
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
