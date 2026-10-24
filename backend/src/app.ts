// HTTP API. The browser never talks to a model directly.
import express, { type NextFunction, type Request, type Response } from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Answer, ChatTurn, ContentBundle, Lesson, PodcastLesson, VideoLesson } from '@l45/shared';
import { completionReward } from '@l45/shared';
import { content } from './content.ts';
import { InputError, profileFromFile, profileFromManual } from './dcc.ts';
import { modelStatus, providerName } from './provider.ts';
import {
  HttpError, addTracks, answerFeedback, chat, clearCache, complete, createTrack, generatedPublic, get, hint, login, nextLesson, partialCheck, patch, publicLesson,
  setMission, startNode, view,
} from './sessions.ts';
import { PodcastService } from './podcast/service.ts';
import { VideoService } from './video/service.ts';
import { chooseTopic, getTopics, suggestTopic } from './nextTopics.ts';
import { askOwl, owlMessages } from './owlChat.ts';

type Handler = (req: Request, res: Response) => unknown;
const h = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => {
  Promise.resolve(fn(req, res)).catch(next);
};
const p = (req: Request, key: string) => String(req.params[key]);

function parseAnswer(body: unknown): Answer {
  const a = (body as { answer?: Answer })?.answer;
  if (!a || typeof a !== 'object') throw new HttpError(400, 'Antwort fehlt');
  switch (a.type) {
    case 'mark-evidence':
      return { type: a.type, marks: (a.marks ?? {}) as Record<string, 'belegt' | 'erfunden'> };
    case 'mock-site':
      return { type: a.type, marked: Array.isArray(a.marked) ? a.marked.map(String) : [], verdict: a.verdict === 'phishing' || a.verdict === 'echt' ? a.verdict : null };
    case 'video':
    case 'podcast':
      return { type: a.type, answers: a.answers ?? {} };
    case 'ai-chat':
      return { type: a.type, turns: parseTurns(a.turns) };
    default:
      throw new HttpError(400, 'Unbekannter Antworttyp');
  }
}

function parseTurns(turns: unknown): ChatTurn[] {
  if (!Array.isArray(turns)) return [];
  return turns
    .filter((t) => t && (t.role === 'ai' || t.role === 'learner'))
    .map((t) => ({ role: t.role, text: String(t.text ?? '').slice(0, 2000), source: t.source }));
}

