/**
 * Analytic rhumb-line (constant-bearing loxodrome) mathematics.
 *
 * @remarks
 * Provides verified constant-bearing geodesic calculations independent of D3.
 */

const EARTH_RADIUS_METERS = 6371008.8;
const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;
const MAX_LAT_RAD = 85.0511287798 * DEG2RAD; // Web Mercator latitude limit

/**
 * Shortest antimeridian-aware delta longitude in radians in `[-PI, PI]`.
 */
export function deltaLongitudeRad(lon1Rad: number, lon2Rad: number): number {
  let delta = (lon2Rad - lon1Rad) % (2 * Math.PI);
  if (delta > Math.PI) delta -= 2 * Math.PI;
  if (delta < -Math.PI) delta += 2 * Math.PI;
  return delta;
}

/**
 * Isometric latitude: psi = ln(tan(pi/4 + phi/2)).
 */
function isometricLatitude(phiRad: number): number {
  const clamped = Math.max(-MAX_LAT_RAD, Math.min(MAX_LAT_RAD, phiRad));
  return Math.log(Math.tan(Math.PI / 4 + clamped / 2));
}

/**
 * Calculate rhumb constant bearing and distance between two [lon, lat] coordinates in degrees.
 */
export function rhumbDistanceAndBearing(
  from: readonly [longitude: number, latitude: number],
  to: readonly [longitude: number, latitude: number],
  radiusMeters: number = EARTH_RADIUS_METERS,
): {
  distanceMeters: number;
  bearingDeg: number;
} {
  const lon1 = from[0] * DEG2RAD;
  const lat1 = from[1] * DEG2RAD;
  const lon2 = to[0] * DEG2RAD;
  const lat2 = to[1] * DEG2RAD;

  const dLat = lat2 - lat1;
  const dLon = deltaLongitudeRad(lon1, lon2);
  const psi1 = isometricLatitude(lat1);
  const psi2 = isometricLatitude(lat2);
  const dPsi = psi2 - psi1;

  // Bearing: beta = atan2(dLon, dPsi)
  let bearing = Math.atan2(dLon, dPsi) * RAD2DEG;
  bearing = (bearing + 360) % 360;

  // Distance:
  const q = Math.abs(dPsi) > 1e-12 ? dLat / dPsi : Math.cos(lat1);
  const distanceMeters =
    Math.sqrt(dLat * dLat + q * q * dLon * dLon) * radiusMeters;

  return {distanceMeters, bearingDeg: bearing};
}

/**
 * Interpolate a point along a rhumb line at parameter t in [0, 1].
 *
 * @returns [longitude, latitude] in degrees.
 */
export function interpolateRhumb(
  from: readonly [longitude: number, latitude: number],
  to: readonly [longitude: number, latitude: number],
  t: number,
): [longitude: number, latitude: number] {
  if (t <= 0) return [from[0], from[1]];
  if (t >= 1) return [to[0], to[1]];

  const lon1 = from[0] * DEG2RAD;
  const lat1 = from[1] * DEG2RAD;
  const lon2 = to[0] * DEG2RAD;
  const lat2 = to[1] * DEG2RAD;

  const dLat = lat2 - lat1;
  const dLon = deltaLongitudeRad(lon1, lon2);

  const latT = lat1 + t * dLat;
  let lonT: number;

  const psi1 = isometricLatitude(lat1);
  const psi2 = isometricLatitude(lat2);
  const dPsi = psi2 - psi1;

  if (Math.abs(dLat) < 1e-12) {
    // Parallel sailing (constant latitude)
    lonT = lon1 + t * dLon;
  } else {
    const psiT = isometricLatitude(latT);
    lonT = lon1 + ((psiT - psi1) * dLon) / (dPsi || 1e-12);
  }

  // Normalize longitude into [-180, 180]
  let lonDeg = lonT * RAD2DEG;
  lonDeg = ((((lonDeg + 180) % 360) + 360) % 360) - 180;
  const latDeg = latT * RAD2DEG;

  return [lonDeg, latDeg];
}

/**
 * Sample a rhumb line into a sequence of [longitude, latitude] coordinates.
 */
export function sampleRhumbLine(
  from: readonly [longitude: number, latitude: number],
  to: readonly [longitude: number, latitude: number],
  samples: number = 33,
): [longitude: number, latitude: number][] {
  const count = Math.max(2, samples);
  const points: [longitude: number, latitude: number][] = [];
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    points.push(interpolateRhumb(from, to, t));
  }
  return points;
}
