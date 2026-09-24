import type {BeatStagingResult} from '../orchestration/BeatStagingCoordinator';
import type {LessonHost} from '../orchestration/LessonHost';
import type {BeatManifest} from '../presentation/BeatManifest';
import type {BeatPresentation} from '../presentation/BeatPresentation';
import type {Lesson} from './Lesson';

export interface LessonPlayerEvents {
  /** A part came on screen and started playing. */
  onPart?(index: number, presentation: BeatPresentation): void;
  /** A part reached its last frame (it holds there while the next swaps in). */
  onPartEnd?(index: number, presentation: BeatPresentation): void;
  /** The last part finished. Its last frame stays on screen. */
  onEnd?(): void;
  onError?(reason: string, detail?: string): void;
}

/**
 * Plays a multi-part lesson straight through.
 *
 * @remarks
 * A `Lesson` stages and swaps beats but never decides when to: a beat plays
 * on a loop and has no "ended" event. This watches the playhead of the part
 * on screen, stops it on its last frame, and advances - by which time the
 * lesson has usually cooked the next part offstage, so the swap is
 * immediate. A compiled lesson starts each part on exactly the frame the
 * previous one ended on, so the host's crossfade between them is invisible.
 *
 * Swaps go through `Lesson.advance()` and the host's own transition, which
 * retires the outgoing part when its fade completes - retiring by hand would
 * cut the crossfade short.
 */
export class LessonPlayer {
  public readonly lesson: Lesson<BeatPresentation>;
  private unsubscribe: (() => void) | null = null;
  private advancing = false;
  private stopped = false;
  private finished = false;

  public constructor(
    host: LessonHost,
    beats: readonly BeatManifest[],
    private readonly events: LessonPlayerEvents = {},
  ) {
    this.lesson = host.createLesson(beats);
  }

  public get index(): number {
    return this.lesson.currentBeatIndex;
  }

  public get isFinished(): boolean {
    return this.finished;
  }

  public async start(): Promise<BeatStagingResult> {
    const result = await this.lesson.start();
    if (result.ok) this.playCurrent();
    else this.events.onError?.(result.reason, result.detail ?? undefined);
    return result;
  }

  /** Stop where it is; the part on screen stays. */
  public stop(): void {
    this.stopped = true;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.lesson.current?.pause();
  }

  private playCurrent(): void {
    const presentation = this.lesson.current;
    if (!presentation || this.stopped) return;
    this.unsubscribe?.();
    const index = this.lesson.currentBeatIndex;
    let last = -1;
    this.unsubscribe = presentation.player.onFrameChanged.subscribe(frame => {
      if (this.stopped || this.advancing) return;
      const end = Math.max(1, presentation.player.playback.duration);
      // A looping beat jumps back to 0 after its last frame; either sign
      // means the part has played through.
      const wrapped = frame < last;
      last = frame;
      if (frame >= end - 1 || wrapped) this.finishPart(index, presentation);
    }, false);
    presentation.seek(0);
    presentation.play();
    this.events.onPart?.(index, presentation);
  }

  private finishPart(index: number, presentation: BeatPresentation): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    // Hold the last frame: it is exactly the next part's first.
    presentation.pause();
    presentation.seek(presentation.player.playback.duration);
    this.events.onPartEnd?.(index, presentation);
    if (!this.lesson.nextBeat) {
      this.finished = true;
      this.events.onEnd?.();
      return;
    }
    this.advancing = true;
    void this.lesson.advance().then(result => {
      this.advancing = false;
      if (this.stopped) return;
      if (!result.ok) {
        this.events.onError?.(result.reason, result.detail);
        return;
      }
      this.playCurrent();
    });
  }
}
