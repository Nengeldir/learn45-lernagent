// The learning path shows one track as a single line of lessons, although the lessons of a track form a small
// tree (chains, plus forks where the agent added a node or offered an alternative). The line reads like a
// history followed by a plan: finished lessons in the order they were first finished, then the next step,
// then the remaining lessons in plan order (depth first through the tree).
import type { MapNode } from '@l45/shared';

export function pathOf(nodes: MapNode[], trackId: string, events: { nodeId: string }[]): MapNode[] {
  const lessons = nodes.filter((n) => n.kind === 'lesson' && n.trackId === trackId);
  const ids = new Set(lessons.map((n) => n.id));
  const children = new Map<string, MapNode[]>();
  for (const n of lessons) {
    if (!n.parentId || !ids.has(n.parentId)) continue;
    children.set(n.parentId, [...(children.get(n.parentId) ?? []), n]);
  }

  const planned: MapNode[] = [];
  const seen = new Set<string>();
  const visit = (n: MapNode) => {
    if (seen.has(n.id)) return;
    seen.add(n.id);
    planned.push(n);
    for (const c of children.get(n.id) ?? []) visit(c);
  };
  for (const n of lessons) if (!n.parentId || !ids.has(n.parentId)) visit(n);

  const firstDone = new Map<string, number>();
  events.forEach((e, i) => !firstDone.has(e.nodeId) && firstDone.set(e.nodeId, i));
  const when = (n: MapNode) => firstDone.get(n.id) ?? Infinity;

  const done = planned.filter((n) => n.state === 'done').sort((a, b) => when(a) - when(b));
  const open = planned.filter((n) => n.state !== 'done');
  const next = open.filter((n) => n.state === 'recommended');
  return [...done, ...next, ...open.filter((n) => n.state !== 'recommended')];
}
