import {describe, expect, test, vi} from 'vitest';
import {DynamicalSystem} from './DynamicalSystem';
import {SimulationError, SimulationModel} from './types';

/**
 * Exponential decay: y' = -k*y, y(0) = 1, so y(t) = exp(-k*t).
 *
 * @remarks
 * Neutral on purpose. It is a one-line differential equation with a closed
 * form, not a physical situation; CAP-05 integrates continuous state and does
 * not know what a component stands for.
 */
function decayModel(overrides: Partial<SimulationModel> = {}): SimulationModel {
  return {
    id: 'decay',
    revision: 1,
    dt: 0.001,
    initialState: [1],
    parameters: {k: 1},
    derivative: (_time, state, parameters) => [-parameters.k * state[0]],
    ...overrides,
  };
}

/**
 * A two-component oscillator: y0' = y1, y1' = -w^2 * y0.
 *
 * @remarks
 * With y(0) = [1, 0] the closed form is [cos(wt), -w sin(wt)], which exercises
 * both components against different reference values.
 */
function oscillatorModel(
  overrides: Partial<SimulationModel> = {},
): SimulationModel {
  return {
    id: 'oscillator',
    revision: 1,
    dt: 0.001,
    initialState: [1, 0],
    parameters: {w: 2},
    derivative: (_time, state, parameters) => [
      state[1],
      -parameters.w * parameters.w * state[0],
    ],
    ...overrides,
  };
}

function codeOf(run: () => unknown): string {
  try {
    run();
  } catch (error: any) {
    expect(error).toBeInstanceOf(SimulationError);
    return error.code;
  }
  throw new Error('expected the request to be refused');
}

// --- A. RK4 AGAINST A KNOWN SYSTEM ---

describe('fixed-step RK4', () => {
  test('matches a closed-form solution within the fourth-order error floor', () => {
    const system = new DynamicalSystem(decayModel());
    const sample = system.stateAtTick(1000);

    expect(sample.tick).toBe(1000);
    expect(sample.time).toBeCloseTo(1, 12);
    // Global error of classical RK4 is O(h^4); with h = 1e-3 that floor is
    // around 1e-12, so 1e-9 is a bound with three orders of headroom rather
    // than a number chosen to make the assertion pass.
    expect(Math.abs(sample.state[0] - Math.exp(-1))).toBeLessThan(1e-9);
  });

  test('converges at fourth order when the step is halved', () => {
    const errorAt = (dt: number, ticks: number) => {
      const system = new DynamicalSystem(decayModel({dt}));
      return Math.abs(system.stateAtTick(ticks).state[0] - Math.exp(-1));
    };

    const coarse = errorAt(0.01, 100);
    const fine = errorAt(0.005, 200);

    // Halving the step must cut the error by roughly 2^4. A lower-order
    // integrator would land near 2, 4 or 8 instead.
    const ratio = coarse / fine;
    expect(ratio).toBeGreaterThan(12);
    expect(ratio).toBeLessThan(20);
  });

  // --- B. VECTOR STATE ---

  test('integrates every component of a multi-component state', () => {
    const system = new DynamicalSystem(oscillatorModel());
    const sample = system.stateAtTick(1000);

    expect(sample.state).toHaveLength(2);
    expect(Math.abs(sample.state[0] - Math.cos(2))).toBeLessThan(1e-9);
    expect(Math.abs(sample.state[1] + 2 * Math.sin(2))).toBeLessThan(1e-9);
    // Both components moved; neither was left at its initial value.
    expect(sample.state[0]).not.toBe(1);
    expect(sample.state[1]).not.toBe(0);
  });

  // --- C. REPEAT DETERMINISM ---

  test('repeats bit-for-bit across fresh engines and repeated queries', () => {
    const first = new DynamicalSystem(oscillatorModel()).stateAtTick(777);
    const second = new DynamicalSystem(oscillatorModel()).stateAtTick(777);
    expect(second.state).toEqual(first.state);

    const shared = new DynamicalSystem(oscillatorModel());
    expect(shared.stateAtTick(777).state).toEqual(first.state);
    expect(shared.stateAtTick(777).state).toEqual(first.state);
  });
});

// --- D. PRESENTATION-FPS INDEPENDENCE ---

