import {
  SimulationError,
  SimulationModel,
  SimulationParameters,
  StateVector,
} from './types';

const SEMANTIC_ID = /^[A-Za-z0-9_-]+$/;

/**
 * A validated, defensively copied model.
 *
 * @remarks
 * The copies matter: the caller keeps its own references to the arrays and
 * objects it passed in, and a later mutation of one of those must not be able
 * to change what an already-computed trajectory meant.
 *
 * @internal Not a public API.
 */
export interface ValidatedModel {
  readonly id: string;
  readonly revision: number;
  readonly dt: number;
  readonly initialState: number[];
  readonly parameters: SimulationParameters;
  readonly derivative: SimulationModel['derivative'];
  /** The revision namespace every trajectory value belongs to. */
  readonly revisionToken: string;
}

function finite(value: unknown, code: any, where: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new SimulationError(
      code,
      `${where} must be a finite number, received ${String(value)}.`,
    );
  }
  // -0 and 0 are ===, but not Object.is, so a token built from one would
  // differ from a token built from the other for identical models.
  return value === 0 ? 0 : value;
}

/**
 * Validate and copy a state vector.
 *
 * @internal Not a public API.
 */
export function validateState(
  state: unknown,
  where: string,
  expectedLength?: number,
): number[] {
  if (!Array.isArray(state) || state.length === 0) {
    throw new SimulationError(
      'INVALID_STATE',
      `${where} must be a non-empty array of finite numbers.`,
    );
  }
  if (expectedLength !== undefined && state.length !== expectedLength) {
    throw new SimulationError(
      'INVALID_STATE',
      `${where} must have ${expectedLength} components, received ${state.length}.`,
    );
  }
  return state.map((value, index) =>
    finite(value, 'INVALID_STATE', `${where}[${index}]`),
  );
}

function validateParameters(parameters: unknown): SimulationParameters {
  if (parameters === undefined) return Object.freeze({});
  if (parameters === null || typeof parameters !== 'object') {
    throw new SimulationError(
      'INVALID_PARAMETER',
      'model.parameters must be an object of finite numbers.',
    );
  }
  const copy: Record<string, number> = {};
  for (const name of Object.keys(parameters as Record<string, unknown>)) {
    if (!SEMANTIC_ID.test(name)) {
      throw new SimulationError(
        'INVALID_PARAMETER',
        `Parameter name "${name}" must match [A-Za-z0-9_-]+.`,
      );
    }
    copy[name] = finite(
      (parameters as Record<string, unknown>)[name],
      'INVALID_PARAMETER',
      `model.parameters.${name}`,
    );
  }
  return Object.freeze(copy);
}

/**
 * The revision namespace token.
 *
 * @remarks
 * Derived from every authoritative input a trajectory depends on: the
 * dynamics identity, the model revision, the solver step, the initial
 * condition and the parameters. The governing formula also names a seed;
 * CAP-05 introduces no randomness, so there is nothing to include, and a
 * stochastic model would need an explicit seeded contract before one existed.
 *
 * It is derived from content rather than trusting the revision counter alone,
 * so a caller that edits a parameter and forgets to advance `revision` still
 * gets a new namespace instead of stale answers. Numbers go in through
 * {@link Number.prototype.toExponential} at full precision, because a token
 * that rounded would map two different models onto one namespace.
 *
 * @internal Not a public API. Not a wire format.
 */
export function revisionTokenFor(model: {
  id: string;
  revision: number;
  dt: number;
  initialState: readonly number[];
  parameters: SimulationParameters;
}): string {
  const number = (value: number) => value.toExponential(17);
  const parameters = Object.keys(model.parameters)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map(name => `${name}=${number(model.parameters[name])}`)
    .join(',');

  return [
    `id=${model.id}`,
    `rev=${model.revision}`,
    `dt=${number(model.dt)}`,
    `y0=[${model.initialState.map(number).join(',')}]`,
    `p={${parameters}}`,
  ].join('|');
}

/**
 * Validate a model, copy everything mutable out of the caller's reach, and
 * compute its revision token.
 *
 * @internal Not a public API.
 */
export function validateModel(model: unknown): ValidatedModel {
  if (model === null || typeof model !== 'object') {
    throw new SimulationError(
      'INVALID_MODEL',
      'A simulation model must be an object.',
    );
  }
  const candidate = model as Record<string, unknown>;

  if (typeof candidate.id !== 'string' || !SEMANTIC_ID.test(candidate.id)) {
    throw new SimulationError(
      'INVALID_ID',
      'model.id must match the canonical semantic ID grammar [A-Za-z0-9_-]+.',
    );
  }
  if (
    typeof candidate.revision !== 'number' ||
    !Number.isSafeInteger(candidate.revision)
  ) {
    throw new SimulationError(
      'INVALID_REVISION',
      `model.revision must be a safe integer, received ${String(
        candidate.revision,
      )}.`,
    );
  }
  const dt = finite(candidate.dt, 'INVALID_TIMESTEP', 'model.dt');
  if (dt <= 0) {
    throw new SimulationError(
      'INVALID_TIMESTEP',
      `model.dt must be greater than zero, received ${dt}. The solver step is ` +
        'fixed; an adaptive or caller-varied step is not part of this kernel.',
    );
  }
  if (typeof candidate.derivative !== 'function') {
    throw new SimulationError(
      'INVALID_DERIVATIVE',
      'model.derivative must be a function.',
    );
  }

  const initialState = validateState(
    candidate.initialState,
    'model.initialState',
  );
  const parameters = validateParameters(candidate.parameters);
  const id = candidate.id;
  const revision = candidate.revision;

  return {
    id,
    revision,
    dt,
    initialState,
    parameters,
    derivative: candidate.derivative as SimulationModel['derivative'],
    revisionToken: revisionTokenFor({
      id,
      revision,
      dt,
      initialState,
      parameters,
    }),
  };
}

/**
 * Evaluate the dynamics and refuse anything that is not a usable derivative.
 *
 * @remarks
 * The state handed over is a copy, so a derivative that writes to its
 * argument corrupts nothing.
 *
 * @internal Not a public API.
 */
export function evaluateDerivative(
  model: ValidatedModel,
  time: number,
  state: StateVector,
): number[] {
  const derivative = model.derivative(time, state, model.parameters);

  if (!Array.isArray(derivative)) {
    throw new SimulationError(
      'DERIVATIVE_DIMENSION_MISMATCH',
      `The derivative must return an array, received ${typeof derivative}.`,
    );
  }
  if (derivative.length !== state.length) {
    throw new SimulationError(
      'DERIVATIVE_DIMENSION_MISMATCH',
      `The derivative returned ${derivative.length} components for a state of ` +
        `${state.length}. A mismatched derivative is refused rather than ` +
        'padded or truncated.',
    );
  }
  for (let i = 0; i < derivative.length; i++) {
    const value = derivative[i];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new SimulationError(
        'DERIVATIVE_NOT_FINITE',
        `The derivative returned ${String(value)} for component ${i} at time ` +
          `${time}.`,
      );
    }
  }
  return derivative;
}
