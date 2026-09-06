import {
  ActivationRejection,
  ActivationRejectionReason,
  MutationCapability,
  PreparedGeneration,
  RuntimeAuthority,
} from './RuntimeAuthority';

/**
 * What the transition owner needs from whatever is holding learner
 * interaction for a presentation.
 *
 * @remarks
 * Structural on purpose: this is exactly the seam the product interaction
 * layer already exposes, and naming its type here would drag a presentation
 * package into the foundation. Nothing else about interaction is visible from
 * here, and none of it is redesigned.
 *
 * @internal Not a public API.
 */
export interface InteractionQuiescence {
  /** Whether a learner is still holding something unresolved. */
  readonly hasActiveExploration: boolean;
  /**
   * Resolve whatever is held, without accepting it.
   *
   * @returns How many were resolved.
   */
  resolveActive(reason: 'generation-retired'): number;
}

/**
 * What a candidate presentation is given while it is being built.
 *
 * @remarks
 * A read-only projection, the generation context it is being prepared
 * against, and a way to say it is finished. The capability is present because
 * the presentation will need it once it is current, and it is inert until
 * then: the authority refuses a write from a generation that is not accepted,
 * so being under construction grants nothing.
 *
 * @internal Not a public API.
 */
export interface PreparationContext<TState extends object> {
  readonly generation: number;
  /** The accepted revision this candidate is being prepared against. */
  readonly preparedAtRevision: number;
  /** The accepted runtime projection. Read-only. */
  read(): Readonly<TState>;
  /** Invalid until this generation is activated. */
  readonly capability: MutationCapability<TState>;
  /**
   * Declare the candidate valid enough to be considered for activation.
   *
   * @remarks
   * Returning from {@link PresentationAdapter.prepare} is not readiness. A
   * candidate that never calls this cannot activate, which is the point: a
   * constructor finishing says nothing about whether a presentation can be
   * shown.
   */
  markReady(): void;
  /** Whether this preparation has been cancelled and should stop. */
  isCancelled(): boolean;
}

/**
 * How the host builds, shows and releases a presentation.
 *
 * @remarks
 * The owner coordinates *which* presentation is current. It knows nothing
 * about stages, scenes, players or canvases, so it cannot become a second
 * lifecycle framework.
 *
 * @internal Not a public API.
 */
export interface PresentationAdapter<TState extends object, TPresentation> {
  /**
   * Build a candidate offstage.
   *
   * @remarks
   * Must not make the candidate learner-visible. Whatever it returns is
   * disposable on its own, without touching the presentation that is current.
   */
  prepare(
    context: PreparationContext<TState>,
  ): TPresentation | Promise<TPresentation>;

  /**
   * Make a prepared presentation the visible current one.
   *
   * @remarks
   * Called after the authority has already accepted the incoming generation,
   * so it cannot decide whether the transition happens. The outgoing
   * presentation is still alive here and is presentation-only from this point.
   */
  activate?(incoming: TPresentation, outgoing: TPresentation | null): void;

  /** Terminally release a presentation. */
  dispose(presentation: TPresentation): void;

  /** Whatever is holding learner interaction for this presentation, if any. */
  quiescence?(presentation: TPresentation): InteractionQuiescence | null;
}

/**
 * Where the owner currently stands.
 *
 * @internal Not a public API.
 */
export type TransitionPhase =
  /** Nothing has ever been activated. */
  | 'empty'
  /** One current presentation, nothing being prepared. */
  | 'active'
  /** A candidate is being built offstage. */
  | 'preparing'
  /** A candidate is built and could be activated. */
  | 'ready'
  /** A candidate became current and the previous one is still alive. */
  | 'overlapping';

/**
 * @internal Not a public API.
 */
export type StagingRefusalReason =
  | 'owner-disposed'
  | 'authority-disposed'
  /** One candidate at a time; the existing one was left alone. */
  | 'candidate-in-progress'
  /** The adapter threw or rejected while building. */
  | 'preparation-failed'
  /** The adapter finished without ever declaring the candidate ready. */
  | 'not-ready'
  /** The candidate was cancelled while it was being built. */
  | 'cancelled';

/**
 * @internal Not a public API.
 */
export type TransitionRefusalReason =
  | 'owner-disposed'
  | 'no-candidate'
  | 'candidate-not-ready'
  | ActivationRejectionReason;

/**
 * @internal Not a public API.
 */