describe('presentation independence', () => {
  test('samples the same trajectory at 24, 30, 50, 60 and 120 fps', () => {
    const reference = new DynamicalSystem(oscillatorModel()).stateAtTick(1000);
    const perRate = new Map<number, number[]>();

    for (const fps of [24, 30, 50, 60, 120]) {
      const system = new DynamicalSystem(oscillatorModel());
      // Walk the trajectory the way a player at this rate would, asking for
      // state at every frame boundary along the way.
      for (let frame = 1; frame <= fps; frame++) {
        system.stateAtTime(frame / fps, 'nearest');
      }
      perRate.set(fps, system.stateAtTime(1, 'exact').state);
    }

    for (const fps of [24, 30, 50, 60, 120]) {
      expect(perRate.get(fps)).toEqual(reference.state);
    }
    // Anchored to the closed form as well as to each other. Agreeing with one
    // another is not enough: a stepper that advanced once per presentation
    // sample would also agree with itself, at the wrong answer.
    for (const fps of [24, 30, 50, 60, 120]) {
      const state = perRate.get(fps)!;
      expect(Math.abs(state[0] - Math.cos(2))).toBeLessThan(1e-9);
      expect(Math.abs(state[1] + 2 * Math.sin(2))).toBeLessThan(1e-9);
    }
    // And the sample cadence changed nothing about which tick answered.
    expect(
      new DynamicalSystem(oscillatorModel()).stateAtTime(1, 'exact').tick,
    ).toBe(1000);
    // Every rate integrated the full grid, not one step per frame.
    expect(reference.tick).toBe(1000);
  });

  test('the solver step comes from the model, never from a caller cadence', () => {
    const coarse = new DynamicalSystem(oscillatorModel({dt: 0.002}));
    const fine = new DynamicalSystem(oscillatorModel({dt: 0.001}));

    // Same simulation time, different solver grids: both approximate the same
    // closed form, and each names the tick that answered.
    expect(coarse.stateAtTime(1, 'exact').tick).toBe(500);
    expect(fine.stateAtTime(1, 'exact').tick).toBe(1000);
    expect(
      Math.abs(coarse.stateAtTime(1, 'exact').state[0] - Math.cos(2)),
    ).toBeLessThan(1e-8);
  });
});

// --- E / F / G. SEEKING ---

describe('seeking', () => {
  test('seeks forward to a later simulation time', () => {
    const system = new DynamicalSystem(decayModel());
    const sample = system.stateAtTick(2000);

    expect(Math.abs(sample.state[0] - Math.exp(-2))).toBeLessThan(1e-9);
  });

  test('seeks backward without integrating with a negative step', () => {
    const system = new DynamicalSystem(decayModel());
    system.stateAtTick(2000);
    const backwards = system.stateAtTick(300);

    const cold = new DynamicalSystem(decayModel()).stateAtTick(300);
    expect(backwards.state).toEqual(cold.state);
    expect(backwards.tick).toBe(300);
  });

  test('returns the same state when a tick is revisited after a detour', () => {
    const system = new DynamicalSystem(oscillatorModel());

    const first = system.stateAtTick(1500).state;
    system.stateAtTick(200);
    const again = system.stateAtTick(1500).state;
    system.stateAtTick(3000);
    system.stateAtTick(50);
    const third = system.stateAtTick(1500).state;

    expect(again).toEqual(first);
    expect(third).toEqual(first);
    expect(first).toEqual(
      new DynamicalSystem(oscillatorModel()).stateAtTick(1500).state,
    );
  });
});

// --- H / I. CHECKPOINTS ---

describe('checkpoint cache', () => {
  test('a repeated seek resumes from the nearest checkpoint at or before it', () => {
    const system = new DynamicalSystem(oscillatorModel(), {
      checkpointInterval: 64,
    });

    const first = system.stateAtTick(1000);
    const afterFirst = system.diagnostics();
    expect(afterFirst.coldStarts).toBe(1);
    expect(afterFirst.checkpointHits).toBe(0);
    expect(afterFirst.ticksIntegrated).toBe(1000);
    expect(afterFirst.checkpointTicks).toContain(960);

    const second = system.stateAtTick(1000);
    const afterSecond = system.diagnostics();
    expect(afterSecond.checkpointHits).toBe(1);
    expect(afterSecond.coldStarts).toBe(1);
    // Resumed from tick 960, so only the remaining 40 steps were integrated.
    expect(afterSecond.ticksIntegrated - afterFirst.ticksIntegrated).toBe(40);
    expect(second.state).toEqual(first.state);

    // And it still equals a clean integration from the initial state.
    expect(first.state).toEqual(
      new DynamicalSystem(oscillatorModel(), {
        checkpointInterval: 1_000_000,
      }).stateAtTick(1000).state,
    );
  });

  test('checkpoint cadence is tuning policy and never changes an answer', () => {
    const states = [7, 64, 250, 1_000_000].map(checkpointInterval => {
      const system = new DynamicalSystem(oscillatorModel(), {
        checkpointInterval,
      });
      system.stateAtTick(1200);
      system.stateAtTick(180);
      return system.stateAtTick(1000).state;
    });

    for (const state of states) expect(state).toEqual(states[0]);
    expect(states[0]).toEqual(
      new DynamicalSystem(oscillatorModel()).stateAtTick(1000).state,
    );
  });

  test('a bounded cache costs recomputation, never correctness', () => {
    const bounded = new DynamicalSystem(oscillatorModel(), {
      checkpointInterval: 8,
      maxCheckpoints: 4,
    });
    const state = bounded.stateAtTick(400).state;

    expect(bounded.diagnostics().checkpointCount).toBeLessThanOrEqual(4);
    expect(state).toEqual(
      new DynamicalSystem(oscillatorModel()).stateAtTick(400).state,
    );
  });
});

