/**
 * One accepted beat's record in the lesson.
 *
 * @remarks
 * `RuntimeAuthority` deep-freezes and deep-clones this on every write, so it
 * must stay plain objects, arrays and primitives - no `Map`, `Set`, `Date` or
 * typed array anywhere in it, at any depth.
 */
export interface BeatRecord {
  id: string;
  title: string;
  /** 0 for the first attempt; incremented on each repair/re-authoring round. */
  attempt: number;
}

/**
 * The authoritative lesson projection a `LessonHost` stages beats against.
 *
 * @remarks
 * This is the `TState` `RuntimeAuthority`/`TransitionOwner` are parameterized
 * over - see `LessonStore`. Deliberately small for the first milestone: just
 * enough to give staging something real to prepare against and something
 * that changes meaning (a new `question`) when a learner interrupts.
 */
export interface LessonState {
  lessonId: string;
  question: string;
  beats: BeatRecord[];
}

export function initialLessonState(
  lessonId: string,
  question: string,
): LessonState {
  return {lessonId, question, beats: []};
}