export interface StagingAccepted {
  readonly ok: true;
  readonly generation: number;
  readonly preparedAtRevision: number;
}

/**
 * @internal Not a public API.
 */
export interface StagingRefused {
  readonly ok: false;
  readonly reason: StagingRefusalReason;
  /** The message the adapter failed with, when it failed. */
  readonly detail: string | null;
}

/**
 * @internal Not a public API.
 */
export type StagingResult = StagingAccepted | StagingRefused;

/**
 * @internal Not a public API.
 */
export interface TransitionAccepted {
  readonly ok: true;
  readonly activated: number;
  readonly retired: number | null;
  /** Explorations resolved to reach quiescence before the boundary. */
  readonly resolvedInteractions: number;
  /**
   * Whether the adapter threw while showing the incoming presentation.
   *
   * @remarks
   * The transition still happened. Once the authority has accepted the
   * incoming generation, that decision stands; a presentation-side failure
   * afterwards is reported, not rolled back.
   */
  readonly presentationError: string | null;
}

/**
 * @internal Not a public API.
 */
export interface TransitionRefused {
  readonly ok: false;
  readonly reason: TransitionRefusalReason;
  readonly preparedAtRevision: number | null;
  readonly currentRevision: number;
}

/**
 * @internal Not a public API.
 */
export type TransitionResult = TransitionAccepted | TransitionRefused;

interface CandidateRecord<TState extends object, TPresentation> {
  readonly handle: PreparedGeneration<TState>;
  presentation: TPresentation | null;
  ready: boolean;
  cancelled: boolean;
}

/**
 * Coordinates which presentation generation is current.
 *
 * @remarks
 * A candidate is built offstage while the current presentation keeps working.
 * It becomes current only at the foundation's own activation boundary, which
 * checks freshness and swaps in one step. The previous presentation may stay
 * alive briefly afterwards so a transition has something to animate, but it
 * is presentation-only from the moment the boundary is crossed.
 *
 * **Freshness is the authority's.** A candidate records the accepted revision
 * it was prepared against, and `RuntimeAuthority.activate` refuses it if the
 * accepted projection has moved on. Handle identity is the authority's too: a
 * handle it never issued is refused untouched. No second freshness rule is
 * invented here, because none is needed - and the one-candidate rule below
 * means a candidate can never be stranded behind another candidate's
 * activation.
 *
 * **One candidate at a time.** A second staging request is refused and the
 * existing candidate is left exactly as it was. Refusing is narrower than
 * racing a cancellation, and the host can cancel deliberately.
 *
 * **One outgoing at a time.** Activating while an outgoing presentation is
 * still alive retires it first, so retired presentations cannot stack up.
 *
 * The owner schedules nothing. It has no timer, no animation frame and no
 * loop; the only asynchrony is whatever the adapter's own preparation does.
 *
 * @internal Not a public API. Names, shape and granularity are not frozen,
 *           and no segment, serialization or delivery protocol is implied.
 */
export class TransitionOwner<TState extends object, TPresentation> {
  private readonly authority: RuntimeAuthority<TState>;
  private readonly adapter: PresentationAdapter<TState, TPresentation>;
  private readonly onPhaseChanged?: () => void;

  private activePresentation: TPresentation | null = null;
  private activeGenerationId: number | null = null;
  private outgoingPresentation: TPresentation | null = null;
  private outgoingGenerationId: number | null = null;
  private candidate: CandidateRecord<TState, TPresentation> | null = null;
  private disposed = false;

  public constructor(options: {
    authority: RuntimeAuthority<TState>;
    adapter: PresentationAdapter<TState, TPresentation>;
    onPhaseChanged?: () => void;
  }) {
    this.authority = options.authority;
    this.adapter = options.adapter;
    this.onPhaseChanged = options.onPhaseChanged;
  }

  public get phase(): TransitionPhase {
    if (this.candidate) return this.candidate.ready ? 'ready' : 'preparing';
    if (this.outgoingPresentation !== null) return 'overlapping';
    return this.activePresentation === null ? 'empty' : 'active';
  }

  /** A description of everything the owner is holding, for tests and hosts. */
  public status() {
    return {
      phase: this.phase,
      activeGeneration: this.activeGenerationId,
      candidateGeneration: this.candidate?.handle.id ?? null,
      candidateReady: this.candidate?.ready ?? false,
      outgoingGeneration: this.outgoingGenerationId,
      hasOutgoing: this.outgoingPresentation !== null,
      revision: this.authority.revision,
      trackedGenerations: this.authority.trackedGenerations,
      disposed: this.disposed,
    };
  }

