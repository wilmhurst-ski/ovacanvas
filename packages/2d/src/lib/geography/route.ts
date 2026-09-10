import type {GeoPoint, GeoRoute} from './types';
import {GeographyError} from './types';

const RadiansPerDegree = Math.PI / 180;
const DegreesPerRadian = 180 / Math.PI;

/**
 * How close two endpoints may be to antipodal before a great circle is
 * refused.
 *
 * @remarks
 * Exactly antipodal endpoints have infinitely many shortest paths, so there
 * is no single correct route to draw. Near-antipodal ones are numerically
 * unstable for the same reason. Refusing is honest; picking one silently
 * would assert a path the caller never chose.
 */
const AntipodalToleranceRadians = 1e-9;

/**
 * The positions a route actually passes through.
 *
 * @remarks
 * A declared polyline is returned as supplied. A projected-straight route is
 * its two endpoints, because straightness is a property of the plane it is
 * drawn in and needs no intermediate geography. A great circle is sampled
 * here, mechanically, from its endpoints - never supplied - so that the
 * drawn path cannot disagree with the endpoints it claims to connect.
 *
 * The first and last returned positions are always exactly the declared
 * endpoints. That is what lets an evaluator check attachment without
 * recomputing the interior.
 */
export function routePositions(
  route: GeoRoute,
  samples: number,
): readonly GeoPoint[] {
  if (route.kind === 'DECLARED_POLYLINE') return route.waypoints;
  if (route.kind === 'PROJECTED_STRAIGHT') return route.waypoints;
  return sampleGreatCircle(
    route.waypoints[0],
    route.waypoints[1],
    samples,
    route.id,
  );
}

/**
 * Interpolate the shortest path across the spherical Earth model.
 *
 * @remarks
 * Standard spherical interpolation. The endpoints are returned verbatim
 * rather than recomputed at `f = 0` and `f = 1`, so floating-point drift can
 * never detach a route from the location it starts at.
 */
export function sampleGreatCircle(
  from: GeoPoint,
  to: GeoPoint,
  samples: number,
  routeId: string,
): readonly GeoPoint[] {
  const phi1 = from.latitude * RadiansPerDegree;
  const lambda1 = from.longitude * RadiansPerDegree;
  const phi2 = to.latitude * RadiansPerDegree;
  const lambda2 = to.longitude * RadiansPerDegree;

  const delta = angularDistance(phi1, lambda1, phi2, lambda2);

  if (delta === 0) {
    // The same position twice. There is no path, and pretending there is one
    // would draw a zero-length mark that an evaluator would have to explain.
    throw new GeographyError(
      'INVALID_ROUTE',
      `route ${routeId} declares the same position as both endpoints.`,
    );
  }
  if (Math.abs(delta - Math.PI) < AntipodalToleranceRadians) {
    throw new GeographyError(
      'INVALID_ROUTE',
      `route ${routeId} declares antipodal endpoints, which have no single ` +
        `shortest path. Declare a polyline if a particular path is meant.`,
    );
  }

  const sinDelta = Math.sin(delta);
  const out: GeoPoint[] = [from];
  for (let step = 1; step < samples - 1; step++) {
    const f = step / (samples - 1);
    const a = Math.sin((1 - f) * delta) / sinDelta;
    const b = Math.sin(f * delta) / sinDelta;

    const x =
      a * Math.cos(phi1) * Math.cos(lambda1) +
      b * Math.cos(phi2) * Math.cos(lambda2);
    const y =
      a * Math.cos(phi1) * Math.sin(lambda1) +
      b * Math.cos(phi2) * Math.sin(lambda2);
    const z = a * Math.sin(phi1) + b * Math.sin(phi2);

    out.push({
      latitude: Math.atan2(z, Math.hypot(x, y)) * DegreesPerRadian,
      longitude: Math.atan2(y, x) * DegreesPerRadian,
    });
  }
  // Verbatim, for the same reason as the first.
  if (samples >= 2) out.push(to);
  return out;
}

/** The great-circle angular separation of two positions, in radians. */
export function angularDistance(
  phi1: number,
  lambda1: number,
  phi2: number,
  lambda2: number,
): number {
  // Haversine: stable for small separations, where the cosine form loses
  // precision.
  const dPhi = phi2 - phi1;
  const dLambda = lambda2 - lambda1;
  const h =
    Math.sin(dPhi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * The midpoint of a great circle, for independent checking.
 *
 * @remarks
 * Exposed because the halfway point is the cheapest way to tell a great
 * circle from a projected straight line: on any long route the two differ
 * visibly there, and agreeing at the endpoints proves nothing.
 */
export function greatCircleMidpoint(
  from: GeoPoint,
  to: GeoPoint,
  routeId = 'midpoint',
): GeoPoint {
  const sampled = sampleGreatCircle(from, to, 3, routeId);
  return sampled[1];
}
