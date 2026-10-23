// The learning agent. Rules decide, the model only writes (chat replies, hints, judging free text).
// 1. From the DCC profile it plans lessons per track (the faded nodes on the mind map).
// 2. After every lesson it picks the next step, explains why and offers an alternative.
// 3. It grows the map: new nodes when something was hard twice or too easy.
// It never changes the DCC profile, and missing DCC values are treated as unknown, not low.
import type {
  AiChatLesson, DccLevel, DccProfile, LearningEvent, Lesson, MapNode, Observation, RuleId, Skill, Source, Track,
} from '@l45/shared';
import { DCC_LEVELS } from '@l45/shared';

export interface Decision {
  ruleId: RuleId;
  ruleName: string;
  /** Node to recommend. Missing = nothing fits (time is up, or all done) */
  nodeId?: string;
  alternativeNodeId?: string;
  observation: string;
  reason: string;
  why: string;
  tags: Source[];
  /** Nodes the agent adds to the map for this decision */
  newNodes: MapNode[];
  /** Lessons the agent created for these nodes */
  newLessons: Lesson[];
}

export const RULE_NAME: Record<RuleId, string> = {
  R0: 'Weiter im Lernweg',
  R1: 'Wiederholte Schwierigkeit',
  R2: 'Unterfordert',
  R3: 'Start nach DCC-Profil',
  R4: 'Wenig Zeit',
  R5: 'Alternative gewählt',
  R6: 'Hilfe in der Aufgabe',
  R7: 'Bereich abgeschlossen',
  A1: 'Agent-Plan',
};

// --- Initial plan --------------------------------------------------------------------------

const byLevel = (lessons: Lesson[], trackId: string, level: DccLevel) => lessons.filter((l) => l.trackId === trackId && l.level === level);

/** Which lessons to place on a track's branch, given the DCC level. undefined = skill without DCC. */
export function planTrack(track: Track, level: DccLevel | null | undefined, lessons: Lesson[]): Lesson[] {
  const G = byLevel(lessons, track.id, 'Grundstufe');
  const M = byLevel(lessons, track.id, 'Mittelstufe');
  const F = byLevel(lessons, track.id, 'Fortgeschritten');
  if (level === undefined) return [...G, ...M].slice(0, 3);
  // Not assessed: a short starter, then one step up. No assumption that the level is low.
  if (level === null) return [[...G].sort((a, b) => a.durationMin - b.durationMin)[0], M[0]].filter(Boolean) as Lesson[];
  if (level === 'Grundstufe') return G.slice(0, 3);
  if (level === 'Mittelstufe') return [...M, ...F].slice(0, 3);
  return [...F, ...M].slice(0, 2);
}

/** starterOnly: with the planner agent, each track starts with one lesson; the agent grows the rest. */
export function buildMap(userName: string, skills: Skill[], dcc: DccProfile, lessons: Lesson[], starterOnly = false): MapNode[] {
  const nodes: MapNode[] = [{ id: 'start', kind: 'start', parentId: null, label: userName }];
  for (const skill of skills) {
    const sid = `s-${skill.id}`;
    nodes.push({ id: sid, kind: 'skill', parentId: 'start', label: skill.name, skillId: skill.id });
    for (const track of skill.tracks) {
      const tid = `t-${track.id}`;
      nodes.push({ id: tid, kind: 'track', parentId: sid, label: track.name, skillId: skill.id, trackId: track.id });
      let parent = tid;
      const plan = planTrack(track, skill.dccBased ? dcc.levels[track.id] ?? null : undefined, lessons);
      for (const lesson of starterOnly ? plan.slice(0, 1) : plan) {
        const id = `n-${lesson.id}`;
        nodes.push({ id, kind: 'lesson', parentId: parent, label: lesson.title, skillId: skill.id, trackId: track.id, lessonId: lesson.id, state: 'planned' });
        parent = id;
      }
    }
  }
  return nodes;
}

// --- Decisions ---------------------------------------------------------------------------------

export interface AgentInput {
  skills: Skill[];
  dcc: DccProfile;
  nodes: MapNode[];
  events: LearningEvent[];
  observations: Observation[];
  lessons: Lesson[];
  remainingMin: number;
  /** For unique ids of agent-created lessons */
  counter: number;
}

const levelRank = (l: DccLevel) => DCC_LEVELS.indexOf(l);

