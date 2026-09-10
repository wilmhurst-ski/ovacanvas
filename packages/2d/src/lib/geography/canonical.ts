import type {
  ExtentRequest,
  GeoBounds,
  GeoFeature,
  GeoPart,
  GeoPoint,
  GeoRing,
  GeoRoute,
  IdentifiedGeoPoint,
  ProjectionKind,
  ProjectionRequest,
  Viewport,
} from './types';
import {GeographyError, WebMercatorLatitudeLimit} from './types';

/** The same grammar the planar geometry module uses for semantic ids. */
const SEMANTIC_ID = /^[A-Za-z0-9_-]+$/;

/** Bounds on the route subdivision a caller may ask for. */
const MinRouteSamples = 2;
const MaxRouteSamples = 4096;

const AdmittedProjections: readonly ProjectionKind[] = [
  'EQUIRECTANGULAR',
  'WEB_MERCATOR',
];

function assertFinite(value: unknown, where: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new GeographyError(
      'NON_FINITE_COORDINATE',
      `${where} must be a finite number.`,
    );
  }
  // `-0` and `0` are the same position; normalizing here keeps canonical
  // output byte-stable regardless of how a caller arrived at zero.
  return value === 0 ? 0 : value;
}

function assertId(value: unknown, where: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new GeographyError('INVALID_ID', `${where} must be a non-empty id.`);
  }
  if (!SEMANTIC_ID.test(value)) {
    throw new GeographyError(
      'INVALID_ID',
      `${where} must match the canonical semantic ID grammar [A-Za-z0-9_-]+.`,
    );
  }
  return value;
}

/**
 * Validate one position.
 *
 * @remarks
 * Range is checked separately from finiteness so that a transposed pair -
 * latitude 120, which is a perfectly finite number - is refused with a
 * diagnostic that names the actual mistake.
 */
export function canonicalizeGeoPoint(value: unknown, where: string): GeoPoint {
  if (typeof value !== 'object' || value === null) {
    throw new GeographyError(
      'INVALID_POINT',
      `${where} must be an object carrying longitude and latitude.`,
    );
  }
  const candidate = value as Partial<GeoPoint>;
  const longitude = assertFinite(candidate.longitude, `${where}.longitude`);
  const latitude = assertFinite(candidate.latitude, `${where}.latitude`);

  if (longitude < -180 || longitude > 180) {
    throw new GeographyError(
      'LONGITUDE_OUT_OF_RANGE',
      `${where}.longitude ${longitude} is outside [-180, 180].`,
    );
  }
  if (latitude < -90 || latitude > 90) {
    throw new GeographyError(
      'LATITUDE_OUT_OF_RANGE',
      `${where}.latitude ${latitude} is outside [-90, 90].`,
    );
  }
  return {longitude, latitude};
}

/**
 * Whether a projection can represent a latitude at all.
 *
 * @remarks
 * Separate from validation because it depends on the projection, not on the
 * coordinate: latitude 89 is valid WGS84 and unprojectable in Web Mercator.
 */
export function assertProjectable(
  point: GeoPoint,
  projection: ProjectionKind,
  where: string,
): void {
  if (
    projection === 'WEB_MERCATOR' &&
    Math.abs(point.latitude) > WebMercatorLatitudeLimit
  ) {
    throw new GeographyError(
      'LATITUDE_UNPROJECTABLE',
      `${where}.latitude ${point.latitude} exceeds the Web Mercator limit ` +
        `of ${WebMercatorLatitudeLimit}. It is refused rather than clamped, ` +
        `because clamping would move the position.`,
    );
  }
}

/**
 * Drop consecutive duplicates and any closing repeat.
 *
 * @remarks
 * Rings are carried open internally - the closing vertex is implied by
 * `closed` - so that a seam split does not have to reason about whether the
 * duplicate it is looking at is data or punctuation.
 */
