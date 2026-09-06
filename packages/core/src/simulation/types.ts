/**
 * A finite numerical state vector.
 *
 * @remarks
 * Deliberately just numbers. CAP-05 integrates continuous dynamical state in
 * general and does not know whether a component means a position, a
 * concentration, a population, a temperature or a phase angle. Naming the
 * components here would bake one family of models into the kernel; what a
 * component means belongs to whoever defined the model.
 *
 * @internal Not a public API. Shape is deliberately not frozen.
 */
export type StateVector = readonly number[];

/**
 * Finite scalar parameters of a model.
 *
 * @internal Not a public API.
 */
export type SimulationParameters = Readonly<Record<string, number>>;

/**
 * The dynamics: given a time, a state and the parameters, produce the
 * derivative of every state component.
 *
 * @remarks
 * Must be a pure function of its arguments. It receives a copy of the state
 * and must return a new array of the same length; it is called several times
 * per step at intermediate times that are not tick boundaries.
 *
 * @internal Not a public API.
 */
export type DerivativeFunction = (
  time: number,
  state: StateVector,
  parameters: SimulationParameters,
) => number[];

/**
 * Everything that defines one dynamical model.
 *
 * @remarks
 * These fields are exactly the authoritative inputs a trajectory depends on,
 * which is why the revision token is derived from all of them. CAP-05 does
 * not own any of this: the model is handed to it, and it computes.
 *
 * @internal Not a public API. This is not a serialization schema and implies
 *           no compiler or delivery protocol.
 */
export interface SimulationModel {
  /**
   * Identity of the dynamics definition itself.
   *
   * @remarks
   * A function cannot be hashed, so this names it. Two models that share an
   * `id` and a `revision` are taken to have the same `derivative`; giving two
   * different dynamics the same identity is a caller error the kernel cannot
   * detect.
   */
  readonly id: string;

  /**
   * The authoritative model revision.
   *
   * @remarks
   * Advanced by whoever owns the model when it changes. Presentation seeking
   * never touches it.
   */
  readonly revision: number;

  /** The fixed solver step. Must be finite and greater than zero. */
  readonly dt: number;

  /** State at tick 0. */
  readonly initialState: StateVector;

  readonly parameters: SimulationParameters;

  readonly derivative: DerivativeFunction;
}

/**
 * A state and the grid point it belongs to.
 *
 * @remarks
 * Always carries the tick that answered, so a caller that asked in seconds
 * can see exactly which grid point it received and never has to guess how a
 * time was resolved.
 *
 * @internal Not a public API.
 */
export interface SimulationSample {
  readonly tick: number;
  /** `tick * dt`, the canonical time of this grid point. */
  readonly time: number;
  readonly state: number[];
}

/**
 * How a requested time becomes a solver tick.
 *
 * @remarks
 * Always explicit, never inferred. Off-grid behaviour that is left to a
 * floor-or-round accident is exactly how two callers end up disagreeing about
 * what the same request meant.
 *
 * None of these interpolate. The kernel returns state on the solver grid,
 * because interpolation between grid points is not part of the frozen
 * contract and inventing a policy for it would freeze one by accident.
 *
 * @internal Not a public API.
 */
export type TimeResolution =
  /** The time must land on a tick, or the request is refused. */
  | 'exact'
  /** The greatest tick at or before the time. */
  | 'floor'
  /** The nearest tick, halves resolving upward. */
  | 'nearest';

/**
 * Observable counters, exposed so regressions can see that a seek actually
 * used a checkpoint rather than silently recomputing from tick 0.
 *
 * @remarks
 * Diagnostics only. Nothing here affects a result, and no result may depend
 * on it.
 *
 * @internal Not a public API.
 */
export interface SimulationDiagnostics {
  /** The revision namespace answers currently belong to. */
  readonly revisionToken: string;
  readonly modelRevision: number;
  readonly dt: number;
  readonly checkpointInterval: number;
  readonly checkpointCount: number;
  readonly checkpointTicks: number[];
  /** Solver steps actually integrated over this engine's lifetime. */
  readonly ticksIntegrated: number;
  /** Queries answered from a checkpoint at or before the requested tick. */
  readonly checkpointHits: number;
  /** Queries that had to start again from the initial state. */
  readonly coldStarts: number;
  /** Times the whole cache was dropped because the model changed. */
  readonly invalidations: number;
}

/**
 * Why a simulation request was refused.
 *
 * @remarks
 * Every one is a refusal. Nothing is clamped, no non-finite value is replaced
 * with zero, and no mismatched derivative is truncated to fit: a trajectory
 * that quietly repaired itself is not a deterministic trajectory, and the
 * caller would never learn its model was wrong.
 *
 * @internal Not a public API.
 */
export type SimulationErrorCode =
  /** The model was not an object with the required fields. */
  | 'INVALID_MODEL'
  /** The dynamics identity was absent or not a canonical semantic ID. */
  | 'INVALID_ID'
  /** The model revision was not a finite integer. */
  | 'INVALID_REVISION'
  /** The solver step was absent, non-finite, zero or negative. */
  | 'INVALID_TIMESTEP'
  /** The state was not a non-empty array of finite numbers. */
  | 'INVALID_STATE'
  /** A parameter was not a finite number, or its name was malformed. */
  | 'INVALID_PARAMETER'
  /** The derivative was not a function. */
  | 'INVALID_DERIVATIVE'
  /** The derivative returned a vector of the wrong length. */
  | 'DERIVATIVE_DIMENSION_MISMATCH'
  /** The derivative returned a value that was not finite. */
  | 'DERIVATIVE_NOT_FINITE'
  /** Integration produced a state that was not finite. */
  | 'NON_FINITE_STATE'
  /** The tick was not a non-negative safe integer. */
  | 'INVALID_TICK'
  /** The requested time was not finite, or was before tick 0. */
  | 'INVALID_TIME'
  /** The requested time did not land on the solver grid. */
  | 'TIME_NOT_TICK_ALIGNED'
  /** The checkpoint interval was not a positive safe integer. */
  | 'INVALID_CHECKPOINT_INTERVAL';

/**
 * @internal Not a public API.
 */
export class SimulationError extends Error {
  public constructor(
    public readonly code: SimulationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SimulationError';
  }
}
