import type {TransitionResult} from '@ovacanvas/core/lib/internal';
import {TransitionOwner} from '@ovacanvas/core/lib/internal';
import type {BeatStagingResult} from '../orchestration/BeatStagingCoordinator';
import {BeatStagingCoordinator} from '../orchestration/BeatStagingCoordinator';
import type {BeatManifest} from '../presentation/BeatManifest';
import type {ChunkRequest} from './ChunkRequest';
import type {LessonState} from './LessonState';
import {LessonStore} from './LessonStore';

export interface LessonOptions<TPresentation = unknown> {
  readonly lessonId?: string;
  readonly question?: string;
  readonly beats?: readonly BeatManifest[];
  readonly store?: LessonStore;
  readonly coordinator?: BeatStagingCoordinator<TPresentation>;
  readonly owner?: TransitionOwner<LessonState, TPresentation, ChunkRequest>;
  readonly autoCookNext?: boolean;
}

export type LessonAdvanceResult =
  | {ok: true; index: number; beat: BeatManifest; activation: TransitionResult}
  | {ok: false; reason: string; detail?: string};

/**
 * Multi-beat lesson orchestrator.
 *
 * @remarks
 * Coordinates an ordered (or dynamically extended) sequence of beats using
 * `TransitionOwner` and `BeatStagingCoordinator`. Implements generalized
 * N-beat background lookahead: when beat K is activated and begins active
 * playback on screen, beat K+1 immediately begins preparation and staging
 * offstage in the background. When the learner or host calls `advance()`,
 * beat K+1 is swapped in atomically with zero wait time.
 */
export class Lesson<TPresentation = unknown> {
  public readonly store: LessonStore;
  private readonly coordinator: BeatStagingCoordinator<TPresentation>;
  private readonly beatsList: BeatManifest[];
  private readonly autoCookNext: boolean;

  private activeIndex = -1;
  private cookingIndex = -1;
  private cookingPromise: Promise<BeatStagingResult> | null = null;
  private disposed = false;

  public constructor(options: LessonOptions<TPresentation> = {}) {
    this.beatsList = [...(options.beats ?? [])];
    this.autoCookNext = options.autoCookNext ?? true;

    if (options.store) {
      this.store = options.store;
    } else {
      this.store = new LessonStore(
        options.lessonId ?? 'lesson',
        options.question ?? 'Lesson',
      );
    }

    if (options.coordinator) {
      this.coordinator = options.coordinator;
    } else if (options.owner) {
      this.coordinator = new BeatStagingCoordinator<TPresentation>(
        options.owner,
      );
    } else {
      throw new Error(
        'Lesson requires either a BeatStagingCoordinator or a TransitionOwner.',
      );
    }
  }

  public get beats(): readonly BeatManifest[] {
    return this.beatsList;
  }

  public get currentBeatIndex(): number {
    return this.activeIndex;
  }

  public get currentBeat(): BeatManifest | null {
    return this.activeIndex >= 0 && this.activeIndex < this.beatsList.length
      ? this.beatsList[this.activeIndex]
      : null;
  }

  public get nextBeat(): BeatManifest | null {
    const nextIdx = this.activeIndex + 1;
    return nextIdx < this.beatsList.length ? this.beatsList[nextIdx] : null;
  }

  public get candidateBeatIndex(): number {
    return this.cookingIndex;
  }

  public get isCooking(): boolean {
    return this.cookingPromise !== null;
  }

  public get current(): TPresentation | null {
    return this.coordinator.current;
  }

  public get outgoing(): TPresentation | null {
    return this.coordinator.outgoing;
  }

  /** Append an additional beat to the lesson sequence dynamically. */
  public enqueueBeat(beat: BeatManifest): void {
    this.beatsList.push(beat);
    // If we're active, not currently cooking anything, and there's a next beat to cook,
    // trigger background cook immediately.
    if (
      this.autoCookNext &&
      this.activeIndex >= 0 &&
      this.cookingIndex === -1 &&
      this.activeIndex + 1 < this.beatsList.length
    ) {
      this.triggerCookNext();
    }
  }

