import request from 'supertest';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.ts';
import { FREE_AI_ENDPOINT, FREE_AI_MODEL } from '../src/freeAi.ts';
import { setSourceCheck } from '../src/designer.ts';
import { _reset } from '../src/sessions.ts';
import { content } from '../src/content.ts';
import { sourcesOf } from '../src/resources.ts';
import { mockSiteJson } from './helpers.ts';

beforeEach(() => {
  _reset();
  vi.stubEnv('MODEL_PROVIDER', undefined);
  vi.stubEnv('ANTHROPIC_API_KEY', ''); vi.stubEnv('OPENAI_API_KEY', '');
  vi.stubEnv('VIDEO_SPEECH_PROVIDER', undefined); vi.stubEnv('ELEVENLABS_API_KEY', '');
});
afterEach(() => { setSourceCheck(null); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

const proposals = { topics: [
  { title: 'Linkziele sicher erkennen', reason: 'Vertiefe das Prüfen von Links.', criterion: 'link' },
  { title: 'Links in Rechnungsmails prüfen', reason: 'Wende dein Wissen an einer Rechnung an.', criterion: 'link' },
  { title: 'Domains genauer vergleichen', reason: 'Erkunde einen verwandten Schwerpunkt.', criterion: 'adresse' },
] };

async function setup() {
  const bodies: Record<string, any>[] = [];
  const fetch = vi.fn(async (url, init) => {
    if (String(url) !== FREE_AI_ENDPOINT) return Response.json({ error: { code: 'invalid_api_key' } }, { status: 401 });
    const body = JSON.parse(init.body); bodies.push(body);
    const content = body.messages[0].content.includes('KEINE vollständigen Lektionen') ? JSON.stringify(proposals) : mockSiteJson();
    return Response.json({ choices: [{ message: { content }, finish_reason: 'stop' }] });
  });
  vi.stubGlobal('fetch', fetch);
  const app = createApp();
  const login = await request(app).post('/api/login').send({ name: 'Private Learner Name', levels: {} }).expect(201);
  const id = login.body.session.id;
  await request(app).post(`/api/sessions/${id}/tracks`).send({ trackIds: ['t-sicherheit'] }).expect(201);
  const choices = (await request(app).post(`/api/sessions/${id}/tracks/t-sicherheit/topics`).send({}).expect(200)).body.choices;
  const choose = (index: number, format: string) => request(app).post(`/api/sessions/${id}/topics/choose`).send({ choiceSetId: choices.id, topicId: choices.topics[index].id, format });
  return { app, id, choices, choose, login: login.body, fetch, bodies };
}

it.each([false, true])('creates a validated lesson with free AI (invalid paid key: %s)', async invalidKey => {
  if (invalidKey) {
    vi.stubEnv('MODEL_PROVIDER', 'openai'); vi.stubEnv('OPENAI_API_KEY', 'broken-key'); vi.stubEnv('OPENAI_MODEL', 'test-model');
  }
  const { choose, login, bodies, fetch } = await setup();
  expect(login.modelStatus).toBe('online'); expect(login.canCreateTracks).toBe(true);
  const result = await choose(1, 'mock-site').expect(201);
  expect(result.body.generated).toHaveLength(1);
  expect(result.body.generated[0]).toMatchObject({ type: 'mock-site', provenance: { model: FREE_AI_MODEL } });
  expect(bodies.every(b => b.model === FREE_AI_MODEL)).toBe(true);
  expect(JSON.stringify(bodies)).not.toContain('Private Learner Name');
  expect(JSON.stringify(bodies)).not.toContain('broken-key');
  expect(fetch.mock.calls.filter(([url]) => String(url) === FREE_AI_ENDPOINT)).toHaveLength(2);
});

it('marks new audio formats unavailable and rejects them before calling AI, while reusing bundled video', async () => {
  const { choices, choose, fetch } = await setup();
  expect(choices.topics[1].unavailableFormats).toMatchObject({ video: expect.any(String), podcast: expect.any(String) });
  expect(choices.topics[1].unavailableFormats['mock-site']).toBeUndefined();
  const count = fetch.mock.calls.length;
  await choose(1, 'video').expect(409);
  await choose(1, 'podcast').expect(409);
  expect(fetch).toHaveBeenCalledTimes(count);
  expect(choices.topics[0].unavailableFormats.video).toBeUndefined();
  const result = await choose(0, 'video').expect(201);
  expect(result.body.generated).toHaveLength(0);
});

it('keeps the selection and stores no invalid lesson when free AI is unavailable', async () => {
  const { app, id, choices, choose } = await setup();
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({}, { status: 503 })));
  await choose(1, 'mock-site').expect(502);
  expect((await request(app).get(`/api/sessions/${id}/lessons`).expect(200)).body).toEqual([]);
  const view = (await request(app).get(`/api/sessions/${id}`).expect(200)).body;
  expect(view.session.topicChoices.id).toBe(choices.id);
});

