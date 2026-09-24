import {getComponent} from '../catalogue/index.js';
import type {Catalogue} from '../catalogue/types.js';
import type {SceneNode, Step, Value} from '../document/model.js';

/**
 * The animation between two drawings of the same kit instance.
 *
 * @remarks
 * A kit is a function of its fields, so a change of fields (a `set` beat)
 * is two drawings with the same node ids. Everything that differs glides:
 * positions, sizes, colours, a line's points, an equation's terms. Nodes
 * only the new drawing has fade in; nodes it dropped fade out. A turn takes
 * the short way round. And when a quantity does not move in a straight line
 * as the field changes - an angle arc as its vertex moves, a sine curve as
 * its frequency grows - the drawing is sampled along the way, so every
 * frame in between is a true drawing, not a blend of the two ends.
 */

/** Current prop values of every node, as the animation has left them. */
export type Live = Map<string, Record<string, Value>>;

export interface TransitionInput {
  readonly from: readonly SceneNode[];
  readonly to: readonly SceneNode[];
  readonly seconds: number;
  readonly live: Live;
  /** Nodes beats keep hidden right now: they change silently. */
  readonly hidden: ReadonlySet<string>;
  readonly catalogue: Catalogue;
  /**
   * Drawings part-way through the change (t in 0..1, eased), when every
   * difference between the two field sets is a number.
   */
  readonly sample?: (t: number) => readonly SceneNode[] | null;
}

export interface TransitionOutput {
  readonly steps: Step[];
  /** Nodes that faded in (now visible). */
  readonly appeared: string[];
  /** Nodes that faded out (now hidden). */
  readonly vanished: string[];
}

const SAMPLES = 12;
/** How far (px) a sampled midpoint may stray from a straight blend. */
const TOLERANCE = 1;

function equal(a: Value | undefined, b: Value | undefined): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function isPoint(v: Value): v is [number, number] {
  return (
    Array.isArray(v) &&
    v.length === 2 &&
    typeof v[0] === 'number' &&
    typeof v[1] === 'number'
  );
}

function isPointList(v: Value | undefined): v is [number, number][] {
  return Array.isArray(v) && v.length > 0 && v.every(isPoint);
}

/** Same length, by repeating the last point: a line can then be tweened. */
function padPoints(
  points: [number, number][],
  length: number,
): [number, number][] {
  const out = [...points];
  while (out.length < length) out.push(out[out.length - 1]);
  return out;
}

/** Largest distance between two numeric values of the same shape. */
function deviation(a: Value, b: Value): number {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b);
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) {
    return Math.max(0, ...a.map((v, i) => deviation(v, b[i])));
  }
  return Infinity;
}

function blend(a: Value, b: Value, t: number): Value {
  if (typeof a === 'number' && typeof b === 'number') return a + (b - a) * t;
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) {
    return a.map((v, i) => blend(v, b[i], t));
  }
  return b;
}

/** Numbers all the way down (a number, a point, a list of points). */
function numeric(v: Value | undefined): boolean {
  if (typeof v === 'number') return true;
  return Array.isArray(v) && v.length > 0 && v.every(numeric);
}