  /**
   * Stage and activate the first beat in the sequence, and begin background cooking
   * of beat 1 offstage.
   */
  public async start(): Promise<BeatStagingResult> {
    if (this.disposed) {
      return {
        ok: false,
        reason: 'owner-disposed',
        detail: 'Lesson is disposed',
      };
    }
    if (this.beatsList.length === 0) {
      return {
        ok: false,
        reason: 'not-ready',
        detail: 'Lesson has no beats to start',
      };
    }

    this.activeIndex = 0;
    const firstBeat = this.beatsList[0];
    const stageResult = await this.coordinator.stage({beat: firstBeat});
    if (!stageResult.ok) {
      this.activeIndex = -1;
      return stageResult;
    }

    const activation = this.coordinator.activate();
    if (!activation.ok) {
      this.activeIndex = -1;
      return {
        ok: false,
        reason: 'not-ready',
        detail: `Activation failed: ${activation.reason}`,
      };
    }

    // Beat 0 is now active on screen! Kick off offstage preparation for beat 1.
    if (this.autoCookNext && this.beatsList.length > 1) {
      this.triggerCookNext();
    }

    return stageResult;
  }

  /**
   * Advance to the next beat. Awaits background preparation of beat K+1 if not yet
   * ready, activates it, and automatically kicks off cooking beat K+2 offstage.
   */
  public async advance(): Promise<LessonAdvanceResult> {
    if (this.disposed) {
      return {
        ok: false,
        reason: 'owner-disposed',
        detail: 'Lesson is disposed',
      };
    }
    const nextIdx = this.activeIndex + 1;
    if (nextIdx >= this.beatsList.length) {
      return {
        ok: false,
        reason: 'no-next-beat',
        detail: 'Lesson has reached the end of its beat sequence',
      };
    }

    // Ensure staging is initiated for nextIdx
    if (this.cookingIndex !== nextIdx || !this.cookingPromise) {
      this.startCook(nextIdx);
    }

    const stageResult = await this.cookingPromise!;
    if (!stageResult.ok) {
      return {
        ok: false,
        reason: stageResult.reason,
        detail: stageResult.detail ?? undefined,
      };
    }

    const activation = this.coordinator.activate();
    if (!activation.ok) {
      return {
        ok: false,
        reason: activation.reason,
        detail: `Activation failed for beat index ${nextIdx}`,
      };
    }

    this.activeIndex = nextIdx;
    this.cookingIndex = -1;
    this.cookingPromise = null;

    // Beat K+1 is now active on screen! Kick off offstage background preparation for beat K+2.
    if (this.autoCookNext && this.activeIndex + 1 < this.beatsList.length) {
      this.triggerCookNext();
    }

    return {
      ok: true,
      index: this.activeIndex,
      beat: this.beatsList[this.activeIndex],
      activation,
    };
  }

  public retireOutgoing(): boolean {
    return this.coordinator.retireOutgoing();
  }

  public status() {
    return {
      ...this.coordinator.status(),
      activeIndex: this.activeIndex,
      activeBeatId: this.currentBeat?.id ?? null,
      cookingIndex: this.cookingIndex,
      cookingBeatId:
        this.cookingIndex >= 0 && this.cookingIndex < this.beatsList.length
          ? this.beatsList[this.cookingIndex].id
          : null,
      isCooking: this.isCooking,
      totalBeats: this.beatsList.length,
    };
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cookingPromise = null;
    this.cookingIndex = -1;
    this.coordinator.dispose();
    this.store.dispose();
  }

  private triggerCookNext(): void {
    const nextIdx = this.activeIndex + 1;
    if (nextIdx < this.beatsList.length && this.cookingIndex !== nextIdx) {
      this.startCook(nextIdx);
    }
  }

  private startCook(index: number): void {
    this.cookingIndex = index;
    const beat = this.beatsList[index];
    const promise = this.coordinator.stage({beat});
    this.cookingPromise = promise;
    // Catch rejection to avoid unhandled promise errors in background
    promise.catch(() => {});
  }
}