function stripRepeats(points: readonly GeoPoint[]): GeoPoint[] {
  const out: GeoPoint[] = [];
  for (const point of points) {
    const previous = out[out.length - 1];
    if (
      previous &&
      previous.longitude === point.longitude &&
      previous.latitude === point.latitude
    ) {
      continue;
    }
    out.push(point);
  }
  while (
    out.length > 1 &&
    out[0].longitude === out[out.length - 1].longitude &&
    out[0].latitude === out[out.length - 1].latitude
  ) {
    out.pop();
  }
  return out;
}

export function canonicalizeGeoRing(
  value: unknown,
  closed: boolean,
  where: string,
): GeoRing {
  if (typeof value !== 'object' || value === null) {
    throw new GeographyError('INVALID_RING', `${where} must be an object.`);
  }
  const candidate = value as Partial<GeoRing>;
  if (candidate.role !== 'exterior' && candidate.role !== 'hole') {
    throw new GeographyError(
      'INVALID_RING',
      `${where}.role must be 'exterior' or 'hole'.`,
    );
  }
  if (!Array.isArray(candidate.points)) {
    throw new GeographyError(
      'INVALID_RING',
      `${where}.points must be an array.`,
    );
  }

  const points = candidate.points.map((point, index) =>
    canonicalizeGeoPoint(point, `${where}.points[${index}]`),
  );
  const stripped = stripRepeats(points);

  // A line needs two distinct positions; a boundary needs three.
  const minimum = closed ? 3 : 2;
  if (stripped.length < minimum) {
    throw new GeographyError(
      closed ? 'DEGENERATE_RING' : 'INVALID_RING',
      `${where} carries ${stripped.length} distinct positions; ` +
        `${closed ? 'a boundary' : 'a line'} needs at least ${minimum}.`,
    );
  }
  return {role: candidate.role, points: stripped};
}

/**
 * A total order over rings, by their vertex sequences.
 *
 * @remarks
 * Compares position by position so that two rings differing anywhere order
 * consistently, and only genuinely identical rings compare equal.
 */
function compareRings(a: GeoRing, b: GeoRing): number {
  const shared = Math.min(a.points.length, b.points.length);
  for (let index = 0; index < shared; index++) {
    const left = a.points[index];
    const right = b.points[index];
    if (left.longitude !== right.longitude) {
      return left.longitude - right.longitude;
    }
    if (left.latitude !== right.latitude) return left.latitude - right.latitude;
  }
  return a.points.length - b.points.length;
}

export function canonicalizePart(
  value: unknown,
  index: number,
  where: string,
): GeoPart {
  if (typeof value !== 'object' || value === null) {
    throw new GeographyError('INVALID_PART', `${where} must be an object.`);
  }
  const candidate = value as Partial<GeoPart>;
  if (typeof candidate.closed !== 'boolean') {
    throw new GeographyError(
      'INVALID_PART',
      `${where}.closed must be a boolean.`,
    );
  }
  if (!Array.isArray(candidate.rings) || candidate.rings.length === 0) {
    throw new GeographyError(
      'INVALID_PART',
      `${where}.rings must be a non-empty array.`,
    );
  }

  const rings = candidate.rings.map((ring, ringIndex) =>
    canonicalizeGeoRing(
      ring,
      candidate.closed!,
      `${where}.rings[${ringIndex}]`,
    ),
  );

  const exteriors = rings.filter(ring => ring.role === 'exterior').length;
  if (exteriors !== 1) {
    throw new GeographyError(
      'INVALID_PART',
      `${where} carries ${exteriors} exterior rings; exactly one is required.`,
    );
  }
  if (!candidate.closed && rings.length !== 1) {
    throw new GeographyError(
      'INVALID_PART',
      `${where} is open, so it may carry only one ring.`,
    );
  }
  // Exterior first, then holes in a canonical order. Hole order carries no
  // meaning, so it is sorted by vertex sequence rather than left as supplied:
  // input that means the same thing must produce the same bytes, which is
  // what makes the output comparable across runs. The planar geometry module
  // canonicalizes for the same reason.
  const ordered = [
    ...rings.filter(ring => ring.role === 'exterior'),
    ...rings
      .filter(ring => ring.role === 'hole')
      .sort((a, b) => compareRings(a, b)),
  ];
  return {index, closed: candidate.closed, rings: ordered};
}

