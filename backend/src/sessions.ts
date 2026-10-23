// Sessions and the actions on them. In memory: nothing needs to survive the demo.
import type {
  Answer, ChatTurn, DccProfile, Lesson, LessonResult, MapNode, MockPart, PartialCheck, Recommendation, Session, SessionView, Source,
} from '@l45/shared';
import { buildMap, decide, updateObservations } from './agent.ts';
import { content, criterionLabel } from './content.ts';
import {
  judgeMarkEvidence, judgeMockSite, judgeVideo, partialMarkEvidence, partialMockSite,
} from './judge.ts';
import { modelStatus, providerName } from './provider.ts';
import { chatReply, hintMarkEvidence, hintMockSite, judgeChat, type Opts } from './services.ts';
import { newId, nowIso } from './util.ts';

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

interface Stored {
  session: Session;
  dcc: DccProfile;
}

const store = new Map<string, Stored>();

export function get(id: string): Stored {
  const s = store.get(id);
  if (!s) throw new HttpError(404, 'Sitzung nicht gefunden. Bitte neu anmelden.');
  return s;
}

const remaining = (s: Session) => Math.max(0, s.timeBudgetMin - s.usedMin);
const offline = (s: Session) => s.simulation || providerName() === 'none';
const opts = (s: Session): Opts => ({ offline: offline(s), onCall: (c) => s.modelCalls.push(c) });

function lessons(s: Session): Lesson[] {
  return [...content.lessons, ...s.generatedLessons];
}

function lessonById(s: Session, id: string): Lesson {
  const l = lessons(s).find((x) => x.id === id);
  if (!l) throw new HttpError(404, 'Lektion nicht gefunden');
  return l;
}

function nodeById(s: Session, id: string): MapNode & { lessonId: string } {
  const n = s.nodes.find((x) => x.id === id);
  if (!n || n.kind !== 'lesson' || !n.lessonId) throw new HttpError(404, 'Knoten nicht gefunden');
  return n as MapNode & { lessonId: string };
}

export function openRecommendation(s: Session): Recommendation | null {
  const r = s.recommendations.at(-1);
  return r && r.status === 'open' ? r : null;
}

// --- Login -------------------------------------------------------------------------------------

export function createSession(input: { name: string; timeBudgetMin: number; dcc: DccProfile }): Stored {
  const name = input.name.trim().slice(0, 40) || 'Du';
  const session: Session = {
    id: newId('s'),
    createdAt: nowIso(),
    userName: name,
    timeBudgetMin: input.timeBudgetMin,
    usedMin: 0,
    simulation: false,
    nodes: buildMap(name, content.skills, input.dcc, content.lessons),
    recommendations: [],
    observations: [],
    events: [],
    transfer: [],
    helpUsed: {},
    checks: {},
    modelCalls: [],
    generatedLessons: [],
  };
  const stored = { session, dcc: input.dcc };
  store.set(session.id, stored);
  recommend(stored);
  return stored;
}

// --- The agent's next step ----------------------------------------------------------------------

function recommend(st: Stored) {
  const s = st.session;
  const open = openRecommendation(s);
  if (open) s.recommendations = s.recommendations.filter((r) => r.id !== open.id);
  for (const n of s.nodes) if (n.state === 'recommended' || n.state === 'alternative') n.state = 'planned';

  const d = decide({
    skills: content.skills,
    dcc: st.dcc,
    nodes: s.nodes,
    events: s.events,
    observations: s.observations,
    lessons: lessons(s),
    remainingMin: remaining(s),
    counter: s.nodes.length,
  });
  s.generatedLessons.push(...d.newLessons);
  s.nodes.push(...d.newNodes);
  const rec: Recommendation = {
    id: newId('r'),
    createdAt: nowIso(),
    ruleId: d.ruleId,
    ruleName: d.ruleName,
    nodeId: d.nodeId ?? '',
    alternativeNodeId: d.alternativeNodeId,
    observation: d.observation,
    reason: d.reason,
    why: d.why,
    tags: d.tags,
    status: 'open',
  };
  s.recommendations.push(rec);
  for (const n of s.nodes) {
    if (n.id === rec.nodeId) {
      n.state = 'recommended';
      n.recommendationId = rec.id;
    } else if (n.id === rec.alternativeNodeId) {
      n.state = 'alternative';
      n.recommendationId = rec.id;
    }
  }
}

// --- Lessons -------------------------------------------------------------------------------------

/** Strips solutions before a lesson goes to the browser. */
export function publicLesson(l: Lesson): Lesson {
  switch (l.type) {
    case 'mark-evidence':
      return { ...l, content: { ...l.content, summary: l.content.summary.map((x) => ({ id: x.id, text: x.text, verdict: 'belegt' as const, explanation: '' })) } };
    case 'mock-site': {
      const strip = (p: MockPart): MockPart => ({ id: p.id, kind: p.kind, text: p.text, linkTarget: p.linkTarget });
      return {
        ...l,
        content: { ...l.content, mail: l.content.mail?.map(strip), site: l.content.site.map(strip), correctVerdict: 'phishing', verdictExplanation: '' },
      };
    }
    case 'video':
      return { ...l, content: { ...l.content, questions: l.content.questions.map((q) => ({ ...q, correct: -1, explanation: '' })) } };
    case 'ai-chat':
      return { ...l, content: { ...l.content, aiRole: '', fallbackReplies: [], criteria: l.content.criteria.map((c) => ({ ...c, patterns: [] })) } };
  }
}

