import {describe, expect, it} from 'vitest';
import {WORLD_LAND} from '../public/worldData';

describe('WORLD_LAND', () => {
  it('is real land geometry, not a placeholder', () => {
    expect(WORLD_LAND.id).toBe('world-land-110m');
    const geometry = WORLD_LAND.geometry as {
      type: string;
      features?: unknown[];
    };
    expect(geometry.type).toBe('FeatureCollection');
    expect(geometry.features?.length).toBeGreaterThan(0);
  });
});
