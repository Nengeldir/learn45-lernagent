import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { compileSource, evaluateScene, validateRenderableScene } from '@l45/animlib/core';
import type { NarratedVideoManifest } from '@l45/shared';
import { createApp } from '../src/app.ts';

const root = new URL('../../', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('frontend/public/videos/math-v1/manifest.json', root), 'utf8')) as NarratedVideoManifest;
const app = createApp();

describe('Was ist eine Ableitung?', () => {
  it('publishes four renderable scenes with matching narration and caption timing', async () => {
    expect(manifest.lessonId).toBe('math-v1');
    expect(manifest.locale).toBe('de-CH');
    expect(manifest.scenes).toHaveLength(4);
    for (const scene of manifest.scenes) {
      const audio = readFileSync(new URL(`frontend/public${scene.audioUrl}`, root));
      expect(audio.toString('ascii', 0, 4)).toBe('RIFF');
      expect(audio.readUInt32LE(24)).toBe(24000);
      expect(audio.readUInt32LE(40) / 48000).toBeCloseTo(scene.duration, 5);
      expect(audio.subarray(44).some(value => value !== 0)).toBe(true);
      expect(scene.captions).toHaveLength(2);
      expect(scene.captions[0].start).toBe(0);
      expect(scene.captions.at(-1)!.end).toBeLessThanOrEqual(scene.duration);
      const compiled = await compileSource(scene.source);
      validateRenderableScene(compiled);
      expect(compiled.duration).toBeCloseTo(scene.duration, 5);
      // Evaluate real intermediate and final geometry, not just the source envelope.
      for (const t of [0, scene.duration / 2, scene.duration]) {
        expect(evaluateScene(compiled, t).elements.length).toBeGreaterThan(5);
      }
    }
  }, 20000);
  it('keeps checkpoint solutions on the server and updates results without changing DCC', async () => {
    const catalog = await request(app).get('/api/content').expect(200);
    const lesson = catalog.body.lessons.find((l: { id: string }) => l.id === 'math-v1');
    expect(lesson.content.narrated.manifestUrl).toBe('/videos/math-v1/manifest.json');
    expect(lesson.content.questions.map((q: { afterScene: number }) => q.afterScene)).toEqual([1, 3]);
    expect(lesson.content.questions.every((q: { correct: number; explanation: string }) => q.correct === -1 && q.explanation === '')).toBe(true);
    expect(JSON.stringify(manifest)).not.toContain('"correct"');
    const login = await request(app).post('/api/login').send({ name: 'Video-Test', timeBudgetMin: 30, levels: {} }).expect(201);
    const before = login.body;
    const node = before.session.nodes.find((n: { lessonId: string }) => n.lessonId === 'math-v1');
    expect(node).toBeDefined();
    await request(app).post(`/api/sessions/${before.session.id}/nodes/${node.id}/start`).expect(200);
    const done = await request(app).post(`/api/sessions/${before.session.id}/nodes/${node.id}/complete`)
      .send({ answer: { type: 'video', answers: { 0: 2, 1: 1 } }, durationMin: 3 }).expect(200);
    expect(done.body.result).toMatchObject({ allMet: true, judgedBy: 'rule' });
    expect(done.body.result.criteria.map((c: { key: string }) => c.key)).toEqual(['grenzwert', 'steigung']);
    expect(done.body.view.dcc).toEqual(before.dcc);
    expect(done.body.view.session.nodes.find((n: { id: string }) => n.id === node.id).state).toBe('done');
    expect(done.body.view.session.events.at(-1).lessonId).toBe('math-v1');
  });
});
