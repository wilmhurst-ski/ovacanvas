/**
 * A position on the Earth in WGS84 degrees.
 *
 * @remarks
 * Longitude is east-positive in `[-180, 180]`; latitude is north-positive in
 * `[-90, 90]`. The order is never positional: both are named, because
 * `[x, y]` pairs are the single most common source of silently transposed
 * geographic data.
 *
 * This module is renderer-neutral in the same sense as the planar geometry
 * module: it never sees pixels, canvases, nodes or scenes.
 *
 * @internal Not a public API. Shape is deliberately not frozen.
 */
export interface GeoPoint {
  readonly longitude: number;
  readonly latitude: number;
}

/**
 * What a ring contributes to its part.
 *
 * @remarks
 * Position does not carry this meaning, unlike the planar geometry module
 * where index 0 is the outer ring. Projection may split one ring into several
 * pieces, so a piece has to say for itself whether it bounds area or removes
 * it.
 *
 * @internal Not a public API.
 */
export type RingRole = 'exterior' | 'hole';

/**
 * One boundary within a part.
 *
 * @internal Not a public API.
 */
export interface GeoRing {
  readonly role: RingRole;
  readonly points: readonly GeoPoint[];
}

/**
 * One connected piece of a feature.
 *
 * @remarks
 * A closed part is a polygon: one exterior ring and zero or more holes. An
 * open part is a line and carries exactly one ring whose role is `exterior`.
 *
 * `index` is the part's position within its feature and is preserved through
 * projection, so a multipolygon's pieces stay attributable to the feature
 * they came from.
 *
 * @internal Not a public API.
 */
export interface GeoPart {
  readonly index: number;
  readonly closed: boolean;
  readonly rings: readonly GeoRing[];
}

/**
 * Trusted normalized geometry for one real-world feature.
 *
 * @remarks
 * The identity is supplied by whoever owns the atlas. This module never
 * invents, resolves or interprets it - it only carries it through so that a
 * projected path can be traced back to the feature it realizes.
 *
 * @internal Not a public API.
 */
export interface GeoFeature {
  readonly id: string;
  readonly parts: readonly GeoPart[];
}

/**
 * A geographic interval.
 *
 * @remarks
 * `crossesAntimeridian` is declared rather than inferred. `west > east` is a
 * legitimate description of an interval that spans the seam - the Pacific
 * from Japan to California, say - and is indistinguishable from transposed
 * input unless the intent is stated. Guessing here is how a map ends up
 * showing the whole world when a caller asked for one ocean.
 *
 * @internal Not a public API.
 */
export interface GeoBounds {
  readonly west: number;
  readonly east: number;
  readonly south: number;
  readonly north: number;
  readonly crossesAntimeridian: boolean;
}

/**
 * Which cartographic projection to apply.
 *
 * @remarks
 * Deliberately a closed set of two. This is **not** the camera projection in
 * the sibling `projection` module: that one projects a 3D scene through a
 * camera, and the two meanings must never be conflated or share a name
 * merely because both are called projection.
 *
 * @internal Not a public API.
 */
export type ProjectionKind =
  /**
   * Longitude and latitude mapped linearly. Covers the whole world including
   * both poles, which makes it the baseline any other projection is checked
   * against.
   */
  | 'EQUIRECTANGULAR'
  /**
   * The familiar planar web-map projection. Conformal, and mathematically
   * undefined at the poles, so it carries a latitude limit rather than a
   * clamp.
   */
  | 'WEB_MERCATOR';

/**
 * The latitude beyond which Web Mercator is not admitted.
 *
 * @remarks
 * The standard web-map limit. `y` diverges logarithmically towards the poles,
 * so there is no honest finite value to clamp to: a coordinate outside this
 * range is refused rather than quietly moved, because moving it would place a
 * marker somewhere the caller did not ask for.
 */
export const WebMercatorLatitudeLimit = 85.05112877980659;

/**
 * Which part of the world to show.
 *
 * @remarks
 * Geographic intent only. The caller says what must be visible; this module
 * decides where that lands on a canvas. No pixel coordinate crosses in.
 *
 * @internal Not a public API.
 */