function trackPriority(input: AgentInput, trackId: string): number {
  const skill = input.skills.find((s) => s.tracks.some((t) => t.id === trackId));
  if (!skill?.dccBased) return 10;
  const level = input.dcc.levels[trackId];
  // Grundstufe first (largest need according to the DCC), then not assessed (short starter), then higher levels.
  if (level === 'Grundstufe') return 0;
  if (level === null || level === undefined) return 1;
  return 2 + levelRank(level);
}

const lessonOf = (input: AgentInput, n?: MapNode) => (n?.lessonId ? input.lessons.find((l) => l.id === n.lessonId) : undefined);
const trackOf = (input: AgentInput, id: string) => input.skills.flatMap((s) => s.tracks).find((t) => t.id === id)!;
const label = (input: AgentInput, trackId: string, crit: string) => trackOf(input, trackId).criteria.find((c) => c.id === crit)?.label ?? crit;

/** Planned nodes that can be done next: their parent is not itself still planned. */
export function frontier(input: Pick<AgentInput, 'nodes'>, trackId?: string): MapNode[] {
  const byId = new Map(input.nodes.map((n) => [n.id, n]));
  return input.nodes.filter((n) => {
    if (n.kind !== 'lesson' || n.state !== 'planned') return false;
    if (trackId && n.trackId !== trackId) return false;
    const parent = n.parentId ? byId.get(n.parentId) : undefined;
    return !parent || parent.kind !== 'lesson' || parent.state === 'done' || parent.state === 'skipped';
  });
}

function tracksByPriority(input: AgentInput, exclude?: string): string[] {
  return input.skills.flatMap((s) => s.tracks.map((t) => t.id))
    .filter((id) => id !== exclude && frontier(input, id).length > 0)
    .sort((a, b) => trackPriority(input, a) - trackPriority(input, b));
}

function lastDoneNode(input: AgentInput, trackId: string): MapNode {
  const done = input.nodes.filter((n) => n.trackId === trackId && n.kind === 'lesson' && n.state === 'done');
  return done.at(-1) ?? input.nodes.find((n) => n.kind === 'track' && n.trackId === trackId)!;
}

function inMap(input: AgentInput, lessonId: string) {
  return input.nodes.some((n) => n.lessonId === lessonId);
}

function newNode(input: AgentInput, lesson: Lesson, parentId: string): MapNode {
  return {
    id: `n-${lesson.id}-${input.counter}`,
    kind: 'lesson',
    parentId,
    label: lesson.title,
    skillId: input.skills.find((s) => s.tracks.some((t) => t.id === lesson.trackId))?.id,
    trackId: lesson.trackId,
    lessonId: lesson.id,
    state: 'planned',
    addedByAgent: true,
  };
}

export function keywordPatterns(text: string): string[] {
  const words = text.toLowerCase().replace(/[«».,:;!?()]/g, ' ').split(/\s+/).filter((w) => w.length >= 5);
  return [...new Set(words)].slice(0, 8).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
}

/** A short AI conversation about exactly the criterion that was missed twice. Created by the agent. */
export function clarifyLesson(track: Track, criterionId: string, n: number): AiChatLesson {
  const c = track.criteria.find((x) => x.id === criterionId) ?? { id: criterionId, label: criterionId, ruleOfThumb: '' };
  return {
    id: `klaeren-${track.id}-${criterionId}-${n}`,
    trackId: track.id,
    type: 'ai-chat',
    level: 'Grundstufe',
    title: `Mit KI klären: ${c.label}`,
    intro: `Du hast «${c.label}» zweimal übersehen. Kläre mit der KI, woran du es erkennst.`,
    durationMin: 3,
    mode: 'ai',
    targets: [criterionId],
    transfer: c.ruleOfThumb,
    source: 'prepared',
    content: {
      kind: 'tutor',
      goal: `Am Schluss sagst du in einem Satz, woran du «${c.label}» erkennst und wie du es prüfst.`,
      aiRole: `Du bist ein Lerncoach. Die Person hat in Übungen im Bereich «${track.name}» zweimal «${c.label}» übersehen. Hilf ihr mit Rückfragen zu verstehen, woran man das erkennt und wie man es prüft. Ziel ist dieser Merksatz: «${c.ruleOfThumb}». Verrate ihn nicht sofort, lass die Person ihn selbst formulieren.`,
      opening: `In den letzten Übungen ist dir «${c.label}» zweimal entgangen. Was glaubst du, warum man das leicht übersieht?`,
      criteria: [{ id: criterionId, label: c.label, hint: c.ruleOfThumb, patterns: keywordPatterns(`${c.label} ${c.ruleOfThumb}`) }],
      fallbackReplies: [
        'Danke. Woran könntest du beim nächsten Mal schneller merken, dass du hier genau hinschauen musst?',
        'Gut. Wie würdest du es konkret prüfen, Schritt für Schritt?',
        `Fass es jetzt in einem eigenen Satz zusammen. Zum Vergleich der Merksatz: «${c.ruleOfThumb}»`,
        'Danke. Du kannst die Lektion jetzt abschliessen.',
      ],
      minTurns: 3,
    },
  };
}

