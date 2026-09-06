import {ValidatedModel, evaluateDerivative} from './model';
import {SimulationError, StateVector} from './types';

/**
 * One fixed-step classical Runge-Kutta step.
 *
 * @param model - The validated model supplying the dynamics and the step.
 * @param tick - The tick the state belongs to. The step advances to `tick + 1`.
 * @param state - State at `tick`.
 *
 * @returns State at `tick + 1`.
 *
 * @remarks
 * Standard RK4, fixed `dt`. The step is never adapted from an error estimate
 * and never varies: an adaptive step makes the trajectory depend on the
 * floating-point history of the run, which is the opposite of what this
 * kernel exists to provide.
 *
 * Stage times are computed from the tick rather than accumulated, so the
 * state at a tick depends only on that tick and never on the path taken to
 * reach it. Accumulating `t += dt` would make a state reached by scrubbing
 * differ in the last bits from the same state reached by playing through.
 *
 * The first stage receives a copy of the incoming state. The later stages
 * evaluate at freshly built vectors, which RK4 constructs anyway, so a
 * derivative that writes into its argument can corrupt neither the caller's
 * array nor a cached checkpoint.
 *
 * @internal Not a public API.
 */
export function rk4Step(
  model: ValidatedModel,
  tick: number,
  state: StateVector,
): number[] {
  const h = model.dt;
  const time = tick * h;
  const halfTime = time + h / 2;
  const nextTime = (tick + 1) * h;
  const size = state.length;

  const k1 = evaluateDerivative(model, time, state.slice());

  const stage2 = new Array<number>(size);
  for (let i = 0; i < size; i++) stage2[i] = state[i] + (h / 2) * k1[i];
  const k2 = evaluateDerivative(model, halfTime, stage2);

  const stage3 = new Array<number>(size);
  for (let i = 0; i < size; i++) stage3[i] = state[i] + (h / 2) * k2[i];
  const k3 = evaluateDerivative(model, halfTime, stage3);

  const stage4 = new Array<number>(size);
  for (let i = 0; i < size; i++) stage4[i] = state[i] + h * k3[i];
  const k4 = evaluateDerivative(model, nextTime, stage4);

  const next = new Array<number>(size);
  for (let i = 0; i < size; i++) {
    const value = state[i] + (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
    if (!Number.isFinite(value)) {
      throw new SimulationError(
        'NON_FINITE_STATE',
        `Integration produced ${String(value)} for component ${i} advancing ` +
          `from tick ${tick} to ${tick + 1}. The model has diverged; the ` +
          'result is refused rather than clamped.',
      );
    }
    next[i] = value === 0 ? 0 : value;
  }
  return next;
}
