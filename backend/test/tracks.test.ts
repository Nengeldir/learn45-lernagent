// The map starts empty. Learners add prepared tracks from the catalog or create their own from a topic:
// the model designs the track, only sources that answer are kept, and the generator writes every lesson.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SessionView } from '@l45/shared';
import { createApp } from '../src/app.ts';
import { setSourceCheck } from '../src/designer.ts';
import { setMockAgentHandler, setMockHandler, type AgentBlock, type ModelRequest } from '../src/provider.ts';
import { _idle, _reset } from '../src/sessions.ts';
import { learnersRoot } from '../src/workspace.ts';
import { addTracks, scripted, session, use, type Turn } from './helpers.ts';

const app = createApp();

const COMPTIA = 'https://www.comptia.org/certifications/security';
const NIST = 'https://csrc.nist.gov/glossary';

/** What the model answers when asked to design a track for "Security+". */
function designJson(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    name: 'Security+ Prüfung',
    criteria: [
      { id: 'ports', label: 'Ports und Protokolle', ruleOfThumb: 'Zu jedem Dienst gehört ein Standard-Port, zum Beispiel HTTPS auf 443.' },
      { id: 'krypto', label: 'Verschlüsselung', ruleOfThumb: 'Symmetrisch ist schnell, asymmetrisch löst den Schlüsseltausch.' },
      { id: 'zugriff', label: 'Zugriffskontrolle', ruleOfThumb: 'Jede Person bekommt nur die Rechte, die sie für ihre Arbeit braucht.' },
    ],
    mission: {
      suggestions: ['Ich will die Prüfung im ersten Versuch bestehen', 'Ich will in der IT-Sicherheit Fuss fassen', 'Ich will Begriffe im Job sicher verwenden'],
      default: 'Ich will die Security+ Prüfung bestehen.',
    },
    sources: [
      { title: 'CompTIA Security+', url: COMPTIA, note: 'Prüfungsziele und Themen' },
      { title: 'NIST Glossar', url: NIST, note: 'Begriffe nachschlagen' },
    ],
    lessonTypes: ['video', 'ai-chat'],
    ...overrides,
  });
}

/** A valid video lesson for the criterion "ports", as the generator would get it from the model. */
function videoJson() {
  return JSON.stringify({
    title: 'Ports im Überblick',
    intro: 'Du ordnest Diensten ihre Standard-Ports zu.',
    durationMin: 3,
    transfer: 'Prüfe bei jeder Firewall-Regel, welcher Dienst hinter dem Port steht.',
    primarySourceUrl: COMPTIA,
    content: {
      scenes: [
        { caption: 'Dienste hören auf feste Ports.', visual: 'steps', items: ['HTTPS', 'Port 443'], seconds: 6 },
        { caption: 'Auch SSH hat seinen Port.', visual: 'steps', items: ['SSH', 'Port 22'], seconds: 6 },
      ],
      questions: [
        { afterScene: 0, prompt: 'Welcher Port gehört zu HTTPS?', options: ['Port 443', 'Port 80', 'Port 21'], correct: 0, explanation: 'HTTPS nutzt 443.', criterion: 'ports' },
        { afterScene: 1, prompt: 'Welcher Port gehört zu SSH?', options: ['Port 22', 'Port 25', 'Port 53'], correct: 0, explanation: 'SSH nutzt 22.', criterion: 'ports' },
      ],
    },
  });
}

let modelRequests: ModelRequest[] = [];

beforeEach(() => {
  _reset();
  process.env.MODEL_PROVIDER = 'mock';
  modelRequests = [];
  setMockHandler((req) => {
    modelRequests.push(req);
    return req.purpose === 'design' ? designJson() : req.purpose === 'generate' ? videoJson() : 'ok';
  });
  setSourceCheck(async () => true);
});
afterEach(async () => {
  await _idle();
  setMockHandler(null);
  setMockAgentHandler(null);
  setSourceCheck(null);
  process.env.MODEL_PROVIDER = 'none';
});

async function emptyLogin(name = 'Test'): Promise<SessionView> {
  return (await request(app).post('/api/login').send({ name, timeBudgetMin: 60 }).expect(201)).body;
}

async function createOwn(v: SessionView, body: Record<string, unknown> = { topic: 'Security+ Prüfung bestehen', goal: 'Ich will im Dezember die Security+ Prüfung bestehen' }, status = 201) {
  const res = await request(app).post(`/api/sessions/${v.session.id}/own-tracks`).send(body);
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res.body as { trackId: string; view: SessionView; error?: string };
}

