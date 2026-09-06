import {EventDispatcher} from '@ovacanvas/core';
import type {MutationCapability} from '@ovacanvas/core/lib/internal';
import {
  InteractionOperation,
  InteractionOutcome,
  InteractionPolicy,
  InteractionRefusalReason,
  InteractionRefused,
  knownTarget,
  permits,
} from './policy';

/**
 * Why an open exploration was resolved without being committed.
 *
 * @internal Not a public API.
 */
export type ExplorationEndReason =
  | 'discarded'
  | 'policy-revoked'
  | 'reset'
  | 'generation-retired'
  | 'disposed';

/**
 * How an exploration ended.
 *
 * @internal Not a public API.
 */
export type ExplorationState = 'active' | 'committed' | 'discarded' | 'revoked';

/**
 * What presentation is told when a learner needs the timeline to stop moving.
 *
 * @remarks
 * Two calls, balanced, and nothing about frames or positions. Holding a
 * presentation is the host's business; whether that means pausing playback,
 * and what it does with the playhead, belongs to whoever owns the player.
 * This layer only says when.
 *
 * @internal Not a public API.
 */
export interface PresentationHold {
  hold(): void;
  release(): void;
}

/**
 * @internal Not a public API.
 */
export interface InteractionControllerOptions<TState extends object> {
  /**
   * The generation-scoped permission to change accepted runtime state.
   *
   * @remarks
   * The same capability CAP-01 hands its handlers. A commit goes through this
   * and through nothing else, so an interaction cannot outlive the generation
   * that authorized it.
   */
  readonly capability: MutationCapability<TState>;

  /** The accepted runtime projection. Read-only by construction. */
  read(): Readonly<TState>;

  /**
   * The accepted scalar a target stands for.
   *
   * @remarks
   * Supplied by the host, so this layer never learns the shape of the state
   * it is coordinating.
   */
  valueOf(target: string, state: Readonly<TState>): number;

  /** How a committed value lands in a mutation draft. */
  apply(draft: TState, target: string, value: number): void;

  /**
   * Read-only information about a target.
   *
   * @remarks
   * Receives the accepted projection and returns whatever the host wants a
   * learner to see. It is handed no capability and no draft, so an inspection
   * cannot reach the write path even by mistake.
   */
  describe?(target: string, state: Readonly<TState>): unknown;

  readonly policy?: InteractionPolicy;

  readonly presentation?: PresentationHold;
}

interface ExplorationRecord {
  readonly id: number;
  readonly target: string;
  state: ExplorationState;
  value: number;
  /** The accepted value when this exploration opened, for reporting. */
  readonly acceptedAtStart: number;
  /**
   * What a later call against this exploration is told.
   *
   * @remarks
   * Recorded when it ends rather than inferred afterwards. Retirement and
   * policy revocation both end an exploration abnormally, and reporting one
   * as the other would tell a caller the wrong thing about why its work was
   * refused.
   */
  terminalReason: InteractionRefusalReason;
}

/**
 * Gives CAP-01's pointer mechanics product meaning.
 *
 * @remarks
 * CAP-01 answers "which target, where, and is this generation still allowed
 * to write". This answers "is the learner allowed to do this, is it an
 * observation or a change, and is that change provisional or accepted".
 *
 * A temporary exploration is an **overlay**: one held value that presentation
 * reads in preference to the accepted one. Accepted state is not touched
 * while a learner explores, so the runtime revision does not advance, no
 * other reader sees an exploratory value as accepted, and discarding is
 * dropping the overlay rather than reconstructing anything. That is smaller
 * than keeping a baseline snapshot to write back - there is no second copy to
 * fall out of step with a concurrent accepted change - and smaller than a
 * delta log, which would be the beginning of an undo system this mission does
 * not want.
 *
 * Committing writes the held value through the capability CAP-01 already
 * uses. "Accepted" here means accepted *runtime* state. It is not compiler
 * semantic truth: the Ovareel accepted revision owns that, this layer cannot
 * reach it, and nothing here persists.
 *
 * One exploration is open at a time. A second request is refused rather than
 * queued, which keeps "is a learner still holding something" a question with
 * one answer - the property a future transition owner will need.
 *
 * Nothing here schedules. There is no timer, no animation frame and no loop;
 * a value change tells the host, and waking rendering stays the host's
 * decision.
 *
 * @internal Not a public API. Names, shape and granularity are not frozen,
 *           and no serialization or delivery protocol is implied.
 */
