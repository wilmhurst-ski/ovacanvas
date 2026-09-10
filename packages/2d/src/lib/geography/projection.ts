import type {GeoPoint, ProjectionKind} from './types';
import {GeographyError, WebMercatorLatitudeLimit} from './types';

/**
 * A position in the projection plane.
 *
 * @remarks
 * `u` runs east, `v` runs **north**, and both are in degree-equivalent units
 * so the two admitted projections share one scale convention. The flip to
 * screen coordinates, where y runs down, happens once when a plate is fitted
 * to a viewport - not here, where getting it wrong would be invisible.
 *
 * @internal Not a public API.
 */
export interface PlanePoint {
  readonly u: number;
  readonly v: number;
}

/**
 * Half the width of the projection plane, in degree-equivalent units.
 *
 * @remarks
 * Both admitted projections span `[-180, 180]` in `u`. Web Mercator also
 * spans exactly `[-180, 180]` in `v` at its latitude limit, which is the
 * familiar square world: `ln(tan(pi/4 + phi/2))` equals `pi` radians there,
 * and `pi` radians is 180 degrees.
 */
export const PlaneHalfSpan = 180;

const DegreesPerRadian = 180 / Math.PI;
const RadiansPerDegree = Math.PI / 180;

/**
 * Project one position into the projection plane.
 *
 * @remarks
 * Forward projection only. Nothing here consults a viewport, a theme or a
 * canvas, and nothing here decides which positions matter.
 *
 * @param point - A validated position. Range and projectability are the
 *                canonicalizer's job; this function assumes both.
 */
export function projectToPlane(
  point: GeoPoint,
  projection: ProjectionKind,
): PlanePoint {
  if (projection === 'EQUIRECTANGULAR') {
    // Linear in both axes, which is why it is the baseline: an anchor can be
    // checked by hand.
    return {u: point.longitude, v: point.latitude};
  }
  if (projection === 'WEB_MERCATOR') {
    if (Math.abs(point.latitude) > WebMercatorLatitudeLimit) {
      // Defence in depth. The canonicalizer refuses this, so reaching here
      // means an internal caller bypassed it, and silently returning a
      // clamped value would place a marker somewhere nobody asked for.
      throw new GeographyError(
        'LATITUDE_UNPROJECTABLE',
        `latitude ${point.latitude} exceeds the Web Mercator limit.`,
      );
    }
    if (point.latitude === 0) {
      // Exact by definition: ln(tan(pi/4)) is ln(1) is 0. Computing it
      // instead yields about -6e-15, because tan(pi/4) is not exactly 1 in
      // binary floating point - and the equator is precisely the anchor
      // someone checks a plate against by hand.
      return {u: point.longitude, v: 0};
    }
    const phi = point.latitude * RadiansPerDegree;
    const v = Math.log(Math.tan(Math.PI / 4 + phi / 2)) * DegreesPerRadian;
    return {u: point.longitude, v};
  }
  throw new GeographyError(
    'UNKNOWN_PROJECTION',
    `projection ${String(projection)} is not admitted.`,
  );
}

/**
 * Recover the latitude a plane `v` came from.
 *
 * @remarks
 * Exists so that a fit expressed in plane units can be reported back as the
 * geographic interval it actually represents. An evaluator checking an anchor
 * needs the extent in degrees, not in whatever units the projection happened
 * to use.
 */
export function latitudeFromPlane(
  v: number,
  projection: ProjectionKind,
): number {
  if (projection === 'EQUIRECTANGULAR') return v;
  if (projection === 'WEB_MERCATOR') {
    const y = v * RadiansPerDegree;
    return (2 * Math.atan(Math.exp(y)) - Math.PI / 2) * DegreesPerRadian;
  }
  throw new GeographyError(
    'UNKNOWN_PROJECTION',
    `projection ${String(projection)} is not admitted.`,
  );
}

/**
 * The plane `v` range a projection admits.
 *
 * @remarks
 * Used when a caller asks for the whole world: equirectangular reaches the
 * poles, Web Mercator stops at its limit, and the difference is a property of
 * the projection rather than of the data.
 */
export function planeLatitudeSpan(projection: ProjectionKind): {
  readonly min: number;
  readonly max: number;
} {
  if (projection === 'EQUIRECTANGULAR') return {min: -90, max: 90};
  if (projection === 'WEB_MERCATOR') {
    return {min: -PlaneHalfSpan, max: PlaneHalfSpan};
  }
  throw new GeographyError(
    'UNKNOWN_PROJECTION',
    `projection ${String(projection)} is not admitted.`,
  );
}

/**
 * The latitude range a projection admits, in degrees.
 */
export function admittedLatitudeSpan(projection: ProjectionKind): {
  readonly south: number;
  readonly north: number;
} {
  if (projection === 'EQUIRECTANGULAR') return {south: -90, north: 90};
  if (projection === 'WEB_MERCATOR') {
    return {
      south: -WebMercatorLatitudeLimit,
      north: WebMercatorLatitudeLimit,
    };
  }
  throw new GeographyError(
    'UNKNOWN_PROJECTION',
    `projection ${String(projection)} is not admitted.`,
  );
}
