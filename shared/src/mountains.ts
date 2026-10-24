// A topic is climbed as mountains of six lessons. The sixth step of each mountain is its peak, where the exam is.

export const STEPS_PER_MOUNTAIN = 6;

/** True when the next finished lesson tops a mountain, that is when five of its six steps are done. */
export const nextIsPeak = (doneInTrack: number) => doneInTrack % STEPS_PER_MOUNTAIN === STEPS_PER_MOUNTAIN - 1;