export class InteractionController<TState extends object> {
  private readonly options: InteractionControllerOptions<TState>;
  private currentPolicy: InteractionPolicy;
  private active: ExplorationRecord | null = null;
  private lastResolved: ExplorationRecord | null = null;
  private nextExplorationId = 1;
  private presentationHeld = false;
  private disposed = false;

  public constructor(options: InteractionControllerOptions<TState>) {
    this.options = options;
    this.currentPolicy = options.policy ?? {};
  }

  public get policy(): InteractionPolicy {
    return this.currentPolicy;
  }

  public get isDisposed(): boolean {
    return this.disposed;
  }

  /**
   * Fires whenever what presentation should show may have changed.
   *
   * @remarks
   * The provisional overlay was opened, moved, committed, discarded or
   * revoked. Deliberately an event carrying nothing rather than a value: one
   * controller stands for several targets, and what a presentation displays is
   * the presentation's business.
   *
   * This is the notification half of the presentation-reactivity seam.
   * {@link InteractionReadout} is the reactive half; nothing here knows what a
   * signal is.
   */
  public get onProvisionalChanged() {
    return this.provisionalChanged.subscribable;
  }
  private readonly provisionalChanged = new EventDispatcher<void>();

  /**
   * Whether a learner is still holding something unresolved.
   *
   * @remarks
   * The seam a future transition owner needs: before it activates a
   * replacement it can ask whether an interaction is still open, and use
   * {@link resolveActive} to reach quiescence. Nothing about segments,
   * overlap or choreography is implied or implemented here.
   */
  public get hasActiveExploration(): boolean {
    return this.active !== null;
  }

  /** The open exploration, for diagnostics and tests. */
  public activeExploration(): {
    id: number;
    target: string;
    value: number;
  } | null {
    return this.active
      ? {
          id: this.active.id,
          target: this.active.target,
          value: this.active.value,
        }
      : null;
  }

  public get isPresentationHeld(): boolean {
    return this.presentationHeld;
  }

  /**
   * Replace the interaction policy while the presentation exists.
   *
   * @returns Whether an open exploration was revoked by the change.
   *
   * @remarks
   * An open exploration whose target no longer permits exploring is resolved
   * immediately rather than at the next pointer event. The overlay is dropped
   * at once, so presentation stops showing a value the learner is no longer
   * allowed to hold, and every later call against that exploration is refused.
   */
  public setPolicy(next: InteractionPolicy): boolean {
    this.currentPolicy = next ?? {};
    if (
      this.active &&
      !permits(this.currentPolicy, this.active.target, 'explore')
    ) {
      this.endActive('revoked', 'policy-revoked');
      return true;
    }
    return false;
  }

  /**
   * Read information about a target.
   *
   * @remarks
   * Mechanically incapable of mutating: it opens nothing, resolves nothing,
   * and the describe callback receives the accepted projection and no write
   * path at all.
   */
  public inspect(target: string): InteractionOutcome<{
    target: string;
    data: unknown;
  }> {
    if (this.disposed) {
      return this.refuse('inspect', target, 'controller-disposed');
    }
    const gate = this.checkTarget('inspect', target, 'inspect');
    if (gate) return gate;

    return {
      ok: true,
      value: {
        target,
        data: this.options.describe?.(target, this.options.read()),
      },
    };
  }

  /** The accepted scalar a target currently stands for. */
  public acceptedValue(target: string): number {
    return this.options.valueOf(target, this.options.read());
  }