export type ExtentRequest =
  /** Everything the projection admits. */
  | {readonly kind: 'WHOLE_WORLD'}
  /** An explicitly declared interval. */
  | {readonly kind: 'BOUNDS'; readonly bounds: GeoBounds}
  /**
   * Fit exactly these features and points.
   *
   * @remarks
   * Named rather than implied by "everything supplied", because a map
   * routinely draws context it does not need to frame.
   */
  | {
      readonly kind: 'FIT';
      readonly featureIds: readonly string[];
      readonly points: readonly GeoPoint[];
    };

/**
 * The canvas region projected geometry must land inside.
 *
 * @remarks
 * `padding` is mechanical and comes from the caller's theme metrics. This
 * module has no opinion about margins, and no access to one.
 *
 * @internal Not a public API.
 */
export interface Viewport {
  readonly width: number;
  readonly height: number;
  readonly padding: number;
}

/**
 * How to turn declared endpoints into a drawable path.
 *
 * @remarks
 * The distinction is explanatory, not visual. A great circle and a projected
 * straight line between the same two airports are different claims about
 * distance, and which one was meant can never be recovered from the curvature
 * of the result - so it is declared, never inferred.
 *
 * @internal Not a public API.
 */
export type RoutePathKind =
  /** The shortest path across the spherical Earth model. */
  | 'GREAT_CIRCLE'
  /** Exactly the waypoints supplied, in order. */
  | 'DECLARED_POLYLINE'
  /** A straight segment in the projected plane, where that contrast is the point. */
  | 'PROJECTED_STRAIGHT';

/**
 * A path between declared positions.
 *
 * @remarks
 * A `GREAT_CIRCLE` or `PROJECTED_STRAIGHT` route carries exactly its two
 * endpoints; the intermediate geometry is sampled here, mechanically, from
 * those endpoints. A caller may not supply a pre-sampled great circle,
 * because copied geometry would then compete with the declared endpoints for
 * authority over where the route actually goes.
 *
 * @internal Not a public API.
 */
export interface GeoRoute {
  readonly id: string;
  readonly kind: RoutePathKind;
  readonly waypoints: readonly GeoPoint[];
}

/**
 * Everything needed to project one map plate.
 *
 * @internal Not a public API.
 */
export interface ProjectionRequest {
  readonly projection: ProjectionKind;
  readonly extent: ExtentRequest;
  readonly viewport: Viewport;
  readonly features: readonly GeoFeature[];
  readonly routes: readonly GeoRoute[];
  /** Standalone positions - markers, label anchors - to project and to fit. */
  readonly points: readonly IdentifiedGeoPoint[];
  /**
   * How finely a sampled route is subdivided.
   *
   * @remarks
   * Chosen by trusted lowering, never by candidate data: it is a rendering
   * tolerance, and letting content pick it would let content decide how
   * accurate its own route looks.
   */
  readonly routeSamples: number;
}

/**
 * A position carrying the identity of whatever it stands for.
 *
 * @internal Not a public API.
 */
export interface IdentifiedGeoPoint extends GeoPoint {
  readonly id: string;
}

/**
 * A position on the canvas.
 *
 * @internal Not a public API.
 */
export interface ProjectedPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * What became of a part once projected and clipped.
 *
 * @internal Not a public API.
 */
export type PartVisibility =
  /** Wholly inside the viewport. */
  | 'VISIBLE'
  /** Partly inside: some vertices were removed at the viewport edge. */
  | 'CLIPPED'
  /** Nothing of it falls inside the viewport. */
  | 'OUTSIDE'
  /** It survived projection but bounds no area, so there is nothing to draw. */
  | 'DEGENERATE';

/**
 * One projected boundary.
 *
 * @remarks
 * `sourceIndices` maps every output vertex back to the input vertex it came
 * from, or to `-1` for a vertex this module introduced - a seam crossing, a
 * viewport intersection, a route sample. That is what lets an independent
 * evaluator check a projected path against the coordinates it claims to
 * realize, instead of trusting that it does.
 *
 * @internal Not a public API.
 */
export interface ProjectedRing {
  readonly role: RingRole;
  readonly closed: boolean;
  readonly points: readonly ProjectedPoint[];
  readonly sourceIndices: readonly number[];
}

