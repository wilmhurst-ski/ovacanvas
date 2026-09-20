import {describe, expect, it} from 'vitest';
import {canonicalizeRing} from './canonical';
import {inscribedRing, iterateInscribedRings} from './selfSimilar';
import {GeometryError, Point2D} from './types';

function points(...pairs: [number, number][]): Point2D[] {
  return pairs.map(([x, y]) => ({x, y}));
}

function codeOf(run: () => unknown): string {
  try {
    run();
  } catch (error: any) {
    expect(error).toBeInstanceOf(GeometryError);
    return error.code;
  }
  throw new Error('expected the operation to be refused');
}

const Square = points([0, 0], [10, 0], [10, 10], [0, 10]);
const Triangle = points([0, 0], [10, 0], [5, 8.660254]); // equilateral-ish

describe('inscribedRing', () => {
  it('connecting midpoints of a square gives a square of exactly half the area', () => {
    const inscribed = inscribedRing(Square, 0.5);
    // The classic fact this whole construction is built on: the
    // midpoint-connected square is a real, verifiable 1/2-area case,
    // independent of anything about this codebase.
    const area = shoelaceArea(inscribed);
    const original = shoelaceArea(canonicalizeRing(Square, false, 'square'));
    expect(area / original).toBeCloseTo(0.5, 6);
  });

  it('refuses a cut fraction outside (0, 1)', () => {
    expect(codeOf(() => inscribedRing(Square, 0))).toBe('INVALID_RATIO');
    expect(codeOf(() => inscribedRing(Square, 1))).toBe('INVALID_RATIO');
    expect(codeOf(() => inscribedRing(Square, 1.5))).toBe('INVALID_RATIO');
    expect(codeOf(() => inscribedRing(Square, NaN))).toBe('INVALID_RATIO');
  });

  it('refuses malformed ring input the same way the rest of the geometry kernel does', () => {
    expect(codeOf(() => inscribedRing(points([0, 0], [1, 1]), 0.5))).toBe(
      'INVALID_RING',
    );
  });
});

describe('iterateInscribedRings', () => {
  it('matches the well-known triangle case: medial triangle is exactly 1/4 the area', () => {
    const sequence = iterateInscribedRings(Triangle, 0.5, 1);
    expect(sequence.ratio).toBeCloseTo(0.25, 4);
  });

  it('matches the well-known square case: midpoint square is exactly 1/2 the area', () => {
    const sequence = iterateInscribedRings(Square, 0.5, 1);
    expect(sequence.ratio).toBeCloseTo(0.5, 6);
  });

  it('the ratio stays constant across further iterations of a regular polygon', () => {
    const sequence = iterateInscribedRings(Square, 0.5, 4);
    expect(sequence.steps).toHaveLength(5);
    for (let i = 1; i < sequence.steps.length; i++) {
      const stepRatio = sequence.steps[i].area / sequence.steps[i - 1].area;
      expect(stepRatio).toBeCloseTo(sequence.ratio, 6);
    }
  });

  it('each step is smaller than the last and iteration numbers are sequential', () => {
    const sequence = iterateInscribedRings(Square, 0.3, 3);
    expect(sequence.steps.map(step => step.iteration)).toEqual([0, 1, 2, 3]);
    for (let i = 1; i < sequence.steps.length; i++) {
      expect(sequence.steps[i].area).toBeLessThan(sequence.steps[i - 1].area);
    }
  });

  it('refuses a non-positive or non-integer iteration count', () => {
    expect(codeOf(() => iterateInscribedRings(Square, 0.5, 0))).toBe(
      'INVALID_ITERATION_COUNT',
    );
    expect(codeOf(() => iterateInscribedRings(Square, 0.5, -1))).toBe(
      'INVALID_ITERATION_COUNT',
    );
    expect(codeOf(() => iterateInscribedRings(Square, 0.5, 1.5))).toBe(
      'INVALID_ITERATION_COUNT',
    );
  });
});

/** Local, independent area calculation - deliberately not reusing
 * `signedDoubleArea` internally, so these tests aren't just checking the
 * implementation against itself. */
function shoelaceArea(ring: readonly Point2D[]): number {
  const open =
    ring[0].x === ring[ring.length - 1].x &&
    ring[0].y === ring[ring.length - 1].y
      ? ring.slice(0, -1)
      : ring;
  let total = 0;
  for (let i = 0; i < open.length; i++) {
    const a = open[i];
    const b = open[(i + 1) % open.length];
    total += a.x * b.y - b.x * a.y;
  }
  return Math.abs(total) / 2;
}