  /**
   * The held value for a target, or `null` when nothing is held for it.
   */
  public provisionalValue(target: string): number | null {
    return this.active && this.active.target === target
      ? this.active.value
      : null;
  }

  /**
   * What presentation should show: the held value when there is one,
   * otherwise the accepted one.
   */
  public valueFor(target: string): number {
    return this.provisionalValue(target) ?? this.acceptedValue(target);
  }

  /**
   * Open a temporary exploration of a target.
   *
   * @remarks
   * Holds the presentation if the host supplied a way to. Accepted state is
   * untouched: opening an exploration writes nothing and advances no
   * revision.
   */
  public begin(target: string): InteractionOutcome<{
    id: number;
    target: string;
    value: number;
  }> {
    if (this.disposed) {
      return this.refuse('begin', target, 'controller-disposed');
    }
    if (!this.options.capability.isValid()) {
      return this.refuse('begin', target, 'generation-retired');
    }
    if (this.active) {
      return this.refuse('begin', target, 'exploration-in-progress');
    }
    const gate = this.checkTarget('begin', target, 'explore');
    if (gate) return gate;

    const accepted = this.acceptedValue(target);
    this.active = {
      id: this.nextExplorationId++,
      target,
      state: 'active',
      value: accepted,
      acceptedAtStart: accepted,
      terminalReason: 'exploration-already-resolved',
    };

    if (this.options.presentation && !this.presentationHeld) {
      this.presentationHeld = true;
      this.options.presentation.hold();
    }
    this.provisionalChanged.dispatch();

    return {ok: true, value: {id: this.active.id, target, value: accepted}};
  }

  /**
   * Move the held value.
   *
   * @remarks
   * Re-checks the policy and the generation on every continuation, the same
   * way CAP-01 re-checks its capability, so a permission taken away mid-drag
   * stops the very next continuation instead of waiting for a release.
   */
  public update(
    id: number,
    value: number,
  ): InteractionOutcome<{id: number; target: string; value: number}> {
    const record = this.resolveRecord('update', id);
    if (!record.ok) return record;
    const exploration = record.value;

    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return this.refuse('update', exploration.target, 'invalid-value');
    }
    const gate = this.guardContinuation('update', exploration);
    if (gate) return gate;

