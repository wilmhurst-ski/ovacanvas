import {describe, expect, test} from 'vitest';
import {canonicalizeRequest} from './canonical';
import {projectPlate} from './project';
import {
  admittedLatitudeSpan,
  latitudeFromPlane,
  projectToPlane,
} from './projection';
import {angularDistance, greatCircleMidpoint, sampleGreatCircle} from './route';
import {enclosesPole, shortestLongitudeDelta, unwrap} from './seams';
import type {
  GeoFeature,
  GeoPoint,
  GeoRoute,
  IdentifiedGeoPoint,
  ProjectionKind,
} from './types';
import {GeographyError, WebMercatorLatitudeLimit} from './types';

const RadiansPerDegree = Math.PI / 180;

/** A viewport whose degrees map to whole pixels, so anchors can be read. */
const WorldViewport = {width: 360, height: 180, padding: 0};

function point(longitude: number, latitude: number): GeoPoint {
  return {longitude, latitude};
}

/** A closed box, counter-clockwise, as an atlas would supply one. */
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

function request(overrides: Record<string, unknown> = {}) {
  return {
    projection: 'EQUIRECTANGULAR' as ProjectionKind,
    extent: {kind: 'WHOLE_WORLD'},
    viewport: WorldViewport,
    features: [],
    routes: [],
    points: [],
    routeSamples: 33,
    ...overrides,
  };
}

function throwsWith(code: string, run: () => unknown) {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(GeographyError);
    expect((error as GeographyError).code).toBe(code);
    return;
  }
  throw new Error(`expected a GeographyError with code ${code}`);
}

// --- 1. EQUIRECTANGULAR ANCHORS ---

describe('equirectangular projection', () => {
  test('known anchors land where they can be checked by hand', () => {
    const plate = projectPlate(
      request({
        points: [
          {id: 'origin', ...point(0, 0)},
          {id: 'northwest', ...point(-180, 90)},
          {id: 'southeast', ...point(180, -90)},
          {id: 'greenwich-north', ...point(0, 90)},
        ] satisfies IdentifiedGeoPoint[],
      }),
    );
    const at = (id: string) =>
      plate.markers.find(marker => marker.id === id)!.position;

    // A 360x180 viewport makes one degree one pixel, so the numbers are the
    // coordinates themselves.
    expect(at('origin')).toEqual({x: 180, y: 90});
    expect(at('northwest')).toEqual({x: 0, y: 0});
    expect(at('southeast')).toEqual({x: 360, y: 180});
    expect(at('greenwich-north')).toEqual({x: 180, y: 0});
  });

  test('the plane is linear in both axes', () => {
    expect(projectToPlane(point(0, 0), 'EQUIRECTANGULAR')).toEqual({
      u: 0,
      v: 0,
    });
    expect(projectToPlane(point(45, -45), 'EQUIRECTANGULAR')).toEqual({
      u: 45,
      v: -45,
    });
    expect(admittedLatitudeSpan('EQUIRECTANGULAR')).toEqual({
      south: -90,
      north: 90,
    });
  });
});

// --- 2. WEB MERCATOR EQUATOR AND LIMIT ---

describe('web mercator projection', () => {
  test('the equator is the origin and the limit squares the world', () => {
    expect(projectToPlane(point(0, 0), 'WEB_MERCATOR')).toEqual({u: 0, v: 0});

    // At the standard limit `ln(tan(pi/4 + phi/2))` is exactly pi radians,
    // which in degree-equivalent units is 180 - so the plate is square.
    const north = projectToPlane(
      point(0, WebMercatorLatitudeLimit),
      'WEB_MERCATOR',
    );
    expect(north.v).toBeCloseTo(180, 9);
    const south = projectToPlane(
      point(0, -WebMercatorLatitudeLimit),
      'WEB_MERCATOR',
    );
    expect(south.v).toBeCloseTo(-180, 9);
  });

  test('a mid latitude round-trips through the plane', () => {
    for (const latitude of [-70, -33.5, -1, 0, 12.25, 51.5, 80]) {
      const {v} = projectToPlane(point(0, latitude), 'WEB_MERCATOR');
      expect(latitudeFromPlane(v, 'WEB_MERCATOR')).toBeCloseTo(latitude, 9);
    }
  });

  test('latitude beyond the limit fails closed rather than clamping', () => {
    throwsWith('LATITUDE_UNPROJECTABLE', () =>
      canonicalizeRequest(
        request({
          projection: 'WEB_MERCATOR',
          points: [{id: 'pole', ...point(0, 89.9)}],
        }),
      ),
    );
    // And the pole itself, which Mercator sends to infinity.
    throwsWith('LATITUDE_UNPROJECTABLE', () =>
      projectToPlane(point(0, 90), 'WEB_MERCATOR'),
    );
  });

  test('the admitted span stops short of the poles', () => {
    const span = admittedLatitudeSpan('WEB_MERCATOR');
    expect(span.north).toBeCloseTo(WebMercatorLatitudeLimit, 12);
    expect(span.south).toBeCloseTo(-WebMercatorLatitudeLimit, 12);
  });
});