  public get current(): TPresentation | null {
    return this.activePresentation;
  }

  public get outgoing(): TPresentation | null {
    return this.outgoingPresentation;
  }

  /** The candidate, which is deliberately not reachable as "current". */
  public get pendingCandidate(): TPresentation | null {
    return this.candidate?.presentation ?? null;
  }

  public get isDisposed(): boolean {
    return this.disposed;
  }

  /**
   * Build a candidate offstage.
   *
   * @remarks
   * The current presentation is untouched throughout. If the adapter throws,
   * rejects, or finishes without declaring readiness, the candidate's
   * generation is discarded and the current presentation is left exactly as
   * it was: a failure of the next presentation must not damage the present
   * one.
   */
  public async stage(): Promise<StagingResult> {
    if (this.disposed) return refuseStaging('owner-disposed');
    if (this.authority.isDisposed) return refuseStaging('authority-disposed');
    if (this.candidate) return refuseStaging('candidate-in-progress');

    const handle = this.authority.prepare();
    const record: CandidateRecord<TState, TPresentation> = {
      handle,
      presentation: null,
      ready: false,
      cancelled: false,
    };
    this.candidate = record;
    this.onPhaseChanged?.();

    const context: PreparationContext<TState> = {
      generation: handle.id,
      preparedAtRevision: handle.preparedAtRevision,
      read: () => this.authority.read(),
      capability: handle.capability,
      markReady: () => {
        if (record.cancelled) return;
        record.ready = true;
        handle.markReady();
      },
      isCancelled: () => record.cancelled || this.disposed,
    };

    let presentation: TPresentation;
    try {
      presentation = await this.adapter.prepare(context);
    } catch (error: any) {
      this.abandonCandidate(record, null);
      return refuseStaging(
        'preparation-failed',
        String(error?.message ?? error),
      );
    }

    record.presentation = presentation;

    if (record.cancelled || this.disposed) {
      this.abandonCandidate(record, presentation);
      return refuseStaging('cancelled');
    }
    if (!record.ready) {
      // Finishing is not readiness. A candidate that never said so cannot be
      // shown, so it is discarded rather than left to be activated later.
      this.abandonCandidate(record, presentation);
      return refuseStaging('not-ready');
    }

    this.onPhaseChanged?.();
    return {
      ok: true,
      generation: handle.id,
      preparedAtRevision: handle.preparedAtRevision,
    };
  }

  /**
   * Make the ready candidate current.
   *
   * @remarks
   * One product decision. The authority's activation is the boundary: before
   * it, the current presentation is authoritative and the candidate is only
   * prepared; after it, the candidate is authoritative and the previous one is
   * outgoing. There is no in-between state where nothing is current, both are
   * writable, or the previous one has been invalidated without a replacement
   * being accepted.
   *
   * Before crossing, any temporary learner exploration on the presentation
   * that is about to be retired is resolved through the interaction layer's
   * own seam. Resolving is not accepting: nothing a learner was holding gets
   * committed by a transition.
   */
  public activate(): TransitionResult {
    const currentRevision = this.authority.revision;
    if (this.disposed) {
      return refuseTransition('owner-disposed', null, currentRevision);
    }
    const record = this.candidate;
    if (!record) {
      return refuseTransition('no-candidate', null, currentRevision);
    }
    if (!record.ready || record.presentation === null) {
      return refuseTransition(
        'candidate-not-ready',
        record.handle.preparedAtRevision,
        currentRevision,
      );
    }

    // Reaching quiescence must never look like consent, so this discards.
    const resolvedInteractions = this.quiesceActive();

    const result = this.authority.activate(record.handle);
    if (!result.ok) {
      const rejection = result as ActivationRejection;
      // The authority already discarded the refused generation; the
      // presentation built for it is now unreachable and is released here.
      this.releasePresentation(record.presentation);
      this.candidate = null;
      this.onPhaseChanged?.();
      return {
        ok: false,
        reason: rejection.reason,
        preparedAtRevision: rejection.preparedAtRevision,
        currentRevision: rejection.currentRevision,
      };
    }

    // Only one outgoing presentation is kept, so retired presentations cannot
    // accumulate.
    if (this.outgoingPresentation !== null) this.retireOutgoing();

    const previous = this.activePresentation;
    const previousGeneration = this.activeGenerationId;
    this.activePresentation = record.presentation;
    this.activeGenerationId = record.handle.id;
    this.outgoingPresentation = previous;
    this.outgoingGenerationId = previous === null ? null : previousGeneration;
    this.candidate = null;

    let presentationError: string | null = null;
    try {
      this.adapter.activate?.(record.presentation, previous);
    } catch (error: any) {
      // The boundary has already been crossed. The incoming generation is
      // current and stays current: a presentation-side failure afterwards is
      // reported rather than rolled back, because rolling back would mean
      // re-accepting a generation the authority has already retired.
      presentationError = String(error?.message ?? error);
    }

    this.onPhaseChanged?.();
    return {
      ok: true,
      activated: result.activated,
      retired: result.retired,
      resolvedInteractions,
      presentationError,
    };
  }