// --- J / K / L. MODEL REVISION ---

describe('model revision', () => {
  test('changing a parameter invalidates the whole trajectory cache', () => {
    const system = new DynamicalSystem(decayModel(), {checkpointInterval: 64});
    const underR1 = system.stateAtTick(1000).state;
    expect(system.diagnostics().checkpointCount).toBeGreaterThan(0);
    const tokenR1 = system.revisionToken;

    const changed = system.updateModel(
      decayModel({revision: 2, parameters: {k: 3}}),
    );

    expect(changed).toBe(true);
    expect(system.revisionToken).not.toBe(tokenR1);
    // The whole cache, not the part after some notional edit time.
    expect(system.diagnostics().checkpointCount).toBe(0);
    expect(system.diagnostics().checkpointTicks).toEqual([]);
    expect(system.diagnostics().invalidations).toBe(1);

    const underR2 = system.stateAtTick(1000).state;
    const cleanR2 = new DynamicalSystem(
      decayModel({revision: 2, parameters: {k: 3}}),
    ).stateAtTick(1000).state;

    expect(underR2).toEqual(cleanR2);
    expect(underR2).not.toEqual(underR1);
    expect(Math.abs(underR2[0] - Math.exp(-3))).toBeLessThan(1e-9);
  });

  test('an early checkpoint from the old revision cannot answer the new one', () => {
    const system = new DynamicalSystem(decayModel(), {checkpointInterval: 10});
    system.stateAtTick(500);
    expect(system.diagnostics().checkpointTicks).toContain(10);

    system.updateModel(decayModel({revision: 2, parameters: {k: 5}}));

    // Tick 10 precedes anywhere a caller might imagine the change "started",
    // and it is gone regardless.
    expect(system.diagnostics().checkpointTicks).toEqual([]);
    expect(system.stateAtTick(10).state).toEqual(
      new DynamicalSystem(
        decayModel({revision: 2, parameters: {k: 5}}),
      ).stateAtTick(10).state,
    );
  });

  test('every authoritative input takes part in the revision identity', () => {
    const base = new DynamicalSystem(decayModel());
    const token = base.revisionToken;

    for (const change of [
      decayModel({revision: 2}),
      decayModel({dt: 0.002}),
      decayModel({initialState: [2]}),
      decayModel({parameters: {k: 2}}),
      decayModel({id: 'decay-b'}),
    ]) {
      const system = new DynamicalSystem(decayModel());
      expect(system.updateModel(change)).toBe(true);
      expect(system.revisionToken).not.toBe(token);
    }
  });

  test('re-supplying an identical model keeps the cache', () => {
    const system = new DynamicalSystem(decayModel(), {checkpointInterval: 64});
    system.stateAtTick(1000);
    const before = system.diagnostics().checkpointCount;

    expect(system.updateModel(decayModel())).toBe(false);
    expect(system.diagnostics().checkpointCount).toBe(before);
    expect(system.diagnostics().invalidations).toBe(0);
  });

  test('seeking never mutates the model revision', () => {
    const system = new DynamicalSystem(decayModel());
    const token = system.revisionToken;
    const revision = system.modelRevision;

    for (const tick of [1000, 300, 800, 10, 2000, 0, 1500]) {
      system.stateAtTick(tick);
      expect(system.revisionToken).toBe(token);
      expect(system.modelRevision).toBe(revision);
    }
    system.stateAtTime(1, 'exact');
    system.stateAtTime(0.5, 'nearest');

    expect(system.revisionToken).toBe(token);
    expect(system.modelRevision).toBe(revision);
    expect(system.diagnostics().invalidations).toBe(0);
  });
});

// --- M. STATE ALIASING ---