export function startNode(st: Stored, nodeId: string): { lesson: Lesson; switched?: string } {
  const s = st.session;
  const node = nodeById(s, nodeId);
  const rec = openRecommendation(s);
  let switched: string | undefined;
  if (rec && node.state === 'recommended') rec.status = 'accepted';
  if (rec && node.state === 'alternative') {
    // Choosing the alternative = declining the recommendation. Recorded as such.
    rec.status = 'declined';
    switched = 'Du hast die Alternative gewählt. Der Agent merkt sich das und plant danach neu.';
  }
  delete s.helpUsed[nodeId];
  delete s.checks[nodeId];
  return { lesson: publicLesson(lessonById(s, node.lessonId)), switched };
}

export function partialCheck(st: Stored, nodeId: string, a: Answer): PartialCheck {
  const s = st.session;
  const l = lessonById(s, nodeById(s, nodeId).lessonId);
  let c: PartialCheck;
  if (l.type === 'mark-evidence' && a.type === 'mark-evidence') c = partialMarkEvidence(l, a);
  else if (l.type === 'mock-site' && a.type === 'mock-site') c = partialMockSite(l, a);
  else throw new HttpError(400, 'Zwischenprüfung gibt es nur bei Text- und Webseiten-Aufgaben');
  if (!c.complete) s.checks[nodeId] = (s.checks[nodeId] ?? 0) + 1;
  return c;
}

export async function hint(st: Stored, nodeId: string, a: Answer): Promise<{ text: string; source: Source }> {
  const s = st.session;
  const l = lessonById(s, nodeById(s, nodeId).lessonId);
  s.helpUsed[nodeId] = true;
  if (l.type === 'mark-evidence' && a.type === 'mark-evidence') return hintMarkEvidence(l, a.marks, opts(s));
  if (l.type === 'mock-site' && a.type === 'mock-site') return hintMockSite(l, a.marked);
  return { text: 'Lies die Aufgabe noch einmal und geh Punkt für Punkt vor.', source: 'prepared' };
}

export async function chat(st: Stored, nodeId: string, turns: ChatTurn[]): Promise<{ text: string; source: Source }> {
  const s = st.session;
  const l = lessonById(s, nodeById(s, nodeId).lessonId);
  if (l.type !== 'ai-chat') throw new HttpError(400, 'Keine Chat-Lektion');
  return chatReply(l, turns.slice(-20), opts(s));
}

export async function complete(st: Stored, nodeId: string, a: Answer, durationMin?: number): Promise<LessonResult> {
  const s = st.session;
  const node = nodeById(s, nodeId);
  const l = lessonById(s, node.lessonId);
  let result: LessonResult;
  if (l.type === 'mark-evidence' && a.type === 'mark-evidence') result = judgeMarkEvidence(l, a);
  else if (l.type === 'mock-site' && a.type === 'mock-site') result = judgeMockSite(l, a);
  else if (l.type === 'video' && a.type === 'video') result = judgeVideo(l, a);
  else if (l.type === 'ai-chat' && a.type === 'ai-chat') result = await judgeChat(l, a.turns.slice(-30), opts(s));
  else throw new HttpError(400, 'Antwort passt nicht zur Lektion');

  const helpUsed = Boolean(s.helpUsed[nodeId]);
  const attempts = 1 + (s.checks[nodeId] ?? 0);
  delete s.helpUsed[nodeId];
  delete s.checks[nodeId];

  const at = nowIso();
  const usedModel = result.judgedBy === 'model' || (a.type === 'ai-chat' && a.turns.some((t) => t.source === 'model'));
  const event = {
    id: newId('ev'), at, nodeId, lessonId: l.id, trackId: l.trackId, mode: l.mode, helpUsed, attempts,
    durationMin: Math.max(1, Math.round(durationMin ?? l.durationMin)), result,
    source: (usedModel ? 'model' : 'prepared') as Source,
  };
  s.events.push(event);
  s.observations = updateObservations(s.observations, event, criterionLabel, () => newId('ob'));
  s.usedMin += l.durationMin;
  if (l.transfer) s.transfer.push({ at, lessonTitle: l.title, text: l.transfer });

  // The recommendation is settled: if the learner started something else, record it as declined.
  const rec = openRecommendation(s);
  if (rec && rec.nodeId !== nodeId) rec.status = 'declined';
  if (rec && rec.nodeId === nodeId) rec.status = 'accepted';

  Object.assign(node, { state: 'done', result, helpUsed });
  recommend(st);
  return result;
}

export function patch(st: Stored, body: { timeBudgetMin?: unknown; simulation?: unknown }) {
  const s = st.session;
  if (body.timeBudgetMin !== undefined) {
    const t = Number(body.timeBudgetMin);
    if (!Number.isFinite(t) || t < 1 || t > 180) throw new HttpError(400, 'Zeit: 1 bis 180 Minuten');
    s.timeBudgetMin = Math.round(t);
  }
  if (body.simulation !== undefined) s.simulation = Boolean(body.simulation);
  recommend(st);
}

export function view(st: Stored): SessionView {
  const { generatedLessons: _g, ...session } = st.session;
  return {
    session,
    dcc: st.dcc,
    recommendation: openRecommendation(st.session),
    remainingMin: remaining(st.session),
    modelStatus: modelStatus(st.session.simulation),
  };
}

/** Lessons the agent created in this session (without solutions), so the map can show them. */
export function generatedPublic(st: Stored): Lesson[] {
  return st.session.generatedLessons.map(publicLesson);
}

export function _reset() {
  store.clear();
}
