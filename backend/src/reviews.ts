import { randomInt } from 'node:crypto';
import type { Lesson, ReviewChallenge, ReviewItem, ReviewOverview, ReviewQuestion } from '@l45/shared';
import { allLessons } from './guard.ts';
import { isDue } from './records.ts';
import { firstReviewAt, scheduleReview } from './reviewSchedule.ts';
import { HttpError } from './sessions.ts';
import { criterionLabel, learnerTracks, trackIn } from './tracks.ts';
import { newId } from './util.ts';
import { writeState, type Stored } from './workspace.ts';

/** Upgrade the old one-shot queue, and include learning from before reviews existed. */
export function ensureReviews(st: Stored) {
  let changed = false;
  const s = st.session;
  for (const q of s.reviewQueue) {
    if (q.dueAt) continue;
    const done = q.status === 'done';
    const at = s.events.find((ev) => ev.id === q.doneEventId)?.at ?? q.addedAt;
    const due = !done && isDue(st, q);
    Object.assign(q, { dueAt: due ? new Date().toISOString() : firstReviewAt(at), status: 'waiting', intervalDays: 1, streak: 0, lapses: 0 });
    changed = true;
  }
  for (const track of learnerTracks(st)) {
    for (const criterion of track.criteria) {
      if (s.reviewQueue.some((q) => q.trackId === track.id && q.criterion === criterion.id)) continue;
      const ev = [...s.events].reverse().find((ev) => ev.trackId === track.id && ev.result.criteria.some((c) => c.key === criterion.id));
      if (!ev) continue;
      const q: ReviewItem = { id: newId('rv'), trackId: track.id, criterion: criterion.id, recordId: ev.id, addedAt: ev.at, addedAfterEvents: s.events.indexOf(ev) + 1, addedInSession: s.sessionNo, status: 'waiting', dueAt: firstReviewAt(ev.at), intervalDays: 1, streak: 0, lapses: 0 };
      if (ev.result.criteria.some((c) => c.key === criterion.id && c.status === 'missed')) scheduleReview(q, false, new Date(ev.at));
      s.reviewQueue.push(q);
      changed = true;
    }
  }
  if (changed) writeState(s);
}

export function reviewOverview(st: Stored): ReviewOverview {
  const items = st.session.reviewQueue.filter((q) => q.status === 'waiting' && trackIn(st, q.trackId));
  const priority = (a: ReviewItem, b: ReviewItem) => Number(b.lastCorrect === false) - Number(a.lastCorrect === false)
    || (b.lapses ?? 0) - (a.lapses ?? 0) || a.dueAt!.localeCompare(b.dueAt!);
  const summary = (q: ReviewItem) => ({ id: q.id, trackId: q.trackId, label: criterionLabel(st, q.trackId, q.criterion), dueAt: q.dueAt!, lapses: q.lapses ?? 0 });
  return {
    due: items.filter((q) => isDue(st, q)).sort(priority).map(summary),
    upcoming: items.filter((q) => !isDue(st, q)).sort((a, b) => a.dueAt!.localeCompare(b.dueAt!)).map(summary),
  };
}

type QuestionContent = Pick<ReviewChallenge, 'prompt' | 'options' | 'correctOption' | 'explanation' | 'context'>;

function fromLesson(lesson: Lesson, q: ReviewItem): QuestionContent | undefined {
  if (lesson.type === 'video' || lesson.type === 'podcast') {
    const questions = lesson.content.questions.filter((x) => (x.criterion ?? lesson.targets[0]) === q.criterion);
    const question = questions[((q.streak ?? 0) + (q.lapses ?? 0)) % questions.length];
    if (question) return { prompt: question.prompt, options: question.options, correctOption: question.correct, explanation: question.explanation };
  }
  if (lesson.type === 'mark-evidence') {
    const items = lesson.content.summary.filter((x) => x.criterion === q.criterion);
    const item = items[((q.streak ?? 0) + (q.lapses ?? 0)) % items.length];
    if (item) return { prompt: `Ist diese Aussage durch die Notiz belegt? «${item.text}»`, context: lesson.content.note, options: ['Belegt', 'Erfunden'], correctOption: item.verdict === 'belegt' ? 0 : 1, explanation: item.explanation };
  }
  return undefined;
}

