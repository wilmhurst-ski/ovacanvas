/**
 * Public geographic types and specifications for OvaCanvas.
 *
 * @remarks
 * These types form the closed, serializable geographic contract of `@ovacanvas/2d`.
 * They strictly hide all private D3 types and mutable objects.
 */

/**
 * Admitted cartographic projection identifiers.
 */
export type GeoProjectionKind =
  | 'equirectangular'
  | 'mercator'
  | 'orthographic'
  | 'equalEarth'
  | 'naturalEarth1';

/**
 * A geographic coordinate in WGS84 degrees.
 *
 * @remarks
 * Longitude is east-positive in `[-180, 180]`; latitude is north-positive in `[-90, 90]`.
 */
export interface GeoPoint {
  readonly longitude: number;
  readonly latitude: number;
}

/**
 * A bounding interval in geographic coordinates.
 */
export interface GeoBounds {
  readonly west: number;
  readonly east: number;
  readonly south: number;
  readonly north: number;
  readonly crossesAntimeridian?: boolean;
}

/**
 * Immutable serializable specification for a cartographic projection.
 */
export interface GeoProjectionSpec {
  /** The admitted projection type. */
  readonly kind: GeoProjectionKind;

  /** Projection center in `[longitude, latitude]` degrees. */
  readonly center?: readonly [longitude: number, latitude: number];

  /** Three-axis spherical rotation: `[lambda, phi, gamma]` in degrees. */
  readonly rotate?: readonly [lambda: number, phi: number, gamma?: number];

  /** Planar rotation angle in degrees. */
  readonly angle?: number;

  /** Scale factor. Defaults vary by projection. */
  readonly scale?: number;

  /** Translation offset `[x, y]` in canvas pixels. */
  readonly translate?: readonly [x: number, y: number];

  /** Spherical clipping angle in degrees (e.g., 90 for orthographic hemisphere). */
  readonly clipAngle?: number | null;

  /** Planar clipping rectangle `[[x0, y0], [x1, y1]]` in canvas pixels. */
  readonly clipExtent?:
    | readonly [
        readonly [x0: number, y0: number],
        readonly [x1: number, y1: number],
      ]
    | null;

  /** Adaptive resampling threshold in pixels. */
  readonly precision?: number;

  /** Reflection along x-axis. */
  readonly reflectX?: boolean;

  /** Reflection along y-axis. */
  readonly reflectY?: boolean;

  /** Target geometry and bounding box for automatic fitting. */
  readonly fit?: {
    readonly target: GeoFeatureSource | readonly GeoFeatureSource[];
    readonly extent: readonly [
      readonly [x0: number, y0: number],
      readonly [x1: number, y1: number],
    ];
  };
}

/**
 * Wrapper for standard GeoJSON geometry with a stable OvaCanvas identifier.
 */
export interface GeoFeatureSource {
  /** Authoritative feature identifier. */
  readonly id: string;

  /** GeoJSON Geometry, Feature, FeatureCollection, or Sphere object. */
  readonly geometry: any;
}

/**
 * Admitted route construction types.
 */
export type GeoRouteKind =
  | 'geodesic'
  | 'rhumb'
  | 'declared_polyline'
  | 'projected_segment';

/**
 * Specification for a geographic route.
 */
export interface GeoRouteSpec {
  /** Authoritative route identifier. */
  readonly id: string;

  /** Route construction semantics. */
  readonly kind: GeoRouteKind;

  /** Sequence of `[longitude, latitude]` waypoints in degrees. */
  readonly waypoints: readonly (readonly [
    longitude: number,
    latitude: number,
  ])[];

  /** Sample resolution for curved segments. */
  readonly samples?: number;
}

/**
 * Geographic graticule configuration.
 */
export interface GeoGraticuleSpec {
  /** Step interval between major meridians and parallels in degrees `[lonStep, latStep]`. */
  readonly step?: readonly [lonStep: number, latStep: number];

  /** Step interval for minor lines in degrees `[lonStep, latStep]`. */
  readonly stepMinor?: readonly [lonStep: number, latStep: number];

  /** Bounding extent for graticule lines `[[west, south], [east, north]]`. */
  readonly extent?: readonly [
    readonly [west: number, south: number],
    readonly [east: number, north: number],
  ];

  /** Resampling precision for graticule curves. */
  readonly precision?: number;
}

/**
 * Authoritative spherical measurement results.
 */
export interface GeoMeasurementResult {
  /** Great-circle angular distance in radians. */
  readonly angularDistanceRad: number;

  /** Surface distance in meters based on spherical Earth model (R ≈ 6,371,008.8 meters). */
  readonly distanceMeters: number;

  /** Initial bearing in degrees `[0, 360)`. */
  readonly initialBearingDeg: number;

  /** Final bearing in degrees `[0, 360)`. */
  readonly finalBearingDeg: number;
}

/**
 * Information exposed during inspection and hit-testing of geographic nodes.
 */
export interface GeoInspectionInfo {
  readonly id: string;
  readonly kind: 'feature' | 'route' | 'marker' | 'graticule' | 'sphere';
  readonly projectedBounds: readonly [
    x0: number,
    y0: number,
    x1: number,
    y1: number,
  ];
  readonly centerProjected: readonly [x: number, y: number];
  readonly centerGeographic?: readonly [longitude: number, latitude: number];
}
