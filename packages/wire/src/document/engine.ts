import {suggest} from '../catalogue/index.js';
import {resolveCountry, suggestCountry} from '../kits/geo/atlas.js';
import type {Value} from './model.js';
import {isObject, type ValueProblem} from './values.js';

/**
 * Engine values: data a document cannot spell out inline, named instead.
 *
 * @remarks
 * A country's boundary is thousands of coordinates - far too much to write
 * into a document, and exactly what a model would get wrong. A document
 * names it instead, inside any JSON prop:
 *
 * ```json
 * {"feature": {"$engine": "countryFeature", "args": ["Nigeria"]}}
 * {"feature": {"$engine": "WORLD_COUNTRIES"}}
 * ```
 *
 * and the generated module calls the engine's own helper
 * (`countryFeature("Nigeria")`), imported from `@ovacanvas/2d`. Only the
 * names below exist, and every country argument is checked against the
 * boundary data before any code is generated.
 */
type ArgKind = 'country' | 'countries' | 'string' | 'spec';

interface EngineValueSpec {
  /** Positional arguments; a `?` suffix marks an optional one. */
  readonly args?: readonly `${ArgKind}${'' | '?'}`[];
  readonly doc: string;
}

// Keys are the engine's own export names, constants included.
/* eslint-disable @typescript-eslint/naming-convention */
export const ENGINE_VALUES: Readonly<Record<string, EngineValueSpec>> = {
  countryFeature: {args: ['country'], doc: "one country's outline"},
  countriesFeature: {
    args: ['countries', 'string?'],
    doc: 'several countries merged into one outline (a region)',
  },
  countryGroupFeature: {
    args: ['countries', 'string?'],
    doc: 'several countries, each its own shape',
  },
  countryBordersFeature: {
    args: ['countries?'],
    doc: 'the borders between countries (all, or only among the ones given)',
  },
  WORLD_COUNTRIES: {doc: 'every country'},
  WORLD_COUNTRIES_110M: {
    doc: 'every country, coarser - for world and globe views',
  },
  WORLD_BORDERS_110M: {
    doc: 'every border, coarser - for world and globe views',
  },
  WORLD_LAND: {doc: 'all land as one shape'},
  buildWorld3D: {
    args: ['spec'],
    doc: 'a 3D world from plain data: surfaces, curves, arrows, spheres, a framing box',
  },
};
/* eslint-enable @typescript-eslint/naming-convention */

export function isEngineValue(value: Value): value is {
  readonly $engine: string;
  readonly args?: readonly Value[];
} {
  return isObject(value) && typeof value.$engine === 'string';
}

function checkCountry(value: Value, where: string): ValueProblem | null {
  if (typeof value !== 'string') {
    return {
      message: `${where}: expected a country name, got ${JSON.stringify(value)}`,
    };
  }
  if (resolveCountry(value)) return null;
  const close = suggestCountry(value);
  return {
    message: `${where}: unknown country "${value}"`,
    hint: close.length
      ? `did you mean ${close.map(c => `"${c}"`).join(' or ')}?`
      : 'use the country name as on a map, e.g. "Nigeria", "Côte d\'Ivoire", "USA"',
  };
}

function checkEngineValue(value: {
  readonly $engine: string;
  readonly args?: readonly Value[];
}): ValueProblem | null {
  const spec = ENGINE_VALUES[value.$engine];
  if (!spec) {
    const close = suggest(value.$engine, Object.keys(ENGINE_VALUES));
    return {
      message: `unknown engine value "${value.$engine}"`,
      hint: close.length
        ? `did you mean ${close.map(c => `"${c}"`).join(' or ')}?`
        : `engine values: ${Object.keys(ENGINE_VALUES).join(', ')}`,
    };
  }
  const extra = Object.keys(value).filter(k => k !== '$engine' && k !== 'args');
  if (extra.length) {
    return {
      message: `unexpected key(s) ${extra.join(', ')} in an engine value`,
    };
  }
  const kinds = spec.args ?? [];
  const args = value.args ?? [];
  if (!Array.isArray(args)) {
    return {message: '"args" is a list'};
  }
  const required = kinds.filter(k => !k.endsWith('?')).length;
  if (args.length < required || args.length > kinds.length) {
    return {
      message: `${value.$engine} takes ${required === kinds.length ? kinds.length : `${required}-${kinds.length}`} argument(s), got ${args.length}`,
    };
  }
  for (let i = 0; i < args.length; i++) {
    const kind = kinds[i].replace('?', '') as ArgKind;
    const where = `${value.$engine} argument ${i + 1}`;
    const arg = args[i];
    if (kind === 'country') {
      const problem = checkCountry(arg, where);
      if (problem) return problem;
    } else if (kind === 'countries') {
      if (!Array.isArray(arg) || arg.length === 0) {
        return {message: `${where}: expected a list of country names`};
      }
      for (const country of arg) {
        const problem = checkCountry(country, where);
        if (problem) return problem;
      }
    } else if (kind === 'spec') {
      if (!isObject(arg)) return {message: `${where}: expected an object`};
    } else if (typeof arg !== 'string') {
      return {message: `${where}: expected a string`};
    }
  }
  return null;
}

/** The first problem with any engine value inside a JSON prop value. */
export function checkEngineValues(value: Value): ValueProblem | null {
  if (isEngineValue(value)) return checkEngineValue(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const problem = checkEngineValues(item);
      if (problem) return problem;
    }
  } else if (isObject(value)) {
    for (const item of Object.values(value)) {
      const problem = checkEngineValues(item);
      if (problem) return problem;
    }
  }
  return null;
}

function canonical(arg: Value): Value {
  if (typeof arg === 'string') return resolveCountry(arg) ?? arg;
  if (Array.isArray(arg)) return arg.map(canonical);
  return arg;
}

/**
 * TypeScript source for a JSON value, with engine values emitted as calls to
 * the engine's helpers. Country names are written as the data spells them.
 */
export function emitJson(value: Value, used: Set<string>): string {
  if (isEngineValue(value)) {
    used.add(value.$engine);
    const spec = ENGINE_VALUES[value.$engine];
    if (!spec.args) return value.$engine;
    const args = (value.args ?? []).map((arg, i) =>
      spec.args![i].startsWith('countr')
        ? JSON.stringify(canonical(arg))
        : JSON.stringify(arg),
    );
    return `${value.$engine}(${args.join(', ')})`;
  }
  if (Array.isArray(value)) {
    return `[${value.map(v => emitJson(v, used)).join(', ')}]`;
  }
  if (isObject(value)) {
    return `{${Object.entries(value)
      .map(([k, v]) => `${JSON.stringify(k)}: ${emitJson(v, used)}`)
      .join(', ')}}`;
  }
  return JSON.stringify(value);
}