export function canonicalizeFeature(value: unknown, where: string): GeoFeature {
  if (typeof value !== 'object' || value === null) {
    throw new GeographyError('INVALID_FEATURE', `${where} must be an object.`);
  }
  const candidate = value as Partial<GeoFeature>;
  const id = assertId(candidate.id, `${where}.id`);
  if (!Array.isArray(candidate.parts) || candidate.parts.length === 0) {
    throw new GeographyError(
      'INVALID_FEATURE',
      `${where}.parts must be a non-empty array.`,
    );
  }
  const parts = candidate.parts.map((part, index) =>
    canonicalizePart(part, index, `${where}.parts[${index}]`),
  );
  return {id, parts};
}

export function canonicalizeRoute(value: unknown, where: string): GeoRoute {
  if (typeof value !== 'object' || value === null) {
    throw new GeographyError('INVALID_ROUTE', `${where} must be an object.`);
  }
  const candidate = value as Partial<GeoRoute>;
  const id = assertId(candidate.id, `${where}.id`);
  if (
    candidate.kind !== 'GREAT_CIRCLE' &&
    candidate.kind !== 'DECLARED_POLYLINE' &&
    candidate.kind !== 'PROJECTED_STRAIGHT'
  ) {
    throw new GeographyError('INVALID_ROUTE', `${where}.kind is not admitted.`);
  }
  if (!Array.isArray(candidate.waypoints)) {
    throw new GeographyError(
      'INVALID_ROUTE',
      `${where}.waypoints must be an array.`,
    );
  }
  const waypoints = candidate.waypoints.map((point, index) =>
    canonicalizeGeoPoint(point, `${where}.waypoints[${index}]`),
  );

  if (candidate.kind === 'DECLARED_POLYLINE') {
    if (waypoints.length < 2) {
      throw new GeographyError(
        'INVALID_ROUTE',
        `${where} declares a polyline with ${waypoints.length} waypoints; ` +
          `at least two are required.`,
      );
    }
  } else if (waypoints.length !== 2) {
    // A sampled route carries endpoints only. Accepting a pre-sampled path
    // would let supplied geometry disagree with the endpoints it claims to
    // connect, and nothing downstream could tell which one was meant.
    throw new GeographyError(
      'INVALID_ROUTE',
      `${where} is ${candidate.kind} and carries ${waypoints.length} ` +
        `waypoints; exactly two endpoints are required, and the path ` +
        `between them is sampled here rather than supplied.`,
    );
  }
  return {id, kind: candidate.kind, waypoints};
}

