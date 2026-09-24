import type {Value} from '../document/model.js';
import {isObject} from '../document/values.js';
import type {KitNode, KitSpec} from './types.js';

/**
 * `{"set": {"graph.k": 3, "proof.layout": "square"}}` - a beat that changes
 * a kit's fields. The kit is drawn again from the new fields and every
 * difference is animated: a curve reshapes, pieces slide into a new
 * arrangement, a point moves and its angles and labels follow.
 *
 * A key is `<kitId>.<field>` with further dots going into objects and lists
 * (`"fig.points.B"`, `"graph.areas.0.rects"`). A bare name the kit has no
 * field for is one of its params (`"graph.k"` is `"graph.params.k"`).
 */
export interface SetPath {
  readonly kitId: string;
  readonly path: readonly string[];
}

export function parseSetKey(key: string): SetPath | null {
  const parts = key.split('.');
  if (parts.length < 2 || parts.some(p => !p)) return null;
  return {kitId: parts[0], path: parts.slice(1)};
}

export type SetResult =
  | {readonly ok: true; readonly node: KitNode}
  | {readonly ok: false; readonly message: string; readonly hint?: string};

/** The kit instance with one field changed, or why it cannot be. */
export function applySet(
  node: KitNode,
  spec: KitSpec,
  path: readonly string[],
  value: Value,
): SetResult {
  let full = [...(spec.setPath?.(node, path) ?? path)];
  const params = isObject(node.params) ? node.params : undefined;
  if (!(full[0] in spec.fields) && params && full[0] in params) {
    full = ['params', ...full];
  }
  if (!(full[0] in spec.fields) || full[0] === 'region' || full[0] === 'box') {
    const known = [
      ...Object.keys(spec.fields).filter(f => f !== 'region' && f !== 'box'),
      ...Object.keys(params ?? {}),
    ];
    return {
      ok: false,
      message: `${spec.name} "${node.id}" has no field or param "${full[0]}" to set`,
      hint: `set one of: ${known.join(', ')}`,
    };
  }
  const updated = setIn(node as unknown as Value, full, value);
  if (updated === undefined) {
    return {
      ok: false,
      message: `"${node.id}.${path.join('.')}" does not lead to a value`,
      hint: 'dots go into objects by key and into lists by index',
    };
  }
  return {ok: true, node: updated as unknown as KitNode};
}

function setIn(
  target: Value | undefined,
  path: readonly string[],
  value: Value,
): Value | undefined {
  if (!path.length) return value;
  const [head, ...rest] = path;
  if (Array.isArray(target)) {
    const index = Number(head);
    if (!Number.isInteger(index) || index < 0 || index > target.length) {
      return undefined;
    }
    const child = setIn(target[index], rest, value);
    if (child === undefined) return undefined;
    const copy = [...target];
    copy[index] = child;
    return copy;
  }
  if (target === undefined || isObject(target)) {
    // A missing object on the way is created: setting a new point adds it.
    const object = (target ?? {}) as Record<string, Value>;
    const child = setIn(object[head], rest, value);
    if (child === undefined) return undefined;
    return {...object, [head]: child};
  }
  return undefined;
}

/** Whether two values differ only in numbers (so the change can be sampled). */
export function numericDifference(a: Value, b: Value): boolean {
  if (typeof a === 'number' && typeof b === 'number') return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return (
      a.length === b.length && a.every((v, i) => numericDifference(v, b[i]))
    );
  }
  if (isObject(a) && isObject(b)) {
    const keys = Object.keys(a);
    return (
      keys.length === Object.keys(b).length &&
      keys.every(k => k in b && numericDifference(a[k], b[k]))
    );
  }
  return a === b;
}

/** Numbers interpolated field by field; anything else switches at the end. */
export function lerpValue(a: Value, b: Value, t: number): Value {
  if (typeof a === 'number' && typeof b === 'number') return a + (b - a) * t;
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) {
    return a.map((v, i) => lerpValue(v, b[i], t));
  }
  if (isObject(a) && isObject(b)) {
    const out: Record<string, Value> = {};
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (key in a && key in b) out[key] = lerpValue(a[key], b[key], t);
      else if (t >= 1 ? key in b : key in a) out[key] = (t >= 1 ? b : a)[key];
    }
    return out;
  }
  return t >= 1 ? b : a;
}
