import {describe, expect, it} from 'vitest';
import {unionAreas} from './boolean';
import {partitionVoronoi, triangulateDelaunay} from './delaunay';
import {convexHull} from './hull';
import {IdentifiedPoint2D, Point2D} from './types';

/** A regular polygon, which gives a boolean a predictable vertex budget. */
function ring(cx: number, cy: number, radius: number, sides: number) {
  const points: Point2D[] = [];
  for (let i = 0; i < sides; i++) {
    const angle = (i / sides) * Math.PI * 2;
    points.push({
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * radius,
    });
  }
  points.push(points[0]);
  return points;
}

/** A deterministic scatter, so a timing run is repeatable. */
function scatter(count: number, extent: number): IdentifiedPoint2D[] {
  let seed = 20260906;
  const next = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  const points: IdentifiedPoint2D[] = [];
  for (let i = 0; i < count; i++) {
    points.push({
      id: `p${i.toString().padStart(4, '0')}`,
      x: next() * extent,
      y: next() * extent,
    });
  }
  return points;
}

describe('planar geometry representative performance', () => {
  it('records boolean, triangulation, partition and hull timings', () => {
    const timings: Record<string, number> = {};

    for (const sides of [8, 64, 512]) {
      const a = [[ring(0, 0, 100, sides)]];
      const b = [[ring(60, 40, 100, sides)]];
      const start = performance.now();
      const result = unionAreas(a, b);
      timings[`union_${sides}gon_ms`] = performance.now() - start;
      expect(result).toHaveLength(1);
    }

    const bounds = {minX: 0, minY: 0, maxX: 1000, maxY: 1000};
    for (const count of [50, 500, 2000]) {
      const points = scatter(count, 1000);

      const triangulateStart = performance.now();
      const triangulation = triangulateDelaunay(points);
      timings[`delaunay_${count}pts_ms`] = performance.now() - triangulateStart;
      expect(triangulation.triangles.length).toBeGreaterThan(0);

      const voronoiStart = performance.now();
      const partition = partitionVoronoi(points, bounds);
      timings[`voronoi_${count}pts_ms`] = performance.now() - voronoiStart;
      expect(partition.cells).toHaveLength(count);

      const hullStart = performance.now();
      const hull = convexHull(points);
      timings[`hull_${count}pts_ms`] = performance.now() - hullStart;
      expect(hull.length).toBeGreaterThanOrEqual(4);
    }

    console.info(`CAP03_TIMINGS ${JSON.stringify(timings)}`);
  });
});
