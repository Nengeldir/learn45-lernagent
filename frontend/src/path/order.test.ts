import { describe, expect, it } from 'vitest';
import type { MapNode } from '@l45/shared';
import { pathOf } from './order.ts';

const lesson = (id: string, parentId: string, state: MapNode['state'], trackId = 'a'): MapNode =>
  ({ id, kind: 'lesson', parentId, label: id, trackId, state });

const base: MapNode[] = [
  { id: 'start', kind: 'start', parentId: null, label: 'Mara' },
  { id: 'track-a', kind: 'track', parentId: 'start', label: 'A', trackId: 'a' },
];

describe('pathOf', () => {
  it('follows a chain of lessons in plan order', () => {
    const nodes = [...base, lesson('l1', 'track-a', 'recommended'), lesson('l2', 'l1', 'planned'), lesson('l3', 'l2', 'planned')];
    expect(pathOf(nodes, 'a', []).map((n) => n.id)).toEqual(['l1', 'l2', 'l3']);
  });

  it('puts finished lessons first, in the order they were finished, then the next step', () => {
    const nodes = [
      ...base,
      lesson('l1', 'track-a', 'done'),
      lesson('fork', 'l1', 'planned'),
      lesson('l2', 'l1', 'done'),
      lesson('l3', 'l2', 'recommended'),
    ];
    const events = [{ nodeId: 'l2' }, { nodeId: 'l1' }, { nodeId: 'l2' }];
    expect(pathOf(nodes, 'a', events).map((n) => n.id)).toEqual(['l2', 'l1', 'l3', 'fork']);
  });

  it('keeps only the lessons of the asked track', () => {
    const nodes = [...base, lesson('l1', 'track-a', 'planned'), lesson('b1', 'track-b', 'recommended', 'b')];
    expect(pathOf(nodes, 'a', []).map((n) => n.id)).toEqual(['l1']);
  });

  it('survives a cycle in the parent links', () => {
    const nodes = [...base, lesson('l1', 'l2', 'planned'), lesson('l2', 'l1', 'planned'), lesson('l0', 'track-a', 'planned')];
    expect(pathOf(nodes, 'a', []).map((n) => n.id)).toEqual(['l0']);
  });
});
