import {ValueDispatcher} from '../events';

/**
 * Where a presentation generation sits in its lifecycle.
 *
 * @remarks
 * `Preparing` and `Ready` generations are *not* accepted: they hold no
 * mutation authority and are invisible to anything reading current state.
 * Exactly one generation may be `Active`. `Retired` generations have lost
 * their mutation authority but may still own presentation resources while an
 * outgoing transition finishes; `Discarded` ones lost activation and must be
 * torn down.
 *
 * @internal Not a public API. Shape is deliberately not frozen.
 */
export enum GenerationState {
  Preparing = 'preparing',
  Ready = 'ready',
  Active = 'active',
  Retired = 'retired',
  Discarded = 'discarded',
}

/**
 * Why an activation attempt was refused.
 *
 * @internal Not a public API.
 */
export type ActivationRejectionReason =
  /** The authority itself is gone. */
  | 'authority-disposed'
  /**
   * The handle was not issued by *this* authority.
   *
   * @remarks
   * Generation ids are per-authority counters, so a matching id proves
   * nothing. A foreign handle is refused untouched.
   */
  | 'unknown-generation'
  /** The generation was already activated, retired or discarded. */
  | 'not-pending'
  /** Preparation never reported readiness. */
  | 'not-ready'
  /**
   * The accepted runtime projection moved on after this generation was
   * prepared, so the work no longer describes current state.
   */
  | 'stale-revision';

/**
 * @internal Not a public API.
 */
export interface ActivationSuccess {
  ok: true;
  /** The generation that is now accepted. */
  activated: number;
  /**
   * The generation that was accepted until this commit, or `null` for the
   * first activation.
   *
   * @remarks
   * It has already lost its mutation authority, but the host may keep its
   * presentation resources alive for a bounded outgoing transition and call
   * {@link RuntimeAuthority.release} when the teardown is finished.
   */
  retired: number | null;
}

/**
 * @internal Not a public API.
 */
export interface ActivationRejection {
  ok: false;
  reason: ActivationRejectionReason;
  /** The accepted revision the refused work was prepared against. */
  preparedAtRevision: number;
  /** The accepted revision at the moment of the refusal. */
  currentRevision: number;
}

/**
 * @internal Not a public API.
 */
export type ActivationResult = ActivationSuccess | ActivationRejection;

/**
 * A generation-scoped permission to mutate authoritative runtime projection
 * state.
 *
 * @remarks
 * Holding a reference to runtime state is not permission to change it. A
 * capability is bound to one generation and is only usable while that
 * generation is the accepted one, so a capability captured before a
 * replacement cannot write after it. Presentation nodes never receive one
 * implicitly.
 *
 * @internal Not a public API.
 */
export interface MutationCapability<TState extends object> {
  /** The generation this capability was issued to. */
  readonly generation: number;

  /** Whether a write would currently be accepted. */
  isValid(): boolean;

  /**
   * Apply a mutation to the authoritative projection.
   *
   * @param mutate - Receives a draft copy. If it throws, nothing is committed.
   *
   * @returns The accepted revision after the write.
   *
   * @remarks
   * Throws if this capability is stale, not yet accepted, or the authority is
   * disposed. Failing closed is deliberate: a rejected mutation must never
   * look like a successful one.
   */
  write(mutate: (draft: TState) => void): number;
}

/**
 * A presentation generation that is being prepared but is not accepted.
 *
 * @remarks
 * Preparing must not disturb the accepted presentation. The handle records the
 * accepted revision it was prepared against so that freshness can be checked
 * once, at the activation commit boundary.
 *
 * @internal Not a public API.
 */
export interface PreparedGeneration<TState extends object> {
  readonly id: number;
  /** The accepted revision current when preparation began. */
  readonly preparedAtRevision: number;
  readonly state: GenerationState;
  /** Invalid until this generation is activated. */
  readonly capability: MutationCapability<TState>;
  /** Report that preparation finished and the work may be committed. */
  markReady(): void;
  /** Abandon this work. Terminal, idempotent, and invisible to the active generation. */
  discard(): void;
}

interface GenerationRecord {
  id: number;
  preparedAtRevision: number;
  state: GenerationState;
}

/**
 * Containers a freeze cannot protect.
 *
 * @remarks
 * `Object.freeze` does not stop `map.set()`, `set.add()`, `date.setTime()` or
 * a write through a typed array, so a projection holding one of these would
 * still hand out a mutable path into authoritative state. Authoritative
 * projection state is therefore restricted to plain objects, arrays and
 * primitives, and anything else is refused rather than silently left mutable.
 */
function assertFreezable(value: unknown, path: string): void {
  if (
    value instanceof Map ||
    value instanceof Set ||
    value instanceof WeakMap ||
    value instanceof WeakSet ||
    value instanceof Date ||
    value instanceof ArrayBuffer ||
    ArrayBuffer.isView(value)
  ) {
    throw new Error(
      `Authoritative runtime projection state may not contain a ` +
        `${(value as object).constructor?.name ?? 'mutable container'} ` +
        `(at ${path}): freezing it would not prevent mutation. Use plain ` +
        `objects, arrays and primitives.`,
    );
  }
}

