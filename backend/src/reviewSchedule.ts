import type { ReviewItem } from '@l45/shared';

const DAY = 86_400_000;
export const REVIEW_INTERVALS = [1, 3, 7, 14, 30, 60];
export const RETRY_MINUTES = 10;

/** A lapse restarts the progression; the first successful retry is due tomorrow. */
export function scheduleReview(item: ReviewItem, correct: boolean, now = new Date(), source: ReviewItem['lastReviewSource'] = 'lesson') {
  const streak = correct && item.lastCorrect !== false ? (item.streak ?? 0) + 1 : 0;
  const intervalDays = correct ? REVIEW_INTERVALS[Math.min(streak, REVIEW_INTERVALS.length - 1)] : RETRY_MINUTES / 1440;
  Object.assign(item, {
    status: 'waiting', streak, intervalDays,
    lapses: (item.lapses ?? 0) + (correct ? 0 : 1),
    lastReviewedAt: now.toISOString(), lastCorrect: correct,
    lastReviewSource: source,
    dueAt: new Date(now.getTime() + intervalDays * DAY).toISOString(),
  });
}

export const firstReviewAt = (at: string) => new Date(new Date(at).getTime() + DAY).toISOString();
