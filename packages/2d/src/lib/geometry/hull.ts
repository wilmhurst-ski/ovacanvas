import {canonicalizeRing, normalizePoint} from './canonical';
import {GeometryError, Point2D, Ring2D} from './types';

function cross(origin: Point2D, a: Point2D, b: Point2D): number {
  return (
    (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x)
  );
}

/**
 * The convex hull of a finite point set.
 *
 * @param points - At least three points, not all on one line.
 *
 * @returns A canonical closed ring: counter-clockwise, rotated to its
 *          lexicographically smallest vertex, with no vertex lying on the
 *          interior of a hull edge.
 *
 * @remarks
 * Andrew's monotone chain, written here rather than taken from the
 * triangulation kernel. The kernel derives its hull from a Delaunay
 * triangulation, and a triangulation of collinear points does not exist, so
 * it perturbs such input and reports a hull built from points the caller
 * never supplied. Monotone chain needs no triangulation, uses only exact
 * comparisons and one cross product, and reports collinear input as what it
 * is.
 *
 * Points on the interior of a hull edge are dropped, so the same shape
 * described with extra edge samples returns the same hull.
 *
 * @internal Not a public API. Shape is deliberately not frozen.
 */
export function convexHull(points: unknown): Ring2D {
  if (!Array.isArray(points)) {
    throw new GeometryError('INSUFFICIENT_POINTS', 'points must be an array.');
  }
  if (points.length < 3) {
    throw new GeometryError(
      'INSUFFICIENT_POINTS',
      `A convex hull needs at least three points, received ${points.length}.`,
    );
  }

  const normalized = points
    .map((point, index) => normalizePoint(point, `points[${index}]`))
    .sort((a, b) => (a.x !== b.x ? a.x - b.x : a.y - b.y));

  const lower: Point2D[] = [];
  for (const point of normalized) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0
    ) {
      lower.pop();
    }
    lower.push(point);
  }

  const upper: Point2D[] = [];
  for (let i = normalized.length - 1; i >= 0; i--) {
    const point = normalized[i];
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0
    ) {
      upper.pop();
    }
    upper.push(point);
  }

  lower.pop();
  upper.pop();
  const hull = [...lower, ...upper];

  if (hull.length < 3) {
    throw new GeometryError(
      'COLLINEAR_POINT_SET',
      'Every point lies on one line, so the set has no area-bearing hull.',
    );
  }

  return canonicalizeRing(hull, false, 'hull');
}
