import {decorate, threadable} from '../decorators';
import type {Signal, SignalValue} from '../signals';
import {ThreadGenerator} from '../threading';
import {InterpolationFunction, TimingFunction} from '../tweening';
import {chain} from './chain';

export interface GrowThroughOptions<TValue> {
  /** Seconds spent tweening into each state. Default 0.6. */
  readonly transitionSeconds?: number;
  /** Seconds held on each state once reached. Default 1. */
  readonly holdSeconds?: number;
  readonly timingFunction?: TimingFunction;
  readonly interpolationFunction?: InterpolationFunction<TValue>;
}

decorate(growThrough, threadable());

/**
 * Tween a signal through a sequence of states, holding on each one.
 *
 * @remarks
 * Packages the "advance, hold, advance, hold" discipline real choreography
 * needs into one call, built entirely from primitives that already exist
 * and are already used elsewhere in this exact form (`Signal.to()`,
 * `SignalGenerator.wait()`, `chain()` - see `Grid.ts`'s own doc example,
 * `grid().end(0.5, 1).to(1, 1).wait(1)`). Nothing here is a new animation
 * mechanism.
 *
 * This exists because nothing previously packaged that discipline into a
 * single call: every real LLM-generated eval scene that needed multi-step
 * motion came out as a single static frame instead, because "hold, advance,
 * hold, repeat N times" had to be hand-assembled correctly every time.
 *
 * @example
 * ```ts
 * yield* growThrough(equation.tex, [
 *   'x^2 + bx + c = 0',
 *   'x^2 + bx = -c',
 *   '\\left(x + \\tfrac{b}{2}\\right)^2 = \\tfrac{b^2}{4} - c',
 * ]);
 * ```
 *
 * @param signal - The signal to tween.
 * @param states - The states to pass through, in order. The signal's
 *                 current value is the implicit starting point - to show the
 *                 first state instantly with no transition, set the signal
 *                 directly before calling this.
 * @param options - Shared timing for every step. There is no per-step
 *                  override; a scene wanting different timing per step
 *                  should chain multiple `growThrough` calls instead.
 */
export function* growThrough<TSetterValue, TValue extends TSetterValue>(
  signal: Signal<TSetterValue, TValue, unknown>,
  states: readonly SignalValue<TSetterValue>[],
  options: GrowThroughOptions<TValue> = {},
): ThreadGenerator {
  const {
    transitionSeconds = 0.6,
    holdSeconds = 1,
    timingFunction,
    interpolationFunction,
  } = options;

  yield* chain(
    ...states.map(state =>
      signal(
        state,
        transitionSeconds,
        timingFunction,
        interpolationFunction,
      ).wait(holdSeconds),
    ),
  );
}