  /**
   * Terminally release the outgoing presentation.
   *
   * @returns Whether there was one to retire.
   *
   * @remarks
   * Idempotent. The authority is told to forget the retired generation so it
   * stops being tracked; its mutation authority was already revoked at the
   * activation boundary, so nothing is being taken away here that the
   * outgoing presentation still had.
   */
  public retireOutgoing(): boolean {
    const presentation = this.outgoingPresentation;
    if (presentation === null) return false;
    const generation = this.outgoingGenerationId;
    this.outgoingPresentation = null;
    this.outgoingGenerationId = null;
    this.releasePresentation(presentation);
    if (generation !== null) this.authority.release(generation);
    this.onPhaseChanged?.();
    return true;
  }

  /**
   * Abandon the candidate.
   *
   * @returns Whether there was one to cancel.
   *
   * @remarks
   * Safe at any point, including while the adapter is still building: the
   * preparation sees {@link PreparationContext.isCancelled} and whatever it
   * eventually returns is disposed instead of kept. A cancelled candidate can
   * never become visible.
   */
  public cancelCandidate(): boolean {
    const record = this.candidate;
    if (!record) return false;
    record.cancelled = true;
    record.ready = false;
    // If the adapter is still running, `stage` disposes what it returns.
    if (record.presentation !== null) {
      this.abandonCandidate(record, record.presentation);
    } else {
      record.handle.discard();
      this.candidate = null;
      this.onPhaseChanged?.();
    }
    return true;
  }

  /**
   * Terminally release the owner and everything it holds.
   *
   * @remarks
   * Idempotent. A candidate is discarded, never activated, and the outgoing
   * and current presentations are released. Disposal does not accept anything
   * a learner was holding.
   */
  public dispose(): void {
    if (this.disposed) return;
    this.cancelCandidate();
    this.disposed = true;
    this.retireOutgoing();
    const active = this.activePresentation;
    this.activePresentation = null;
    this.activeGenerationId = null;
    if (active !== null) this.releasePresentation(active);
    this.onPhaseChanged?.();
  }

  /** Resolve learner interaction on the presentation about to be retired. */
  private quiesceActive(): number {
    const presentation = this.activePresentation;
    if (presentation === null) return 0;
    const quiescence = this.adapter.quiescence?.(presentation);
    if (!quiescence || !quiescence.hasActiveExploration) return 0;
    return quiescence.resolveActive('generation-retired');
  }

  private abandonCandidate(
    record: CandidateRecord<TState, TPresentation>,
    presentation: TPresentation | null,
  ): void {
    record.handle.discard();
    this.authority.release(record.handle.id);
    if (this.candidate === record) this.candidate = null;
    if (presentation !== null) this.releasePresentation(presentation);
    this.onPhaseChanged?.();
  }

  private releasePresentation(presentation: TPresentation): void {
    try {
      this.adapter.dispose(presentation);
    } catch {
      // A presentation that fails while being released is already gone as far
      // as this owner is concerned; refusing to forget it would strand it.
    }
  }
}

function refuseStaging(
  reason: StagingRefusalReason,
  detail: string | null = null,
): StagingRefused {
  return {ok: false, reason, detail};
}

function refuseTransition(
  reason: TransitionRefusalReason,
  preparedAtRevision: number | null,
  currentRevision: number,
): TransitionRefused {
  return {ok: false, reason, preparedAtRevision, currentRevision};
}
