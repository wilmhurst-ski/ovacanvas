import type {PortType} from '../catalogue/types.js';
import {emitJson} from '../document/engine.js';
import type {Value} from '../document/model.js';
import {isObject} from '../document/values.js';

/** Imports a value's emitted source needs. */
export interface EmitContext {
  usesTheme: boolean;
  usesOrigin: boolean;
  /** Engine helpers (`countryFeature`, ...) the emitted values call. */
  engine: Set<string>;
}

function literal(value: Value): string {
  return JSON.stringify(value);
}

function vector(value: Value): string {
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return `[${value[0]}, ${value[1]}]`;
  if (isObject(value)) return `[${value.x}, ${value.y}]`;
  return literal(value);
}

/** A point on another node, read lazily so it follows the node as it moves. */
function anchor(
  ref: string,
  side: string | undefined,
  targetIsLayout: boolean,
): string {
  if (side === undefined || side === 'center') {
    return targetIsLayout ? `() => ${ref}.middle()` : `() => ${ref}.position()`;
  }
  return `() => ${ref}.${side}()`;
}

function endpoint(value: Value, isLayout: (id: string) => boolean): string {
  if (isObject(value) && typeof value.ref === 'string') {
    const side = typeof value.side === 'string' ? value.side : undefined;
    return anchor(value.ref, side, isLayout(value.ref));
  }
  return vector(value);
}

/**
 * TypeScript source for one validated value.
 *
 * @remarks
 * Only ever called on a value `checkValue` accepted for the same type, so
 * every branch can assume the shape it is given. Vectors are always emitted
 * inline as literals - never through a variable - which is what makes the
 * `number[]` widening error that full code generation kept hitting
 * impossible here.
 */
export function emitValue(
  value: Value,
  type: PortType,
  context: EmitContext,
  isLayout: (id: string) => boolean,
): string {
  if (value === null) return 'null';
  switch (type.kind) {
    case 'color':
      if (isObject(value) && typeof value.theme === 'string') {
        context.usesTheme = true;
        return `theme().${value.theme}`;
      }
      return literal(value);
    case 'vector2':
      return vector(value);
    case 'origin':
      context.usesOrigin = true;
      return `Origin.${value}`;
    case 'node':
      return isObject(value) ? String(value.ref) : literal(value);
    case 'endpoint':
      return endpoint(value, isLayout);
    case 'points':
      return Array.isArray(value)
        ? `[${value.map(point => endpoint(point, isLayout)).join(', ')}]`
        : literal(value);
    case 'numbers':
    case 'spacing':
    case 'number':
    case 'string':
    case 'boolean':
    case 'length':
    case 'enum':
    case 'tex':
      return literal(value);
    case 'json':
      return emitJson(value, context.engine);
  }
}
