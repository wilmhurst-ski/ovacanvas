import {describe, expect, test} from 'vitest';
import {DynamicalSystem} from './DynamicalSystem';
import {SimulationModel} from './types';

/** A chain of coupled components, so state width can be varied neutrally. */
function chainModel(width: number): SimulationModel {
  return {
    id: `chain-${width}`,
    revision: 1,
    dt: 0.001,
    initialState: Array.from({length: width}, (_, index) =>
      Math.cos(index + 1),
    ),
    parameters: {c: 0.5},
    derivative: (_time, state, parameters) => {
      const out = new Array<number>(state.length);
      for (let i = 0; i < state.length; i++) {
        const next = state[(i + 1) % state.length];
        out[i] = parameters.c * (next - state[i]);
      }
      return out;
    },
  };
}

describe('dynamical state representative performance', () => {
  test('records cold integration, seek-assisted, and revision-change costs', () => {
    const timings: Record<string, number> = {};

    for (const [width, ticks] of [
      [1, 10_000],
      [12, 20_000],
      [64, 20_000],
    ] as const) {
      const system = new DynamicalSystem(chainModel(width), {
        checkpointInterval: 256,
      });

      const coldStart = performance.now();
      const cold = system.stateAtTick(ticks);
      timings[`cold_${width}comp_${ticks}ticks_ms`] =
        performance.now() - coldStart;
      expect(cold.state).toHaveLength(width);

      // Backward seek served from a checkpoint rather than from tick 0.
      const backStart = performance.now();
      system.stateAtTick(Math.floor(ticks / 3));
      timings[`backward_seek_${width}comp_ms`] = performance.now() - backStart;

      // Returning to a tick already behind a checkpoint.
      const repeatStart = performance.now();
      system.stateAtTick(ticks);
      timings[`repeat_seek_${width}comp_ms`] = performance.now() - repeatStart;

      const invalidateStart = performance.now();
      system.updateModel({...chainModel(width), revision: 2});
      system.stateAtTick(ticks);
      timings[`after_revision_change_${width}comp_ms`] =
        performance.now() - invalidateStart;
    }

    // The same trajectory with no checkpoints at all, for comparison.
    const uncachedStart = performance.now();
    new DynamicalSystem(chainModel(12), {
      checkpointInterval: 1_000_000,
    }).stateAtTick(20_000);
    timings.uncached_12comp_20000ticks_ms = performance.now() - uncachedStart;

    console.info(`CAP05_TIMINGS ${JSON.stringify(timings)}`);
  });
});
