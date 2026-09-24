import {describe, expect, it} from 'vitest';
import {
  arrangeWithoutOverlap,
  type PlacementItem,
} from './arrangeWithoutOverlap';

function overlaps(
  a: PlacementItem,
  b: PlacementItem,
  x: number,
  y: number,
  x2: number,
  y2: number,
): boolean {
  const ax0 = x - a.width / 2;
  const ax1 = x + a.width / 2;
  const ay0 = y - a.height / 2;
  const ay1 = y + a.height / 2;
  const bx0 = x2 - b.width / 2;
  const bx1 = x2 + b.width / 2;
  const by0 = y2 - b.height / 2;
  const by1 = y2 + b.height / 2;
  return !(ax1 <= bx0 || ax0 >= bx1 || ay1 <= by0 || ay0 >= by1);
}

describe('arrangeWithoutOverlap', () => {
  it('never moves a pinned item, and pushes the free one clear of it', () => {
    const pinned: PlacementItem = {
      id: 'pin',
      x: 0,
      y: 0,
      width: 40,
      height: 40,
      fixed: true,
    };
    const free: PlacementItem = {
      id: 'free',
      x: 10,
      y: 0,
      width: 40,
      height: 40,
    };
    const [a, b] = arrangeWithoutOverlap([pinned, free]);
    expect(a).toEqual({id: 'pin', x: 0, y: 0});
    expect(overlaps(pinned, free, a.x, a.y, b.x, b.y)).toBe(false);
    expect(b.x).toBeGreaterThan(10);
  });

  it('returns an empty array for no items', () => {
    expect(arrangeWithoutOverlap([])).toEqual([]);
  });

  it('leaves a single item exactly where it wants to be', () => {
    const result = arrangeWithoutOverlap([
      {id: 'a', x: 12, y: -7, width: 40, height: 20},
    ]);
    expect(result).toEqual([{id: 'a', x: 12, y: -7}]);
  });

  it('leaves already-non-overlapping items essentially unmoved', () => {
    const items: PlacementItem[] = [
      {id: 'a', x: -100, y: 0, width: 20, height: 20},
      {id: 'b', x: 100, y: 0, width: 20, height: 20},
    ];
    const result = arrangeWithoutOverlap(items);
    const a = result.find(r => r.id === 'a')!;
    const b = result.find(r => r.id === 'b')!;
    expect(a.x).toBeCloseTo(-100, 0);
    expect(b.x).toBeCloseTo(100, 0);
  });

  it('resolves a real overlap into two non-overlapping rects', () => {
    const items: PlacementItem[] = [
      {id: 'a', x: -5, y: 0, width: 40, height: 40},
      {id: 'b', x: 5, y: 0, width: 40, height: 40},
    ];
    const result = arrangeWithoutOverlap(items);
    const a = result.find(r => r.id === 'a')!;
    const b = result.find(r => r.id === 'b')!;

    expect(overlaps(items[0], items[1], a.x, a.y, b.x, b.y)).toBe(false);
  });

  it('resolves a five-way pile-up with no pair left overlapping', () => {
    const items: PlacementItem[] = Array.from({length: 5}, (_, i) => ({
      id: `n${i}`,
      x: 0,
      y: 0,
      width: 30,
      height: 20,
    }));
    const result = arrangeWithoutOverlap(items);

    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = result[i];
        const b = result[j];
        expect(overlaps(items[i], items[j], a.x, a.y, b.x, b.y)).toBe(false);
      }
    }
  });

  it('every returned position is finite', () => {
    const items: PlacementItem[] = Array.from({length: 8}, (_, i) => ({
      id: `n${i}`,
      x: Math.sin(i) * 5,
      y: Math.cos(i) * 5,
      width: 25,
      height: 25,
    }));
    const result = arrangeWithoutOverlap(items);
    for (const item of result) {
      expect(Number.isFinite(item.x)).toBe(true);
      expect(Number.isFinite(item.y)).toBe(true);
    }
  });
});
