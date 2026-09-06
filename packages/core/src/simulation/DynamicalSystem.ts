import {ValidatedModel, validateModel} from './model';
import {rk4Step} from './rk4';
import {
  SimulationDiagnostics,
  SimulationError,
  SimulationModel,
  SimulationSample,
  TimeResolution,
} from './types';

/**
 * How far a requested time may sit from a tick and still count as that tick.
 *
 * @remarks
 * Relative, because `1.0 / 0.001` is not exactly `1000` in binary floating
 * point and a caller asking for a round second must not be told its request
 * missed the grid. Stated as a constant rather than left to whichever of
 * `floor` or `round` happened to be written.
 */
const AlignmentTolerance = 1e-9;

const DefaultCheckpointInterval = 64;
const DefaultMaxCheckpoints = 512;

/**
 * @internal Not a public API.
 */
export interface DynamicalSystemOptions {
  /**
   * How many solver steps between cached checkpoints.
   *
   * @remarks
   * Tuning policy, not model semantics. It changes how much work a seek
   * costs and never what a seek returns; a regression pins that. No interval
   * is architecturally significant.
   */
  readonly checkpointInterval?: number;

  /**
   * How many checkpoints to retain before the oldest is dropped.
   *
   * @remarks
   * Also tuning policy. Losing a checkpoint costs recomputation from an
   * earlier one, never a different answer, because tick 0 is always available
   * from the model itself.
   */
  readonly maxCheckpoints?: number;
}

/**
 * Deterministic fixed-step integration of a dynamical model, with a sparse
 * checkpoint cache for seeking.
 *
 * @remarks
 * The trajectory is *derived* state. It is not semantic truth, which belongs
 * to the accepted Ovareel compiler revision, and it is not runtime
 * realization authority either. Nothing here is authoritative; everything
 * here is recomputable from the model.
 *
 * Three clocks are kept apart on purpose:
 *
 * - the model revision, which advances when the model changes;
 * - simulation time, the fixed-step coordinate integrated here;
 * - presentation time, which belongs to the player.
 *
 * Presentation never sets the solver step. Asking for state at a simulation
 * time is a read; it cannot change the model revision, and the answer is the
 * same whether the caller arrived by playing through, by scrubbing backwards,
 * or by asking once from cold.
 *
 * This object owns no timer, no animation frame and no loop. It computes when
 * asked and does nothing in between.
 *
 * @internal Not a public API. Names, shape and granularity are not frozen; no
 *           serialization or delivery protocol is implied.
 */
export class DynamicalSystem {
  private model: ValidatedModel;
  private readonly checkpointInterval: number;
  private readonly maxCheckpoints: number;

  /** Checkpoints for the current revision only, keyed by tick. */
  private checkpoints = new Map<number, number[]>();

  private ticksIntegrated = 0;
  private checkpointHits = 0;
  private coldStarts = 0;
  private invalidations = 0;

  public constructor(
    model: SimulationModel,
    options: DynamicalSystemOptions = {},
  ) {
    this.model = validateModel(model);
    this.checkpointInterval = positiveInteger(
      options.checkpointInterval,
      DefaultCheckpointInterval,
      'checkpointInterval',
    );
    this.maxCheckpoints = positiveInteger(
      options.maxCheckpoints,
      DefaultMaxCheckpoints,
      'maxCheckpoints',
    );
  }

  /** The revision namespace every answer currently belongs to. */
  public get revisionToken(): string {
    return this.model.revisionToken;
  }

  /** The authoritative model revision. Seeking never changes it. */
  public get modelRevision(): number {
    return this.model.revision;
  }

  /** The fixed solver step. */
  public get dt(): number {
    return this.model.dt;
  }

  /** The canonical time of a tick. */
  public timeForTick(tick: number): number {
    return this.assertTick(tick) * this.model.dt;
  }

  /**
   * Replace the model.
   *
   * @returns Whether the revision namespace changed.
   *
   * @remarks
   * When any authoritative input changes, the whole cache is dropped. Not the
   * part after the edit - all of it. A checkpoint from the old revision
   * describes a trajectory that no longer exists, and keeping one because its
   * tick happens to precede the change would mean answering a question about
   * the new model with a state the new model never passes through.
   *
   * An identical model leaves the cache alone, so re-supplying the same model
   * is not a way to accidentally throw work away.
   */
  public updateModel(model: SimulationModel): boolean {
    const next = validateModel(model);
    if (next.revisionToken === this.model.revisionToken) {
      this.model = next;
      return false;
    }
    this.model = next;
    this.checkpoints = new Map();
    this.invalidations++;
    return true;
  }