export function decide(input: AgentInput): Decision {
  const base = { newNodes: [] as MapNode[], newLessons: [] as Lesson[] };
  const end = (ruleId: RuleId, observation: string, reason: string, why: string): Decision => ({
    ...base, ruleId, ruleName: RULE_NAME[ruleId], observation, reason, why, tags: ['rule'],
  });

  if (input.remainingMin <= 0) {
    return end('R4', 'Die geplante Zeit für heute ist um.', 'Deine Zeit für heute ist aufgebraucht.', 'Lieber an einem guten Punkt aufhören. Die Karte merkt sich, wo es weitergeht.');
  }

  const core = coreDecision(input);
  const chosen = input.nodes.find((n) => n.id === core.nodeId) ?? core.newNodes.find((n) => n.id === core.nodeId);
  const chosenLesson = chosen?.lessonId ? [...input.lessons, ...core.newLessons].find((l) => l.id === chosen.lessonId) : undefined;
  if (!chosenLesson || chosenLesson.durationMin <= input.remainingMin) return core;

  // R4: does not fit the remaining time -> shortest fitting next step, same track first.
  const fits = frontier(input)
    .map((n) => ({ n, l: lessonOf(input, n)! }))
    .filter((x) => x.l && x.l.durationMin <= input.remainingMin)
    .sort((a, b) => Number(b.n.trackId === chosen?.trackId) - Number(a.n.trackId === chosen?.trackId) || a.l.durationMin - b.l.durationMin);
  if (!fits[0]) {
    return end('R4', `Noch ${input.remainingMin} Min. Zeit; der nächste Schritt dauert ${chosenLesson.durationMin} Min.`, `Für keinen nächsten Schritt reichen die restlichen ${input.remainingMin} Minuten.`, 'Lieber an einem guten Punkt aufhören. Die Karte merkt sich, wo es weitergeht.');
  }
  return {
    ...core,
    ruleId: 'R4',
    ruleName: RULE_NAME.R4,
    nodeId: fits[0].n.id,
    alternativeNodeId: chosen!.id,
    observation: `${core.observation} Noch ${input.remainingMin} Min. Zeit.`,
    reason: `Dir bleiben noch ${input.remainingMin} Minuten. «${chosenLesson.title}» dauert ${chosenLesson.durationMin}.`,
    why: 'Ein kleiner, abgeschlossener Schritt bringt mehr als ein angefangener grosser. Der längere Schritt bleibt als Alternative.',
    tags: ['rule'],
  };
}

