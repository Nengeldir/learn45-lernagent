// Model path with a mock provider: model answers are marked, broken answers fall back to prepared content.
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SessionView } from '@l45/shared';
import { createApp } from '../src/app.ts';
import { setMockHandler } from '../src/provider.ts';
import { _reset } from '../src/sessions.ts';

const app = createApp();
const levels = { 't-info': 'Mittelstufe', 't-komm': 'Grundstufe', 't-inhalte': 'Grundstufe', 't-sicherheit': 'Mittelstufe', 't-problem': 'Grundstufe' };

async function chatNode() {
  const res = await request(app).post('/api/login').send({ name: 'Quirina', timeBudgetMin: 60, levels }).expect(201);
  const v: SessionView = res.body;
  // With the agent the map starts with one lesson per track; for Kommunikation (Grundstufe) that is a chat.
  const n = v.session.nodes.find((x) => x.lessonId === 'komm-c1')!;
  expect(n).toBeDefined();
  return { id: v.session.id, node: n.id };
}

beforeEach(() => {
  _reset();
  process.env.MODEL_PROVIDER = 'mock';
});
afterEach(() => {
  setMockHandler(null);
  process.env.MODEL_PROVIDER = 'none';
});

describe('Modell', () => {
  it('kennzeichnet Antworten des Modells', async () => {
    const seen: string[] = [];
    setMockHandler((req) => {
      seen.push(JSON.stringify(req));
      return 'Woran erkennst du, woher die Zahl stammt?';
    });
    const { id, node } = await chatNode();
    const res = await request(app).post(`/api/sessions/${id}/nodes/${node}/chat`).send({ turns: [{ role: 'learner', text: 'Ich frage nach der Quelle.' }] }).expect(200);
    expect(res.body).toEqual({ text: 'Woran erkennst du, woher die Zahl stammt?', source: 'model' });
    // Neither the name nor the DCC profile goes to the model.
    expect(seen.join(' ')).not.toContain('Quirina');
    expect(seen.join(' ')).not.toMatch(/Mittelstufe|Grundstufe/);
  });

  it('fällt bei Fehlern auf vorbereitete Inhalte zurück', async () => {
    setMockHandler(() => {
      throw new Error('timeout');
    });
    const { id, node } = await chatNode();
    const res = await request(app).post(`/api/sessions/${id}/nodes/${node}/chat`).send({ turns: [{ role: 'learner', text: 'Hallo' }] }).expect(200);
    expect(res.body.source).toBe('prepared');
  });

  it('bewertet mit dem Modell und nimmt bei unlesbarem JSON die Stichworte', async () => {
    const { id, node } = await chatNode();
    const lesson = (await request(app).get('/api/content')).body.lessons.find((l: { id: string }) => l.id === 'komm-c1');
    const ids: string[] = lesson.content.criteria.map((c: { id: string }) => c.id);
    const turns = [{ role: 'learner', text: 'Ich prüfe, ob die Zahl in der Quelle steht.' }];

    setMockHandler(() => JSON.stringify({ criteria: ids.map((c) => ({ id: c, met: true, reason: 'Steht so da.' })) }));
    await request(app).post(`/api/sessions/${id}/nodes/${node}/start`).expect(200);
    let res = await request(app).post(`/api/sessions/${id}/nodes/${node}/complete`).send({ answer: { type: 'ai-chat', turns } }).expect(200);
    expect(res.body.result.judgedBy).toBe('model');
    expect(res.body.result.allMet).toBe(true);

    setMockHandler(() => 'kein JSON');
    await request(app).post(`/api/sessions/${id}/nodes/${node}/start`).expect(200);
    res = await request(app).post(`/api/sessions/${id}/nodes/${node}/complete`).send({ answer: { type: 'ai-chat', turns } }).expect(200);
    expect(res.body.result.judgedBy).toBe('keywords');
  });
});
