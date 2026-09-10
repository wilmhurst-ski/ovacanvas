import {describe, expect, it} from 'vitest';
import {Line} from '../components/Line';
import {Node} from '../components/Node';
import {Path} from '../components/Path';
import {mockScene2D} from '../components/__tests__/mockScene2D';
import {projectPlate} from './project';
import type {GeoFeature, GeoPoint, ProjectedPart} from './types';

function point(longitude: number, latitude: number): GeoPoint {
  return {longitude, latitude};
}

function box(
  id: string,
  west: number,
  east: number,
  south: number,
  north: number,
): GeoFeature {
  return {
    id,
    parts: [
      {
        index: 0,
        closed: true,
        rings: [
          {
            role: 'exterior',
            points: [
              point(west, south),
              point(east, south),
              point(east, north),
              point(west, north),
            ],
          },
        ],
      },
    ],
  };
}

/**
 * An SVG path for one projected part, holes included.
 *
 * @remarks
 * Written here rather than shipped, for the same reason the planar geometry
 * module writes its own: this module emits projected geometry, and how a
 * caller spells that for a presentation primitive is a presentation decision.
 */
function pathData(part: ProjectedPart): string {
  return part.rings
    .map(ring => {
      const [first, ...rest] = ring.points;
      const moves = rest.map(p => `L${p.x} ${p.y}`).join('');
      return `M${first.x} ${first.y}${moves}${ring.closed ? 'Z' : ''}`;
    })
    .join('');
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    projection: 'EQUIRECTANGULAR',
    extent: {kind: 'WHOLE_WORLD'},
    viewport: {width: 360, height: 180, padding: 0},
    features: [],
    routes: [],
    points: [],
    routeSamples: 33,
    ...overrides,
  };
}

describe('geography renderer consumption', () => {
  mockScene2D();

  it('drives a Path with a projected boundary that has a hole', () => {
    const plate = projectPlate(
      request({
        features: [
          {
            id: 'holed',
            parts: [
              {
                index: 0,
                closed: true,
                rings: [
                  box('outer', -20, 20, -20, 20).parts[0].rings[0],
                  {
                    role: 'hole',
                    points: [
                      point(-5, -5),
                      point(5, -5),
                      point(5, 5),
                      point(-5, 5),
                    ],
                  },
                ],
              },
            ],
          },
        ],
      }),
    );

    const part = plate.features[0];
    expect(part.rings).toHaveLength(2);
    const path = new Path({data: pathData(part)});

    // The presentation primitive parsed it into real drawable geometry.
    const profile = path.profile();
    expect(profile.segments.length).toBeGreaterThan(0);
    expect(profile.arcLength).toBeGreaterThan(0);
    // Two subpaths, so the hole is a hole rather than a second outline.
    expect(path.data()).toContain('Z');
    expect(path.data().match(/M/g)).toHaveLength(2);
  });

  it('drives a Line with a sampled great-circle route', () => {
    const plate = projectPlate(
      request({
        routes: [
          {
            id: 'transatlantic',
            kind: 'GREAT_CIRCLE',
            waypoints: [point(-0.1278, 51.5074), point(-74.006, 40.7128)],
          },
        ],
      }),
    );

    const route = plate.routes[0];
    const line = new Line({
      points: route.rings[0].points.map(p => [p.x, p.y] as [number, number]),
      lineWidth: 2,
      stroke: '#888888',
    });

    expect(line.parsedPoints()).toHaveLength(33);
    const profile = line.profile();
    expect(profile.arcLength).toBeGreaterThan(0);
    // The drawn path is longer than the straight chord, which is what a
    // great circle looks like once projected.
    const first = route.rings[0].points[0];
    const last = route.rings[0].points.at(-1)!;
    const chord = Math.hypot(last.x - first.x, last.y - first.y);
    expect(profile.arcLength).toBeGreaterThan(chord);
  });

  it('composes a whole plate into one addressable node group', () => {
    const plate = projectPlate(
      request({
        features: [
          box('west', -40, -10, 10, 40),
          box('east', 10, 40, 10, 40),
          box('straddler', 170, -170, -10, 10),
        ],
        routes: [
          {
            id: 'link',
            kind: 'GREAT_CIRCLE',
            waypoints: [point(-25, 25), point(25, 25)],
          },
        ],
        points: [{id: 'capital', ...point(0, 25)}],
      }),
    );

    // One group per plate, and every drawn thing still names what it realizes.
    const group = new Node({});
    const drawn: Path[] = [];
    for (const part of [...plate.features, ...plate.routes]) {
      const path = new Path({
        data: pathData(part),
        // The key is how a host would later rebind a semantic target to
        // whichever node currently realizes it.
        key: `${part.sourceId}-${part.partIndex}-${part.sliceIndex}`,
      });
      drawn.push(path);
      group.add(path);
    }

    // Three features, one of which the seam split in two, plus one route.
    expect(plate.features).toHaveLength(4);
    expect(group.children()).toHaveLength(5);
    for (const path of drawn) {
      expect(path.profile().arcLength).toBeGreaterThan(0);
    }

    // The marker projects into the plate, where a host would place a shape.
    expect(plate.markers[0].inside).toBe(true);
    expect(plate.markers[0].position.x).toBeCloseTo(180, 6);
  });

  it('keeps a seam-split feature drawable as two separate paths', () => {
    const plate = projectPlate(
      request({features: [box('straddler', 170, -170, 0, 20)]}),
    );
    const slices = plate.features;
    expect(slices).toHaveLength(2);

    for (const slice of slices) {
      const path = new Path({data: pathData(slice)});
      const profile = path.profile();
      expect(profile.arcLength).toBeGreaterThan(0);
      // Neither piece is a stripe across the plate.
      const xs = slice.rings[0].points.map(p => p.x);
      expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(180);
    }
  });
});
