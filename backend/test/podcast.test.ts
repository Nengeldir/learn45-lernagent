import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PodcastLine, PodcastManifest, PodcastSpeaker } from '@l45/shared';
import { content } from '../src/content.ts';
import { createApp } from '../src/app.ts';
import { PodcastService } from '../src/podcast/service.ts';
import { parseScript, ruleScript } from '../src/podcast/script.ts';
import { setMockHandler, type ModelRequest } from '../src/provider.ts';
import type { Speaker } from '../src/video/build.ts';

const komm = content.skills.flatMap(s => s.tracks).find(t => t.id === 't-komm')!;
const second = Buffer.alloc(24000 * 2, 1);
const temp = () => mkdtemp(join(tmpdir(), 'l45-podcast-test-'));
const dialogue = (n: number): PodcastLine[] => Array.from({ length: n }, (_, i) => ({ speaker: i % 2 ? 'b' : 'a', text: `Beitrag ${i + 1}.` }));
const speakers = (pcm = async (_text: string) => second): Record<PodcastSpeaker, Speaker> => ({
  a: { config: { provider: 'elevenlabs', voice: 'voice-a', model: 'test' }, pcm: vi.fn(pcm) },
  b: { config: { provider: 'elevenlabs', voice: 'voice-b', model: 'test' }, pcm: vi.fn(pcm) },
});

let learners = 0;
async function setup(speak?: Record<PodcastSpeaker, Speaker>) {
  const folder = await temp();
  const app = createApp({ podcastService: new PodcastService({ output: folder, speechCache: folder, speakers: speak ?? speakers() }) });
  const login = await request(app).post('/api/login').send({ name: `Podcast ${++learners}`, levels: {} }).expect(201);
  await request(app).post(`/api/sessions/${login.body.session.id}/tracks`).send({ trackIds: ['t-komm'] }).expect(201);
  return { app, folder, url: `/api/sessions/${login.body.session.id}/tracks/t-komm/podcast` };
}
async function settled(app: Parameters<typeof request>[0], url: string) {
  let body: { state: string; manifestUrl?: string; script?: { lines: PodcastLine[] } } = { state: 'idle' };
  await vi.waitFor(async () => {
    body = (await request(app).get(url).expect(200)).body;
    expect(body.state).toMatch(/ready|error/);
  }, { timeout: 5000, interval: 20 });
  return body;
}

afterEach(() => { setMockHandler(null); process.env.MODEL_PROVIDER = 'none'; });

describe('podcast script', () => {
  it('accepts a two-host dialogue within the speech budget and writes ss', () => {
    expect(parseScript({ lines: [...dialogue(5), { speaker: 'b', text: 'Das ist  gross und heiß.' }] })?.at(-1)?.text).toBe('Das ist gross und heiss.');
    expect(parseScript({ lines: dialogue(6).map(l => ({ ...l, speaker: 'a' })) })).toBeNull();
    expect(parseScript({ lines: dialogue(5) })).toBeNull();
    expect(parseScript({ lines: dialogue(25) })).toBeNull();
    expect(parseScript({ lines: [...dialogue(5), { speaker: 'c', text: 'Wer?' }] })).toBeNull();
    expect(parseScript({ lines: dialogue(12).map(l => ({ ...l, text: 'x'.repeat(450) })) })).toBeNull();
  });

  it('puts every rule of thumb and the map lessons into the script without a model', () => {
    const lessons = content.lessons.filter(l => l.trackId === 't-komm');
    const script = ruleScript({ track: komm, mission: 'Ich übergebe Arbeit', sources: [], lessons });
    expect(script.by).toBe('rule');
    expect(parseScript(script)).toEqual(script.lines);
    const text = script.lines.map(l => l.text).join(' ');
    for (const c of komm.criteria) expect(text).toContain(c.ruleOfThumb);
    expect(text).toContain(lessons[0].title);
    expect(text).toContain('Ich übergebe Arbeit');
  });
});

describe('podcast service', () => {
  it('writes the script with the model once, narrates both hosts and serves one audio file', async () => {
    const speak = speakers();
    const { app, url, folder } = await setup(speak);
    process.env.MODEL_PROVIDER = 'mock';
    const asked: ModelRequest[] = [];
    setMockHandler((req) => { asked.push(req); return JSON.stringify({ lines: dialogue(8) }); });
    const first = await Promise.all([request(app).post(url), request(app).post(url)]);
    expect(first.map(r => r.status)).toEqual([202, 202]);
    const done = await settled(app, url);
    expect(done.state).toBe('ready');
    expect(asked).toHaveLength(1);
    expect(asked[0].purpose).toBe('podcast');
    expect(asked[0].messages[0].content).toContain(komm.criteria[0].ruleOfThumb);
    // Quiz solutions stay out of the prompt.
    const quiz = content.lessons.find(l => l.trackId === 't-komm' && l.type === 'video');
    if (quiz?.type === 'video') expect(asked[0].messages[0].content).not.toContain(quiz.content.questions[0].explanation);
    expect(speak.a.pcm).toHaveBeenCalledTimes(4);
    expect(speak.b.pcm).toHaveBeenCalledTimes(4);

    const manifest = (await request(app).get(done.manifestUrl!).expect(200)).body as PodcastManifest;
    expect(manifest).toMatchObject({ trackId: 't-komm', scriptBy: 'model', hosts: { a: 'Mira', b: 'Jonas' }, narration: { voices: { a: 'voice-a', b: 'voice-b' } } });
    expect(manifest.lines).toHaveLength(8);
    expect(manifest.lines[0]).toMatchObject({ start: 0, end: 1 });
    expect(manifest.lines[1].start).toBeCloseTo(1.4, 5);
    expect(manifest.duration).toBeCloseTo(8 + 7 * 0.4, 5);
    const audio = await request(app).get(manifest.audioUrl).expect(200).expect('content-type', /audio/);
    expect(audio.body.toString('ascii', 0, 4)).toBe('RIFF');

    // A restarted server finds podcast and script on disk: no new model call, no new speech.
    const restarted = new PodcastService({ output: folder, speechCache: folder, speakers: speak });
    const again = await request(createApp({ podcastService: restarted })).post(url);
    expect(again.status).toBe(200);
    expect(asked).toHaveLength(1);
    expect(speak.a.pcm).toHaveBeenCalledTimes(4);
  });

  it('falls back to the rule script when the model answers nonsense', async () => {
    const { app, url } = await setup();
    process.env.MODEL_PROVIDER = 'mock';
    setMockHandler(() => 'Gerne! Hier ist ein Podcast über Kommunikation.');
    await request(app).post(url).expect(202);
    const done = await settled(app, url);
    const manifest = (await request(app).get(done.manifestUrl!).expect(200)).body as PodcastManifest;
    expect(manifest.scriptBy).toBe('rule');
  });

  it('keeps the script readable when narration fails', async () => {
    const { app, url } = await setup(speakers(async () => { throw new Error('ElevenLabs-Schlüssel oder Stimme fehlt.'); }));
    await request(app).post(url).expect(202);
    const done = await settled(app, url);
    expect(done.state).toBe('error');
    expect(done.script!.lines.map(l => l.text).join(' ')).toContain(komm.criteria[0].ruleOfThumb);
    expect((await request(app).post(url)).status).toBe(503);
  });

  it('only covers tracks on the learner map', async () => {
    const { app, url } = await setup();
    await request(app).post(url.replace('t-komm', 't-physik')).expect(404);
    await request(app).get('/podcasts/missing/manifest.json').expect(404);
  });
});
