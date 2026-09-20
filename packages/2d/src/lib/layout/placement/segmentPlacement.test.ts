import {describe, expect, it} from 'vitest';
import {labelOnSegment, squareOnSegment, type Point} from './segmentPlacement';

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

describe('labelOnSegment', () => {
  it('sits at the segment midpoint, offset perpendicular by the given distance, on the far side from awayFrom', () => {
    const a = {x: 0, y: 0};
    const b = {x: 100, y: 0};
    const awayFrom = {x: 50, y: 100}; // on the +y side - label lands on the -y side, farther from it

    const label = labelOnSegment(a, b, awayFrom, {distance: 24});

    expect(label.x).toBeCloseTo(50);
    expect(label.y).toBeCloseTo(-24);
  });

  it('lands on the opposite side when awayFrom is on the other side', () => {
    const a = {x: 0, y: 0};
    const b = {x: 100, y: 0};
    const awayFrom = {x: 50, y: -100}; // on the -y side - label lands on the +y side

    const label = labelOnSegment(a, b, awayFrom, {distance: 24});

    expect(label.y).toBeCloseTo(24);
  });

  it('never lands ON the segment - stays at real, non-zero clearance', () => {
    const a = {x: 0, y: 0};
    const b = {x: 200, y: 0};
    const awayFrom = {x: 100, y: 500};

    const label = labelOnSegment(a, b, awayFrom, {distance: 30});
    // Distance from the label to the infinite line through a-b is exactly
    // the perpendicular offset, since a-b is horizontal here.
    expect(Math.abs(label.y)).toBeCloseTo(30);
  });

  it('supports a parametric position other than the midpoint', () => {
    const a = {x: 0, y: 0};
    const b = {x: 100, y: 0};
    const awayFrom = {x: 50, y: 100};

    const label = labelOnSegment(a, b, awayFrom, {distance: 10, t: 0.25});
    expect(label.x).toBeCloseTo(25);
  });

  it('works for a diagonal segment, not just axis-aligned ones', () => {
    const a = {x: 0, y: 0};
    const b = {x: 100, y: 100};
    const awayFrom = {x: 200, y: 0}; // to the lower-right of the segment

    const label = labelOnSegment(a, b, awayFrom, {distance: 20});
    const midpoint = {x: 50, y: 50};
    expect(distance(label, midpoint)).toBeCloseTo(20);
    // Should have moved farther from awayFrom than the bare midpoint did.
    expect(distance(label, awayFrom)).toBeGreaterThan(
      distance(midpoint, awayFrom),
    );
  });
});

describe('squareOnSegment', () => {
  it('builds a real square sharing the segment as one full edge', () => {
    const a = {x: 0, y: 0};
    const b = {x: 100, y: 0};
    const awayFrom = {x: 50, y: 100}; // triangle's third vertex is above - square goes below

    const {corners} = squareOnSegment(a, b, awayFrom);

    expect(corners[0]).toEqual(a);
    expect(corners[1]).toEqual(b);
    // Side length matches the segment length exactly - a real square, not
    // an approximation.
    expect(distance(corners[0], corners[1])).toBeCloseTo(100);
    expect(distance(corners[1], corners[2])).toBeCloseTo(100);
    expect(distance(corners[2], corners[3])).toBeCloseTo(100);
    expect(distance(corners[3], corners[0])).toBeCloseTo(100);
  });

  it('extends away from the reference point, never back toward it', () => {
    const a = {x: 0, y: 0};
    const b = {x: 100, y: 0};
    const awayFrom = {x: 50, y: 100};

    const {corners, center} = squareOnSegment(a, b, awayFrom);

    // Every corner, and the square's own center, should be farther from
    // (or at least no closer to) awayFrom than the segment's own midpoint -
    // this is the property that makes crossing back into a triangle's
    // interior structurally impossible.
    const midpoint = {x: 50, y: 0};
    const midDistance = distance(midpoint, awayFrom);
    for (const corner of corners) {
      expect(distance(corner, awayFrom)).toBeGreaterThanOrEqual(midDistance);
    }
    expect(distance(center, awayFrom)).toBeGreaterThan(midDistance);
  });

  it('produces right angles at every corner (a real square, not a rhombus)', () => {
    const a = {x: 10, y: 20};
    const b = {x: 60, y: 55}; // an arbitrary diagonal segment
    const awayFrom = {x: 0, y: 0};

    const {corners} = squareOnSegment(a, b, awayFrom);
    for (let i = 0; i < 4; i++) {
      const prev = corners[(i + 3) % 4];
      const curr = corners[i];
      const next = corners[(i + 1) % 4];
      const v1 = {x: prev.x - curr.x, y: prev.y - curr.y};
      const v2 = {x: next.x - curr.x, y: next.y - curr.y};
      const dot = v1.x * v2.x + v1.y * v2.y;
      expect(dot).toBeCloseTo(0);
    }
  });

  it('flips to the other side when awayFrom flips', () => {
    const a = {x: 0, y: 0};
    const b = {x: 100, y: 0};

    const awayFromPositiveSide = squareOnSegment(a, b, {x: 50, y: 100});
    const awayFromNegativeSide = squareOnSegment(a, b, {x: 50, y: -100});

    expect(awayFromPositiveSide.center.y).toBeLessThan(0);
    expect(awayFromNegativeSide.center.y).toBeGreaterThan(0);
  });
});