    exploration.value = value === 0 ? 0 : value;
    this.provisionalChanged.dispatch();
    return {
      ok: true,
      value: {
        id: exploration.id,
        target: exploration.target,
        value: exploration.value,
      },
    };
  }

  /**
   * Promote the held value into accepted runtime state.
   *
   * @remarks
   * The only write in this file, and it goes through the generation-scoped
   * capability. Accepted runtime state, not accepted semantic truth: nothing
   * here reaches a compiler revision or persists anything.
   */
  public commit(id: number): InteractionOutcome<{
    id: number;
    target: string;
    value: number;
    revision: number;
  }> {
    const record = this.resolveRecord('commit', id);
    if (!record.ok) return record;
    const exploration = record.value;

    const gate = this.guardContinuation('commit', exploration);
    if (gate) return gate;
    if (!permits(this.currentPolicy, exploration.target, 'commit')) {
      return this.refuse('commit', exploration.target, 'not-permitted');
    }

    const value = exploration.value;
    const target = exploration.target;
    const revision = this.options.capability.write(draft => {
      this.options.apply(draft, target, value);
    });

    exploration.state = 'committed';
    this.finishActive();
    return {ok: true, value: {id: exploration.id, target, value, revision}};
  }

  /**
   * Abandon the held value.
   *
   * @remarks
   * Always allowed while the exploration is open, whatever the policy now
   * says: a learner must be able to put something back down. Dropping the
   * overlay is the whole restoration, because accepted state was never
   * changed.
   */
  public discard(
    id: number,
  ): InteractionOutcome<{id: number; target: string; value: number}> {
    if (this.disposed) {
      return this.refuse('discard', null, 'controller-disposed');
    }
    const record = this.resolveRecord('discard', id);
    if (!record.ok) return record;
    const exploration = record.value;

    const target = exploration.target;
    this.endActive('discarded');
    return {
      ok: true,
      value: {id: exploration.id, target, value: this.acceptedValue(target)},
    };
  }

  /**
   * Resolve whatever a learner is still holding, without committing it.
   *
   * @returns How many explorations were resolved.
   *
   * @remarks
   * The host calls this when presentation is rebuilt, when a generation
   * retires, and when it disposes. A future transition owner is the other
   * intended caller: reaching quiescence must never mean silently accepting
   * what the learner had not accepted.
   */
  public resolveActive(reason: ExplorationEndReason = 'reset'): number {
    if (!this.active) return 0;
    if (reason === 'policy-revoked') {
      this.endActive('revoked', 'policy-revoked');
    } else if (reason === 'generation-retired') {
      this.endActive('revoked', 'generation-retired');
    } else {
      this.endActive('discarded', 'exploration-already-resolved');
    }
    return 1;
  }

  /**
   * Terminally release this controller.
   *
   * @remarks
   * Idempotent. An open exploration is discarded, never committed: disposal
   * is not consent.
   */
  public dispose(): void {
    if (this.disposed) return;
    this.resolveActive('disposed');
    this.disposed = true;
    if (this.presentationHeld) {
      this.presentationHeld = false;
      this.options.presentation?.release();
    }
    // Cleared after the final notification, so a reader still observes the
    // overlay being dropped before the controller stops speaking.
    this.provisionalChanged.clear();
  }

  private checkTarget(
    operation: InteractionOperation,
    target: string,
    permission: 'inspect' | 'explore' | 'commit',
  ): InteractionRefused | null {
    if (
      typeof target !== 'string' ||
      !knownTarget(this.currentPolicy, target)
    ) {
      return this.refusal(operation, target ?? null, 'unknown-target');
    }
    if (!permits(this.currentPolicy, target, permission)) {
      return this.refusal(operation, target, 'not-permitted');
    }
    return null;
  }

  private guardContinuation(
    operation: InteractionOperation,
    exploration: ExplorationRecord,
  ): InteractionRefused | null {
    if (!this.options.capability.isValid()) {
      this.endActive('revoked', 'generation-retired');
      return this.refusal(operation, exploration.target, 'generation-retired');
    }
    if (!permits(this.currentPolicy, exploration.target, 'explore')) {
      this.endActive('revoked', 'policy-revoked');
      return this.refusal(operation, exploration.target, 'policy-revoked');
    }
    return null;
  }

  private resolveRecord(
    operation: InteractionOperation,
    id: number,
  ): {ok: true; value: ExplorationRecord} | InteractionRefused {
    if (this.disposed) {
      return this.refusal(operation, null, 'controller-disposed');
    }
    if (this.active && this.active.id === id) {
      return {ok: true, value: this.active};
    }
    if (this.lastResolved && this.lastResolved.id === id) {
      return this.refusal(
        operation,
        this.lastResolved.target,
        this.lastResolved.terminalReason,
      );
    }
    return this.refusal(operation, null, 'unknown-exploration');
  }

  /** End the open exploration without accepting it. */
  private endActive(
    state: 'discarded' | 'revoked',
    terminalReason: InteractionRefusalReason = 'exploration-already-resolved',
  ): void {
    if (!this.active) return;
    this.active.state = state;
    this.active.terminalReason = terminalReason;
    this.finishActive();
  }

  private finishActive(): void {
    this.lastResolved = this.active;
    this.active = null;
    if (this.presentationHeld) {
      this.presentationHeld = false;
      this.options.presentation?.release();
    }
    this.provisionalChanged.dispatch();
  }

  private refuse<TValue>(
    operation: InteractionOperation,
    target: string | null,
    reason: InteractionRefusalReason,
  ): InteractionOutcome<TValue> {
    return this.refusal(operation, target, reason);
  }

  private refusal(
    operation: InteractionOperation,
    target: string | null,
    reason: InteractionRefusalReason,
  ): InteractionRefused {
    return {ok: false, reason, operation, target};
  }
}