export function createApp(options: { videoService?: VideoService; podcastService?: PodcastService } = {}) {
  // A new app starts like a restarted server: nothing in memory, everything is read from disk.
  clearCache();
  const app = express();
  const videos = options.videoService ?? new VideoService({
    output: process.env.VIDEO_CACHE_DIR ?? join(import.meta.dirname, '..', 'var', 'videos'),
    speechCache: process.env.VIDEO_SPEECH_CACHE_DIR ?? join(import.meta.dirname, '..', 'var', 'video-speech'),
    published: join(import.meta.dirname, '..', '..', 'frontend', 'public', 'videos'),
  });
  const podcasts = options.podcastService ?? new PodcastService({
    output: process.env.PODCAST_CACHE_DIR ?? join(import.meta.dirname, '..', 'var', 'podcasts'),
    speechCache: videos.options.speechCache,
  });
  app.use(express.json({ limit: '200kb' }));

  app.get('/api/health', (_req, res) => res.json({ ok: true, provider: providerName(), modelStatus: modelStatus(false) }));

  app.post('/api/owl', h(async (req, res) => {
    res.json({ text: await askOwl(owlMessages(req.body)) });
  }));

  app.get('/api/content', (_req, res) => {
    const bundle: ContentBundle = { skills: content.skills, lessons: content.lessons.map(publicLesson) };
    res.json(bundle);
  });

  // Login: name + DCC profile (from a result file or entered by hand). No password: prototype with synthetic data.
  // A name that exists already answers 409; the learner then sends resume: 'continue' or 'new'.
  app.post('/api/login', h((req, res) => {
    const body = req.body ?? {};
    const dcc = body.dccFile ? profileFromFile(body.dccFile, body.fileName) : profileFromManual(body.levels);
    const resume = body.resume === 'continue' || body.resume === 'new' ? body.resume : undefined;
    const st = login({ name: String(body.name ?? ''), dcc, resume });
    res.status(201).json(view(st));
  }));

  app.get('/api/sessions/:id', h((req, res) => res.json(view(get(p(req, 'id'))))));
  app.get('/api/sessions/:id/lessons', h((req, res) => res.json(generatedPublic(get(p(req, 'id'))))));
  app.patch('/api/sessions/:id', h((req, res) => {
    const st = get(p(req, 'id'));
    patch(st, req.body ?? {});
    res.json(view(st));
  }));

  // The map starts empty. Prepared tracks from the catalog, own tracks from a topic (the model designs them).
  app.post('/api/sessions/:id/tracks', h((req, res) => {
    const st = get(p(req, 'id'));
    addTracks(st, req.body?.trackIds);
    res.status(201).json({ view: view(st), generated: generatedPublic(st) });
  }));
  app.post('/api/sessions/:id/own-tracks', h(async (req, res) => {
    const st = get(p(req, 'id'));
    const track = await createTrack(st, req.body ?? {});
    res.status(201).json({ trackId: track.id, view: view(st), generated: generatedPublic(st) });
  }));
  app.post('/api/sessions/:id/tracks/:track/next', h(async (req, res) => {
    const st = get(p(req, 'id'));
    await nextLesson(st, p(req, 'track'));
    res.json({ view: view(st), generated: generatedPublic(st) });
  }));

  app.post('/api/sessions/:id/tracks/:track/topics', h(async (req, res) => {
    const st = get(p(req, 'id'));
    const choices = await getTopics(st, p(req, 'track'));
    res.json({ choices, view: view(st) });
  }));
  app.post('/api/sessions/:id/topics/custom', h(async (req, res) => {
    const st = get(p(req, 'id'));
    const topic = await suggestTopic(st, req.body ?? {});
    res.json({ topic, view: view(st) });
  }));
  app.post('/api/sessions/:id/topics/choose', h(async (req, res) => {
    const st = get(p(req, 'id'));
    const nodeId = await chooseTopic(st, req.body ?? {});
    res.status(201).json({ nodeId, view: view(st), generated: generatedPublic(st) });
  }));

  app.put('/api/sessions/:id/missions/:track', h((req, res) => {
    const st = get(p(req, 'id'));
    setMission(st, p(req, 'track'), req.body ?? {});
    res.json(view(st));
  }));

  app.post('/api/sessions/:id/nodes/:node/start', h((req, res) => {
    const st = get(p(req, 'id'));
    const r = startNode(st, p(req, 'node'));
    res.json({ ...r, view: view(st) });
  }));
  const lessonOf = (sessionId: string, nodeId: string): Lesson => {
    const st = get(sessionId);
    const node = st.session.nodes.find(n => n.id === nodeId && n.kind === 'lesson');
    const lesson = [...content.lessons, ...st.session.generatedLessons].find(l => l.id === node?.lessonId);
    if (!lesson) throw new HttpError(404, 'Lektion nicht gefunden');
    return lesson;
  };
  const videoOf = (sessionId: string, nodeId: string): VideoLesson => {
    const lesson = lessonOf(sessionId, nodeId);
    if (lesson.type !== 'video') throw new HttpError(400, 'Diese Lektion ist kein Video.');
    return lesson;
  };
  const podcastOf = (sessionId: string, nodeId: string): PodcastLesson => {
    const lesson = lessonOf(sessionId, nodeId);
    if (lesson.type !== 'podcast') throw new HttpError(400, 'Diese Lektion ist kein Podcast.');
    return lesson;
  };
  app.post('/api/sessions/:id/nodes/:node/video', h(async (req, res) => {
    const result = await videos.prepare(videoOf(p(req, 'id'), p(req, 'node')));
    res.status(result.state === 'building' ? 202 : result.state === 'error' ? 503 : 200).json(result);
  }));
  app.get('/api/sessions/:id/nodes/:node/video', h(async (req, res) => {
    res.json(await videos.status(videoOf(p(req, 'id'), p(req, 'node'))));
  }));
  // The audio of a podcast lesson is narrated the first time it is opened.
  app.post('/api/sessions/:id/nodes/:node/podcast', h(async (req, res) => {
    const result = await podcasts.prepare(podcastOf(p(req, 'id'), p(req, 'node')));
    res.status(result.state === 'building' ? 202 : result.state === 'error' ? 503 : 200).json(result);
  }));
  app.get('/api/sessions/:id/nodes/:node/podcast', h(async (req, res) => {
    res.json(await podcasts.status(podcastOf(p(req, 'id'), p(req, 'node'))));
  }));
  app.post('/api/sessions/:id/nodes/:node/answer-feedback', h((req, res) => res.json(answerFeedback(get(p(req, 'id')), p(req, 'node'), req.body))));
  app.post('/api/sessions/:id/nodes/:node/check', h((req, res) => res.json(partialCheck(get(p(req, 'id')), p(req, 'node'), parseAnswer(req.body)))));
  app.post('/api/sessions/:id/nodes/:node/hint', h(async (req, res) => res.json(await hint(get(p(req, 'id')), p(req, 'node'), parseAnswer(req.body)))));
  app.post('/api/sessions/:id/nodes/:node/chat', h(async (req, res) => res.json(await chat(get(p(req, 'id')), p(req, 'node'), parseTurns(req.body?.turns)))));
  app.post('/api/sessions/:id/nodes/:node/complete', h(async (req, res) => {
    const st = get(p(req, 'id'));
    const before = view(st).rewards;
    const d = Number(req.body?.durationMin);
    const result = await complete(st, p(req, 'node'), parseAnswer(req.body), Number.isFinite(d) ? d : undefined);
    const after = view(st);
    const trackId = st.session.nodes.find((node) => node.id === p(req, 'node'))!.trackId!;
    res.json({ result, reward: completionReward(before, after.rewards, trackId), view: after, generated: generatedPublic(st) });
  }));

  // Completed runtime videos and bundled videos share the same public asset URL shape.
  app.use('/videos', express.static(videos.options.output), express.static(videos.options.published));
  app.use('/videos', (_req, res) => res.status(404).json({ error: 'Video-Datei nicht gefunden' }));
  app.use('/podcasts', express.static(podcasts.options.output));
  app.use('/podcasts', (_req, res) => res.status(404).json({ error: 'Podcast-Datei nicht gefunden' }));

  // Built frontend
  const dist = process.env.FRONTEND_DIST ?? join(import.meta.dirname, '..', '..', 'frontend', 'dist');
  if (existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(join(dist, 'index.html')));
  } else {
    app.get('/', (_req, res) => {
      res.type('html').send(
        '<!doctype html><meta charset="utf-8"><title>AIthena</title><body style="font-family:system-ui;max-width:40rem;margin:3rem auto;padding:0 1rem;line-height:1.5">' +
          '<h1>Die App ist noch nicht gebaut</h1><p>Die API läuft, aber <code>frontend/dist</code> fehlt.</p>' +
          '<p><code>npm run build</code> und danach <code>npm start</code>, dann neu laden. Oder <code>npm run dev</code> und <a href="http://localhost:5173">http://localhost:5173</a> öffnen.</p>',
      );
    });
  }

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Nicht gefunden' }));
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...err.body });
    if (err instanceof InputError) return res.status(400).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Interner Fehler' });
  });
  return app;
}
