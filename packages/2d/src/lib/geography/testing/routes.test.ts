import {describe, expect, it} from 'vitest';
import type {GeoRouteSpec} from '../public/types';
import {
  WGS84_EARTH_RADIUS_METERS,
  generateRoutePoints,
  measureRoute,
} from '../routes/routeGenerator';
import {JFK_COORDINATES, LHR_COORDINATES} from './fixtures/world110m';

describe('Authoritative Route Semantics & Measurements', () => {
  it('measures geodesic great-circle distance and bearing accurately', () => {
    const measurement = measureRoute(
      JFK_COORDINATES,
      LHR_COORDINATES,
      'geodesic',
      WGS84_EARTH_RADIUS_METERS,
    );

    // JFK to London Heathrow great-circle distance is ~5550 - 5585 km
    const distanceKm = measurement.distanceMeters / 1000;
    expect(distanceKm).toBeGreaterThan(5500);
    expect(distanceKm).toBeLessThan(5600);

    // Initial heading departs northeast (~50 - 55 degrees)
    expect(measurement.initialBearingDeg).toBeGreaterThan(48);
    expect(measurement.initialBearingDeg).toBeLessThan(55);
  });

  it('measures rhumb constant-bearing distance and bearing accurately', () => {
    const measurement = measureRoute(
      JFK_COORDINATES,
      LHR_COORDINATES,
      'rhumb',
      WGS84_EARTH_RADIUS_METERS,
    );

    // Rhumb distance is strictly longer than great-circle distance (~5758 km vs ~5562 km)
    const distanceKm = measurement.distanceMeters / 1000;
    expect(distanceKm).toBeGreaterThan(5700);
    expect(distanceKm).toBeLessThan(5850);

    // Initial and final bearing along a rhumb line are identical (constant bearing ~78 - 80 degrees)
    expect(measurement.initialBearingDeg).toBeCloseTo(
      measurement.finalBearingDeg,
      5,
    );
    expect(measurement.initialBearingDeg).toBeGreaterThan(77);
    expect(measurement.initialBearingDeg).toBeLessThan(81);
  });

  it('proves that great-circle distance is strictly shorter than rhumb distance', () => {
    const geodesic = measureRoute(JFK_COORDINATES, LHR_COORDINATES, 'geodesic');
    const rhumb = measureRoute(JFK_COORDINATES, LHR_COORDINATES, 'rhumb');

    expect(geodesic.distanceMeters).toBeLessThan(rhumb.distanceMeters);
    // Delta is approximately 250 - 300 km
    const deltaKm = (rhumb.distanceMeters - geodesic.distanceMeters) / 1000;
    expect(deltaKm).toBeGreaterThan(200);
    expect(deltaKm).toBeLessThan(350);
  });

  it('interpolates great circle curving northward while rhumb line maintains linear latitude progression', () => {
    const geodesicRoute: GeoRouteSpec = {
      id: 'jfk-lhr-geodesic',
      kind: 'geodesic',
      waypoints: [JFK_COORDINATES, LHR_COORDINATES],
      samples: 33,
    };
    const rhumbRoute: GeoRouteSpec = {
      id: 'jfk-lhr-rhumb',
      kind: 'rhumb',
      waypoints: [JFK_COORDINATES, LHR_COORDINATES],
      samples: 33,
    };

    const geodesicPoints = generateRoutePoints(geodesicRoute);
    const rhumbPoints = generateRoutePoints(rhumbRoute);

    expect(geodesicPoints).toHaveLength(33);
    expect(rhumbPoints).toHaveLength(33);

    // Endpoints match exactly
    expect(geodesicPoints[0][0]).toBeCloseTo(JFK_COORDINATES[0], 4);
    expect(geodesicPoints[0][1]).toBeCloseTo(JFK_COORDINATES[1], 4);
    expect(geodesicPoints[32][0]).toBeCloseTo(LHR_COORDINATES[0], 4);
    expect(geodesicPoints[32][1]).toBeCloseTo(LHR_COORDINATES[1], 4);

    expect(rhumbPoints[0][0]).toBeCloseTo(JFK_COORDINATES[0], 4);
    expect(rhumbPoints[0][1]).toBeCloseTo(JFK_COORDINATES[1], 4);
    expect(rhumbPoints[32][0]).toBeCloseTo(LHR_COORDINATES[0], 4);
    expect(rhumbPoints[32][1]).toBeCloseTo(LHR_COORDINATES[1], 4);

    // Midpoint comparison:
    // Great circle arcs higher northward over the North Atlantic (~52 - 55 degrees)
    const midGeodesic = geodesicPoints[16];
    const midRhumb = rhumbPoints[16];

    expect(midGeodesic[1]).toBeGreaterThan(midRhumb[1]);
    expect(midGeodesic[1]).toBeGreaterThan(50); // Arcs above 50 N
    expect(midRhumb[1]).toBeCloseTo(
      (JFK_COORDINATES[1] + LHR_COORDINATES[1]) / 2,
      0,
    ); // ~46 N
  });
});
