import {DynamicalSystem, SimulationModel} from '@ovacanvas/core';
import {describe, expect, it} from 'vitest';
import {Circle} from '../Circle';
import {Line} from '../Line';
import {mockScene2D} from './mockScene2D';

/**
 * A neutral two-component oscillator.
 *
 * @remarks
 * Nothing about the model knows it will be drawn, and nothing about the
 * drawing knows what the components mean. The proof is only that derived
 * numerical state can drive an existing primitive.
 */
const Oscillator: SimulationModel = {
  id: 'proof-oscillator',
  revision: 1,
  dt: 0.001,
  initialState: [1, 0],
  parameters: {w: 2},
  derivative: (_time, state, parameters) => [
    state[1],
    -parameters.w * parameters.w * state[0],
  ],
};

describe('dynamical state renderer consumption', () => {
  mockScene2D();

  it('drives a node coordinate from simulation state at a given time', () => {
    const system = new DynamicalSystem(Oscillator);
    const sample = system.stateAtTime(0.5, 'exact');

    const node = new Circle({
      position: [sample.state[0] * 100, sample.state[1] * 100],
      size: 20,
    });

    expect(sample.tick).toBe(500);
    expect(node.position().x).toBe(sample.state[0] * 100);
    expect(node.position().y).toBe(sample.state[1] * 100);
  });

  it('drives a polyline from a sampled trajectory', () => {
    const system = new DynamicalSystem(Oscillator);
    const samples = [0, 200, 400, 600, 800, 1000].map(tick =>
      system.stateAtTick(tick),
    );

    const line = new Line({
      points: samples.map(sample => [sample.time * 200, sample.state[0] * 100]),
    });

    expect(
      line.parsedPoints().map(point => ({x: point.x, y: point.y})),
    ).toEqual(
      samples.map(sample => ({
        x: sample.time * 200,
        y: sample.state[0] * 100,
      })),
    );
    expect(line.arcLength()).toBeGreaterThan(0);

    // Seeking to build the presentation did not disturb the model.
    expect(system.modelRevision).toBe(1);
    expect(system.diagnostics().invalidations).toBe(0);
  });
});
