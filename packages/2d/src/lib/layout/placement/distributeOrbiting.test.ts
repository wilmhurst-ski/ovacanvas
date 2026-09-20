import {describe, expect, it} from 'vitest';
import {distributeOrbiting} from './distributeOrbiting';

function distance(
  a: {x: number; y: number},
  b: {x: number; y: number},
): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

describe('distributeOrbiting', () => {
  it('returns nothing for a count of zero or less', () => {
    expect(distributeOrbiting(0)).toEqual([]);
    expect(distributeOrbiting(-3)).toEqual([]);
  });

  it('places a single item at the start angle, at the given radius from center', () => {
    const [placement] = distributeOrbiting(1, {
      center: {x: 10, y: 20},
      radius: 50,
      startAngleDegrees: 0,
    });
    expect(placement.x).toBeCloseTo(60);
    expect(placement.y).toBeCloseTo(20);
    expect(placement.angleDegrees).toBe(0);
  });

  it('spaces every item evenly around the center, all at the same radius', () => {
    const center = {x: 0, y: 0};
    const radius = 100;
    const placements = distributeOrbiting(6, {center, radius});

    expect(placements).toHaveLength(6);
    for (const placement of placements) {
      expect(distance(placement, center)).toBeCloseTo(radius);
    }

    // Consecutive angles are 60 degrees apart, wrapping around exactly once.
    const angles = placements.map(p => p.angleDegrees).sort((a, b) => a - b);
    for (let i = 1; i < angles.length; i++) {
      expect(angles[i] - angles[i - 1]).toBeCloseTo(60);
    }
  });

  it('every pair of items is equidistant from its neighbors on the ring', () => {
    const placements = distributeOrbiting(5, {radius: 80});
    const distances = placements.map((p, i) =>
      distance(p, placements[(i + 1) % placements.length]),
    );
    for (const d of distances) {
      expect(d).toBeCloseTo(distances[0]);
    }
  });

  it('defaults to centered at the origin with the first item straight up', () => {
    const [placement] = distributeOrbiting(4);
    expect(placement.x).toBeCloseTo(0);
    expect(placement.y).toBeCloseTo(-160);
  });
});
