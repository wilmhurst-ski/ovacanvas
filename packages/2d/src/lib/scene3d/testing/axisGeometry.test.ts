import {describe, expect, it} from 'vitest';
import {buildAxisGeometry3D} from '../geometry/axisGeometry';
import {canonicalizeLines} from '../geometry/canonicalize';
import {Scene3DError} from '../public/errors';

function codeOf(run: () => unknown): string {
  try {
    run();
  } catch (error: any) {
    expect(error).toBeInstanceOf(Scene3DError);
    return error.code;
  }
  throw new Error('expected the operation to be refused');
}

describe('buildAxisGeometry3D', () => {
  it('places one tick per integer step and none for the other axes', () => {
    const result = buildAxisGeometry3D([
      {axis: 'x', range: [-2, 2], tickStep: 1},
    ]);
    expect(result.ticks.x.map(tick => tick.value)).toEqual([-2, -1, 0, 1, 2]);
    expect(result.ticks.y).toHaveLength(0);
    expect(result.ticks.z).toHaveLength(0);

    // Every tick sits exactly on the x-axis, at its own value.
    for (const tick of result.ticks.x) {
      expect(tick.position).toEqual([tick.value, 0, 0]);
    }
  });

  it('produces geometry the real canonicalizer accepts without complaint', () => {
    const result = buildAxisGeometry3D([
      {axis: 'x', range: [-3, 3], tickStep: 1},
      {axis: 'y', range: [0, 5], tickStep: 0.5},
      {axis: 'z', range: [-1, 1], tickStep: 1},
    ]);
    const canonical = canonicalizeLines(result.geometry);
    expect(canonical.topology).toBe('segments');
    expect(canonical.vertexCount).toBeGreaterThan(0);
  });

  it('handles a tick step that does not evenly divide the range', () => {
    const result = buildAxisGeometry3D([
      {axis: 'y', range: [0, 1], tickStep: 0.3},
    ]);
    // 0, 0.3, 0.6, 0.9 fit; 1.2 would not.
    expect(result.ticks.y.map(tick => Number(tick.value.toFixed(2)))).toEqual([
      0, 0.3, 0.6, 0.9,
    ]);
  });

  it('refuses a non-increasing axis range', () => {
    expect(
      codeOf(() =>
        buildAxisGeometry3D([{axis: 'x', range: [2, -2], tickStep: 1}]),
      ),
    ).toBe('INVALID_DOMAIN_RANGE');
    expect(
      codeOf(() =>
        buildAxisGeometry3D([{axis: 'x', range: [1, 1], tickStep: 1}]),
      ),
    ).toBe('INVALID_DOMAIN_RANGE');
  });

  it('refuses a non-positive tick step', () => {
    expect(
      codeOf(() =>
        buildAxisGeometry3D([{axis: 'x', range: [-1, 1], tickStep: 0}]),
      ),
    ).toBe('INVALID_DOMAIN_RANGE');
    expect(
      codeOf(() =>
        buildAxisGeometry3D([{axis: 'x', range: [-1, 1], tickStep: -0.5}]),
      ),
    ).toBe('INVALID_DOMAIN_RANGE');
  });

  it('returns empty geometry-but-valid-shape for no axes requested', () => {
    const result = buildAxisGeometry3D([]);
    expect(result.geometry.positions).toEqual([]);
    expect(result.ticks).toEqual({x: [], y: [], z: []});
  });
});
