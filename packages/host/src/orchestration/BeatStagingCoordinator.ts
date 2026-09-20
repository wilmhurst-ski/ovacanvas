import type {
  StagingRefusalReason,
  StagingResult,
  TransitionOwner,
  TransitionResult,
} from '@ovacanvas/core/lib/internal';
import type {ChunkRequest} from '../lesson/ChunkRequest';
import type {LessonState} from '../lesson/LessonState';

/** Consecutive real failures a beat gets before its retry budget is exhausted. */
const DEFAULT_MAX_ATTEMPTS = 3;

/**
 * Refusal reasons that are the beat's own fault and therefore count against
 * its retry budget. Everything else - busy (`candidate-in-progress`),
 * shutting down (`*-disposed`), or superseded by a newer request
 * (`cancelled`) - is not the beat's failure and must not charge it: a beat
 * that is merely waiting its turn, or that got pre-empted by a learner
 * interruption, has not actually failed at anything.
 */
const CHARGEABLE_REASONS: ReadonlySet<StagingRefusalReason> = new Set([
  'preparation-failed',
  'not-ready',
]);

/**
 * A beat has failed to prepare `attempts` times in a row and the coordinator
 * is refusing to try again automatically.
 *
 * @remarks
 * Distinct from `StagingRefused` (whose `reason` is a closed, core-owned
 * enum) because "give up on this beat" is a host-level retry policy, not a
 * `TransitionOwner` concept - `owner.stage()` is never even called once a
 * beat's budget is spent, so no candidate, generation or adapter call is
 * wasted on a beat already known to be stuck.
 */
export interface AttemptsExhausted {
  readonly ok: false;
  readonly reason: 'attempts-exhausted';
  readonly detail: string;
  readonly attempts: number;
}

export type BeatStagingResult = StagingResult | AttemptsExhausted;

/**
 * The restage/activate logic on top of a `TransitionOwner`, factored out of
 * `LessonHost` so it can be tested against a fake adapter with no real
 * canvas, `Player` or `Stage` involved.
 *
 * @remarks
 * Also owns each beat's retry budget. Without this, a beat whose `prepare()`
 * keeps genuinely failing (a bad compile, an audit finding mechanical repair
 * can't fix) would be retried forever by anything that naively re-calls
 * `stage`/`restage` on refusal - or, just as bad, a caller too cautious to
 * retry at all would treat one transient failure as final. Charging an
 * attempt only for the beat's *own* failures, never for being pre-empted or
 * busy, is what makes "three genuine failures in a row" and "three
 * interruptions in a row" distinguishable instead of both looking like "not
 * ready yet" to whatever is watching.
 */
export class BeatStagingCoordinator<TPresentation> {
  /** Bumped on every `restage`, so a stale in-flight call can tell it lost the race. */
  private stageToken = 0;
  /** Consecutive real (chargeable) preparation failures, keyed by beat id. */
  private readonly attempts = new Map<string, number>();

  public constructor(
    private readonly owner: TransitionOwner<
      LessonState,
      TPresentation,
      ChunkRequest
    >,
    private readonly maxAttempts: number = DEFAULT_MAX_ATTEMPTS,
  ) {}

  public get current(): TPresentation | null {
    return this.owner.current;
  }

  public get outgoing(): TPresentation | null {
    return this.owner.outgoing;
  }

  public status() {
    return this.owner.status();
  }

  /** How many consecutive real failures this beat has accumulated so far. */
  public attemptsFor(beatId: string): number {
    return this.attempts.get(beatId) ?? 0;
  }

  /**
   * Clear a beat's failure history.
   *
   * @remarks
   * Not called anywhere in this package yet - a caller that replaces a
   * failed beat's request with meaningfully different content (a
   * re-authored source, say) can use this to give the replacement its own
   * full budget instead of inheriting the original's near-exhausted count.
   * Left as public API for that caller to reach for, rather than guessed at
   * here: nothing in this package can tell "genuinely different content"
   * from "the exact same request tried again" on its own.
   */
  public forgetAttempts(beatId: string): void {
    this.attempts.delete(beatId);
  }

  public async stage(request: ChunkRequest): Promise<BeatStagingResult> {
    const exhausted = this.checkBudget(request.beat.id);
    if (exhausted) return exhausted;
    return this.chargeResult(request.beat.id, await this.owner.stage(request));
  }

  public activate(): TransitionResult {
    return this.owner.activate();
  }

  public retireOutgoing(): boolean {
    return this.owner.retireOutgoing();
  }

  /**
   * Cancel whatever candidate is in flight and stage `request` in its place.
   *
   * @remarks
   * `cancelCandidate()` clears the pending candidate synchronously - both
   * when a presentation already exists and when preparation is still
   * in-flight - so the `stage()` call below always lands in the same
   * synchronous turn and never sees `'candidate-in-progress'`. The only rule
   * this depends on: never `await` between the cancel and the stage.
   *
   * `stageToken` guards the other race: if a *further* `restage` starts
   * before this one's `stage()` settles, this call's result is superseded
   * and must not be reported as if it were current.
   *
   * The budget check runs before `cancelCandidate()`, not after: a beat that
   * has already spent its budget must not tear down some *other*, perfectly
   * healthy candidate just to fail immediately in its place.
   */
  public async restage(request: ChunkRequest): Promise<BeatStagingResult> {
    const beatId = request.beat.id;
    const exhausted = this.checkBudget(beatId);
    if (exhausted) return exhausted;

    const token = ++this.stageToken;
    this.owner.cancelCandidate();
    const result = await this.owner.stage(request);
    if (token !== this.stageToken) {
      return {
        ok: false,
        reason: 'cancelled',
        detail: 'superseded by a later restage',
      };
    }
    return this.chargeResult(beatId, result);
  }

  public dispose(): void {
    this.owner.dispose();
  }

  private checkBudget(beatId: string): AttemptsExhausted | null {
    const attempts = this.attemptsFor(beatId);
    if (attempts < this.maxAttempts) return null;
    return {
      ok: false,
      reason: 'attempts-exhausted',
      detail: `beat "${beatId}" failed ${attempts} time(s) in a row (limit ${this.maxAttempts}); not retrying automatically`,
      attempts,
    };
  }

  /**
   * Update `beatId`'s failure count from a real `owner.stage()` result and
   * pass the result through unchanged.
   *
   * @remarks
   * Success clears the count outright rather than decrementing it - a beat
   * that finally prepared is not "one failure less broken," it is fixed, and
   * a later unrelated failure should not benefit from a partially-spent
   * budget it did not earn.
   */
  private chargeResult(beatId: string, result: StagingResult): StagingResult {
    if (result.ok) {
      this.attempts.delete(beatId);
      return result;
    }
    if (CHARGEABLE_REASONS.has(result.reason)) {
      this.attempts.set(beatId, this.attemptsFor(beatId) + 1);
    }
    return result;
  }
}
