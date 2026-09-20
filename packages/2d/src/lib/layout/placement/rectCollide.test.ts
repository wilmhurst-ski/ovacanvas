import {describe, expect, it} from 'vitest';
import {forceRectCollide, type RectNodeDatum} from './rectCollide';

function node(
  x: number,
  y: number,
  width: number,
  height: number,
): RectNodeDatum {
  return {x, y, vx: 0, vy: 0, width, height};
}

describe('forceRectCollide', () => {
  it('does nothing when rects do not overlap', () => {
    const a = node(0, 0, 10, 10);
    const b = node(100, 0, 10, 10);
    const force = forceRectCollide<RectNodeDatum>(1);
    force.initialize?.([a, b], Math.random);
    force(1);
    expect(a.vx).toBe(0);
    expect(b.vx).toBe(0);
  });

  it('pushes two overlapping rects apart along the axis of least overlap', () => {
    // Centers 5px apart horizontally (heavy x-overlap), 0px apart vertically
    // (full y-overlap) - the least-overlap axis is x, so velocity change
    // should land on vx, not vy.
    const a = node(0, 0, 20, 20);
    const b = node(5, 0, 20, 20);
    const force = forceRectCollide<RectNodeDatum>(1);
    force.initialize?.([a, b], Math.random);
    force(1);

    expect(a.vx!).toBeLessThan(0);
    expect(b.vx!).toBeGreaterThan(0);
    expect(a.vy).toBe(0);
    expect(b.vy).toBe(0);
  });

  it('gives a larger share of the push to the smaller rect', () => {
    const small = node(0, 0, 10, 10);
    const large = node(5, 0, 40, 40);
    const force = forceRectCollide<RectNodeDatum>(1);
    force.initialize?.([small, large], Math.random);
    force(1);

    expect(Math.abs(small.vx!)).toBeGreaterThan(Math.abs(large.vx!));
  });

  it('strength() scales the push and returns the force for chaining', () => {
    const a1 = node(0, 0, 20, 20);
    const b1 = node(5, 0, 20, 20);
    const weak = forceRectCollide<RectNodeDatum>(0.1);
    weak.initialize?.([a1, b1], Math.random);
    weak(1);

    const a2 = node(0, 0, 20, 20);
    const b2 = node(5, 0, 20, 20);
    const strong = forceRectCollide<RectNodeDatum>(0.1).strength(2);
    strong.initialize?.([a2, b2], Math.random);
    strong(1);

    expect(Math.abs(a2.vx!)).toBeGreaterThan(Math.abs(a1.vx!));
  });
});