/** Reuse only questions from lessons the learner actually completed. No teaching or model call. */
function questionContent(st: Stored, q: ReviewItem): QuestionContent {
  const lessons = allLessons(st.session);
  const learned = [...new Set([...st.session.events].reverse().filter((ev) => ev.trackId === q.trackId && ev.result.criteria.some((c) => c.key === q.criterion)).map((ev) => ev.lessonId))];
  for (const id of learned) {
    const lesson = lessons.find((l) => l.id === id && l.trackId === q.trackId);
    const question = lesson && fromLesson(lesson, q);
    if (question) return question;
  }
  const track = trackIn(st, q.trackId)!;
  const criterion = track.criteria.find((c) => c.id === q.criterion)!;
  const options = [criterion.ruleOfThumb, ...track.criteria.filter((c) => c.id !== q.criterion && c.ruleOfThumb !== criterion.ruleOfThumb).map((c) => c.ruleOfThumb).slice(0, 3)];
  // Custom tracks have at least three criteria; keep a meaningful binary fallback for legacy tracks.
  if (options.length < 2) options.push('Das muss ich nicht prüfen.');
  return { prompt: `Was solltest du bei «${criterion.label}» beachten?`, options, correctOption: 0, explanation: criterion.ruleOfThumb };
}

function publicQuestion(challenge: ReviewChallenge): ReviewQuestion {
  const { correctOption: _c, explanation: _e, answeredOption: _a, feedback: _f, ...question } = challenge;
  return question;
}

export function startReview(st: Stored, reviewId: string): ReviewQuestion {
  ensureReviews(st);
  const q = st.session.reviewQueue.find((q) => q.id === reviewId && trackIn(st, q.trackId));
  if (!q) throw new HttpError(404, 'Wiederholung nicht gefunden.');
  if (!isDue(st, q)) throw new HttpError(409, 'Diese Wiederholung ist noch nicht fällig.');
  const challenges = st.session.reviewChallenges ??= {};
  const existing = challenges[q.id];
  if (existing && !existing.feedback) return publicQuestion(existing);
  const content = questionContent(st, q);
  const order = content.options.map((text, index) => ({ text, index }));
  for (let i = order.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  const challenge: ReviewChallenge = {
    ...content, options: order.map((x) => x.text), correctOption: order.findIndex((x) => x.index === content.correctOption),
    id: newId('rc'), reviewId: q.id, trackId: q.trackId, label: criterionLabel(st, q.trackId, q.criterion),
  };
  challenges[q.id] = challenge;
  writeState(st.session);
  return publicQuestion(challenge);
}

export function answerReview(st: Stored, reviewId: string, input: { challengeId?: unknown; option?: unknown }) {
  const q = st.session.reviewQueue.find((q) => q.id === reviewId);
  const challenge = st.session.reviewChallenges?.[reviewId];
  if (!q || !challenge || challenge.id !== input.challengeId) throw new HttpError(409, 'Bitte öffne die Wiederholung erneut.');
  const option = input.option;
  if (typeof option !== 'number' || !Number.isInteger(option) || option < 0 || option >= challenge.options.length) throw new HttpError(400, 'Ungültige Antwort.');
  if (challenge.feedback) {
    if (challenge.answeredOption !== option) throw new HttpError(409, 'Diese Antwort wurde bereits geprüft.');
    return challenge.feedback;
  }
  // A normal lesson can reschedule a review while an old browser tab is open.
  if (!isDue(st, q)) throw new HttpError(409, 'Diese Wiederholung wurde bereits erledigt.');
  const correct = option === challenge.correctOption;
  scheduleReview(q, correct, new Date(), 'recall');
  challenge.answeredOption = option;
  challenge.feedback = { correct, correctOption: challenge.correctOption, explanation: challenge.explanation, dueAt: q.dueAt!, intervalDays: q.intervalDays! };
  writeState(st.session);
  return challenge.feedback;
}