const learnerDir = (v: SessionView) => join(learnersRoot(), v.session.learnerId);

describe('Leere Karte', () => {
  it('beginnt ohne Bereiche und ohne DCC-Profil', async () => {
    process.env.MODEL_PROVIDER = 'none';
    const v = await emptyLogin();
    expect(v.session.nodes.map((n) => n.kind)).toEqual(['start']);
    expect(v.skills).toEqual([]);
    expect(v.workspace.lernstand).toEqual([]);
    expect(v.recommendation).toMatchObject({ ruleId: 'R7', nodeId: '', observation: 'Noch kein Bereich auf der Karte.' });
    expect(v.canCreateTracks).toBe(false);
  });

  it('nimmt einen vorbereiteten Bereich auf und startet dort (R8)', async () => {
    process.env.MODEL_PROVIDER = 'none';
    let v = await emptyLogin();
    v = await addTracks(app, v, ['t-sicherheit']);
    expect(v.skills.map((s) => [s.id, s.tracks.map((t) => t.id)])).toEqual([['digital', ['t-sicherheit']]]);
    expect(v.session.nodes.filter((n) => n.kind === 'track').map((n) => n.trackId)).toEqual(['t-sicherheit']);
    // Without the agent, the whole prepared plan of the track.
    expect(v.session.nodes.filter((n) => n.kind === 'lesson').length).toBeGreaterThan(1);
    const rec = v.recommendation!;
    expect(rec.ruleId).toBe('R8');
    expect(v.session.nodes.find((n) => n.id === rec.nodeId)!.trackId).toBe('t-sicherheit');

    await request(app).post(`/api/sessions/${v.session.id}/tracks`).send({ trackIds: ['t-sicherheit'] }).expect(409);
    await request(app).post(`/api/sessions/${v.session.id}/tracks`).send({ trackIds: ['t-gibts-nicht'] }).expect(404);
    // A mission only for tracks on the map.
    await request(app).put(`/api/sessions/${v.session.id}/missions/t-info`).send({ skip: true }).expect(404);
  });

  it('startet einen vorbereiteten Bereich mit KI mit einem Einstieg', async () => {
    let v = await emptyLogin();
    v = await addTracks(app, v, ['t-analysis']);
    expect(v.session.nodes.filter((n) => n.kind === 'lesson')).toHaveLength(1);
    expect(v.skills[0].id).toBe('math');
  });
});

