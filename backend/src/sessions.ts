// Sessions and the actions on them. A session is one sitting of a learner; the learner's workspace
// (map, events, records, missions, generated lessons) lives on disk and survives a restart.
import type {
  Answer, ChatTurn, DccProfile, DccSnapshot, LearnerProfile, LearningEvent, Lesson, LessonResult, LoginConflict, MapNode, Mission,
  MockPart, PartialCheck, Recommendation, Session, SessionView, Source,
} from '@l45/shared';
import { buildMap, decide, planTrack, updateObservations, type Decision } from './agent.ts';
import { allTracks, content, criterionLabel, getTrack, skillOf } from './content.ts';
import { allLessons, checkPlan, remaining } from './guard.ts';
import {
  judgeMarkEvidence, judgeMockSite, judgeVideo, partialMarkEvidence, partialMockSite,
} from './judge.ts';
import { modelStatus, providerName } from './provider.ts';
import { addRecord, lernstandAll, recordFromEvent, settleReviews } from './records.ts';
import { chatReply, hintMarkEvidence, hintMockSite, judgeChat, type Opts } from './services.ts';
import { newId, nowIso } from './util.ts';
import {
  _wipe, findByName, findBySession, loadLearner, nextLessonNumber, readState, writeLesson, writeMission, writeProfile, writeState,
  type Stored,
} from './workspace.ts';

export type { Stored } from './workspace.ts';

export class HttpError extends Error {
  constructor(public status: number, message: string, public body?: object) {
    super(message);
  }
}

/** Loaded workspaces by session id. Only a cache: everything is on disk. */
const cache = new Map<string, Stored>();

export function get(id: string): Stored {
  let st = cache.get(id);
  if (!st) {
    const learnerId = findBySession(id);
    const loaded = learnerId ? loadLearner(learnerId) : null;
    if (loaded?.session.id === id) {
      cache.set(id, loaded);
      st = loaded;
    }
  }
  if (!st) throw new HttpError(404, 'Sitzung nicht gefunden. Bitte neu anmelden.');
  return st;
}

const offline = (s: Session) => s.simulation || providerName() === 'none';
const opts = (s: Session): Opts => ({ offline: offline(s), onCall: (c) => s.modelCalls.push(c) });

/** The planner agent needs tool use: Anthropic, or the mock provider in tests. Other providers keep the rules. */
const plannerProvider = () => providerName() === 'anthropic' || providerName() === 'mock';
export const agentAvailable = (s: Session) => !s.simulation && plannerProvider();

export function save(st: Stored) {
  writeState(st.session);
}

