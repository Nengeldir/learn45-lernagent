import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.ts';
import { setSourceCheck } from '../src/designer.ts';
import { setMockHandler, type ModelRequest } from '../src/provider.ts';
import { VideoService } from '../src/video/service.ts';

const design = {
  name: 'Photosynthese',
  criteria: [
    { id: 'licht', label: 'Licht als Energie', ruleOfThumb: 'Pflanzen nutzen Licht als Energiequelle.' },
    { id: 'wasser', label: 'Wasser als Ausgangsstoff', ruleOfThumb: 'Wasser ist ein Ausgangsstoff der Photosynthese.' },
    { id: 'zucker', label: 'Zucker als Ergebnis', ruleOfThumb: 'Aus Wasser und Kohlendioxid entsteht mit Lichtenergie Zucker.' },
  ],
  mission: { suggestions: [], default: 'Ich will die Photosynthese verstehen.' },
  sources: [{ title: 'Universität', url: 'https://www.ethz.ch/', note: 'Grundlagen der Pflanzenbiologie' }],
  // Even when the agent suggests a chat, the explicit video request must win.
  lessonTypes: ['ai-chat'],
};
export const topicVideoReply = {
  title: 'Wie nutzen Pflanzen Licht?', intro: 'Du erklärst, wofür Pflanzen Licht brauchen.', durationMin: 3,
  primarySourceUrl: 'https://www.ethz.ch/',
  content: {
    narrated: { manifestUrl: 'https://untrusted.example/manifest.json' },
    scenes: [
      { caption: 'Pflanzen nutzen Licht als Energiequelle für die Photosynthese.', visual: 'steps', items: ['Licht aufnehmen', 'Energie nutzen'], seconds: 7 },
      { caption: 'Mit dieser Energie stellen sie aus Wasser und Kohlendioxid Zucker her.', visual: 'steps', items: ['Wasser und Kohlendioxid', 'Zucker herstellen'], seconds: 7 },
    ],
    questions: [
      { afterScene: 0, prompt: 'Welche Energie nutzen Pflanzen?', options: ['Die Lichtenergie', 'Die Schallenergie', 'Die Bewegungsenergie'], correct: 0, explanation: 'Die Lichtenergie treibt die Photosynthese an.', criterion: 'licht' },
    ],
  },
};
afterEach(() => { setMockHandler(null); setSourceCheck(null); vi.unstubAllEnvs(); });

it('turns a typed novel topic and an explicit video request into a persisted, playable narrated lesson', async () => {
  vi.stubEnv('MODEL_PROVIDER', 'mock');
  setSourceCheck(async () => true);
  const requests: ModelRequest[] = [];
  setMockHandler(req => { requests.push(req); return JSON.stringify(req.purpose === 'design' ? design : topicVideoReply); });
  const folder = await mkdtemp(join(tmpdir(), 'l45-topic-video-'));
  const speak = vi.fn(async () => Buffer.alloc(24000 * 2 * 2, 1));
  const service = new VideoService({ output: join(folder, 'videos'), published: join(folder, 'bundled'), speechCache: join(folder, 'speech'), speaker: { config: { provider: 'elevenlabs', voice: 'test', model: 'test' }, pcm: speak } });
  const app = createApp({ videoService: service });
  const login = await request(app).post('/api/login').send({ name: 'Topic learner', timeBudgetMin: 30 }).expect(201);
  const session = login.body.session.id;
  const result = await request(app).post(`/api/sessions/${session}/own-tracks`)
    .send({ topic: 'Ich möchte Photosynthese verstehen', selfLevel: 'Grundstufe', lessonType: 'video' }).expect(201);
  const lesson = result.body.generated.find((l: { type: string }) => l.type === 'video');
  expect(lesson).toBeDefined();
  expect(lesson.content.narrated).toBeUndefined();
  expect(result.body.view.workspace.missions.some((m: { trackId: string }) => m.trackId === result.body.trackId)).toBe(true);
  expect(requests[0].messages[0].content).toContain('Ich möchte Photosynthese verstehen');
  expect(requests[1].messages[0].content).toContain('ausdrücklich ein Erklärvideo');
  const node = result.body.view.session.nodes.find((n: { lessonId: string }) => n.lessonId === lesson.id);
  expect(result.body.view.recommendation.nodeId).toBe(node.id);
  const url = `/api/sessions/${session}/nodes/${node.id}/video`;
  await request(app).post(url).expect(202);
  let path = '';
  await vi.waitFor(async () => {
    const status = await request(app).get(url).expect(200);
    expect(status.body.state).toBe('ready'); path = status.body.manifestUrl;
  }, { timeout: 15000 });
  const manifest = await request(app).get(path).expect(200);
  expect(manifest.body.title).toBe('Wie nutzen Pflanzen Licht?');
  expect(manifest.body.scenes).toHaveLength(2);
  expect(JSON.stringify(manifest.body)).not.toContain('untrusted.example');
  expect(JSON.stringify(manifest.body)).not.toContain('"correct"');
  expect(speak).toHaveBeenCalledTimes(3);
  await request(app).post(url).expect(200);
  expect(speak).toHaveBeenCalledTimes(3);
}, 20000);

it('does not substitute a different lesson type when the requested video is invalid', async () => {
  vi.stubEnv('MODEL_PROVIDER', 'mock');
  setSourceCheck(async () => true);
  const purposes: string[] = [];
  setMockHandler(req => { purposes.push(req.purpose); return JSON.stringify(req.purpose === 'design' ? design : { ...topicVideoReply, content: { goal: 'This is a chat, not a video.' } }); });
  const app = createApp();
  const login = await request(app).post('/api/login').send({ name: 'Bad video reply', timeBudgetMin: 30 }).expect(201);
  await request(app).post(`/api/sessions/${login.body.session.id}/own-tracks`).send({ topic: 'Photosynthese', lessonType: 'video' }).expect(502);
  expect(purposes).toEqual(['design', 'generate']);
  const generated = await request(app).get(`/api/sessions/${login.body.session.id}/lessons`).expect(200);
  expect(generated.body).toEqual([]);
});