it('keeps simulation offline even though free AI is available', async () => {
  const { app, id, fetch } = await setup();
  await request(app).patch(`/api/sessions/${id}`).send({ simulation: true }).expect(200);
  fetch.mockClear();
  const result = await request(app).post(`/api/sessions/${id}/tracks/t-sicherheit/topics`).send({}).expect(200);
  expect(result.body.view.modelStatus).toBe('simulation');
  expect(result.body.choices.canSuggestOwn).toBe(false);
  expect(fetch).not.toHaveBeenCalled();
});


it('creates an own area and its first text lesson without any model or speech keys', async () => {
  setSourceCheck(async () => true);
  const design = {
    name: 'Sichere Links',
    criteria: [
      { id: 'link', label: 'Linkziel prüfen', ruleOfThumb: 'Prüfe das Ziel vor dem Klick.' },
      { id: 'adresse', label: 'Domain prüfen', ruleOfThumb: 'Vergleiche die Domain mit dem erwarteten Anbieter.' },
      { id: 'daten', label: 'Daten schützen', ruleOfThumb: 'Gib keine vertraulichen Daten auf unbekannten Seiten ein.' },
    ],
    sources: [{ title: 'BACS', url: 'https://www.bacs.admin.ch/de/phishing-de', note: 'Links auf Warnzeichen prüfen.' }],
    lessonTypes: ['video'],
  };
  const chat = {
    title: 'Linkziele besprechen', intro: 'Übe im Gespräch, wie du Linkziele prüfst.', durationMin: 3,
    primarySourceUrl: design.sources[0].url,
    content: {
      kind: 'tutor', goal: 'Du prüfst ein Linkziel.', aiRole: 'Stelle Fragen zum Prüfen von Links.',
      opening: 'Was prüfst du vor einem Klick?',
      criteria: [{ id: 'link', label: 'Linkziel prüfen', hint: 'Lies die Zieladresse.' }],
      fallbackReplies: ['Wie lautet das Ziel?', 'Passt die Domain?', 'Fasse deine Regel zusammen.'], minTurns: 3,
    },
  };
  const fetch = vi.fn(async (_url, init) => {
    const system = JSON.parse(init.body).messages[0].content;
    return Response.json({ choices: [{ message: { content: JSON.stringify(system.includes('Du planst') ? design : chat) } }] });
  });
  vi.stubGlobal('fetch', fetch);
  const app = createApp();
  const login = await request(app).post('/api/login').send({ name: 'Own free topic', levels: {} }).expect(201);
  const result = await request(app).post(`/api/sessions/${login.body.session.id}/own-tracks`).send({ topic: 'Sichere Links' }).expect(201);
  expect(result.body.generated).toHaveLength(1);
  expect(result.body.generated[0]).toMatchObject({ type: 'ai-chat', provenance: { model: FREE_AI_MODEL } });
  const track = result.body.view.skills.flatMap((s: any) => s.tracks).find((t: any) => t.id === result.body.trackId);
  expect(track.custom.model).toBe(FREE_AI_MODEL);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('adds a usable text format when the planner proposes only unavailable audio', async () => {
  const { app, id } = await setup();
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ choices: [{ message: { content: JSON.stringify({ topics: proposals.topics.map(t => ({ ...t, formats: ['video'] })) }) } }] })));
  // Changing a mission invalidates the previous preview and plans again.
  await request(app).put(`/api/sessions/${id}/missions/t-sicherheit`).send({ text: 'Ich möchte Links sicher prüfen.' }).expect(200);
  const result = await request(app).post(`/api/sessions/${id}/tracks/t-sicherheit/topics`).send({}).expect(200);
  const topic = result.body.choices.topics[1];
  expect(topic.formats.some((t: string) => ['ai-chat', 'mark-evidence', 'mock-site'].includes(t) && !topic.unavailableFormats[t])).toBe(true);
});