export function canonicalizeGeoBounds(
  value: unknown,
  where: string,
): GeoBounds {
  if (typeof value !== 'object' || value === null) {
    throw new GeographyError('INVALID_BOUNDS', `${where} must be an object.`);
  }
  const candidate = value as Partial<GeoBounds>;
  const west = assertFinite(candidate.west, `${where}.west`);
  const east = assertFinite(candidate.east, `${where}.east`);
  const south = assertFinite(candidate.south, `${where}.south`);
  const north = assertFinite(candidate.north, `${where}.north`);

  if (typeof candidate.crossesAntimeridian !== 'boolean') {
    throw new GeographyError(
      'INVALID_BOUNDS',
      `${where}.crossesAntimeridian must be declared, not inferred from ` +
        `whether west exceeds east.`,
    );
  }
  for (const [name, degrees] of [
    ['west', west],
    ['east', east],
  ] as const) {
    if (degrees < -180 || degrees > 180) {
      throw new GeographyError(
        'INVALID_BOUNDS',
        `${where}.${name} ${degrees} is outside [-180, 180].`,
      );
    }
  }
  for (const [name, degrees] of [
    ['south', south],
    ['north', north],
  ] as const) {
    if (degrees < -90 || degrees > 90) {
      throw new GeographyError(
        'INVALID_BOUNDS',
        `${where}.${name} ${degrees} is outside [-90, 90].`,
      );
    }
  }
  if (north <= south) {
    throw new GeographyError(
      'INVALID_BOUNDS',
      `${where} has no latitude extent: north ${north} <= south ${south}.`,
    );
  }
  if (!candidate.crossesAntimeridian && east <= west) {
    throw new GeographyError(
      'INVALID_BOUNDS',
      `${where} has no longitude extent: east ${east} <= west ${west}. ` +
        `Declare crossesAntimeridian if the interval spans the seam.`,
    );
  }
  if (candidate.crossesAntimeridian && west <= east) {
    throw new GeographyError(
      'INVALID_BOUNDS',
      `${where} declares an antimeridian crossing, but west ${west} does ` +
        `not exceed east ${east}, so the interval does not cross the seam.`,
    );
  }
  return {
    west,
    east,
    south,
    north,
    crossesAntimeridian: candidate.crossesAntimeridian,
  };
}

export function canonicalizeViewport(value: unknown, where: string): Viewport {
  if (typeof value !== 'object' || value === null) {
    throw new GeographyError('INVALID_VIEWPORT', `${where} must be an object.`);
  }
  const candidate = value as Partial<Viewport>;
  const width = assertFinite(candidate.width, `${where}.width`);
  const height = assertFinite(candidate.height, `${where}.height`);
  const padding = assertFinite(candidate.padding, `${where}.padding`);

  if (padding < 0) {
    throw new GeographyError(
      'INVALID_VIEWPORT',
      `${where}.padding must not be negative.`,
    );
  }
  if (width - padding * 2 <= 0 || height - padding * 2 <= 0) {
    throw new GeographyError(
      'INVALID_VIEWPORT',
      `${where} leaves no drawable area after ${padding} of padding.`,
    );
  }
  return {width, height, padding};
}

function canonicalizeIdentifiedPoint(
  value: unknown,
  where: string,
): IdentifiedGeoPoint {
  if (typeof value !== 'object' || value === null) {
    throw new GeographyError('INVALID_POINT', `${where} must be an object.`);
  }
  const id = assertId((value as Partial<IdentifiedGeoPoint>).id, `${where}.id`);
  const point = canonicalizeGeoPoint(value, where);
  return {id, longitude: point.longitude, latitude: point.latitude};
}

function canonicalizeExtent(value: unknown, where: string): ExtentRequest {
  if (typeof value !== 'object' || value === null) {
    throw new GeographyError('INVALID_BOUNDS', `${where} must be an object.`);
  }
  const candidate = value as {kind?: unknown};
  if (candidate.kind === 'WHOLE_WORLD') return {kind: 'WHOLE_WORLD'};
  if (candidate.kind === 'BOUNDS') {
    return {
      kind: 'BOUNDS',
      bounds: canonicalizeGeoBounds(
        (value as {bounds?: unknown}).bounds,
        `${where}.bounds`,
      ),
    };
  }
  if (candidate.kind === 'FIT') {
    const raw = value as {featureIds?: unknown; points?: unknown};
    const featureIds = Array.isArray(raw.featureIds)
      ? raw.featureIds.map((id, index) =>
          assertId(id, `${where}.featureIds[${index}]`),
        )
      : [];
    const points = Array.isArray(raw.points)
      ? raw.points.map((point, index) =>
          canonicalizeGeoPoint(point, `${where}.points[${index}]`),
        )
      : [];
    if (featureIds.length === 0 && points.length === 0) {
      throw new GeographyError(
        'EMPTY_FIT_TARGET',
        `${where} asks to fit nothing. A fit must name what must be visible.`,
      );
    }
    return {kind: 'FIT', featureIds, points};
  }
  throw new GeographyError(
    'INVALID_BOUNDS',
    `${where}.kind is not an admitted extent request.`,
  );
}

