import type {Subscribable} from '@ovacanvas/core';
import type {
  MutationCapability,
  PreparedGeneration,
} from '@ovacanvas/core/lib/internal';
import {RuntimeAuthority} from '@ovacanvas/core/lib/internal';
import type {BeatRecord, LessonState} from './LessonState';
import {initialLessonState} from './LessonState';

/**
 * A `RuntimeAuthority<LessonState>` plus the one accepted mutation this
 * milestone needs: appending a beat once its generation is active.
 *
 * @remarks
 * Mirrors `LearnerStore` in the e2e fixtures - a thin wrapper with no write
 * method of its own beyond what a generation-scoped capability allows.
 */
export class LessonStore {
  public readonly authority: RuntimeAuthority<LessonState>;

  public constructor(lessonId: string, question: string) {
    this.authority = new RuntimeAuthority<LessonState>(
      initialLessonState(lessonId, question),
    );
  }

  public get revision(): number {
    return this.authority.revision;
  }

  public get onRevisionChanged(): Subscribable<number> {
    return this.authority.onRevisionChanged;
  }

  public read(): Readonly<LessonState> {
    return this.authority.read();
  }

  /**
   * Record that `beat` is now the accepted content for the just-activated
   * generation. Throws if `capability` is not (or no longer) the accepted
   * generation's - the same fail-closed behaviour every other write in this
   * runtime relies on.
   */
  public acceptBeat(
    capability: MutationCapability<LessonState>,
    beat: BeatRecord,
  ): number {
    return capability.write(draft => {
      draft.beats.push(beat);
    });
  }

  /** Ask a new interruption to replace what's being asked, bumping the revision. */
  public askQuestion(
    capability: MutationCapability<LessonState>,
    question: string,
  ): number {
    return capability.write(draft => {
      draft.question = question;
    });
  }

  public prepare(): PreparedGeneration<LessonState> {
    return this.authority.prepare();
  }

  public dispose(): void {
    this.authority.dispose();
  }
}