function coreDecision(input: AgentInput): Decision {
  const base = { newNodes: [] as MapNode[], newLessons: [] as Lesson[] };
  const last = input.events.at(-1);

  // R3: nothing done yet -> start where the DCC profile shows the largest need.
  if (!last) {
    const order = tracksByPriority(input);
    const first = order[0];
    if (!first) return { ...base, ruleId: 'R7', ruleName: RULE_NAME.R7, observation: 'Keine Lektionen geplant.', reason: 'Es gibt nichts zu tun.', why: '', tags: ['rule'] };
    const node = frontier(input, first)[0];
    const alt = order[1] ? frontier(input, order[1])[0] : undefined;
    const level = input.dcc.levels[first];
    const t = trackOf(input, first);
    const notAssessed = level === null || level === undefined;
    return {
      ...base,
      ruleId: 'R3',
      ruleName: RULE_NAME.R3,
      nodeId: node.id,
      alternativeNodeId: alt?.id,
      observation: notAssessed ? `Für «${t.name}» gibt es kein DCC-Resultat.` : `DCC-Profil: ${level} in «${t.name}».`,
      reason: notAssessed ? `Für «${t.name}» fehlt ein DCC-Resultat. Ein kurzer Einstieg zeigt, wo du anfängst.` : `Laut DCC-Profil liegt in «${t.name}» dein grösster Entwicklungsbedarf.`,
      why: notAssessed
        ? 'Fehlende Werte heissen nicht geringe Kompetenz. Deshalb ein kurzer Einstieg statt eines ganzen Grundkurses.'
        : 'Die Lektionen passen zu deiner DCC-Stufe. Die DCC-Position selbst ändert sich durch das Lernen hier nicht.',
      tags: ['rule'],
    };
  }

  const T = last.trackId;
  const track = trackOf(input, T);
  const trackEvents = input.events.filter((e) => e.trackId === T);

  // R1: the same criterion missed twice -> the agent creates a short AI conversation about exactly that.
  const repeated = input.observations
    .filter((o) => o.trackId === T && o.status === 'active' && o.count >= 2)
    .find((o) => !input.nodes.some((n) => n.lessonId?.startsWith(`klaeren-${T}-${o.criterion}-`)));
  if (repeated && track.criteria.some((c) => c.id === repeated.criterion)) {
    const lesson = clarifyLesson(track, repeated.criterion, input.counter);
    const parent = lastDoneNode(input, T);
    const node = newNode(input, lesson, parent.id);
    // Alternative on the same fork: another example alone, targeting the same criterion.
    const altLesson = input.lessons.find((l) => l.trackId === T && l.mode === 'alone' && l.targets.includes(repeated.criterion) && !inMap(input, l.id));
    const altNode = altLesson ? newNode({ ...input, counter: input.counter + 1 }, altLesson, parent.id) : frontier(input, T)[0];
    return {
      newLessons: [lesson],
      newNodes: altLesson && altNode ? [node, altNode] : [node],
      ruleId: 'R1',
      ruleName: RULE_NAME.R1,
      nodeId: node.id,
      alternativeNodeId: altNode?.id,
      observation: repeated.text,
      reason: `Du hast «${label(input, T, repeated.criterion)}» ${repeated.count}× übersehen.`,
      why: 'Wenn derselbe Fehler wiederholt auftritt, fehlt meist ein Begriff, nicht Übung. Ein kurzes Gespräch mit Rückfragen klärt, woran man es erkennt. Danach übst du wieder alleine.',
      tags: ['rule', 'model'],
    };
  }

  // R2: the last two lessons in this track went smoothly -> add a harder one.
  const lastTwo = trackEvents.slice(-2);
  const fluent = lastTwo.length === 2 && lastTwo.every((e) => e.result.allMet && !e.helpUsed && e.attempts <= 1);
  if (fluent) {
    const levels = lastTwo.map((e) => input.lessons.find((l) => l.id === e.lessonId)?.level ?? 'Grundstufe');
    const top = Math.max(...levels.map(levelRank));
    const harder = input.lessons.find((l) => l.trackId === T && levelRank(l.level) > top && !inMap(input, l.id));
    if (harder) {
      const parent = lastDoneNode(input, T);
      const node = newNode(input, harder, parent.id);
      const other = tracksByPriority(input, T)[0];
      const alt = other ? frontier(input, other)[0] : undefined;
      return {
        newLessons: [],
        newNodes: [node],
        ruleId: 'R2',
        ruleName: RULE_NAME.R2,
        nodeId: node.id,
        alternativeNodeId: alt?.id,
        observation: `Die letzten zwei Lektionen in «${track.name}» ohne Hilfe gelöst.`,
        reason: `Das klappt schon gut. Der Agent fügt eine anspruchsvollere Lektion (${harder.level}) hinzu.`,
        why: 'Aufgaben, die zu leicht sind, bringen wenig. Eine Stufe höher bleibt es lehrreich. Die DCC-Stufe ändert sich dadurch nicht.',
        tags: ['rule'],
      };
    }
  }

  // R0: continue. Aim at what was missed last time, otherwise keep going in this track.
  const missed = last.result.criteria.filter((c) => c.status === 'missed' && c.key !== 'entscheid').map((c) => c.key);
  const helped = last.helpUsed || last.attempts > 1 ? last.result.criteria.filter((c) => c.key !== 'entscheid').map((c) => c.key) : [];
  const focus = [...new Set([...missed, ...helped])];
  const otherTrack = tracksByPriority(input, T)[0];
  const altOther = otherTrack ? frontier(input, otherTrack)[0] : undefined;

  if (focus.length) {
    const planned = frontier(input, T).find((n) => lessonOf(input, n)?.targets.some((t) => focus.includes(t)));
    const fromPool = planned ? undefined : input.lessons.find((l) => l.trackId === T && l.mode === 'alone' && l.targets.some((t) => focus.includes(t)) && !inMap(input, l.id));
    const node = planned ?? (fromPool ? newNode(input, fromPool, lastDoneNode(input, T).id) : undefined);
    if (node) {
      const crit = (lessonOf(input, node) ?? fromPool)!.targets.find((t) => focus.includes(t))!;
      const wasHelped = !missed.includes(crit);
      return {
        newLessons: [],
        newNodes: planned ? [] : [node],
        ruleId: 'R0',
        ruleName: RULE_NAME.R0,
        nodeId: node.id,
        alternativeNodeId: altOther?.id,
        observation: wasHelped ? `«${label(input, T, crit)}» mit Hinweis gefunden.` : `«${label(input, T, crit)}» zuletzt übersehen.`,
        reason: wasHelped ? `Bei «${label(input, T, crit)}» hast du einen Hinweis gebraucht.` : `«${label(input, T, crit)}» ist dir zuletzt entgangen.`,
        why: 'Ein weiteres Beispiel zur gleichen Sache zeigt, ob es jetzt alleine klappt.',
        tags: ['rule'],
      };
    }
  }

  const next = frontier(input, T)[0];
  if (next) {
    return {
      ...base,
      ruleId: 'R0',
      ruleName: RULE_NAME.R0,
      nodeId: next.id,
      alternativeNodeId: altOther?.id,
      observation: last.result.allMet ? 'Letzte Lektion vollständig gelöst.' : 'Letzte Lektion abgeschlossen.',
      reason: `Weiter in «${track.name}».`,
      why: 'Im gleichen Bereich weiterzumachen hilft, das Gelernte zu festigen.',
      tags: ['rule'],
    };
  }

  if (otherTrack && altOther) {
    const t2 = trackOf(input, otherTrack);
    const second = tracksByPriority(input, T)[1];
    return {
      ...base,
      ruleId: 'R7',
      ruleName: RULE_NAME.R7,
      nodeId: altOther.id,
      alternativeNodeId: second ? frontier(input, second)[0]?.id : undefined,
      observation: `Alle geplanten Lektionen in «${track.name}» erledigt.`,
      reason: `Weiter mit «${t2.name}», dem nächsten Bereich nach deinem DCC-Profil.`,
      why: 'Die Reihenfolge folgt deinem DCC-Profil: zuerst die Bereiche mit dem grössten Bedarf.',
      tags: ['rule'],
    };
  }
  return { ...base, ruleId: 'R7', ruleName: RULE_NAME.R7, observation: 'Alle geplanten Lektionen erledigt.', reason: 'Du hast alles auf deiner Karte erledigt.', why: 'Mit einem neuen DCC-Resultat plant der Agent die nächsten Schritte.', tags: ['rule'] };
}

// --- Observations ---------------------------------------------------------------------------

export function updateObservations(obs: Observation[], ev: LearningEvent, criterionText: (trackId: string, key: string) => string, makeId: () => string): Observation[] {
  const next = obs.map((o) => ({ ...o }));
  const seen = new Set<string>();
  for (const c of ev.result.criteria) {
    if (seen.has(`${c.key}:${c.status}`)) continue;
    seen.add(`${c.key}:${c.status}`);
    const active = next.find((o) => o.trackId === ev.trackId && o.criterion === c.key && o.status === 'active');
    const name = c.key === 'entscheid' ? c.label : criterionText(ev.trackId, c.key);
    if (c.status === 'missed') {
      if (active) {
        active.count += 1;
        active.text = `«${name}» ${active.count}× übersehen`;
      } else {
        next.push({ id: makeId(), trackId: ev.trackId, criterion: c.key, text: `«${name}» 1× übersehen`, count: 1, status: 'active', createdAt: ev.at });
      }
    } else if (active && !ev.helpUsed && !ev.result.criteria.some((x) => x.key === c.key && x.status === 'missed')) {
      active.status = 'outdated';
    }
  }
  return next;
}
