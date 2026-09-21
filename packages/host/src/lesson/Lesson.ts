import type {
  MutationCapability,
  TransitionResult,
} from '@ovacanvas/core/lib/internal';
import {TransitionOwner} from '@ovacanvas/core/lib/internal';
import type {BeatStagingResult} from '../orchestration/BeatStagingCoordinator';
import {BeatStagingCoordinator} from '../orchestration/BeatStagingCoordinator';
import type {BeatManifest} from '../presentation/BeatManifest';
import type {ChunkRequest} from './ChunkRequest';
import type {BeatRecord, LessonState} from './LessonState';
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

export type LessonExploreResult =
  | {ok: true; beat: BeatManifest}
  | {ok: false; reason: string; detail?: string};

export type LessonAbandonResult =
  | {ok: true; restoredIndex: number; beat: BeatManifest}
  | {ok: false; reason: string; detail?: string};

export type LessonCommitResult =
  | {ok: true; index: number; beat: BeatManifest; revision: number}
  | {ok: false; reason: string; detail?: string};

export interface ActiveExploration<TPresentation = unknown> {
  readonly beat: BeatManifest;
  readonly question?: string;
  readonly returnIndex: number;
  readonly returnBeat: BeatManifest;
  readonly presentation: TPresentation | null;
}

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
 *
 * Also implements exploration-vs-commit interruption semantics: a tangential
 * question stages an exploratory beat without altering the committed lesson track
 * or bumping RuntimeAuthority revision. Abandoning the exploration seamlessly returns
 * to the committed beat; committing it incorporates the beat into the track,
 * advances the revision, and gracefully invalidates stale pre-commit background cooks.
 */
export class Lesson<TPresentation = unknown> {
  public readonly store: LessonStore;
  private readonly coordinator: BeatStagingCoordinator<TPresentation>;
  private readonly beatsList: BeatManifest[];
  private readonly autoCookNext: boolean;

  private activeIndex = -1;
  private cookingIndex = -1;
  private cookingPromise: Promise<BeatStagingResult> | null = null;
  private activeExploration: ActiveExploration<TPresentation> | null = null;
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

  public get committedIndex(): number {
    return this.activeIndex;
  }

  public get isExploring(): boolean {
    return this.activeExploration !== null;
  }

  public get exploration(): ActiveExploration<TPresentation> | null {
    return this.activeExploration;
  }

  public get currentBeat(): BeatManifest | null {
    if (this.activeExploration) {
      return this.activeExploration.beat;
    }
    return this.activeIndex >= 0 && this.activeIndex < this.beatsList.length
      ? this.beatsList[this.activeIndex]
      : null;
  }

  public get committedBeat(): BeatManifest | null {
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
    // If we're active, not exploring, not cooking, and there's a next beat, trigger cook.
    if (
      this.autoCookNext &&
      !this.activeExploration &&
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
   * Stage and activate a tangential exploration beat without mutating the committed
   * lesson track or bumping RuntimeAuthority revision.
   */
  public async explore(
    beat: BeatManifest,
    options?: {question?: string},
  ): Promise<LessonExploreResult> {
    if (this.disposed) {
      return {
        ok: false,
        reason: 'owner-disposed',
        detail: 'Lesson is disposed',
      };
    }
    if (this.activeIndex < 0) {
      return {
        ok: false,
        reason: 'not-ready',
        detail: 'Lesson has not been started',
      };
    }

    const returnIndex = this.activeIndex;
    const returnBeat = this.beatsList[returnIndex];

    // Restage candidate offstage with the exploration beat, replacing any in-flight background cook.
    const stageResult = await this.coordinator.restage({beat});
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
        detail: `Activation failed for exploration beat ${beat.id}`,
      };
    }

    this.activeExploration = {
      beat,
      question: options?.question,
      returnIndex,
      returnBeat,
      presentation: this.coordinator.current,
    };

    this.cookingIndex = -1;
    this.cookingPromise = null;

    return {
      ok: true,
      beat,
    };
  }

