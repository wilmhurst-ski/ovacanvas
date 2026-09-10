import {geoDistance, geoInterpolate} from 'd3-geo';
import type {
  GeoMeasurementResult,
  GeoRouteKind,
  GeoRouteSpec,
} from '../public/types';
import {rhumbDistanceAndBearing, sampleRhumbLine} from './rhumb';

export const WGS84_EARTH_RADIUS_METERS = 6371008.8;
const RAD2DEG = 180 / Math.PI;
const DEG2RAD = Math.PI / 180;

/**
 * Calculate initial great-circle bearing from `a` to `b` in degrees `[0, 360)`.
 */
export function greatCircleBearingDeg(
  from: readonly [longitude: number, latitude: number],
  to: readonly [longitude: number, latitude: number],
): number {
  const lon1 = from[0] * DEG2RAD;
  const lat1 = from[1] * DEG2RAD;
  const lon2 = to[0] * DEG2RAD;
  const lat2 = to[1] * DEG2RAD;

  const dLon = lon2 - lon1;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);

  const bearingRad = Math.atan2(y, x);
  return (bearingRad * RAD2DEG + 360) % 360;
}

/**
 * Compute authoritative distance and bearing measurements for a 2-point route.
 */
export function measureRoute(
  from: readonly [longitude: number, latitude: number],
  to: readonly [longitude: number, latitude: number],
  kind: GeoRouteKind = 'geodesic',
  radiusMeters: number = WGS84_EARTH_RADIUS_METERS,
): GeoMeasurementResult {
  if (kind === 'rhumb') {
    const rhumb = rhumbDistanceAndBearing(from, to, radiusMeters);
    const angularDistanceRad = rhumb.distanceMeters / radiusMeters;
    return {
      angularDistanceRad,
      distanceMeters: rhumb.distanceMeters,
      initialBearingDeg: rhumb.bearingDeg,
      finalBearingDeg: rhumb.bearingDeg, // Constant bearing
    };
  }

  // Geodesic (great circle)
  const angularDist = geoDistance(
    from as [number, number],
    to as [number, number],
  );
  const distanceMeters = angularDist * radiusMeters;
  const initialBearing = greatCircleBearingDeg(from, to);
  // Final bearing is opposite of bearing from destination to origin
  const reverseBearing = greatCircleBearingDeg(to, from);
  const finalBearing = (reverseBearing + 180) % 360;

  return {
    angularDistanceRad: angularDist,
    distanceMeters,
    initialBearingDeg: initialBearing,
    finalBearingDeg: finalBearing,
  };
}

/**
 * Generate a sampled sequence of [longitude, latitude] coordinates along a route.
 */
export function generateRoutePoints(
  spec: GeoRouteSpec,
): [longitude: number, latitude: number][] {
  const {kind, waypoints, samples = 33} = spec;
  if (waypoints.length < 2) {
    return waypoints.map(w => [w[0], w[1]]);
  }

  if (
    kind === ('DECLARED_GEOGRAPHIC_POLYLINE' as any) ||
    kind === 'declared_polyline'
  ) {
    return waypoints.map(w => [w[0], w[1]]);
  }

  const segmentSamples = Math.max(
    2,
    Math.floor(samples / (waypoints.length - 1)),
  );
  const result: [longitude: number, latitude: number][] = [];

  for (let s = 0; s < waypoints.length - 1; s++) {
    const p1 = waypoints[s];
    const p2 = waypoints[s + 1];

    if (kind === 'rhumb') {
      const segPoints = sampleRhumbLine(p1, p2, segmentSamples);
      if (s > 0) segPoints.shift(); // Avoid duplicating connection point
      result.push(...segPoints);
    } else {
      // Default: GEODESIC (Great Circle)
      const interpolate = geoInterpolate(
        p1 as [number, number],
        p2 as [number, number],
      );
      const count = segmentSamples - 1;
      const startIdx = s === 0 ? 0 : 1;

      for (let i = startIdx; i <= count; i++) {
        const t = i / (segmentSamples - 1);
        result.push(interpolate(t));
      }
    }
  }

  return result;
}