// --- 3. CLOSED REJECTION OF MALFORMED INPUT ---

describe('validation', () => {
  test('non-finite and out-of-range coordinates are refused', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, '0', null]) {
      throwsWith('NON_FINITE_COORDINATE', () =>
        canonicalizeRequest(
          request({points: [{id: 'p', longitude: bad, latitude: 0}]}),
        ),
      );
    }
    throwsWith('LONGITUDE_OUT_OF_RANGE', () =>
      canonicalizeRequest(request({points: [{id: 'p', ...point(181, 0)}]})),
    );
    // A transposed pair: finite, and still impossible as a latitude.
    throwsWith('LATITUDE_OUT_OF_RANGE', () =>
      canonicalizeRequest(request({points: [{id: 'p', ...point(0, 120)}]})),
    );
  });

  test('duplicate identities are refused', () => {
    throwsWith('DUPLICATE_ID', () =>
      canonicalizeRequest(
        request({features: [box('a', 0, 10, 0, 10), box('a', 20, 30, 0, 10)]}),
      ),
    );
    // A feature and a route may share a name; two features may not.
    expect(() =>
      canonicalizeRequest(
        request({
          features: [box('shared', 0, 10, 0, 10)],
          routes: [
            {
              id: 'shared',
              kind: 'DECLARED_POLYLINE',
              waypoints: [point(0, 0), point(1, 1)],
            } satisfies GeoRoute,
          ],
        }),
      ),
    ).not.toThrow();
  });

  test('malformed rings and parts are refused', () => {
    throwsWith('DEGENERATE_RING', () =>
      canonicalizeRequest(
        request({
          features: [
            {
              id: 'f',
              parts: [
                {
                  index: 0,
                  closed: true,
                  rings: [
                    {role: 'exterior', points: [point(0, 0), point(1, 1)]},
                  ],
                },
              ],
            },
          ],
        }),
      ),
    );
    // Two exterior rings in one part: which one bounds the area?
    throwsWith('INVALID_PART', () =>
      canonicalizeRequest(
        request({
          features: [
            {
              id: 'f',
              parts: [
                {
                  index: 0,
                  closed: true,
                  rings: [
                    box('x', 0, 5, 0, 5).parts[0].rings[0],
                    box('y', 6, 9, 0, 5).parts[0].rings[0],
                  ],
                },
              ],
            },
          ],
        }),
      ),
    );
  });

  test('an unknown projection is refused', () => {
    throwsWith('UNKNOWN_PROJECTION', () =>
      canonicalizeRequest(request({projection: 'ORTHOGRAPHIC'})),
    );
  });

  test('a sampled route may not carry supplied geometry', () => {
    // A pre-sampled great circle would compete with its own endpoints for
    // authority over where the route goes.
    throwsWith('INVALID_ROUTE', () =>
      canonicalizeRequest(
        request({
          routes: [
            {
              id: 'r',
              kind: 'GREAT_CIRCLE',
              waypoints: [point(0, 0), point(10, 10), point(20, 20)],
            },
          ],
        }),
      ),
    );
    throwsWith('INVALID_ROUTE', () =>
      canonicalizeRequest(
        request({
          routes: [
            {id: 'r', kind: 'DECLARED_POLYLINE', waypoints: [point(0, 0)]},
          ],
        }),
      ),
    );
  });

  test('bounds must declare a seam crossing rather than imply one', () => {
    throwsWith('INVALID_BOUNDS', () =>
      canonicalizeRequest(
        request({
          extent: {
            kind: 'BOUNDS',
            bounds: {west: 170, east: -170, south: 0, north: 10},
          },
        }),
      ),
    );
    // Declared, and therefore accepted.
    expect(() =>
      canonicalizeRequest(
        request({
          extent: {
            kind: 'BOUNDS',
            bounds: {
              west: 170,
              east: -170,
              south: 0,
              north: 10,
              crossesAntimeridian: true,
            },
          },
        }),
      ),
    ).not.toThrow();
  });

  test('a fit must name something, and something present', () => {
    throwsWith('EMPTY_FIT_TARGET', () =>
      canonicalizeRequest(
        request({extent: {kind: 'FIT', featureIds: [], points: []}}),
      ),
    );
    throwsWith('UNKNOWN_FIT_FEATURE', () =>
      canonicalizeRequest(
        request({
          extent: {kind: 'FIT', featureIds: ['absent'], points: []},
          features: [box('present', 0, 5, 0, 5)],
        }),
      ),
    );
  });

  test('a viewport with no drawable area is refused', () => {
    throwsWith('INVALID_VIEWPORT', () =>
      canonicalizeRequest(
        request({viewport: {width: 100, height: 100, padding: 50}}),
      ),
    );
  });

  test('the route sample count is bounded and integral', () => {
    for (const bad of [1, 0, -3, 2.5, 100000]) {
      throwsWith('INVALID_SAMPLE_COUNT', () =>
        canonicalizeRequest(request({routeSamples: bad})),
      );
    }
  });
});

