import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReviewQuestion } from '@l45/shared';
import { createApp } from '../src/app.ts';
import { _reset, get, save } from '../src/sessions.ts';
import { scheduleReview } from '../src/reviewSchedule.ts';
import { finish, login, node, s1Right, v1Right } from './helpers.ts';

beforeEach(() => {
  _reset();
  process.env.MODEL_PROVIDER = 'none';
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-24T10:00:00Z'));
});
afterEach(() => vi.useRealTimers());

const advance = (at: string) => vi.setSystemTime(new Date(at));

async function learned() {
  const app = createApp();
  let v = await login(app);
  v = await finish(app, v, node(v, 'sich-v1'), v1Right);
  return { app, v, base: `/api/sessions/${v.session.id}` };
}

async function grade(app: ReturnType<typeof createApp>, base: string, reviewId: string, correct: boolean) {
  const opened = await request(app).post(`${base}/reviews/${reviewId}/start`).send({}).expect(200);
  const question: ReviewQuestion = opened.body.question;
  const sessionId = base.split('/').at(-1)!;
  const answer = get(sessionId).session.reviewChallenges![reviewId].correctOption;
  const option = correct ? answer : (answer + 1) % question.options.length;
  const body = { challengeId: question.id, option };
  const response = await request(app).post(`${base}/reviews/${reviewId}/answer`).send(body).expect(200);
  return { response, question, body };
}

describe('spaced recall', () => {
  it('starts after one day, stays due until answered and never exposes solutions before grading', async () => {
    const { app, v, base } = await learned();
    expect(v.reviews.due).toHaveLength(0);
    expect(v.reviews.upcoming).toHaveLength(2);
    const id = v.reviews.upcoming[0].id;
    await request(app).post(`${base}/reviews/${id}/start`).send({}).expect(409);
    advance('2026-10-25T10:00:00Z');
    const opened = await request(app).post(`${base}/reviews/${id}/start`).send({}).expect(200);
    expect(opened.body.question).not.toHaveProperty('correctOption');
    expect(opened.body.question).not.toHaveProperty('explanation');
    expect(opened.body.view.session).not.toHaveProperty('reviewChallenges');
    expect(opened.body.view.reviews.due).toHaveLength(2);
    expect(opened.body.question).not.toHaveProperty('scenes');
    const same = await request(app).post(`${base}/reviews/${id}/start`).send({}).expect(200);
    expect(same.body.question).toEqual(opened.body.question);
  });

  it('increases successful intervals through 3, 7, 14, 30 and 60 days without adding XP or completed lessons', async () => {
    const { app, v, base } = await learned();
    const id = v.reviews.upcoming[0].id;
    let dueAt = v.reviews.upcoming[0].dueAt;
    for (const days of [3, 7, 14, 30, 60, 60]) {
      advance(dueAt);
      const { response } = await grade(app, base, id, true);
      expect(response.body.feedback.intervalDays).toBe(days);
      expect(Date.parse(response.body.feedback.dueAt) - Date.now()).toBe(days * 86_400_000);
      expect(response.body.view.rewards.xp).toBe(v.rewards.xp);
      expect(response.body.view.rewards.completedLessons).toBe(1);
      dueAt = response.body.feedback.dueAt;
    }
  });

  it('prioritises failed concepts, requires a ten-minute retry, and rebuilds intervals from one day', async () => {
    const { app, v, base } = await learned();
    const id = v.reviews.upcoming[1].id;
    advance(v.reviews.upcoming[1].dueAt);
    const missed = await grade(app, base, id, false);
    expect(Date.parse(missed.response.body.feedback.dueAt) - Date.now()).toBe(600_000);
    const q = get(v.session.id).session.reviewQueue.find((q) => q.id === id)!;
    expect(q.lapses).toBe(1);
    expect(missed.response.body.view.workspace.lernstand.find((c: { criterion: string }) => c.criterion === q.criterion).state).toBe('am-ueben');
    await request(app).post(`${base}/reviews/${id}/start`).send({}).expect(409);
    advance(q.dueAt!);
    const due = await request(app).get(base).expect(200);
    expect(due.body.reviews.due[0].id).toBe(id);
    const recovered = await grade(app, base, id, true);
    expect(recovered.response.body.feedback.intervalDays).toBe(1);
    expect(recovered.response.body.view.workspace.lernstand.find((c: { criterion: string }) => c.criterion === q.criterion).state).toBe('sicher');
    advance(q.dueAt!);
    expect((await grade(app, base, id, true)).response.body.feedback.intervalDays).toBe(3);
  });

  it('persists deadlines and challenge receipts, handles retries once and rejects changing a graded answer', async () => {
    const { app, v, base } = await learned();
    const id = v.reviews.upcoming[0].id;
    advance(v.reviews.upcoming[0].dueAt);
    const { response, body, question } = await grade(app, base, id, false);
    const restarted = createApp();
    const replay = await request(restarted).post(`${base}/reviews/${id}/answer`).send(body).expect(200);
    expect(replay.body.feedback).toEqual(response.body.feedback);
    expect(replay.body.view.session.reviewQueue.find((q: { id: string }) => q.id === id).lapses).toBe(1);
    await request(restarted).post(`${base}/reviews/${id}/answer`).send({ ...body, option: (body.option + 1) % question.options.length }).expect(409);
    const resumed = await login(restarted, { resume: 'continue' });
    expect(resumed.reviews.upcoming.find((q) => q.id === id)?.dueAt).toBe(response.body.feedback.dueAt);
    expect(resumed.dcc).toEqual(v.dcc);
  });

  it('rejects malformed answers, unstarted challenges and another learner’s reviews', async () => {
    const { app, v, base } = await learned();
    const id = v.reviews.upcoming[0].id;
    advance(v.reviews.upcoming[0].dueAt);
    await request(app).post(`${base}/reviews/${id}/answer`).send({ option: 0 }).expect(409);
    const opened = await request(app).post(`${base}/reviews/${id}/start`).send({}).expect(200);
    for (const option of [-1, 1000, 0.5, '0', null]) await request(app).post(`${base}/reviews/${id}/answer`).send({ challengeId: opened.body.question.id, option }).expect(400);
    const other = await login(app, { name: 'Other' });
    await request(app).post(`/api/sessions/${other.session.id}/reviews/${id}/start`).send({}).expect(404);
  });

  it('covers concepts learned through website tasks and migrates old completed reviews into recurring ones', async () => {
    const { app, v, base } = await learned();
    await finish(app, v, node(v, 'sich-s1'), s1Right);
    const st = get(v.session.id);
    expect(st.session.reviewQueue).toHaveLength(6);
    const legacy = st.session.reviewQueue.find((q) => q.criterion === 'druck')!;
    delete legacy.dueAt;
    legacy.status = 'done';
    save(st);
    advance('2026-10-26T10:00:00Z');
    const restarted = createApp();
    const migrated = await request(restarted).get(base).expect(200);
    expect(migrated.body.reviews.due.some((q: { id: string }) => q.id === legacy.id)).toBe(true);
    const { question } = await grade(restarted, base, legacy.id, true);
    expect(question.prompt).toContain('Zeitdruck');
    expect(question.options.length).toBeGreaterThan(1);
  });

  it('a later lesson cannot erase a recent failure or push its retry further away', async () => {
    const { app, v } = await learned();
    const st = get(v.session.id);
    const q = st.session.reviewQueue[0];
    scheduleReview(q, false);
    const dueAt = q.dueAt;
    await finish(app, v, node(v, 'sich-v1'), v1Right);
    expect(q.dueAt).toBe(dueAt);
    expect(q.lapses).toBe(1);
  });
});