/** The eased fraction of the way, so sampled changes still ease in and out. */
function ease(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** The target angle nearest the current one, so a turn goes the short way. */
function nearestTurn(from: number, to: number): number {
  return to + 360 * Math.round((from - to) / 360);
}

export function transition(input: TransitionInput): TransitionOutput {
  const {seconds, live, hidden, catalogue} = input;
  const fromIds = new Set(input.from.map(n => n.id));
  const toById = new Map(input.to.map(n => [n.id, n]));
  const steps: Step[] = [];
  const appeared: string[] = [];
  const vanished: string[] = [];

  // Sampled drawings, fetched once, only if some change needs them.
  let samples: (Map<string, SceneNode> | null)[] | undefined;
  const sampled = () => {
    if (samples === undefined) {
      samples = [];
      for (let k = 1; k < SAMPLES; k++) {
        const drawing = input.sample?.(ease(k / SAMPLES));
        samples.push(drawing ? new Map(drawing.map(n => [n.id, n])) : null);
      }
    }
    return samples;
  };

  const tweenable = (node: SceneNode, prop: string) =>
    getComponent(node.component, catalogue)?.props[prop]?.tweenable === true;

  for (const node of input.to) {
    const current = live.get(node.id) ?? {...(node.props ?? {})};
    const target = node.props ?? {};
    const isNew = !fromIds.has(node.id);
    const keptHidden = hidden.has(node.id);
    const next: Record<string, Value> = {...current};

    for (const prop of new Set([
      ...Object.keys(target),
      ...Object.keys(current),
    ])) {
      if (prop === 'opacity') continue;
      const a = current[prop];
      const b = target[prop];
      if (b === undefined || equal(a, b)) continue;
      next[prop] = b;
      // A node arriving, or one nobody can see, takes its new look at once.
      if (isNew || keptHidden || a === undefined || !tweenable(node, prop)) {
        steps.push({kind: 'set', node: node.id, prop, value: b});
        continue;
      }
      if (prop === 'tex') {
        steps.push({
          kind: 'tween',
          node: node.id,
          prop,
          to: b,
          seconds: Math.max(0.8, seconds),
        });
        continue;
      }
      if (
        prop === 'rotation' &&
        typeof a === 'number' &&
        typeof b === 'number'
      ) {
        const turned = nearestTurn(a, b);
        next[prop] = turned;
        steps.push({kind: 'tween', node: node.id, prop, to: turned, seconds});
        continue;
      }
      if (isPointList(a) && isPointList(b) && a.length !== b.length) {
        // A line gaining or losing points: tween over a padded copy, then
        // settle on the exact list.
        const length = Math.max(a.length, b.length);
        if (a.length < length) {
          steps.push({
            kind: 'set',
            node: node.id,
            prop,
            value: padPoints(a, length),
          });
        }
        steps.push({
          kind: 'chain',
          steps: [
            {
              kind: 'tween',
              node: node.id,
              prop,
              to: padPoints(b, length),
              seconds,
            },
            {kind: 'set', node: node.id, prop, value: b},
          ],
        });
        continue;
      }
      if (numeric(a) && numeric(b) && input.sample) {
        const path = samplePath(node.id, prop, a, b, sampled());
        if (path) {
          steps.push({
            kind: 'chain',
            steps: path.map(value => ({
              kind: 'tween' as const,
              node: node.id,
              prop,
              to: value,
              seconds: Math.round((seconds / SAMPLES) * 1000) / 1000,
              easing: 'linear',
            })),
          });
          continue;
        }
      }
      if (typeof b === 'string' && typeof a === 'string' && prop === 'text') {
        steps.push({kind: 'set', node: node.id, prop, value: b});
        continue;
      }
      steps.push({kind: 'tween', node: node.id, prop, to: b, seconds});
    }

    // Visibility: kit-driven opacity changes, arrivals.
    const targetOpacity =
      typeof target.opacity === 'number' ? target.opacity : 1;
    const currentOpacity = isNew
      ? 0
      : typeof current.opacity === 'number'
        ? current.opacity
        : 1;
    if (!keptHidden && targetOpacity !== currentOpacity) {
      // What arrives comes in as the change settles; what goes, goes first.
      const fade = Math.min(seconds * 0.45, 0.6);
      const arriving = targetOpacity > currentOpacity;
      const tween: Step = {
        kind: 'tween',
        node: node.id,
        prop: 'opacity',
        to: targetOpacity,
        seconds: Math.round(fade * 1000) / 1000,
      };
      steps.push(
        arriving && seconds - fade > 0.05
          ? {
              kind: 'chain',
              steps: [
                {
                  kind: 'wait',
                  seconds: Math.round((seconds - fade) * 1000) / 1000,
                },
                tween,
              ],
            }
          : tween,
      );
      if (targetOpacity > 0 && (isNew || currentOpacity === 0)) {
        appeared.push(node.id);
      } else if (targetOpacity === 0) vanished.push(node.id);
    }
    next.opacity = keptHidden ? (current.opacity ?? 1) : targetOpacity;
    live.set(node.id, next);
  }

  for (const node of input.from) {
    if (toById.has(node.id)) continue;
    const current = live.get(node.id) ?? {};
    if (!hidden.has(node.id) && current.opacity !== 0) {
      steps.push({
        kind: 'tween',
        node: node.id,
        prop: 'opacity',
        to: 0,
        seconds: Math.round(Math.min(seconds * 0.45, 0.6) * 1000) / 1000,
      });
      vanished.push(node.id);
    }
    live.set(node.id, {...current, opacity: 0});
  }
  return {steps, appeared, vanished};
}

/**
 * The values a prop passes through, when a straight blend of its two ends
 * would stray from the true drawing; null when the blend is already true.
 */
function samplePath(
  nodeId: string,
  prop: string,
  a: Value,
  b: Value,
  samples: readonly (Map<string, SceneNode> | null)[],
): Value[] | null {
  const values: Value[] = [];
  for (const drawing of samples) {
    const v = drawing?.get(nodeId)?.props?.[prop];
    if (v === undefined || !numeric(v) || deviation(v, b) === Infinity) {
      return null;
    }
    values.push(v);
  }
  // Compare against the straight blend at each sampled moment.
  const straight = values.every((v, k) => {
    const t = ease((k + 1) / (samples.length + 1));
    return deviation(v, blend(a, b, t)) <= TOLERANCE;
  });
  if (straight) return null;
  return [...values, b];
}