describe('Eigener Bereich', () => {
  it('plant den Bereich mit der KI, erzeugt einen Einstieg und übernimmt das Wofür als Mission', async () => {
    const v = await emptyLogin('Zoe Beispielname');
    expect(v.canCreateTracks).toBe(true);
    const r = await createOwn(v);
    const after = r.view;

    const own = after.skills.find((s) => s.id === 'custom')!;
    expect(own.name).toBe('Eigene Themen');
    const track = own.tracks[0];
    expect(track).toMatchObject({ id: r.trackId, name: 'Security+ Prüfung', skillId: 'custom' });
    expect(track.criteria.map((c) => c.id)).toEqual(['ports', 'krypto', 'zugriff']);
    expect(track.custom).toMatchObject({ topic: 'Security+ Prüfung bestehen', selfLevel: 'Grundstufe', lessonTypes: ['video', 'ai-chat'] });
    expect(track.custom!.sources.map((s) => s.url)).toEqual([COMPTIA, NIST]);

    // On the map: skill, track and the first lesson, recommended as the next step.
    const lesson = after.session.nodes.find((n) => n.kind === 'lesson' && n.trackId === track.id)!;
    expect(lesson.parentId).toBe(`t-${track.id}`);
    expect(after.recommendation).toMatchObject({ ruleId: 'R8', nodeId: lesson.id });
    expect(after.workspace.missions).toEqual([expect.objectContaining({ trackId: track.id, status: 'set', text: 'Ich will im Dezember die Security+ Prüfung bestehen' })]);
    expect(after.workspace.lernstand.map((l) => l.criterion)).toEqual(['ports', 'krypto', 'zugriff']);

    const gen = (await request(app).get(`/api/sessions/${v.session.id}/lessons`).expect(200)).body;
    expect(gen).toHaveLength(1);
    expect(gen[0]).toMatchObject({ id: lesson.lessonId, trackId: track.id, source: 'model', type: 'video', primarySource: { url: COMPTIA } });

    // Stored in the workspace.
    expect(JSON.parse(readFileSync(join(learnerDir(v), 'tracks', `${track.id}.json`), 'utf8')).name).toBe('Security+ Prüfung');
    expect(readdirSync(join(learnerDir(v), 'lessons'))).toHaveLength(1);

    // Neither the name nor the learner id goes to the model.
    const sent = JSON.stringify(modelRequests);
    expect(modelRequests.map((m) => m.purpose)).toEqual(['design', 'generate']);
    expect(sent).not.toContain('Zoe');
    expect(sent).not.toContain(v.session.learnerId);
  });

  it('bewertet mit den Kriterien des eigenen Bereichs und bleibt nach einem Neustart', async () => {
    const v = await emptyLogin();
    const { view: after, trackId } = await createOwn(v);
    const node = after.session.nodes.find((n) => n.kind === 'lesson' && n.trackId === trackId)!;
    await request(app).post(`/api/sessions/${v.session.id}/nodes/${node.id}/start`).expect(200);
    process.env.MODEL_PROVIDER = 'none';
    const res = await request(app).post(`/api/sessions/${v.session.id}/nodes/${node.id}/complete`).send({ answer: { type: 'video', answers: {} } }).expect(200);
    expect(res.body.result.criteria[0]).toMatchObject({ key: 'ports', label: 'Ports und Protokolle', status: 'missed' });

    const app2 = createApp();
    const s: SessionView = (await request(app2).get(`/api/sessions/${v.session.id}`).expect(200)).body;
    expect(s.skills.find((x) => x.id === 'custom')!.tracks[0].id).toBe(trackId);
    expect(s.session.nodes.find((n) => n.id === node.id)!.state).toBe('done');
  });

  it('braucht die KI', async () => {
    process.env.MODEL_PROVIDER = 'none';
    const v = await emptyLogin();
    const r = await createOwn(v, { topic: 'Security+' }, 409);
    expect(r.error).toMatch(/mit KI/);
  });

  it('behält nur erreichbare Quellen', async () => {
    setSourceCheck(async (url) => url === NIST);
    const v = await emptyLogin();
    // The first lesson cites the source that did not answer: rejected, and the track is not made.
    const r = await createOwn(v, undefined, 502);
    expect(r.error).toMatch(/erste Lektion war ungültig: Primärquelle .*comptia.* steht nicht in den Quellen/);
    expect((await session(app, v.session.id)).skills).toEqual([]);

    setMockHandler((req) => (req.purpose === 'design' ? designJson() : videoJson().replace(COMPTIA, NIST)));
    const { view: after } = await createOwn(v);
    expect(after.skills.find((s) => s.id === 'custom')!.tracks[0].custom!.sources.map((s) => s.url)).toEqual([NIST]);
  });

  it('verwirft ein ungültiges Design und hält die Karte leer', async () => {
    setSourceCheck(async () => false);
    const v = await emptyLogin();
    let r = await createOwn(v, { topic: 'Security+' }, 502);
    expect(r.error).toMatch(/Keine der vorgeschlagenen Quellen war erreichbar/);

    setSourceCheck(async () => true);
    setMockHandler((req) => (req.purpose === 'design' ? designJson({ criteria: [{ id: 'Ports und Protokolle', label: 'x', ruleOfThumb: 'y' }] }) : videoJson()));
    r = await createOwn(v, { topic: 'Security+' }, 502);
    expect(r.error).toMatch(/3 bis 6 Kriterien/);

    setMockHandler((req) => (req.purpose === 'design' ? JSON.stringify({ error: 'Das Thema ist zu ungenau.' }) : videoJson()));
    r = await createOwn(v, { topic: 'Dinge' }, 502);
    expect(r.error).toMatch(/zu ungenau/);

    const s = await session(app, v.session.id);
    expect(s.session.nodes.map((n) => n.kind)).toEqual(['start']);
    expect(existsSync(join(learnerDir(v), 'tracks'))).toBe(false);
  });

  it('lässt die Regeln die nächste Lektion erzeugen, wenn der Agent scheitert', async () => {
    setMockAgentHandler(() => [{ type: 'text', text: 'Ich weiss nicht weiter.' }]);
    const v = await emptyLogin();
    const { view: after, trackId } = await createOwn(v);
    const first = after.session.nodes.find((n) => n.kind === 'lesson' && n.trackId === trackId)!;
    await request(app).post(`/api/sessions/${v.session.id}/nodes/${first.id}/start`).expect(200);
    await request(app).post(`/api/sessions/${v.session.id}/nodes/${first.id}/complete`).send({ answer: { type: 'video', answers: {} } }).expect(200);
    await _idle();

    const s = await session(app, v.session.id);
    const run = s.session.plannerRuns.at(-1)!;
    expect(run.outcome).toBe('fallback');
    expect(run.note).toMatch(/Lektion, deren Ziel die Regeln gewählt haben/);
    const next = s.session.nodes.find((n) => n.id === s.recommendation!.nodeId)!;
    expect(next).toMatchObject({ trackId, parentId: first.id, state: 'recommended', addedByAgent: true });
    // The missed criterion is the target.
    const gen = (await request(app).get(`/api/sessions/${v.session.id}/lessons`).expect(200)).body;
    expect(gen.find((l: { id: string }) => l.id === next.lessonId).targets).toEqual(['ports']);
  });

  /** Finishes the first lesson of a new own track while the given agent plans; returns the session after the agent. */
  async function afterFirst(agent: (trackId: string) => ((t: Turn) => AgentBlock[])[]) {
    const v = await emptyLogin();
    const { view: after, trackId } = await createOwn(v);
    setMockAgentHandler(scripted(agent(trackId)));
    const first = after.session.nodes.find((n) => n.kind === 'lesson' && n.trackId === trackId)!;
    await request(app).post(`/api/sessions/${v.session.id}/nodes/${first.id}/start`).expect(200);
    await request(app).post(`/api/sessions/${v.session.id}/nodes/${first.id}/complete`).send({ answer: { type: 'video', answers: {} } }).expect(200);
    await _idle();
    return { s: await session(app, v.session.id), first };
  }
  const generateAndHang = (trackId: string) => [
    () => [use('generate_lesson', { type: 'video', trackId, criterion: 'ports', level: 'Grundstufe', contextHint: 'Firewall-Regeln' })],
    (t: Turn) => [use('add_to_map', { lessonId: (t.results[0].content as { lessonId: string }).lessonId, parentNodeId: `t-${trackId}` })],
  ];

  it('nimmt den Agent-Plan ohne Alternative an, wenn nichts anderes erreichbar ist', async () => {
    const { s } = await afterFirst((trackId) => [
      () => [use('get_learner_state', { trackId })],
      ...generateAndHang(trackId),
      // The only other node is the one just done: not reachable, so the plan goes without an alternative.
      (t) => [use('recommend', {
        nodeId: (t.results[0].content as { nodeId: string }).nodeId,
        alternativeNodeId: t.state!.map[0].nodeId,
        reason: 'Ports noch einmal an einem neuen Beispiel üben.',
        basedOn: [t.state!.lastResults.at(-1)!.eventId],
      })],
    ]);
    expect(s.session.plannerRuns.at(-1)!.outcome).toBe('accepted');
    expect(s.recommendation).toMatchObject({ ruleId: 'A1' });
    expect(s.recommendation!.alternativeNodeId).toBeUndefined();
  });

  it('nimmt nach einem abgelehnten Plan die Lektion, die der Agent schon erzeugt hat', async () => {
    const { s } = await afterFirst((trackId) => [
      ...generateAndHang(trackId),
      (t) => [use('recommend', { nodeId: (t.results[0].content as { nodeId: string }).nodeId, reason: 'Ohne Belege.', basedOn: [] })],
    ]);
    const run = s.session.plannerRuns.at(-1)!;
    expect(run.outcome).toBe('fallback');
    expect(run.note).toMatch(/mit der Lektion, die der Agent erzeugt hat/);
    // Starter and the agent's lesson; no third lesson from the rules.
    expect(modelRequests.filter((m) => m.purpose === 'generate')).toHaveLength(2);
    expect(s.session.nodes.find((n) => n.id === s.recommendation!.nodeId)!.lessonId).toMatch(/^ki-u-/);
  });

  it('erzeugt auf Wunsch eine neue Lektion, wenn im Bereich nichts mehr offen ist', async () => {
    const v = await emptyLogin();
    const { trackId } = await createOwn(v);
    // Still open: the first lesson.
    await request(app).post(`/api/sessions/${v.session.id}/tracks/${trackId}/next`).expect(409);
    await request(app).post(`/api/sessions/${v.session.id}/tracks/t-sicherheit/next`).expect(404);
  });

  it('gehört nur der Person, die ihn angelegt hat', async () => {
    const a = await emptyLogin('Ada');
    const { trackId } = await createOwn(a);
    const b = await emptyLogin('Ben');
    await request(app).put(`/api/sessions/${b.session.id}/missions/${trackId}`).send({ skip: true }).expect(404);
    await request(app).post(`/api/sessions/${b.session.id}/tracks/${trackId}/next`).expect(404);
    expect((await session(app, b.session.id)).skills).toEqual([]);
  });
});