  /**
   * State at a solver tick.
   *
   * @remarks
   * The primitive every other query resolves to. Integration always runs
   * forward from tick 0 or from the nearest checkpoint at or before the
   * target: the step is never run with a negative `dt`, because reversing an
   * explicit integrator is not the same operation and does not return where
   * it started.
   */
  public stateAtTick(tick: number): SimulationSample {
    const target = this.assertTick(tick);

    let cursor = 0;
    let state = this.model.initialState;
    const start = this.nearestCheckpointAtOrBefore(target);
    if (start !== null) {
      cursor = start;
      state = this.checkpoints.get(start)!;
      this.checkpointHits++;
    } else {
      this.coldStarts++;
    }

    // Never hand a cached array to the stepper as something it might keep.
    let working = state.slice();
    while (cursor < target) {
      working = rk4Step(this.model, cursor, working);
      cursor++;
      this.ticksIntegrated++;
      if (cursor % this.checkpointInterval === 0) {
        this.storeCheckpoint(cursor, working);
      }
    }

    return {
      tick: target,
      time: target * this.model.dt,
      // A fresh array: a caller that mutates what it received must not be
      // able to reach into a checkpoint.
      state: working.slice(),
    };
  }

  /**
   * State at a simulation time.
   *
   * @param time - Simulation seconds, at or after zero.
   * @param resolution - How the time becomes a tick. Required to be explicit.
   *
   * @remarks
   * No interpolation. The returned sample names the tick that answered, so
   * the caller can always see what it actually received. Interpolation
   * between grid points is not part of the frozen contract, and picking a
   * policy here would freeze one by accident.
   */
  public stateAtTime(
    time: number,
    resolution: TimeResolution = 'exact',
  ): SimulationSample {
    return this.stateAtTick(this.tickForTime(time, resolution));
  }

  /**
   * Which tick a time resolves to.
   *
   * @internal Not a public API.
   */
  public tickForTime(
    time: number,
    resolution: TimeResolution = 'exact',
  ): number {
    if (typeof time !== 'number' || !Number.isFinite(time)) {
      throw new SimulationError(
        'INVALID_TIME',
        `Simulation time must be a finite number, received ${String(time)}.`,
      );
    }
    if (time < 0) {
      throw new SimulationError(
        'INVALID_TIME',
        `Simulation time must be at or after zero, received ${time}. The ` +
          'trajectory starts at the initial condition and is not integrated ' +
          'backwards.',
      );
    }

    const raw = time / this.model.dt;
    const rounded = Math.round(raw);
    const aligned =
      Math.abs(raw - rounded) <= AlignmentTolerance * Math.max(1, rounded);

    switch (resolution) {
      case 'exact':
        if (!aligned) {
          const below = Math.floor(raw);
          throw new SimulationError(
            'TIME_NOT_TICK_ALIGNED',
            `Simulation time ${time} does not land on the solver grid of ` +
              `dt=${this.model.dt}; it falls between ticks ${below} ` +
              `(${below * this.model.dt}) and ${below + 1} ` +
              `(${(below + 1) * this.model.dt}). Ask for a tick, or state ` +
              'which resolution you want.',
          );
        }
        return rounded;
      case 'floor':
        return aligned ? rounded : Math.floor(raw);
      case 'nearest':
        return rounded;
      default:
        throw new SimulationError(
          'INVALID_TIME',
          `Unknown time resolution: ${String(resolution)}.`,
        );
    }
  }

  /**
   * @remarks
   * Diagnostics only. No result depends on any of these numbers.
   */
  public diagnostics(): SimulationDiagnostics {
    return {
      revisionToken: this.model.revisionToken,
      modelRevision: this.model.revision,
      dt: this.model.dt,
      checkpointInterval: this.checkpointInterval,
      checkpointCount: this.checkpoints.size,
      checkpointTicks: [...this.checkpoints.keys()].sort((a, b) => a - b),
      ticksIntegrated: this.ticksIntegrated,
      checkpointHits: this.checkpointHits,
      coldStarts: this.coldStarts,
      invalidations: this.invalidations,
    };
  }

  /** Drop every checkpoint without changing the model. */
  public clearCache(): void {
    this.checkpoints = new Map();
  }

  private storeCheckpoint(tick: number, state: readonly number[]): void {
    if (this.checkpoints.has(tick)) return;
    if (this.checkpoints.size >= this.maxCheckpoints) {
      // Insertion order: drop the oldest entry. Losing one costs
      // recomputation from an earlier checkpoint, never a different answer.
      const oldest = this.checkpoints.keys().next();
      if (!oldest.done) this.checkpoints.delete(oldest.value);
    }
    this.checkpoints.set(tick, state.slice());
  }

  private nearestCheckpointAtOrBefore(target: number): number | null {
    let best: number | null = null;
    for (const tick of this.checkpoints.keys()) {
      if (tick <= target && (best === null || tick > best)) best = tick;
    }
    return best;
  }

  private assertTick(tick: number): number {
    if (typeof tick !== 'number' || !Number.isSafeInteger(tick) || tick < 0) {
      throw new SimulationError(
        'INVALID_TICK',
        `A solver tick must be a non-negative safe integer, received ${String(
          tick,
        )}.`,
      );
    }
    return tick;
  }
}

function positiveInteger(
  value: number | undefined,
  fallback: number,
  name: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1) {
    throw new SimulationError(
      'INVALID_CHECKPOINT_INTERVAL',
      `${name} must be a positive safe integer, received ${String(value)}.`,
    );
  }
  return resolved;
}
