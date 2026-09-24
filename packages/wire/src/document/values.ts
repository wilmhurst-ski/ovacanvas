import chroma from 'chroma-js';
import {suggest} from '../catalogue/index.js';
import type {Catalogue, PortType} from '../catalogue/types.js';
import {checkEngineValues} from './engine.js';
import {ANCHOR_SIDES, type Value} from './model.js';

/** A problem with one value, before it is located on a node or step. */
export interface ValueProblem {
  readonly message: string;
  readonly hint?: string;
}

/** A node reference found inside a value, for graph checks. */
export interface ValueRef {
  readonly ref: string;
  readonly side?: string;
  /** The prop kind that carried it - `node` refs are needed at construction. */
  readonly via: 'node' | 'endpoint';
}

export function isObject(value: unknown): value is Record<string, Value> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).every(key => keys.includes(key));
}

function checkVector2(value: Value): ValueProblem | null {
  if (isFiniteNumber(value)) return null;
  if (Array.isArray(value)) {
    return value.length === 2 && value.every(isFiniteNumber)
      ? null
      : {
          message: `expected [x, y] with two numbers, got ${JSON.stringify(value)}`,
        };
  }
  if (isObject(value) && hasOnlyKeys(value, ['x', 'y'])) {
    return isFiniteNumber(value.x) && isFiniteNumber(value.y)
      ? null
      : {
          message: `expected {"x": number, "y": number}, got ${JSON.stringify(value)}`,
        };
  }
  return {
    message: `expected a vector, got ${JSON.stringify(value)}`,
    hint: 'write [x, y], {"x": x, "y": y}, or one number for both axes',
  };
}

function checkRef(
  value: Value,
  allowSide: boolean,
): {problem: ValueProblem | null; ref?: ValueRef} {
  if (!isObject(value) || typeof value.ref !== 'string') {
    return {
      problem: {
        message: `expected {"ref": "<node id>"}, got ${JSON.stringify(value)}`,
      },
    };
  }
  const allowed = allowSide ? ['ref', 'side'] : ['ref'];
  if (!hasOnlyKeys(value, allowed)) {
    const extra = Object.keys(value).filter(key => !allowed.includes(key));
    return {
      problem: {
        message: `unexpected key(s) ${extra.map(k => `"${k}"`).join(', ')} in a reference`,
        hint: allowSide
          ? 'a reference is {"ref": "id", "side"?: "..."}'
          : 'a reference is {"ref": "id"}',
      },
    };
  }
  if (value.side !== undefined) {
    if (
      typeof value.side !== 'string' ||
      !(ANCHOR_SIDES as readonly string[]).includes(value.side)
    ) {
      return {
        problem: {
          message: `unknown side ${JSON.stringify(value.side)}`,
          hint: `side is one of ${ANCHOR_SIDES.join(', ')}`,
        },
      };
    }
  }
  return {
    problem: null,
    ref: {
      ref: value.ref,
      ...(typeof value.side === 'string' ? {side: value.side} : {}),
      via: allowSide ? 'endpoint' : 'node',
    },
  };
}

/**
 * Check one value against one port type. Returns the problem (if any) and
 * every node reference the value carries, so the caller can check that the
 * referenced nodes exist and fit.
 */