// --- 4. DETERMINISM UNDER NON-SEMANTIC REORDERING ---

describe('canonical determinism', () => {
  test('reordering features and holes does not change the output', () => {
    const holeA = {
      role: 'hole' as const,
      points: [point(2, 2), point(3, 2), point(3, 3), point(2, 3)],
    };
    const holeB = {
      role: 'hole' as const,
      points: [point(6, 6), point(7, 6), point(7, 7), point(6, 7)],
    };
    const withHoles = (holes: readonly (typeof holeA)[]): GeoFeature => ({
      id: 'holed',
      parts: [
        {
          index: 0,
          closed: true,
          rings: [box('outer', 0, 10, 0, 10).parts[0].rings[0], ...holes],
        },
      ],
    });

    const first = projectPlate(
      request({
        features: [withHoles([holeA, holeB]), box('other', 20, 30, 0, 10)],
      }),
    );
    const second = projectPlate(
      request({
        features: [box('other', 20, 30, 0, 10), withHoles([holeB, holeA])],
      }),
    );

    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  test('projecting the same plate twice is byte-identical', () => {
    const input = request({
      features: [box('a', -20, 20, -10, 10)],
      routes: [
        {
          id: 'r',
          kind: 'GREAT_CIRCLE',
          waypoints: [point(-60, 20), point(60, 40)],
        },
      ],
      points: [{id: 'm', ...point(5, 5)}],
    });
    expect(JSON.stringify(projectPlate(input))).toBe(
      JSON.stringify(projectPlate(input)),
    );
  });
});

// --- 5 / 6. ANTIMERIDIAN ---

describe('antimeridian', () => {
  test('the shortest step across the seam is the short way round', () => {
    expect(shortestLongitudeDelta(170, -170)).toBe(20);
    expect(shortestLongitudeDelta(-170, 170)).toBe(-20);
    expect(shortestLongitudeDelta(0, 90)).toBe(90);
  });

  test('unwrapping makes a seam-crossing sequence continuous', () => {
    const unwrapped = unwrap([point(170, 0), point(-170, 0), point(-150, 0)]);
    expect(unwrapped.map(vertex => vertex.u)).toEqual([170, 190, 210]);
  });

  test('a line crossing the seam is split, not drawn across the plate', () => {
    const plate = projectPlate(
      request({
        routes: [
          {
            id: 'crossing',
            kind: 'DECLARED_POLYLINE',
            waypoints: [point(170, 10), point(-170, 10)],
          },
        ],
      }),
    );
    const slices = plate.routes.filter(part => part.sourceId === 'crossing');
    expect(slices).toHaveLength(2);
    // Each piece ends on a seam edge of the plate.
    const xs = slices.flatMap(slice => slice.rings[0].points.map(p => p.x));
    expect(Math.min(...xs)).toBeCloseTo(0, 6);
    expect(Math.max(...xs)).toBeCloseTo(360, 6);
    // The introduced seam vertices are marked as introduced.
    expect(
      slices.some(slice => slice.rings[0].sourceIndices.includes(-1)),
    ).toBe(true);
  });

  test('a polygon crossing the seam becomes two slices of one feature', () => {
    const plate = projectPlate(
      request({features: [box('straddler', 170, -170, 0, 10)]}),
    );
    const slices = plate.features.filter(part => part.sourceId === 'straddler');
    expect(slices).toHaveLength(2);
    // Both slices belong to the same part of the same feature.
    expect(new Set(slices.map(slice => slice.partIndex))).toEqual(new Set([0]));
    expect(slices.map(slice => slice.sliceIndex).sort()).toEqual([0, 1]);
    // Each slice stays on its own side of the plate.
    for (const slice of slices) {
      const xs = slice.rings[0].points.map(p => p.x);
      const width = Math.max(...xs) - Math.min(...xs);
      expect(width).toBeLessThan(WorldViewport.width / 2);
    }
  });

  test('no projected ring spans the plate spuriously', () => {
    const plate = projectPlate(
      request({
        features: [
          box('straddler', 170, -170, 0, 10),
          box('ordinary', -10, 10, -10, 10),
        ],
        routes: [
          {
            id: 'crossing',
            kind: 'GREAT_CIRCLE',
            waypoints: [point(140, 35), point(-120, 34)],
          },
        ],
      }),
    );
    const parts = [...plate.features, ...plate.routes];
    expect(parts.length).toBeGreaterThan(0);
    for (const part of parts) {
      for (const ring of part.rings) {
        for (let index = 1; index < ring.points.length; index++) {
          const jump = Math.abs(
            ring.points[index].x - ring.points[index - 1].x,
          );
          // A single step may never leap most of the way across the plate.
          expect(jump).toBeLessThan(WorldViewport.width / 2);
        }
      }
    }
  });

  test('a pole-enclosing ring is reported, not approximated', () => {
    // One circuit of a parallel, closing the long way round: the polar cap.
    // Going out along one parallel and back along another would enclose
    // nothing, because the longitude steps would cancel.
    const points: GeoPoint[] = [];
    for (let longitude = -180; longitude < 180; longitude += 30) {
      points.push(point(longitude, -60));
    }
    expect(enclosesPole(points)).toBe(true);

    const plate = projectPlate(
      request({
        features: [
          {
            id: 'polar',
            parts: [
              {index: 0, closed: true, rings: [{role: 'exterior', points}]},
            ],
          },
        ],
      }),
    );
    expect(plate.features).toHaveLength(0);
    expect(plate.unsupported).toEqual([
      {sourceId: 'polar', partIndex: 0, reason: 'POLAR_RING_UNSUPPORTED'},
    ]);
  });
});

// --- 7 / 8. HOLES AND MULTIPOLYGONS ---

describe('feature structure', () => {
  test('a hole survives projection as a hole', () => {
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
    expect(part.rings[0].role).toBe('exterior');
    expect(part.rings[1].role).toBe('hole');
    // The hole is inside the exterior, which is what makes it a hole.
    const outerXs = part.rings[0].points.map(p => p.x);
    const holeXs = part.rings[1].points.map(p => p.x);
    expect(Math.min(...holeXs)).toBeGreaterThan(Math.min(...outerXs));
    expect(Math.max(...holeXs)).toBeLessThan(Math.max(...outerXs));
  });

  test('multipolygon parts stay attached to their feature', () => {
    const plate = projectPlate(
      request({
        features: [
          {
            id: 'archipelago',
            parts: [
              box('i1', -30, -20, 0, 10).parts[0],
              {...box('i2', 20, 30, 0, 10).parts[0], index: 1},
              {...box('i3', 60, 70, 0, 10).parts[0], index: 2},
            ],
          },
        ],
      }),
    );
    expect(plate.features).toHaveLength(3);
    for (const part of plate.features) {
      expect(part.sourceId).toBe('archipelago');
    }
    expect(plate.features.map(part => part.partIndex).sort()).toEqual([
      0, 1, 2,
    ]);
  });
});

// --- 9. GREAT CIRCLE ACCURACY ---

describe('great circle routes', () => {
  test('endpoints are returned verbatim', () => {
    const from = point(-0.1278, 51.5074);
    const to = point(-74.006, 40.7128);
    const sampled = sampleGreatCircle(from, to, 64, 'r');

    expect(sampled[0]).toEqual(from);
    expect(sampled[sampled.length - 1]).toEqual(to);
    expect(sampled).toHaveLength(64);
  });

  test('the midpoint is equidistant from both endpoints', () => {
    const from = point(-0.1278, 51.5074);
    const to = point(-74.006, 40.7128);
    const middle = greatCircleMidpoint(from, to);

    const total = angularDistance(
      from.latitude * RadiansPerDegree,
      from.longitude * RadiansPerDegree,
      to.latitude * RadiansPerDegree,
      to.longitude * RadiansPerDegree,
    );
    const toMiddle = angularDistance(
      from.latitude * RadiansPerDegree,
      from.longitude * RadiansPerDegree,
      middle.latitude * RadiansPerDegree,
      middle.longitude * RadiansPerDegree,
    );
    expect(toMiddle).toBeCloseTo(total / 2, 12);
  });

  test('known midpoints match hand calculation', () => {
    // Symmetric about the prime meridian on the equator.
    const equatorial = greatCircleMidpoint(point(-80, 0), point(80, 0));
    expect(equatorial.longitude).toBeCloseTo(0, 9);
    expect(equatorial.latitude).toBeCloseTo(0, 9);

    // A great circle along a meridian is that meridian.
    const meridional = greatCircleMidpoint(point(10, 0), point(10, 80));
    expect(meridional.longitude).toBeCloseTo(10, 9);
    expect(meridional.latitude).toBeCloseTo(40, 9);
  });

  test('a great circle is not a projected straight line', () => {
    const from = point(-0.1278, 51.5074);
    const to = point(-74.006, 40.7128);
    const plate = projectPlate(
      request({
        routes: [
          {id: 'great', kind: 'GREAT_CIRCLE', waypoints: [from, to]},
          {id: 'straight', kind: 'PROJECTED_STRAIGHT', waypoints: [from, to]},
        ],
      }),
    );
    const great = plate.routes.find(part => part.sourceId === 'great')!;
    const straight = plate.routes.find(part => part.sourceId === 'straight')!;

    // Identical endpoints...
    expect(great.rings[0].points[0]).toEqual(straight.rings[0].points[0]);
    expect(great.rings[0].points.at(-1)).toEqual(
      straight.rings[0].points.at(-1),
    );
    // ...and a visibly different path between them.
    const straightMid = {
      x: (straight.rings[0].points[0].x + straight.rings[0].points[1].x) / 2,
      y: (straight.rings[0].points[0].y + straight.rings[0].points[1].y) / 2,
    };
    const greatPoints = great.rings[0].points;
    const greatMid = greatPoints[Math.floor(greatPoints.length / 2)];
    expect(Math.abs(greatMid.y - straightMid.y)).toBeGreaterThan(1);
  });

  test('degenerate and antipodal routes are refused', () => {
    throwsWith('INVALID_ROUTE', () =>
      sampleGreatCircle(point(10, 10), point(10, 10), 16, 'same'),
    );
    throwsWith('INVALID_ROUTE', () =>
      sampleGreatCircle(point(0, 0), point(180, 0), 16, 'antipodal'),
    );
  });
});

// --- 11. FITTING ---

describe('fitting', () => {
  test('a fit keeps its target inside the safe area', () => {
    const viewport = {width: 800, height: 600, padding: 40};
    const plate = projectPlate(
      request({
        viewport,
        features: [box('target', 4, 18, 44, 52)],
        points: [{id: 'city', ...point(12, 48)}],
        extent: {kind: 'FIT', featureIds: ['target'], points: []},
      }),
    );
    expect(plate.features[0].visibility).toBe('VISIBLE');
    for (const p of plate.features[0].rings[0].points) {
      expect(p.x).toBeGreaterThanOrEqual(viewport.padding - 1e-9);
      expect(p.x).toBeLessThanOrEqual(viewport.width - viewport.padding + 1e-9);
      expect(p.y).toBeGreaterThanOrEqual(viewport.padding - 1e-9);
      expect(p.y).toBeLessThanOrEqual(
        viewport.height - viewport.padding + 1e-9,
      );
    }
    expect(plate.markers[0].inside).toBe(true);
  });

  test('a fit reports the extent it actually used', () => {
    const plate = projectPlate(
      request({
        features: [box('target', -10, 10, -5, 5)],
        extent: {kind: 'FIT', featureIds: ['target'], points: []},
      }),
    );
    expect(plate.extent.west).toBeCloseTo(-10, 9);
    expect(plate.extent.east).toBeCloseTo(10, 9);
    expect(plate.extent.crossesAntimeridian).toBe(false);
  });

  test('a fit across the seam frames the short way round', () => {
    // Two positions either side of the seam are 20 degrees apart, not 340.
    const plate = projectPlate(
      request({
        extent: {
          kind: 'FIT',
          featureIds: [],
          points: [point(170, 0), point(-170, 0)],
        },
      }),
    );
    expect(plate.extent.crossesAntimeridian).toBe(true);
    expect(plate.extent.west).toBeCloseTo(170, 9);
    expect(plate.extent.east).toBeCloseTo(-170, 9);
  });

  test('geometry outside the viewport is reported, not cut', () => {
    const plate = projectPlate(
      request({
        features: [box('target', 0, 10, 0, 10), box('far', 150, 170, 60, 80)],
        extent: {kind: 'FIT', featureIds: ['target'], points: []},
      }),
    );
    const far = plate.features.find(part => part.sourceId === 'far')!;
    expect(far.visibility).toBe('OUTSIDE');
    // Every supplied vertex is still present: nothing was invented at an edge.
    expect(far.rings[0].points).toHaveLength(4);
    expect(far.rings[0].sourceIndices).toEqual([0, 1, 2, 3]);
  });

  test('one aspect ratio is used for both axes', () => {
    // A square geographic box in a wide viewport stays square.
    const plate = projectPlate(
      request({
        viewport: {width: 800, height: 400, padding: 0},
        features: [box('square', -10, 10, -10, 10)],
        extent: {kind: 'FIT', featureIds: ['square'], points: []},
      }),
    );
    const xs = plate.features[0].rings[0].points.map(p => p.x);
    const ys = plate.features[0].rings[0].points.map(p => p.y);
    const width = Math.max(...xs) - Math.min(...xs);
    const height = Math.max(...ys) - Math.min(...ys);
    expect(width).toBeCloseTo(height, 6);
  });
});

// --- 13. REPLAY STABILITY ---

describe('replay', () => {
  test('the same request always yields the same sampled geometry', () => {
    const input = request({
      projection: 'WEB_MERCATOR',
      features: [box('a', -30, 30, -30, 30)],
      routes: [
        {
          id: 'r',
          kind: 'GREAT_CIRCLE',
          waypoints: [point(-30, 10), point(30, 20)],
        },
      ],
      extent: {kind: 'FIT', featureIds: ['a'], points: []},
    });
    const runs = [1, 2, 3].map(() => JSON.stringify(projectPlate(input)));
    expect(new Set(runs).size).toBe(1);
  });
});

// --- 14. BOUNDED COST ---

describe('bounded cost', () => {
  test('a dense plate projects within a bounded budget', () => {
    // 200 features of 200 vertices, plus 40 sampled routes: comfortably more
    // than a legible map, and the point is that the cost stays bounded.
    const features: GeoFeature[] = [];
    for (let index = 0; index < 200; index++) {
      const points: GeoPoint[] = [];
      for (let step = 0; step < 200; step++) {
        const angle = (step / 200) * Math.PI * 2;
        points.push(
          point(
            ((index % 20) - 10) * 8 + Math.cos(angle) * 3,
            (Math.floor(index / 20) - 5) * 8 + Math.sin(angle) * 3,
          ),
        );
      }
      features.push({
        id: `f${index}`,
        parts: [{index: 0, closed: true, rings: [{role: 'exterior', points}]}],
      });
    }
    const routes: GeoRoute[] = [];
    for (let index = 0; index < 40; index++) {
      routes.push({
        id: `r${index}`,
        kind: 'GREAT_CIRCLE',
        waypoints: [point(-80 + index, 10), point(80 - index, -10)],
      });
    }

    const started = performance.now();
    const plate = projectPlate(request({features, routes, routeSamples: 128}));
    const elapsed = performance.now() - started;

    expect(plate.features.length).toBeGreaterThanOrEqual(200);
    expect(plate.routes.length).toBeGreaterThanOrEqual(40);
    // Generous: this asserts the absence of accidental quadratic behaviour,
    // not a performance target.
    expect(elapsed).toBeLessThan(2000);
  });
});