/**
 * Validate and normalize a whole projection request.
 *
 * @remarks
 * Everything is checked before anything is projected, so a malformed plate
 * fails with one diagnostic rather than producing a partial map. Identities
 * are checked for collisions across features, routes and points
 * independently: a feature and a route may legitimately share a name, but two
 * features may not.
 */
export function canonicalizeRequest(value: unknown): ProjectionRequest {
  if (typeof value !== 'object' || value === null) {
    throw new GeographyError('INVALID_FEATURE', 'request must be an object.');
  }
  const candidate = value as Partial<ProjectionRequest>;

  if (
    typeof candidate.projection !== 'string' ||
    !AdmittedProjections.includes(candidate.projection as ProjectionKind)
  ) {
    throw new GeographyError(
      'UNKNOWN_PROJECTION',
      `request.projection must be one of ${AdmittedProjections.join(', ')}.`,
    );
  }
  const projection = candidate.projection as ProjectionKind;

  const samples = candidate.routeSamples;
  if (
    typeof samples !== 'number' ||
    !Number.isInteger(samples) ||
    samples < MinRouteSamples ||
    samples > MaxRouteSamples
  ) {
    throw new GeographyError(
      'INVALID_SAMPLE_COUNT',
      `request.routeSamples must be an integer in ` +
        `[${MinRouteSamples}, ${MaxRouteSamples}].`,
    );
  }

  const viewport = canonicalizeViewport(candidate.viewport, 'request.viewport');
  const extent = canonicalizeExtent(candidate.extent, 'request.extent');

  const features = (
    Array.isArray(candidate.features) ? candidate.features : []
  ).map((feature, index) =>
    canonicalizeFeature(feature, `request.features[${index}]`),
  );
  const routes = (Array.isArray(candidate.routes) ? candidate.routes : []).map(
    (route, index) => canonicalizeRoute(route, `request.routes[${index}]`),
  );
  const points = (Array.isArray(candidate.points) ? candidate.points : []).map(
    (point, index) =>
      canonicalizeIdentifiedPoint(point, `request.points[${index}]`),
  );

  assertDistinct(
    features.map(feature => feature.id),
    'request.features',
  );
  // Sorted by identity. Position is not load-bearing downstream - every
  // projected part names the feature it came from - so ordering the input
  // makes the whole plate byte-stable under a caller reshuffling its atlas.
  features.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  routes.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  points.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  assertDistinct(
    routes.map(route => route.id),
    'request.routes',
  );
  assertDistinct(
    points.map(point => point.id),
    'request.points',
  );

  if (extent.kind === 'FIT') {
    const known = new Set(features.map(feature => feature.id));
    for (const id of extent.featureIds) {
      if (!known.has(id)) {
        throw new GeographyError(
          'UNKNOWN_FIT_FEATURE',
          `request.extent asks to fit feature ${id}, which was not supplied.`,
        );
      }
    }
  }

  // Projectability last: it depends on the chosen projection, so reporting it
  // before the projection itself was validated would be misleading.
  for (const feature of features) {
    for (const part of feature.parts) {
      for (const ring of part.rings) {
        for (const point of ring.points) {
          assertProjectable(point, projection, `feature ${feature.id}`);
        }
      }
    }
  }
  for (const route of routes) {
    for (const point of route.waypoints) {
      assertProjectable(point, projection, `route ${route.id}`);
    }
  }
  for (const point of points) {
    assertProjectable(point, projection, `point ${point.id}`);
  }

  return {
    projection,
    extent,
    viewport,
    features,
    routes,
    points,
    routeSamples: samples,
  };
}

function assertDistinct(ids: readonly string[], where: string): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      throw new GeographyError(
        'DUPLICATE_ID',
        `${where} carries ${id} more than once.`,
      );
    }
    seen.add(id);
  }
}
