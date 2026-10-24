// Guardrails: the rule engine checks the agent's plan before it becomes a recommendation (A1).
import type { Lesson, MapNode, Session } from '@l45/shared';
import { frontier } from './agent.ts';
import { content } from './content.ts';
import type { Stored } from './workspace.ts';

export const remaining = (s: Session) => Math.max(0, s.timeBudgetMin - s.usedMin);
export const allLessons = (s: Session): Lesson[] => [...content.lessons, ...s.generatedLessons];

export interface Plan {
  nodeId: string;
  alternativeNodeId: string;
  reason: string;
  basedOn: string[];
}

/** Recommended and alternative nodes count as planned again: the agent may replace the rule plan. */
const asPlanned = (nodes: MapNode[]) => nodes.map((n) => (n.state === 'recommended' || n.state === 'alternative' ? { ...n, state: 'planned' as const } : n));

/** Nodes the learner could start next, with the nodes the agent staged in this run. */
export const reachableIds = (st: Stored, staged: MapNode[] = []) => new Set(frontier({ nodes: asPlanned([...st.session.nodes, ...staged]) }).map((n) => n.id));

/** Problems with a plan; empty = accepted. `staged` are nodes and lessons the agent added in this run. */
export function checkPlan(st: Stored, plan: Plan, staged: { nodes: MapNode[]; lessons: Lesson[] } = { nodes: [], lessons: [] }): string[] {
  const s = st.session;
  const e: string[] = [];
  const nodes = asPlanned([...s.nodes, ...staged.nodes]);
  const lessons = [...allLessons(s), ...staged.lessons];
  const reachable = reachableIds(st, staged.nodes);
  const node = nodes.find((n) => n.id === plan.nodeId);

  if (!node || node.kind !== 'lesson') e.push(`Knoten ${plan.nodeId} gibt es nicht`);
  else if (!reachable.has(node.id)) e.push(`Knoten ${plan.nodeId} ist nicht erreichbar (erledigt oder der Schritt davor fehlt)`);
  const lesson = node?.lessonId ? lessons.find((l) => l.id === node.lessonId) : undefined;
  if (node && !lesson) e.push(`Lektion zu ${plan.nodeId} fehlt`);
  if (lesson && lesson.durationMin > remaining(s)) e.push(`R4: «${lesson.title}» dauert ${lesson.durationMin} Min., es bleiben ${remaining(s)}`);

  // An alternative is needed whenever another node is reachable. With one track and one new node there is none.
  if (!plan.alternativeNodeId) {
    if ([...reachable].some((id) => id !== plan.nodeId)) e.push('Alternative fehlt');
  } else if (plan.alternativeNodeId === plan.nodeId) e.push('Alternative ist derselbe Knoten');
  else if (!reachable.has(plan.alternativeNodeId)) e.push(`Alternative ${plan.alternativeNodeId} gibt es nicht oder ist nicht erreichbar`);

  if (!plan.reason?.trim() || plan.reason.length > 400) e.push('Begründung fehlt oder ist zu lang');
  const known = new Set([...st.records.map((r) => r.id), ...s.events.map((ev) => ev.id)]);
  const cited = Array.isArray(plan.basedOn) ? plan.basedOn : [];
  const unknown = cited.filter((id) => !known.has(id));
  if (!cited.some((id) => known.has(id))) e.push('Die Begründung muss mindestens einen Lerneintrag (LR-…) oder ein Ereignis (ev-…) nennen');
  if (unknown.length) e.push(`unbekannte Belege: ${unknown.join(', ')}`);
  return e;
}
