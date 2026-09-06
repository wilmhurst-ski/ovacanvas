import {describe, expect, it} from 'vitest';
import {Line} from '../components/Line';
import {Path} from '../components/Path';
import {mockScene2D} from '../components/__tests__/mockScene2D';
import {differenceAreas} from './boolean';
import {partitionVoronoi} from './delaunay';
import {convexHull} from './hull';
import {Polygon2D, Ring2D} from './types';

/**
 * An SVG path for one canonical polygon, holes included.
 *
 * @remarks
 * Deliberately written here rather than shipped. CAP-03 emits abstract
 * geometry; how a caller spells that for a presentation primitive is a
 * presentation decision, and nothing in the current source needs a shared
 * adapter for it yet.
 */
function pathData(polygon: Polygon2D): string {
  return polygon
    .map(ring => {
      const [first, ...rest] = ring;
      const moves = rest.map(point => `L${point.x} ${point.y}`).join('');
      return `M${first.x} ${first.y}${moves}Z`;
    })
    .join('');
}

function asPoints(ring: Ring2D) {
  return ring.map(point => [point.x, point.y] as [number, number]);
}

describe('geometry renderer consumption', () => {
  mockScene2D();

  it('drives a Path with a boolean result that has a hole', () => {
    const result = differenceAreas(
      [[asBox(0, 0, 30, 30)]],
      [[asBox(10, 10, 20, 20)]],
    );

    expect(result[0]).toHaveLength(2);
    const path = new Path({data: pathData(result[0])});

    expect(path.data()).toBe(
      'M0 0L30 0L30 30L0 30L0 0ZM10 10L10 20L20 20L20 10L10 10Z',
    );
    // The presentation primitive parsed it into real drawable geometry.
    const profile = path.profile();
    expect(profile.segments.length).toBeGreaterThan(0);
    expect(profile.arcLength).toBeGreaterThan(0);
  });

  it('drives Lines with Voronoi cells and keeps each cell on its seed', () => {
    const result = partitionVoronoi(
      [
        {id: 'ne', x: 5, y: 5},
        {id: 'nw', x: -5, y: 5},
        {id: 'se', x: 5, y: -5},
        {id: 'sw', x: -5, y: -5},
      ],
      {minX: -10, minY: -10, maxX: 10, maxY: 10},
    );

    const lines = result.cells.map(
      cell => new Line({points: asPoints(cell.ring), closed: true}),
    );

    result.cells.forEach((cell, index) => {
      expect(
        lines[index].parsedPoints().map(point => ({x: point.x, y: point.y})),
      ).toEqual(cell.ring.map(point => ({x: point.x, y: point.y})));
      expect(lines[index].arcLength()).toBeGreaterThan(0);
    });
    // Identity survived the trip to presentation.
    expect(result.cells.map(cell => cell.id)).toEqual(['ne', 'nw', 'se', 'sw']);
  });

  it('drives a Line with a convex hull', () => {
    const hull = convexHull([
      {x: 5, y: 5},
      {x: 10, y: 10},
      {x: 0, y: 0},
      {x: 0, y: 10},
      {x: 10, y: 0},
    ]);
    const line = new Line({points: asPoints(hull), closed: true});

    expect(
      line.parsedPoints().map(point => ({x: point.x, y: point.y})),
    ).toEqual(hull.map(point => ({x: point.x, y: point.y})));
    expect(line.arcLength()).toBeGreaterThan(0);
  });
});

function asBox(minX: number, minY: number, maxX: number, maxY: number) {
  return [
    {x: minX, y: minY},
    {x: maxX, y: minY},
    {x: maxX, y: maxY},
    {x: minX, y: maxY},
    {x: minX, y: minY},
  ];
}