describe('aliasing', () => {
  test('mutating the caller initial state cannot change the trajectory', () => {
    const initialState = [1];
    const system = new DynamicalSystem(decayModel({initialState}));
    const before = system.stateAtTick(500).state;

    initialState[0] = 99;

    expect(system.stateAtTick(500).state).toEqual(before);
    expect(system.stateAtTick(1000).state).toEqual(
      new DynamicalSystem(decayModel()).stateAtTick(1000).state,
    );
  });

  test('mutating the caller parameters cannot change the trajectory', () => {
    const parameters = {k: 1};
    const system = new DynamicalSystem(decayModel({parameters}));
    const before = system.stateAtTick(500).state;

    parameters.k = 42;

    expect(system.stateAtTick(500).state).toEqual(before);
  });

  test('mutating a returned state cannot corrupt a checkpoint', () => {
    const system = new DynamicalSystem(oscillatorModel(), {
      checkpointInterval: 32,
    });
    const sample = system.stateAtTick(320);
    const expected = [...sample.state];

    sample.state[0] = 1234;
    sample.state[1] = -1234;

    expect(system.stateAtTick(320).state).toEqual(expected);
    expect(system.stateAtTick(640).state).toEqual(
      new DynamicalSystem(oscillatorModel()).stateAtTick(640).state,
    );
  });

  test('a derivative that writes into its argument cannot corrupt the state', () => {
    const vandal: SimulationModel = {
      ...oscillatorModel(),
      derivative: (_time, state, parameters) => {
        const derivative = [state[1], -parameters.w * parameters.w * state[0]];
        // Deliberately hostile: scribble over the vector it was handed.
        (state as number[])[0] = 1e6;
        (state as number[])[1] = -1e6;
        return derivative;
      },
    };

    expect(new DynamicalSystem(vandal).stateAtTick(500).state).toEqual(
      new DynamicalSystem(oscillatorModel()).stateAtTick(500).state,
    );
  });
});

// --- N / O. FAIL CLOSED ---