function lessonById(s: Session, id: string): Lesson {
  const l = allLessons(s).find((x) => x.id === id);
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

/** Saves a lesson made during learning to the workspace (lessons/0001-<slug>.json). */
export function storeLesson(st: Stored, lesson: Lesson) {
  st.session.generatedLessons.push(lesson);
  writeLesson(st.profile.id, nextLessonNumber(st.profile.id), lesson);
}

// --- Login -------------------------------------------------------------------------------------

const snapshot = (dcc: DccProfile): DccSnapshot => ({ at: nowIso(), source: dcc.source, fileName: dcc.fileName, profile: dcc });
const sameDcc = (a: DccProfile, b: DccProfile) => JSON.stringify(a.levels) === JSON.stringify(b.levels) && a.assessedOn === b.assessedOn;

export interface LoginInput {
  name: string;
  timeBudgetMin: number;
  dcc: DccProfile;
  /** Needed when a learner with this name exists */
  resume?: 'continue' | 'new';
}

export function login(input: LoginInput): Stored {
  const name = input.name.trim().slice(0, 40) || 'Du';
  const existing = findByName(name)[0];
  if (existing && input.resume !== 'continue' && input.resume !== 'new') {
    const conflict: LoginConflict = { code: 'learner-exists', name: existing.name, createdAt: existing.createdAt, lessonsDone: readState(existing.id)?.events.length ?? 0 };
    throw new HttpError(409, `Es gibt schon einen Verlauf für «${existing.name}».`, conflict);
  }
  if (existing && input.resume === 'continue') return resume(existing.id, input);
  return createLearner(name, input);
}

/** Kept for callers that always want a new learner. */
export const createSession = (input: Omit<LoginInput, 'resume'>) => login({ ...input, resume: 'new' });

function createLearner(name: string, input: LoginInput): Stored {
  const profile: LearnerProfile = { id: newId('l'), name, createdAt: nowIso(), dccSnapshots: [snapshot(input.dcc)] };
  const session: Session = {
    id: newId('s'),
    learnerId: profile.id,
    sessionNo: 1,
    createdAt: nowIso(),
    userName: name,
    timeBudgetMin: input.timeBudgetMin,
    usedMin: 0,
    simulation: false,
    // With the agent: one starter lesson per track, the agent generates the rest. Without: the whole plan from the pool.
    nodes: buildMap(name, content.skills, input.dcc, content.lessons, plannerProvider()),
    recommendations: [],
    observations: [],
    events: [],
    transfer: [],
    helpUsed: {},
    checks: {},
    modelCalls: [],
    generatedLessons: [],
    reviewQueue: [],
    missionChanges: [],
    plannerRuns: [],
    planning: false,
  };
  const st: Stored = { session, dcc: input.dcc, profile, missions: [], records: [], reference: {}, notes: [] };
  writeProfile(profile);
  recommend(st);
  save(st);
  cache.set(session.id, st);
  return st;
}

/** "Weitermachen": a new session on the existing workspace. Nothing is deleted. */
function resume(learnerId: string, input: LoginInput): Stored {
  const cached = [...cache.values()].find((x) => x.profile.id === learnerId);
  const st = cached ?? loadLearner(learnerId);
  if (!st) throw new HttpError(500, 'Verlauf konnte nicht gelesen werden');
  for (const [id, x] of cache) if (x === st) cache.delete(id);

  if (!sameDcc(st.dcc, input.dcc)) {
    // A new DCC result is a new snapshot. The old ones and all learning records stay.
    st.profile.dccSnapshots.push(snapshot(input.dcc));
    writeProfile(st.profile);
    const before = st.dcc;
    st.dcc = input.dcc;
    replanUntouched(st, before);
  }
  const s = st.session;
  Object.assign(s, {
    id: newId('s'),
    sessionNo: s.sessionNo + 1,
    createdAt: nowIso(),
    timeBudgetMin: input.timeBudgetMin,
    usedMin: 0,
    simulation: false,
    helpUsed: {},
    checks: {},
    modelCalls: [],
    planning: false,
  });
  for (const r of s.plannerRuns) if (r.outcome === 'running') Object.assign(r, { outcome: 'fallback', note: 'Abgebrochen: neue Sitzung', finishedAt: nowIso() });
  keepOrRecommend(st);
  save(st);
  cache.set(s.id, st);
  return st;
}

/** Tracks without any finished lesson get a fresh branch for the new DCC level. Branches with progress stay. */
function replanUntouched(st: Stored, before: DccProfile) {
  const s = st.session;
  for (const track of allTracks()) {
    const skill = skillOf(track.id);
    if (!skill?.dccBased || before.levels[track.id] === st.dcc.levels[track.id]) continue;
    const branch = s.nodes.filter((n) => n.kind === 'lesson' && n.trackId === track.id);
    if (branch.some((n) => n.state === 'done') || s.events.some((e) => e.trackId === track.id)) continue;
    s.nodes = s.nodes.filter((n) => !branch.includes(n));
    fillFromPool(st, track.id, agentAvailable(s) ? 1 : undefined);
  }
}

/**
 * Puts the pool lessons the DCC plan foresees for a track on the map, after the track's last lesson.
 * Used without the agent and when the agent fails. limit caps the lessons per track (1 = starter only).
 */
export function fillFromPool(st: Stored, trackId?: string, limit?: number): number {
  const s = st.session;
  let added = 0;
  for (const track of allTracks().filter((t) => !trackId || t.id === trackId)) {
    const skill = skillOf(track.id)!;
    const plan = planTrack(track, skill.dccBased ? st.dcc.levels[track.id] ?? null : undefined, content.lessons).slice(0, limit);
    const branch = () => s.nodes.filter((n) => n.kind === 'lesson' && n.trackId === track.id);
    for (const lesson of plan) {
      if (branch().some((n) => n.lessonId === lesson.id)) continue;
      const parent = branch().at(-1)?.id ?? `t-${track.id}`;
      const id = s.nodes.some((n) => n.id === `n-${lesson.id}`) ? `n-${lesson.id}-${s.nodes.length}` : `n-${lesson.id}`;
      s.nodes.push({ id, kind: 'lesson', parentId: parent, label: lesson.title, skillId: skill.id, trackId: track.id, lessonId: lesson.id, state: 'planned' });
      added++;
    }
  }
  return added;
}

// --- The next step ---------------------------------------------------------------------------------

/** Marks the recommended and alternative node and stores the recommendation as the open one. */
export function applyRecommendation(s: Session, rec: Recommendation) {
  const open = openRecommendation(s);
  if (open) s.recommendations = s.recommendations.filter((r) => r.id !== open.id);
  for (const n of s.nodes) if (n.state === 'recommended' || n.state === 'alternative') n.state = 'planned';
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

function toRecommendation(d: Decision, provisional = false): Recommendation {
  return {
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
    ...(provisional ? { provisional: true } : {}),
  };
}

/**
 * The rule engine decides. Also the fallback whenever the planner agent fails.
 * Without the agent the whole pool is on the map. A provisional plan marks the nodes it adds, so they can go again.
 */
export function recommend(st: Stored, provisional = false) {
  const s = st.session;
  if (!agentAvailable(s)) fillFromPool(st);
  // The open plan is replaced: its nodes count as planned again before the rules decide.
  const open = openRecommendation(s);
  if (open) s.recommendations = s.recommendations.filter((r) => r.id !== open.id);
  for (const n of s.nodes) if (n.state === 'recommended' || n.state === 'alternative') n.state = 'planned';
  const d = decide({
    skills: content.skills,
    dcc: st.dcc,
    nodes: s.nodes,
    events: s.events,
    observations: s.observations,
    lessons: allLessons(s),
    remainingMin: remaining(s),
    counter: s.nodes.length,
  });
  const lastEvent = s.events.at(-1)?.id;
  for (const l of d.newLessons) {
    storeLesson(st, { ...l, provenance: { by: 'rule', at: nowIso(), basedOn: lastEvent ? [lastEvent] : [], sessionNo: s.sessionNo } });
  }
  const rec = toRecommendation(d, provisional && Boolean(d.nodeId));
  s.nodes.push(...(rec.provisional ? d.newNodes.map((n) => ({ ...n, provisionalOf: rec.id })) : d.newNodes));
  applyRecommendation(s, rec);
}

/** After a change of time or session: an open agent plan stays if it still passes the guardrails. */
function keepOrRecommend(st: Stored) {
  const rec = openRecommendation(st.session);
  if (rec?.ruleId === 'A1' && rec.alternativeNodeId) {
    const problems = checkPlan(st, { nodeId: rec.nodeId, alternativeNodeId: rec.alternativeNodeId, reason: rec.reason, basedOn: rec.basedOn ?? [] });
    if (!problems.length) return;
  }
  recommend(st);
}

// --- Missions ----------------------------------------------------------------------------------------

export const defaultMission = (trackId: string) => getTrack(trackId)?.mission?.default ?? `Ich will in «${getTrack(trackId)?.name ?? trackId}» sicherer werden.`;
export const missionOf = (st: Stored, trackId: string): Mission | undefined => st.missions.find((m) => m.trackId === trackId);

/**
 * Sets the mission of a track. The first answer (or skipping) needs no confirmation.
 * A change of an existing mission needs `confirm` and is recorded as a mission-shift.
 */
export function setMission(st: Stored, trackId: string, body: { text?: unknown; skip?: unknown; confirm?: unknown }): Mission {
  const track = getTrack(trackId);
  if (!track) throw new HttpError(404, 'Bereich nicht gefunden');
  const existing = missionOf(st, trackId);
  const at = nowIso();
  let mission: Mission;
  if (body.skip) {
    if (existing) return existing;
    mission = { trackId, text: defaultMission(trackId), status: 'default', updatedAt: at };
  } else {
    const text = String(body.text ?? '').replace(/ß/g, 'ss').replace(/\s+/g, ' ').trim();
    if (text.length < 3 || text.length > 300) throw new HttpError(400, 'Die Mission braucht 3 bis 300 Zeichen.');
    if (existing && existing.text === text) return existing;
    if (existing && body.confirm !== true) throw new HttpError(409, 'Bitte bestätige die neue Mission.');
    mission = { trackId, text, status: 'set', updatedAt: at };
    if (existing) {
      const change = { id: newId('mi'), at, trackId, from: existing.text, to: text };
      st.session.missionChanges.push(change);
      addRecord(st, {
        kind: 'mission-shift', trackId, author: 'rule', evidence: [change.id],
        title: `Mission in «${track.name}» geändert`,
        body: `Vorher: «${existing.text}». Jetzt: «${text}». Von der Person bestätigt.`,
      });
    }
  }
  st.missions = [...st.missions.filter((m) => m.trackId !== trackId), mission];
  writeMission(st.profile.id, mission, track.name);
  save(st);
  return mission;
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
  save(st);
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
  save(st);
  return c;
}

export async function hint(st: Stored, nodeId: string, a: Answer): Promise<{ text: string; source: Source }> {
  const s = st.session;
  const l = lessonById(s, nodeById(s, nodeId).lessonId);
  s.helpUsed[nodeId] = true;
  save(st);
  if (l.type === 'mark-evidence' && a.type === 'mark-evidence') return hintMarkEvidence(l, a.marks, opts(s));
  if (l.type === 'mock-site' && a.type === 'mock-site') return hintMockSite(l, a.marked);
  return { text: 'Lies die Aufgabe noch einmal und geh Punkt für Punkt vor.', source: 'prepared' };
}

export async function chat(st: Stored, nodeId: string, turns: ChatTurn[]): Promise<{ text: string; source: Source }> {
  const s = st.session;
  const l = lessonById(s, nodeById(s, nodeId).lessonId);
  if (l.type !== 'ai-chat') throw new HttpError(400, 'Keine Chat-Lektion');
  const reply = await chatReply(l, turns.slice(-20), opts(s));
  save(st);
  return reply;
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
  const event: LearningEvent = {
    id: newId('ev'), at, nodeId, lessonId: l.id, trackId: l.trackId, mode: l.mode, helpUsed, attempts,
    durationMin: Math.max(1, Math.round(durationMin ?? l.durationMin)), result,
    source: (usedModel ? 'model' : 'prepared') as Source,
  };
  s.events.push(event);
  s.observations = updateObservations(s.observations, event, criterionLabel, () => newId('ob'));
  s.usedMin += l.durationMin;
  if (l.transfer) s.transfer.push({ at, lessonTitle: l.title, text: l.transfer });
  settleReviews(st, event);
  recordFromEvent(st, event);

  // The recommendation is settled: if the learner started something else, record it as declined.
  const rec = openRecommendation(s);
  if (rec && rec.nodeId !== nodeId) rec.status = 'declined';
  if (rec && rec.nodeId === nodeId) rec.status = 'accepted';

  Object.assign(node, { state: 'done', result, helpUsed });
  // The rules answer at once. With an agent, their plan is provisional until the agent is done.
  const withAgent = agentAvailable(s) && !s.plannerRuns.some((r) => r.eventId === event.id);
  recommend(st, withAgent);
  if (withAgent) startPlanner(st, event);
  save(st);
  return result;
}

// --- Planner agent (runs in the background) ------------------------------------------------------------

const running = new Map<Promise<void>, Stored>();

function startPlanner(st: Stored, ev: LearningEvent) {
  st.session.planning = true;
  const p: Promise<void> = import('./planner.ts')
    .then((m) => m.runPlanner(st, ev))
    .catch((err) => console.error('planner crashed', err))
    .finally(() => {
      running.delete(p);
      if (![...running.values()].includes(st)) st.session.planning = false;
    });
  running.set(p, st);
}

/** Test hook: waits until no planner runs. */
export async function _idle() {
  while (running.size) await Promise.all([...running.keys()]);
}

export function patch(st: Stored, body: { timeBudgetMin?: unknown; simulation?: unknown }) {
  const s = st.session;
  if (body.timeBudgetMin !== undefined) {
    const t = Number(body.timeBudgetMin);
    if (!Number.isFinite(t) || t < 1 || t > 180) throw new HttpError(400, 'Zeit: 1 bis 180 Minuten');
    s.timeBudgetMin = Math.round(t);
  }
  if (body.simulation !== undefined) s.simulation = Boolean(body.simulation);
  keepOrRecommend(st);
  save(st);
}

export function view(st: Stored): SessionView {
  const { generatedLessons: _g, ...session } = st.session;
  return {
    session,
    dcc: st.dcc,
    recommendation: openRecommendation(st.session),
    remainingMin: remaining(st.session),
    modelStatus: modelStatus(st.session.simulation),
    agentAvailable: agentAvailable(st.session),
    workspace: {
      missions: st.missions,
      records: st.records,
      reference: st.reference,
      notes: st.notes,
      lernstand: lernstandAll(st, allTracks()),
      dccSnapshots: st.profile.dccSnapshots.map(({ profile: _p, ...rest }) => rest),
    },
  };
}

/** Lessons the agent created for this learner (without solutions), so the map can show them. */
export function generatedPublic(st: Stored): Lesson[] {
  return st.session.generatedLessons.map(publicLesson);
}

/** Drops the in-memory cache, as after a server restart. Disk stays. */
export function clearCache() {
  cache.clear();
}

/** Test hook: forgets everything, also the learner folders in the test directory. */
export function _reset() {
  cache.clear();
  _wipe();
}
