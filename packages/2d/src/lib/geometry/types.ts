/**
 * A point in an abstract planar coordinate system.
 *
 * @remarks
 * Renderer-neutral. CAP-03 never sees pixels, canvases, nodes or scenes; a
 * caller that wants to draw a result converts these to whatever the
 * presentation primitive takes.
 *
 * @internal Not a public API. Shape is deliberately not frozen.
 */
export interface Point2D {
  readonly x: number;
  readonly y: number;
}

/**
 * A closed linear ring: the first and last vertices are equal, and there are
 * at least three distinct vertices.
 *
 * @internal Not a public API.
 */
export type Ring2D = readonly Point2D[];

/**
 * A polygon: one outer ring followed by zero or more hole rings.
 *
 * @remarks
 * Ring position carries the meaning, not winding. Index 0 is the outer ring
 * and every later ring is a hole, which is also how the clipping kernel
 * represents them. Canonical winding is applied on the way out.
 *
 * @internal Not a public API.
 */
export type Polygon2D = readonly Ring2D[];

/**
 * Zero or more polygons. An empty array is a legitimate result: two disjoint
 * shapes have an empty intersection.
 *
 * @internal Not a public API.
 */
export type MultiPolygon2D = readonly Polygon2D[];

/**
 * A point carrying the semantic identity of whatever it stands for.
 *
 * @remarks
 * Geometry is not semantic authority. When an operation produces one result
 * per input - a Voronoi cell per seed, a triangulation vertex per point - the
 * correspondence is carried by this ID, never by array position, because
 * array position is not stable across a caller reordering its own input.
 *
 * @internal Not a public API.
 */
export interface IdentifiedPoint2D extends Point2D {
  readonly id: string;
}

/**
 * A finite axis-aligned region. Voronoi partitioning requires one: an
 * unbounded cell is not geometry a renderer can consume.
 *
 * @internal Not a public API.
 */
export interface Bounds2D {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/**
 * One triangle of a Delaunay triangulation, addressed by stable point ID.
 *
 * @remarks
 * Oriented counter-clockwise and rotated so the lexicographically smallest ID
 * comes first, so the same triangle is written the same way no matter what
 * order the caller supplied its points in.
 *
 * @internal Not a public API.
 */
export interface Triangle2D {
  readonly a: string;
  readonly b: string;
  readonly c: string;
}

/**
 * @internal Not a public API.
 */
export interface TriangulationResult {
  /** Every input point, in stable ID order. */
  readonly points: readonly IdentifiedPoint2D[];
  /** Canonically ordered triangles addressed by point ID. */
  readonly triangles: readonly Triangle2D[];
}

/**
 * One Voronoi cell, clipped to the requested bounds.
 *
 * @internal Not a public API.
 */
export interface VoronoiCell2D {
  /** The seed this cell belongs to. */
  readonly id: string;
  readonly seed: Point2D;
  /** A canonical closed outer ring. */
  readonly ring: Ring2D;
}

/**
 * @internal Not a public API.
 */
export interface VoronoiResult {
  readonly bounds: Bounds2D;
  /** One cell per seed, in stable ID order. */
  readonly cells: readonly VoronoiCell2D[];
}

/**
 * Why a geometry request was refused.
 *
 * @remarks
 * Every one of these is a refusal, never a silent repair. Coercing malformed
 * geometry into something that computes would change what the caller meant.
 *
 * @internal Not a public API.
 */
export type GeometryErrorCode =
  /** A coordinate was NaN, Infinity or not a number. */
  | 'NON_FINITE_COORDINATE'
  /** A point was not an object carrying numeric x and y. */
  | 'INVALID_POINT'
  /** A ring was not an array, or had fewer than three distinct vertices. */
  | 'INVALID_RING'
  /** A ring enclosed no area once consecutive duplicates were removed. */
  | 'DEGENERATE_RING'
  /** A polygon was not an array of rings, or carried no outer ring. */
  | 'INVALID_POLYGON'
  /** A multipolygon was not an array of polygons. */
  | 'INVALID_MULTIPOLYGON'
  /** The clipping bounds were absent, non-finite or had no extent. */
  | 'INVALID_BOUNDS'
  /** An identity was absent or did not match the canonical grammar. */
  | 'INVALID_ID'
  /** Two inputs claimed the same identity. */
  | 'DUPLICATE_ID'
  /** Two identified points occupied the same position. */
  | 'DUPLICATE_POINT'
  /** Too few points for the requested operation. */
  | 'INSUFFICIENT_POINTS'
  /** Every point lay on one line, so no area-bearing result exists. */
  | 'COLLINEAR_POINT_SET'
  /** A Voronoi seed lay outside the clipping bounds. */
  | 'SEED_OUTSIDE_BOUNDS'
  /** The kernel returned something that is not valid finite geometry. */
  | 'OPERATION_FAILED';

/**
 * @internal Not a public API.
 */
export class GeometryError extends Error {
  public constructor(
    public readonly code: GeometryErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'GeometryError';
  }
}