  /**
   * Abandon an active exploration and return cleanly to the committed beat.
   * Restores the committed beat to the screen without altering revision.
   */
  public async abandonExploration(): Promise<LessonAbandonResult> {
    if (this.disposed) {
      return {
        ok: false,
        reason: 'owner-disposed',
        detail: 'Lesson is disposed',
      };
    }
    if (!this.activeExploration) {
      return {
        ok: false,
        reason: 'not-exploring',
        detail: 'No active exploration to abandon',
      };
    }

    const {returnIndex, returnBeat} = this.activeExploration;
    this.activeExploration = null;

    const stageResult = await this.coordinator.restage({beat: returnBeat});
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
        detail: `Activation failed when returning to beat ${returnBeat.id}`,
      };
    }

    this.activeIndex = returnIndex;
    this.cookingIndex = -1;
    this.cookingPromise = null;

    // Re-kick off background cook for next beat in committed sequence.
    if (this.autoCookNext && this.activeIndex + 1 < this.beatsList.length) {
      this.triggerCookNext();
    }

    return {
      ok: true,
      restoredIndex: this.activeIndex,
      beat: returnBeat,
    };
  }

  /**
   * Commit an active exploration into the authoritative lesson projection.
   *
   * @remarks
   * Uses RuntimeAuthority's write capability to mutate the lesson state and advance
   * the revision. Inserts the exploration beat into the lesson sequence at the committed
   * position, and invalidates any stale background cooks.
   */
  public async commitExploration(options?: {
    capability?: MutationCapability<LessonState>;
    question?: string;
  }): Promise<LessonCommitResult> {
    if (this.disposed) {
      return {
        ok: false,
        reason: 'owner-disposed',
        detail: 'Lesson is disposed',
      };
    }
    if (!this.activeExploration) {
      return {
        ok: false,
        reason: 'not-exploring',
        detail: 'No active exploration to commit',
      };
    }

    const exploration = this.activeExploration;
    const capability =
      options?.capability ??
      (
        this.coordinator.current as {
          capability?: MutationCapability<LessonState> | null;
        } | null
      )?.capability ??
      undefined;

    if (!capability || !capability.isValid()) {
      return {
        ok: false,
        reason: 'no-valid-capability',
        detail: 'Active presentation does not possess a valid write capability',
      };
    }

    const beatRecord: BeatRecord = {
      id: exploration.beat.id,
      title: exploration.beat.title,
      attempt: this.coordinator.attemptsFor(exploration.beat.id),
    };

    const revision = this.store.commitExploration(
      capability,
      beatRecord,
      options?.question ?? exploration.question,
    );

    const committedIdx = exploration.returnIndex + 1;
    this.beatsList.splice(committedIdx, 0, exploration.beat);
    this.activeIndex = committedIdx;
    this.activeExploration = null;
    this.cookingIndex = -1;
    this.cookingPromise = null;

    // Kick off cook for the subsequent beat at the new revision.
    if (this.autoCookNext && this.activeIndex + 1 < this.beatsList.length) {
      this.triggerCookNext();
    }

    return {
      ok: true,
      index: this.activeIndex,
      beat: exploration.beat,
      revision,
    };
  }

  /**
   * Advance to the next beat. Awaits background preparation of beat K+1 if not yet
   * ready, activates it, and automatically kicks off cooking beat K+2 offstage.
   *
   * @remarks
   * If a background cook was prepared against a revision that has since become stale
   * (e.g. from an exploration commit), TransitionOwner refuses activation with
   * 'stale-revision'. Advance catches this refusal, restages the candidate fresh
   * against the current authoritative revision, and completes activation cleanly.
   */
  public async advance(): Promise<LessonAdvanceResult> {
    if (this.disposed) {
      return {
        ok: false,
        reason: 'owner-disposed',
        detail: 'Lesson is disposed',
      };
    }
    if (this.activeExploration) {
      return {
        ok: false,
        reason: 'exploring',
        detail:
          'Cannot advance while an exploration is active. Commit or abandon it first.',
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

    let activation = this.coordinator.activate();
    if (!activation.ok) {
      if (activation.reason === 'stale-revision') {
        // Pre-commit cook was prepared against an earlier revision. Restage fresh!
        const restageResult = await this.coordinator.restage({
          beat: this.beatsList[nextIdx],
        });
        if (!restageResult.ok) {
          return {
            ok: false,
            reason: restageResult.reason,
            detail: restageResult.detail ?? undefined,
          };
        }
        activation = this.coordinator.activate();
        if (!activation.ok) {
          return {
            ok: false,
            reason: activation.reason,
            detail: `Activation failed after stale-revision recovery for beat index ${nextIdx}`,
          };
        }
      } else {
        return {
          ok: false,
          reason: activation.reason,
          detail: `Activation failed for beat index ${nextIdx}`,
        };
      }
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
      committedIndex: this.activeIndex,
      committedBeatId: this.committedBeat?.id ?? null,
      isExploring: this.isExploring,
      explorationBeatId: this.activeExploration?.beat.id ?? null,
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
    this.activeExploration = null;
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