describe('fail-closed validation', () => {
  test('refuses a derivative of the wrong shape', () => {
    expect(
      codeOf(() =>
        new DynamicalSystem(
          oscillatorModel({derivative: () => [1]}),
        ).stateAtTick(1),
      ),
    ).toBe('DERIVATIVE_DIMENSION_MISMATCH');
    expect(
      codeOf(() =>
        new DynamicalSystem(
          oscillatorModel({derivative: () => [1, 2, 3]}),
        ).stateAtTick(1),
      ),
    ).toBe('DERIVATIVE_DIMENSION_MISMATCH');
    expect(
      codeOf(() =>
        new DynamicalSystem(
          oscillatorModel({derivative: (() => 5) as any}),
        ).stateAtTick(1),
      ),
    ).toBe('DERIVATIVE_DIMENSION_MISMATCH');
    expect(
      codeOf(() => new DynamicalSystem(decayModel({derivative: 7 as any}))),
    ).toBe('INVALID_DERIVATIVE');
  });

  test('refuses a derivative that is not finite', () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      expect(
        codeOf(() =>
          new DynamicalSystem(
            decayModel({derivative: () => [bad]}),
          ).stateAtTick(1),
        ),
      ).toBe('DERIVATIVE_NOT_FINITE');
    }
  });

  test('refuses a trajectory that diverges to a non-finite state', () => {
    const runaway = decayModel({
      initialState: [1e300],
      derivative: (_time, state) => [state[0] * 1e300],
    });

    expect(codeOf(() => new DynamicalSystem(runaway).stateAtTick(10))).toBe(
      'DERIVATIVE_NOT_FINITE',
    );
  });

  test('refuses an invalid solver step', () => {
    for (const dt of [0, -0.001, NaN, Infinity, -Infinity]) {
      expect(codeOf(() => new DynamicalSystem(decayModel({dt})))).toBe(
        'INVALID_TIMESTEP',
      );
    }
    expect(
      codeOf(() => new DynamicalSystem(decayModel({dt: '0.1' as any}))),
    ).toBe('INVALID_TIMESTEP');
  });

  test('refuses an invalid state', () => {
    for (const bad of [[NaN], [Infinity], [-Infinity], ['1' as any]]) {
      expect(
        codeOf(() => new DynamicalSystem(decayModel({initialState: bad}))),
      ).toBe('INVALID_STATE');
    }
    expect(
      codeOf(() => new DynamicalSystem(decayModel({initialState: []}))),
    ).toBe('INVALID_STATE');
    expect(
      codeOf(() => new DynamicalSystem(decayModel({initialState: 3 as any}))),
    ).toBe('INVALID_STATE');
  });

  test('refuses malformed model identity and parameters', () => {
    expect(codeOf(() => new DynamicalSystem(null as any))).toBe(
      'INVALID_MODEL',
    );
    expect(codeOf(() => new DynamicalSystem(decayModel({id: 'a b'})))).toBe(
      'INVALID_ID',
    );
    expect(codeOf(() => new DynamicalSystem(decayModel({revision: 1.5})))).toBe(
      'INVALID_REVISION',
    );
    expect(
      codeOf(() => new DynamicalSystem(decayModel({parameters: {k: NaN}}))),
    ).toBe('INVALID_PARAMETER');
    const malformed: Record<string, number> = {};
    malformed['bad name'] = 1;
    expect(
      codeOf(() => new DynamicalSystem(decayModel({parameters: malformed}))),
    ).toBe('INVALID_PARAMETER');
  });

  test('refuses an invalid tick or time', () => {
    const system = new DynamicalSystem(decayModel());

    for (const tick of [-1, 1.5, NaN, Infinity, '10' as any]) {
      expect(codeOf(() => system.stateAtTick(tick))).toBe('INVALID_TICK');
    }
    for (const time of [-1, NaN, Infinity, '1' as any]) {
      expect(codeOf(() => system.stateAtTime(time))).toBe('INVALID_TIME');
    }
  });

  test('refuses an off-grid time instead of guessing which tick was meant', () => {
    const system = new DynamicalSystem(decayModel());

    expect(codeOf(() => system.stateAtTime(0.00042))).toBe(
      'TIME_NOT_TICK_ALIGNED',
    );
    // The same request resolves once the caller says what it wants.
    expect(system.stateAtTime(0.00042, 'floor').tick).toBe(0);
    expect(system.stateAtTime(0.00042, 'nearest').tick).toBe(0);
    expect(system.stateAtTime(0.00062, 'nearest').tick).toBe(1);
    expect(system.stateAtTime(0.00062, 'floor').tick).toBe(0);
    // A round second is on the grid even though 1 / 0.001 is not exactly 1000
    // in binary floating point.
    expect(system.stateAtTime(1, 'exact').tick).toBe(1000);
    expect(system.stateAtTime(2.5, 'exact').tick).toBe(2500);
  });

  test('refuses an invalid checkpoint interval', () => {
    expect(
      codeOf(() => new DynamicalSystem(decayModel(), {checkpointInterval: 0})),
    ).toBe('INVALID_CHECKPOINT_INTERVAL');
    expect(
      codeOf(
        () => new DynamicalSystem(decayModel(), {checkpointInterval: 1.5}),
      ),
    ).toBe('INVALID_CHECKPOINT_INTERVAL');
    expect(
      codeOf(() => new DynamicalSystem(decayModel(), {maxCheckpoints: -1})),
    ).toBe('INVALID_CHECKPOINT_INTERVAL');
  });
});

// --- P. ZERO SCHEDULING ---

describe('scheduling ownership', () => {
  test('integrating schedules nothing at all', () => {
    const timeout = vi.spyOn(globalThis, 'setTimeout');
    const interval = vi.spyOn(globalThis, 'setInterval');
    const immediate = vi.spyOn(globalThis, 'queueMicrotask');
    const raf = vi.fn();
    const previousRaf = (globalThis as any).requestAnimationFrame;
    (globalThis as any).requestAnimationFrame = raf;

    try {
      const system = new DynamicalSystem(oscillatorModel(), {
        checkpointInterval: 32,
      });
      system.stateAtTick(2000);
      system.stateAtTick(100);
      system.stateAtTime(1, 'exact');
      system.updateModel(oscillatorModel({revision: 2}));
      system.stateAtTick(500);
      system.diagnostics();

      expect(timeout).not.toHaveBeenCalled();
      expect(interval).not.toHaveBeenCalled();
      expect(immediate).not.toHaveBeenCalled();
      expect(raf).not.toHaveBeenCalled();
    } finally {
      timeout.mockRestore();
      interval.mockRestore();
      immediate.mockRestore();
      (globalThis as any).requestAnimationFrame = previousRaf;
    }
  });

  test('the engine exposes no renderer or scene concept', () => {
    const system = new DynamicalSystem(decayModel());
    const sample = system.stateAtTick(10);

    expect(Object.keys(sample).sort()).toEqual(['state', 'tick', 'time']);
    expect(sample.state.every(value => typeof value === 'number')).toBe(true);
    expect(JSON.parse(JSON.stringify(sample))).toEqual({
      tick: sample.tick,
      time: sample.time,
      state: sample.state,
    });
  });
});