it.each([false, true])('opens the chat format despite a renamed criterion, then chats through free AI (invalid paid key: %s)', async invalidKey => {
  if (invalidKey) {
    vi.stubEnv('MODEL_PROVIDER', 'openai'); vi.stubEnv('OPENAI_API_KEY', 'broken-key'); vi.stubEnv('OPENAI_MODEL', 'test-model');
  }
  const track = content.skills.flatMap(s => s.tracks).find(t => t.id === 't-komm')!;
  const draft = {
    title: 'Offene Punkte klarstellen', intro: 'Übe, offene Punkte in einer Übergabe anzusprechen.', durationMin: 3,
    primarySourceUrl: sourcesOf(track)[0].url,
    content: {
      kind: 'tutor', goal: 'Du klärst offene Punkte.', aiRole: 'Frage nach den offenen Punkten der Übergabe.',
      opening: 'Welche Punkte sind noch offen?',
      criteria: [{ id: 'openPoints', label: 'Open points', hint: 'Nenne, was noch offen ist.' }],
      fallbackReplies: ['Welche Fragen sind noch offen?', 'Wer kann sie klären?', 'Fasse deine Regel zusammen.'], minTurns: 3,
    },
  };
  const freeCalls: Record<string, any>[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    if (String(url) !== FREE_AI_ENDPOINT) return Response.json({ error: { code: 'invalid_api_key' } }, { status: 401 });
    const body = JSON.parse(init.body); freeCalls.push(body);
    const system = body.messages[0].content;
    const reply = system.includes('KEINE vollständigen Lektionen')
      ? JSON.stringify({ topics: ['Offene Punkte', 'Offene Fragen klären', 'Eine Übergabe vorbereiten'].map(title => ({ title, reason: 'Übe das Klären offener Punkte.', criterion: 'offen', formats: ['ai-chat'] })) })
      : system.includes('Du schreibst eine kurze Lektion') ? JSON.stringify(draft) : 'Was muss bei der Freigabe noch geklärt werden?';
    return Response.json({ choices: [{ message: { content: reply }, finish_reason: 'stop' }] });
  }));
  const app = createApp();
  const login = await request(app).post('/api/login').send({ name: 'Free conversation', levels: {} }).expect(201);
  const id = login.body.session.id;
  await request(app).post(`/api/sessions/${id}/tracks`).send({ trackIds: [track.id] }).expect(201);
  const choices = (await request(app).post(`/api/sessions/${id}/tracks/${track.id}/topics`).send({}).expect(200)).body.choices;
  const selected = await request(app).post(`/api/sessions/${id}/topics/choose`).send({ choiceSetId: choices.id, topicId: choices.topics[1].id, format: 'ai-chat' }).expect(201);
  expect(selected.body.generated).toHaveLength(1);
  expect(selected.body.generated[0].content.criteria).toEqual([expect.objectContaining({ id: 'offen', label: track.criteria.find(c => c.id === 'offen')!.label })]);
  const node = selected.body.nodeId;
  const started = await request(app).post(`/api/sessions/${id}/nodes/${node}/start`).expect(200);
  expect(started.body.lesson.type).toBe('ai-chat');
  const chat = await request(app).post(`/api/sessions/${id}/nodes/${node}/chat`).send({ turns: [
    { role: 'ai', text: started.body.lesson.content.opening, source: 'prepared' },
    { role: 'learner', text: 'Die Freigabe ist noch offen.' },
  ] }).expect(200);
  expect(chat.body).toEqual({ source: 'model', text: 'Was muss bei der Freigabe noch geklärt werden?' });
  expect(freeCalls).toHaveLength(3);
});

it('offers podcasts with an ElevenLabs key and only one configured voice', async () => {
  vi.stubEnv('VIDEO_SPEECH_PROVIDER', 'elevenlabs'); vi.stubEnv('ELEVENLABS_API_KEY', 'speech-key');
  vi.stubEnv('ELEVENLABS_VOICE_ID', 'voice-a'); vi.stubEnv('ELEVENLABS_SECOND_VOICE_ID', '');
  const { choices } = await setup();
  expect(choices.topics.every((t: any) => t.formats.includes('podcast') && !t.unavailableFormats.podcast)).toBe(true);
});
