import {describe, expect, it} from 'vitest';
import {
  placeMapLabels,
  type LabelCandidate,
  type RectBBox,
} from '../labels/mapLabelPlacement';

describe('Map-Aware Label Placement', () => {
  it('places non-colliding labels adjacent to anchors without leader lines', () => {
    const labels: LabelCandidate[] = [
      {
        id: 'new-york',
        anchor: [100, 100],
        text: 'New York',
        size: [60, 16],
        priority: 10,
      },
      {
        id: 'london',
        anchor: [500, 200],
        text: 'London',
        size: [50, 16],
        priority: 10,
      },
    ];

    const result = placeMapLabels(labels, [1000, 1000]);

    expect(result.placed).toHaveLength(2);
    expect(result.unplaced).toHaveLength(0);

    const ny = result.placed.find(l => l.id === 'new-york')!;
    const ldn = result.placed.find(l => l.id === 'london')!;

    expect(ny.leader).toBeUndefined(); // Immediate placement
    expect(ldn.leader).toBeUndefined();
  });

  it('displaces colliding labels and introduces a leader line when immediate ring is obstructed', () => {
    // Immediate obstacle covering the radius 12 around anchor [200, 200]
    const obstacles: RectBBox[] = [{x0: 190, y0: 190, x1: 290, y1: 230}];

    const labels: LabelCandidate[] = [
      {
        id: 'displaced',
        anchor: [200, 200],
        text: 'Displaced City',
        size: [80, 20],
        priority: 100,
      },
    ];

    const result = placeMapLabels(labels, [1000, 1000], obstacles);

    expect(result.placed).toHaveLength(1);
    const placed = result.placed[0];
    expect(placed.leader).toBeDefined();
    expect(placed.leader!.start).toEqual([200, 200]);
  });

  it('avoids specified map obstacle bounding boxes', () => {
    // An obstacle covering the immediate right of the anchor [100, 100]
    const obstacles: RectBBox[] = [{x0: 106, y0: 90, x1: 200, y1: 130}];

    const labels: LabelCandidate[] = [
      {
        id: 'test-node',
        anchor: [100, 100],
        text: 'Avoidance Label',
        size: [60, 20],
      },
    ];

    const result = placeMapLabels(labels, [500, 500], obstacles);
    expect(result.placed).toHaveLength(1);

    const placed = result.placed[0];
    // Must not overlap obstacle
    const overlaps = !(
      placed.bounds[2] <= obstacles[0].x0 ||
      placed.bounds[0] >= obstacles[0].x1 ||
      placed.bounds[3] <= obstacles[0].y0 ||
      placed.bounds[1] >= obstacles[0].y1
    );
    expect(overlaps).toBe(false);
  });
});