export function checkValue(
  value: Value | undefined,
  type: PortType,
  catalogue: Catalogue,
): {problem: ValueProblem | null; refs: ValueRef[]} {
  const refs: ValueRef[] = [];
  const ok = {problem: null, refs};
  const fail = (message: string, hint?: string) => ({
    problem: {message, ...(hint ? {hint} : {})},
    refs,
  });

  if (value === undefined) return fail('a value is required');
  if (value === null) {
    return type.nullable || type.kind === 'color'
      ? ok
      : fail('null is not allowed here');
  }

  switch (type.kind) {
    case 'number':
      return isFiniteNumber(value)
        ? ok
        : fail(`expected a number, got ${JSON.stringify(value)}`);
    case 'string':
      return typeof value === 'string'
        ? ok
        : fail(`expected a string, got ${JSON.stringify(value)}`);
    case 'boolean':
      return typeof value === 'boolean'
        ? ok
        : fail(`expected true or false, got ${JSON.stringify(value)}`);

    case 'color': {
      if (isObject(value) && 'theme' in value) {
        if (!hasOnlyKeys(value, ['theme']) || typeof value.theme !== 'string') {
          return fail('a theme colour is written {"theme": "<token>"}');
        }
        if (!catalogue.themeColors.includes(value.theme)) {
          const close = suggest(value.theme, catalogue.themeColors);
          return fail(
            `unknown theme colour "${value.theme}"`,
            close.length
              ? `did you mean ${close.map(c => `"${c}"`).join(' or ')}?`
              : `theme colours: ${catalogue.themeColors.join(', ')}`,
          );
        }
        return ok;
      }
      if (typeof value !== 'string') {
        return fail(
          `expected a colour, got ${JSON.stringify(value)}`,
          'use a CSS colour string or {"theme": "ink"}',
        );
      }
      if (value === 'none' || value === 'transparent') {
        return fail(
          `"${value}" is a CSS keyword, not a colour the engine parses`,
          'omit the prop, or use null for no fill',
        );
      }
      return chroma.valid(value)
        ? ok
        : fail(
            `"${value}" is not a colour the engine can parse`,
            'use hex ("#2F66D0"), rgb(...), a named colour, or {"theme": "ink"}',
          );
    }

    case 'vector2': {
      const problem = checkVector2(value);
      return problem ? {problem, refs} : ok;
    }

    case 'spacing':
      if (isFiniteNumber(value)) return ok;
      return Array.isArray(value) &&
        value.length >= 1 &&
        value.length <= 4 &&
        value.every(isFiniteNumber)
        ? ok
        : fail(
            `expected a number or 1-4 numbers, got ${JSON.stringify(value)}`,
          );

    case 'length':
      if (isFiniteNumber(value)) return ok;
      return typeof value === 'string' && /^-?\d+(\.\d+)?%$/.test(value)
        ? ok
        : fail(
            `expected pixels or a percentage like "50%", got ${JSON.stringify(value)}`,
          );

    case 'enum':
      return typeof value === 'string' && type.choices.includes(value)
        ? ok
        : fail(
            `expected one of ${type.choices.map(c => `"${c}"`).join(', ')}, got ${JSON.stringify(value)}`,
          );

    case 'origin':
      if (typeof value === 'string' && catalogue.origins.includes(value)) {
        return ok;
      }
      return fail(
        `expected an origin, got ${JSON.stringify(value)}`,
        `one of ${catalogue.origins.map(o => `"${o}"`).join(', ')}`,
      );

    case 'node': {
      const {problem, ref} = checkRef(value, false);
      if (ref) refs.push(ref);
      return problem ? {problem, refs} : ok;
    }

    case 'endpoint': {
      if (isObject(value) && 'ref' in value) {
        const {problem, ref} = checkRef(value, true);
        if (ref) refs.push(ref);
        return problem ? {problem, refs} : ok;
      }
      const problem = checkVector2(value);
      return problem
        ? fail(
            problem.message,
            'an endpoint is [x, y] or {"ref": "id", "side"?: "right"}',
          )
        : ok;
    }

    case 'points': {
      if (!Array.isArray(value) || value.length < 2) {
        return fail(
          `expected a list of at least two points, got ${JSON.stringify(value)}`,
          'e.g. [[-200, 0], {"ref": "box", "side": "left"}]',
        );
      }
      for (let i = 0; i < value.length; i++) {
        const point = value[i];
        if (isObject(point) && 'ref' in point) {
          const {problem, ref} = checkRef(point, true);
          if (ref) refs.push(ref);
          if (problem) {
            return fail(`point ${i}: ${problem.message}`, problem.hint);
          }
          continue;
        }
        const problem = checkVector2(point);
        if (problem || isFiniteNumber(point)) {
          return fail(
            `point ${i}: expected [x, y] or a reference, got ${JSON.stringify(point)}`,
          );
        }
      }
      return ok;
    }

    case 'numbers':
      if (!Array.isArray(value) || !value.every(isFiniteNumber)) {
        return fail(`expected a list of numbers, got ${JSON.stringify(value)}`);
      }
      return type.length !== undefined && value.length !== type.length
        ? fail(`expected exactly ${type.length} numbers, got ${value.length}`)
        : ok;

    case 'tex':
      if (typeof value === 'string') return ok;
      return Array.isArray(value) &&
        value.length > 0 &&
        value.every(v => typeof v === 'string')
        ? ok
        : fail(`expected a LaTeX string, got ${JSON.stringify(value)}`);

    case 'json': {
      // Shape is checked by the TypeScript backstop against the real type;
      // engine values inside it are checked here, by name.
      const problem = checkEngineValues(value);
      return problem ? {problem, refs} : ok;
    }
  }
}