/**
 * One projected piece of a feature or route.
 *
 * @remarks
 * Identity is preserved at three levels - which feature, which part of it,
 * and which slice of that part a seam split produced - so that continuity,
 * interaction and verification can all address exactly one drawn thing.
 * Collapsing a plate into a single anonymous path would make all three
 * impossible.
 *
 * @internal Not a public API.
 */
export interface ProjectedPart {
  readonly sourceId: string;
  readonly partIndex: number;
  readonly sliceIndex: number;
  readonly visibility: PartVisibility;
  readonly rings: readonly ProjectedRing[];
}

/**
 * A projected standalone position.
 *
 * @internal Not a public API.
 */
export interface ProjectedMarker {
  readonly id: string;
  readonly source: GeoPoint;
  readonly position: ProjectedPoint;
  readonly inside: boolean;
}

/**
 * The plate: everything projected, plus what it was projected against.
 *
 * @remarks
 * `extent` is the interval actually used after a fit was resolved, which is
 * what an evaluator needs in order to recompute an anchor independently.
 *
 * @internal Not a public API.
 */
export interface ProjectedPlate {
  readonly projection: ProjectionKind;
  readonly extent: GeoBounds;
  readonly viewport: Viewport;
  readonly features: readonly ProjectedPart[];
  readonly routes: readonly ProjectedPart[];
  readonly markers: readonly ProjectedMarker[];
  /**
   * Parts that survived validation but could not be drawn.
   *
   * @remarks
   * Reported rather than dropped. A silently missing country is a wrong map
   * that looks right.
   */
  readonly unsupported: readonly UnsupportedPart[];
}

/**
 * A part this module declined to project, and why.
 *
 * @internal Not a public API.
 */
export interface UnsupportedPart {
  readonly sourceId: string;
  readonly partIndex: number;
  readonly reason: GeographyErrorCode;
}

/**
 * @internal Not a public API.
 */
export type GeographyErrorCode =
  /** A coordinate was NaN, Infinity or not a number. */
  | 'NON_FINITE_COORDINATE'
  /** A position was not an object carrying numeric longitude and latitude. */
  | 'INVALID_POINT'
  /** Longitude fell outside [-180, 180]. */
  | 'LONGITUDE_OUT_OF_RANGE'
  /** Latitude fell outside [-90, 90]. */
  | 'LATITUDE_OUT_OF_RANGE'
  /** The latitude is real but outside the selected projection's valid range. */
  | 'LATITUDE_UNPROJECTABLE'
  /** A ring was not an array, or carried too few vertices for its role. */
  | 'INVALID_RING'
  /** A closed part carried no exterior ring, or more than one. */
  | 'INVALID_PART'
  /** A ring enclosed no area once consecutive duplicates were removed. */
  | 'DEGENERATE_RING'
  /** A feature carried no parts, or was not an object. */
  | 'INVALID_FEATURE'
  /** Bounds were absent, non-finite, or had no extent. */
  | 'INVALID_BOUNDS'
  /** A fit was requested against nothing. */
  | 'EMPTY_FIT_TARGET'
  /** A fit referenced a feature that was not supplied. */
  | 'UNKNOWN_FIT_FEATURE'
  /** The viewport was absent, non-finite, or left no room after padding. */
  | 'INVALID_VIEWPORT'
  /** An identity was absent or did not match the canonical grammar. */
  | 'INVALID_ID'
  /** Two inputs claimed the same identity. */
  | 'DUPLICATE_ID'
  /** A route carried the wrong number of waypoints for its kind. */
  | 'INVALID_ROUTE'
  /** The requested projection is not admitted. */
  | 'UNKNOWN_PROJECTION'
  /** The route sample count was absent, non-integral or out of range. */
  | 'INVALID_SAMPLE_COUNT'
  /**
   * A ring encloses a pole, which this module does not cut at the seam.
   *
   * @remarks
   * Reported rather than approximated. Cutting a pole-enclosing ring
   * correctly means walking the seam *and* the pole edge, and drawing it
   * wrongly produces a shape that spans the entire plate.
   */
  | 'POLAR_RING_UNSUPPORTED';

/**
 * @internal Not a public API.
 */
export class GeographyError extends Error {
  public constructor(
    public readonly code: GeographyErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'GeographyError';
  }
}
