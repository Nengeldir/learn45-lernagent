// Linear knowledge graph: one subway line per learning track.
// Opening a line shows that mountain. Depth on the mountain follows the exercise level.
import type { DccLevel, DccProfile, Lesson, MapNode, Skill } from '@l45/shared';
import { TRACK_COLOR, trackColors } from './layout.ts';

export const DEPTH_LABEL = ['Oberfläche', 'Hang', 'Tiefe'] as const;

/** One mountain route per knowledge line. The name is the route, not a competency score. */
const MOUNTAIN: Record<string, { name: string; metres: number }> = {
  't-info': { name: 'Pilatus', metres: 2128 },
  't-komm': { name: 'Rigi', metres: 1798 },
  't-inhalte': { name: 'Titlis', metres: 3238 },
  't-sicherheit': { name: 'Säntis', metres: 2502 },
  't-problem': { name: 'Schilthorn', metres: 2970 },
  't-analysis': { name: 'Eiger', metres: 3967 },
  't-physik': { name: 'Matterhorn', metres: 4478 },
};

export function depthOf(level: DccLevel | undefined): 0 | 1 | 2 {
  if (level === 'Fortgeschritten') return 2;
  if (level === 'Mittelstufe') return 1;
  return 0;
}

export interface Stop {
  node: MapNode;
  level: DccLevel;
  depth: 0 | 1 | 2;
  /** Slot along the line. Shared by a branch and the main stop at the same step. */
  col: number;
  /** 0 sits on the line. 1 is a short spur, the agent's alternative. */
  row: number;
}

export interface Line {
  trackId: string;
  skillName: string;
  name: string;
  area?: string;
  color: string;
  dccBased: boolean;
  dcc: DccLevel | null;
  mountain: { name: string; metres: number };
  /** False while this area is only shown as a line and is not on the learner's map yet. */
  onMap: boolean;
  stops: Stop[];
}

function walk(nodes: MapNode[], parentId: string, col: number, row: number, lessonOf: (id?: string) => Lesson | undefined, out: Stop[]) {
  const kids = nodes.filter((n) => n.kind === 'lesson' && n.parentId === parentId);
  kids.forEach((node, i) => {
    const nextRow = i === 0 ? row : row + 1;
    const lesson = lessonOf(node.lessonId);
    const level = lesson?.level ?? 'Grundstufe';
    out.push({ node, level, depth: depthOf(level), col, row: nextRow });
    walk(nodes, node.id, col + 1, nextRow, lessonOf, out);
  });
}

export function buildLines(nodes: MapNode[], skills: Skill[], dcc: DccProfile, lessonOf: (id?: string) => Lesson | undefined): Line[] {
  const lines: Line[] = [];
  // Own tracks have no fixed colour or mountain: they share the colours the mind map gives them.
  const colors = trackColors(nodes);
  for (const skill of skills) {
    for (const track of skill.tracks) {
      const trackNode = nodes.find((n) => n.kind === 'track' && n.trackId === track.id);
      const stops: Stop[] = [];
      if (trackNode) walk(nodes, trackNode.id, 1, 0, lessonOf, stops);
      lines.push({
        trackId: track.id,
        skillName: skill.name,
        name: track.name,
        area: track.dccArea,
        color: TRACK_COLOR[track.id] ?? colors.get(track.id) ?? 'var(--ink)',
        dccBased: skill.dccBased,
        dcc: skill.dccBased ? (dcc.levels[track.id] ?? null) : null,
        mountain: MOUNTAIN[track.id] ?? { name: track.name, metres: 1000 },
        onMap: Boolean(trackNode),
        stops,
      });
    }
  }
  return lines;
}

export function lineByTrack(lines: Line[], trackId: string | null): Line | undefined {
  return trackId ? lines.find((l) => l.trackId === trackId) : undefined;
}

export interface PlacedStop extends Stop {
  x: number;
  y: number;
  /** Height on this mountain. Exercise route, not a competency score. */
  metres: number;
}

/** Scene the cartoon peak is drawn in. The flag sits above the highest stop. */
export const PEAK_SCENE = { w: 640, h: 560, peakX: 328, peakY: 78, baseY: 462 };

export function yFromMetres(metres: number, summit: number) {
  const t = summit <= 0 ? 0 : Math.min(1, Math.max(0, metres / summit));
  return PEAK_SCENE.baseY - t * 0.82 * (PEAK_SCENE.baseY - PEAK_SCENE.peakY);
}

/** The path climbs. Easier exercises are lower pitches. Harder ones take more metres toward the summit. */
export function climbStops(stops: Stop[], summit: number): PlacedStop[] {
  const peak = summit > 0 ? summit : 1000;
  const order = [...stops].sort((a, b) => a.depth - b.depth || a.col - b.col || a.row - b.row);
  const weight = (s: Stop) => 1 + s.depth;
  const total = order.reduce((n, s) => n + weight(s), 0) || 1;
  let climbed = 0;
  const byId = new Map<string, PlacedStop>();
  order.forEach((stop, i) => {
    climbed += weight(stop);
    const metres = Math.max(1, Math.round(peak * climbed / total));
    const t = metres / peak;
    const side = i % 2 === 0 ? -1 : 1;
    byId.set(stop.node.id, {
      ...stop,
      metres,
      x: PEAK_SCENE.peakX + side * (1 - t * 0.45) * 92,
      y: yFromMetres(metres, peak),
    });
  });
  return stops.map((s) => byId.get(s.node.id)!);
}

export function routeOf(nodes: MapNode[], skills: Skill[], dcc: DccProfile, lessonOf: (id?: string) => Lesson | undefined, nodeId?: string) {
  if (!nodeId) return undefined;
  const node = nodes.find((n) => n.id === nodeId);
  if (!node?.trackId) return undefined;
  const line = lineByTrack(buildLines(nodes, skills, dcc, lessonOf), node.trackId);
  const stop = line?.stops.find((s) => s.node.id === nodeId);
  return line && stop ? { line, stop } : undefined;
}
