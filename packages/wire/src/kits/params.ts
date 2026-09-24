import type {Value} from '../document/model.js';
import {isObject} from '../document/values.js';
import {
  ExpressionError,
  parseExpression,
  type Expression,
} from './expression.js';
import type {FieldErrors} from './fields.js';

/**
 * Named numbers a kit's expressions may use: `"params": {"a": 2, "k": 1}`.
 *
 * @remarks
 * Params are what makes a figure a function rather than a picture. A curve
 * `"a*sin(k*x)"`, a piece with a corner at `["a+b", 0]` - and a beat that
 * says `{"set": {"graph.k": 3}}` then glides the whole figure to its new
 * shape, every dependent part following, because the figure is simply
 * drawn again from the new value and the difference is animated.
 */
export type Params = Readonly<Record<string, number>>;

const PARAM_NAME = /^[A-Za-z][A-Za-z0-9]{0,11}$/;
/** Names an expression already gives a meaning. */
const RESERVED = new Set([
  'x',
  'y',
  't',
  'pi',
  'e',
  'sin',
  'cos',
  'tan',
  'asin',
  'acos',
  'atan',
  'sinh',
  'cosh',
  'tanh',
  'exp',
  'ln',
  'log',
  'sqrt',
  'abs',
  'floor',
  'ceil',
]);

export const PARAMS_FIELD = {
  type: '{"a": 2, "k": 1}',
  doc: 'Named numbers the expressions may use. A beat {"set": {"<id>.a": 3}} glides the figure to the new value.',
};

/** The instance's params, reporting bad ones when `errors` is given. */
export function readParams(
  raw: Value | undefined,
  errors?: FieldErrors,
  reserved: readonly string[] = [],
): Params {
  if (raw === undefined) return {};
  if (!isObject(raw)) {
    errors?.error('params', 'params is {"name": number, ...}');
    return {};
  }
  const out: Record<string, number> = {};
  for (const [name, value] of Object.entries(raw)) {
    if (
      !PARAM_NAME.test(name) ||
      RESERVED.has(name) ||
      reserved.includes(name)
    ) {
      errors?.error(
        'params',
        `"${name}" cannot be a param name`,
        `use a short name that is not x, y, t, pi, e or a function${reserved.length ? ` or ${reserved.join(', ')}` : ''}`,
      );
    } else if (typeof value !== 'number' || !Number.isFinite(value)) {
      errors?.error('params', `param "${name}" must be a number`);
    } else out[name] = value;
  }
  return out;
}

/**
 * Parse an expression over `variables` plus the params, bound to the
 * params' values: `evaluate(x)` then works exactly as for a plain curve.
 */
export function parseWithParams(
  source: string,
  params: Params,
  variables: readonly string[] = ['x'],
): Expression {
  const names = Object.keys(params);
  const expr = parseExpression(source, [...variables, ...names]);
  return {
    source,
    evaluate: v => expr.evaluateWith({...params, [variables[0]]: v}),
    evaluateWith: values => expr.evaluateWith({...params, ...values}),
  };
}

/**
 * A coordinate: a number, or an expression in the params (`"a+b"`,
 * `"sqrt(a^2+b^2)"`). Returns null (and reports) when it cannot be read.
 */
export function coordinate(
  value: Value | undefined,
  params: Params,
  errors?: FieldErrors,
  field = 'params',
): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    try {
      const n = parseWithParams(value, params, []).evaluateWith({});
      if (Number.isFinite(n)) return n;
      errors?.error(field, `"${value}" is not a finite number`);
    } catch (error) {
      if (!(error instanceof ExpressionError)) throw error;
      errors?.error(
        field,
        `"${value}": ${error.message.replace(/use , /, 'use ')}`,
        Object.keys(params).length
          ? `params here: ${Object.keys(params).join(', ')}`
          : 'declare names in "params" first, e.g. "params": {"a": 2}',
      );
    }
    return null;
  }
  errors?.error(
    field,
    `${JSON.stringify(value)} is not a number or expression`,
  );
  return null;
}
