// A topic is climbed as a row of mountains. Every finished lesson is one step, and six steps reach a peak; the
// next lesson starts the next mountain. A finished mountain is named after what its lessons trained most, so the
// name says what the learner covered there. The mountain still being climbed has no name yet.
import type { Criterion, Lesson, MapNode } from '@l45/shared';
import { STEPS_PER_MOUNTAIN } from '@l45/shared';

export { STEPS_PER_MOUNTAIN };

export interface Mountain {
  /** 1 for the first mountain of the topic */
  number: number;
  /** Finished lessons on this mountain, in the order they were finished */
  lessons: MapNode[];
  /** All steps finished */
  topped: boolean;
  /** Label of the criterion the lessons trained most. Only for a topped mountain whose lessons name targets. */
  name: string | null;
}

/** Splits the finished lessons into mountains. The last one is the mountain being climbed, possibly still empty. */
export function mountainsOf(done: MapNode[], lessonOf: (id?: string) => Lesson | undefined, criteria: Criterion[]): Mountain[] {
  const out: Mountain[] = [];
  for (let i = 0; i < done.length; i += STEPS_PER_MOUNTAIN) {
    const lessons = done.slice(i, i + STEPS_PER_MOUNTAIN);
    const topped = lessons.length === STEPS_PER_MOUNTAIN;
    out.push({ number: out.length + 1, lessons, topped, name: topped ? mostTrained(lessons, lessonOf, criteria) : null });
  }
  if (!out.length || out.at(-1)!.topped) out.push({ number: out.length + 1, lessons: [], topped: false, name: null });
  return out;
}

function mostTrained(lessons: MapNode[], lessonOf: (id?: string) => Lesson | undefined, criteria: Criterion[]): string | null {
  const count = new Map<string, number>();
  for (const n of lessons) for (const id of lessonOf(n.lessonId)?.targets ?? []) count.set(id, (count.get(id) ?? 0) + 1);
  // Ties go to the criterion listed first in the topic, which is the more basic one.
  let best: Criterion | null = null;
  for (const c of criteria) if ((count.get(c.id) ?? 0) > (best ? count.get(best.id)! : 0)) best = c;
  return best?.label ?? null;
}