/** Whether a value has nested contents that must be walked. */
function isWalkable(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Recursively freeze a projection so no mutable nested reference escapes.
 *
 * @remarks
 * Deliberately narrow: this is not a general immutability framework, only
 * enough to make {@link RuntimeAuthority.read} genuinely read-only. The seen
 * set makes shared and cyclic references safe.
 */
function freezeDeep<T>(
  value: T,
  seen = new WeakSet<object>(),
  path = 'state',
): T {
  if (!isWalkable(value)) return value;
  assertFreezable(value, path);
  if (seen.has(value)) return value;
  seen.add(value);

  for (const key of Object.keys(value)) {
    freezeDeep(value[key], seen, `${path}.${key}`);
  }

  return Object.freeze(value);
}

/**
 * Recursively copy a projection into a mutable draft.
 *
 * @remarks
 * A shallow copy would alias nested objects with the frozen snapshot, so a
 * mutator could neither write them nor fail to corrupt the previous
 * revision. The seen map preserves shared and cyclic references.
 */
function cloneDeep<T>(
  value: T,
  seen = new WeakMap<object, unknown>(),
  path = 'state',
): T {
  if (!isWalkable(value)) return value;
  // Reject here too, not only when freezing: a plain-object copy would
  // silently flatten a Map or Set to `{}` before the freeze ever saw it.
  assertFreezable(value, path);
  const existing = seen.get(value);
  if (existing !== undefined) return existing as T;

  const copy = (Array.isArray(value) ? [] : {}) as Record<string, unknown>;
  seen.set(value, copy);
  for (const key of Object.keys(value)) {
    copy[key] = cloneDeep(value[key], seen, `${path}.${key}`);
  }

  return copy as T;
}

/**
 * Owns the authoritative runtime projection (OvaCanvas "store A") and the
 * generation lifecycle around it.
 *
 * @remarks
 * This is the runtime *realization* authority. It is deliberately not the
 * semantic authority: the Ovareel accepted compiler revision owns semantic
 * truth, and this object owns the current runtime projection required to
 * realize it. Scenes, generators and nodes are passive presentation and are
 * never authoritative.
 *
 * The object knows nothing about Players, Stages, Scenes or rendering. It
 * schedules no work of its own, so preparing a generation cannot introduce a
 * render loop or disturb idle behaviour. The host owns all of that, including
 * wake arbitration.
 *
 * @internal Not a public API. Names, shape and granularity are not frozen; no
 *           serialization, wire format or delivery protocol is implied.
 */
export class RuntimeAuthority<TState extends object> {
  /**
   * Notifies subscribers with the accepted revision after every committed
   * mutation.
   */
  public get onRevisionChanged() {
    return this.revisionDispatcher.subscribable;
  }
  private readonly revisionDispatcher = new ValueDispatcher(0);

  private snapshot: Readonly<TState>;
  private revisionValue = 0;
  private nextGenerationId = 1;
  private activeId: number | null = null;
  private disposed = false;
  private readonly generations = new Map<number, GenerationRecord>();

  /**
   * Authority-local identity for prepared handles.
   *
   * @remarks
   * Generation ids are per-authority counters, so two authorities routinely
   * mint the same number. Authenticating a handle by its id would let a handle
   * from one authority resolve a different authority's pending generation.
   * Membership of this map is the identity check: it cannot be forged from
   * outside because only {@link prepare} ever writes to it.
   */
  private readonly ownedHandles = new WeakMap<object, GenerationRecord>();

  public constructor(initialState: TState) {
    // Copy first: the caller keeps its own reference to `initialState`, and
    // that reference must not remain a writable path into the projection.
    this.snapshot = freezeDeep(cloneDeep(initialState));
  }

  /** The accepted runtime projection revision. Monotonic. */
  public get revision(): number {
    return this.revisionValue;
  }

  /** The currently accepted generation, or `null` before the first activation. */
  public get activeGeneration(): number | null {
    return this.activeId;
  }

  public get isDisposed(): boolean {
    return this.disposed;
  }

  /**
   * A read-only projection of the accepted state.
   *
   * @remarks
   * The returned object is frozen *recursively* and is replaced wholesale on
   * every write, so a holder can neither mutate it - at any depth - nor
   * observe a half-applied change. This is what presentation code is allowed
   * to see. Holding it is not permission to change anything.
   */
  public read(): Readonly<TState> {
    return this.snapshot;
  }

  /** How a generation currently stands, or `null` if it was never prepared here. */
  public generationState(generation: number): GenerationState | null {
    return this.generations.get(generation)?.state ?? null;
  }

  /** Generations still known to this authority, for bounded-coexistence checks. */
  public get trackedGenerations(): number {
    return this.generations.size;
  }

  /**
   * Begin preparing a replacement generation.
   *
   * @remarks
   * Beginning preparation deliberately changes nothing about the accepted
   * generation: no state is written, no capability is revoked and nothing is
   * scheduled. If preparation fails, the caller discards the handle and the
   * accepted presentation is untouched.
   */
  public prepare(): PreparedGeneration<TState> {
    this.assertAlive('prepare a generation');

    const record: GenerationRecord = {
      id: this.nextGenerationId++,
      preparedAtRevision: this.revisionValue,
      state: GenerationState.Preparing,
    };
    this.generations.set(record.id, record);

    const isValid = () =>
      !this.disposed &&
      record.state === GenerationState.Active &&
      this.activeId === record.id;

    const capability: MutationCapability<TState> = {
      generation: record.id,
      isValid,
      write: mutate => {
        if (!isValid()) {
          throw new Error(
            `Rejected a mutation from generation ${record.id}: it is ` +
              `${record.state}${
                this.activeId === null
                  ? ' and no generation is accepted'
                  : ` while generation ${this.activeId} is accepted`
              }.`,
          );
        }
        return this.commit(mutate);
      },
    };

    const handle: PreparedGeneration<TState> = {
      id: record.id,
      preparedAtRevision: record.preparedAtRevision,
      get state() {
        return record.state;
      },
      capability,
      markReady() {
        if (record.state !== GenerationState.Preparing) return;
        record.state = GenerationState.Ready;
      },
      discard() {
        if (
          record.state === GenerationState.Preparing ||
          record.state === GenerationState.Ready
        ) {
          record.state = GenerationState.Discarded;
        }
      },
    };

    this.ownedHandles.set(handle, record);
    return handle;
  }

  /**
   * The single commit boundary where prepared work becomes accepted.
   *
   * @remarks
   * Freshness is checked exactly here. If the accepted projection moved on
   * since the work was prepared, the work no longer describes current state,
   * so it is refused and discarded and the accepted presentation is left
   * exactly as it was. On success the outgoing generation loses its mutation
   * authority immediately, while its presentation resources remain the host's
   * to retire.
   */
  public activate(prepared: PreparedGeneration<TState>): ActivationResult {
    const currentRevision = this.revisionValue;

    // Identity first: a handle this authority never issued is refused without
    // being touched, so presenting a foreign handle cannot discard the other
    // authority's work either.
    const record = this.ownedHandles.get(prepared);

    const reject = (reason: ActivationRejectionReason): ActivationRejection => {
      if (record) prepared.discard();
      return {
        ok: false,
        reason,
        preparedAtRevision: prepared.preparedAtRevision,
        currentRevision,
      };
    };

    if (this.disposed) return reject('authority-disposed');
    if (!record) return reject('unknown-generation');
    if (
      record.state !== GenerationState.Preparing &&
      record.state !== GenerationState.Ready
    ) {
      return reject('not-pending');
    }
    if (record.state !== GenerationState.Ready) return reject('not-ready');
    if (record.preparedAtRevision !== this.revisionValue) {
      return reject('stale-revision');
    }

    const outgoing = this.activeId;
    if (outgoing !== null) {
      const outgoingRecord = this.generations.get(outgoing);
      if (outgoingRecord) {
        // Mutation authority is revoked at the commit, before the host has
        // finished tearing anything down.
        outgoingRecord.state = GenerationState.Retired;
      }
    }

    record.state = GenerationState.Active;
    this.activeId = record.id;

    return {ok: true, activated: record.id, retired: outgoing};
  }

  /**
   * Forget a generation the host has finished tearing down.
   *
   * @remarks
   * Only retired or discarded generations may be released; releasing the
   * accepted one would leave the runtime with no authority holder.
   */
  public release(generation: number): boolean {
    const record = this.generations.get(generation);
    if (!record) return false;
    if (
      record.state === GenerationState.Retired ||
      record.state === GenerationState.Discarded
    ) {
      this.generations.delete(generation);
      return true;
    }
    return false;
  }

  /**
   * Terminally release this authority.
   *
   * @remarks
   * Idempotent. Every outstanding capability becomes invalid, so work that
   * resumes after disposal fails closed instead of writing into a dead
   * runtime.
   */
  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const record of this.generations.values()) {
      if (record.state !== GenerationState.Discarded) {
        record.state = GenerationState.Retired;
      }
    }
    this.generations.clear();
    this.activeId = null;
    this.revisionDispatcher.clear();
  }

  private commit(mutate: (draft: TState) => void): number {
    // Mutate a deep draft so a throwing mutator commits nothing and nested
    // writes cannot reach back into the previous frozen snapshot.
    const draft = cloneDeep(this.snapshot) as TState;
    mutate(draft);
    this.snapshot = freezeDeep(draft);
    this.revisionValue++;
    this.revisionDispatcher.current = this.revisionValue;
    return this.revisionValue;
  }

  private assertAlive(operation: string) {
    if (this.disposed) {
      throw new Error(`Cannot ${operation} on a disposed RuntimeAuthority.`);
    }
  }
}
