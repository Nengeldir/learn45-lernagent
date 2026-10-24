// Places each lesson from the agent's map on a Swiss peak.
// Lower peaks are easier exercises. High peaks are the harder ones.
// The line between peaks is the learning path (parent to child), not a geographic tour.
import type { DccLevel, Lesson, MapNode } from '@l45/shared';
import { PEAKS, type Peak } from './swiss.ts';

export interface Station {
  node: MapNode;
  place: Peak;
  level: DccLevel;
  /** Pin position. Nudged when two peaks would sit on top of each other. */
  x: number;
  y: number;
}

const BANDS: Peak[][] = [
  PEAKS.filter((p) => p.m < 900).sort((a, b) => a.m - b.m),
  PEAKS.filter((p) => p.m >= 900 && p.m < 2500).sort((a, b) => a.m - b.m),
  PEAKS.filter((p) => p.m >= 2500).sort((a, b) => a.m - b.m),
];

export function difficultyOf(level: DccLevel | undefined): 0 | 1 | 2 {
  if (level === 'Fortgeschritten') return 2;
  if (level === 'Mittelstufe') return 1;
  return 0;
}

function takePeak(rank: 0 | 1 | 2, used: Set<string>): Peak {
  for (let band = rank; band < BANDS.length; band += 1) {
    const free = BANDS[band].find((p) => !used.has(p.id));
    if (free) return free;
  }
  for (let band = rank - 1; band >= 0; band -= 1) {
    const free = BANDS[band].find((p) => !used.has(p.id));
    if (free) return free;
  }
  return PEAKS.find((p) => !used.has(p.id)) ?? PEAKS[0];
}

function nudge(stations: Station[]) {
  const laid: Station[] = [];
  for (const station of stations) {
    let x = station.place.x;
    let y = station.place.y;
    for (let tries = 0; tries < 24; tries += 1) {
      const hit = laid.some((pin) => (pin.x - x) ** 2 + (pin.y - y) ** 2 < 52 * 52);
      if (!hit) break;
      const angle = tries * 2.4;
      const radius = 20 + tries * 3;
      x = Math.max(24, Math.min(976, station.place.x + Math.cos(angle) * radius));
      y = Math.max(24, Math.min(616, station.place.y + Math.sin(angle) * radius));
    }
    laid.push({ ...station, x, y });
  }
  return laid;
}

/** Stable: lessons keep their peak as the map grows, because nodes are walked in creation order. */
export function assignPass(nodes: MapNode[], lessonOf: (id?: string) => Lesson | undefined): Station[] {
  const used = new Set<string>();
  const raw: Station[] = [];
  for (const node of nodes) {
    if (node.kind !== 'lesson') continue;
    const lesson = lessonOf(node.lessonId);
    const level = lesson?.level ?? 'Grundstufe';
    const place = takePeak(difficultyOf(level), used);
    used.add(place.id);
    raw.push({ node, place, level, x: place.x, y: place.y });
  }
  return nudge(raw);
}

export interface PathEdge {
  from: Station;
  to: Station;
  /** A second child of the same lesson: the agent's alternative branch. */
  branch: boolean;
}

export function pathEdges(stations: Station[]): PathEdge[] {
  const byNode = new Map(stations.map((s) => [s.node.id, s]));
  const childCount = new Map<string, number>();
  const edges: PathEdge[] = [];
  for (const station of stations) {
    const parent = station.node.parentId ? byNode.get(station.node.parentId) : undefined;
    if (!parent) continue;
    const n = childCount.get(parent.node.id) ?? 0;
    childCount.set(parent.node.id, n + 1);
    edges.push({ from: parent, to: station, branch: n > 0 });
  }
  return edges;
}
