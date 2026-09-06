import {Delaunay} from 'd3-delaunay';
import {
  canonicalizeBounds,
  canonicalizeIdentifiedPoints,
  canonicalizeRing,
  compareStableIds,
  signedDoubleArea,
} from './canonical';
import {
  Bounds2D,
  GeometryError,
  IdentifiedPoint2D,
  Triangle2D,
  TriangulationResult,
  VoronoiCell2D,
  VoronoiResult,
} from './types';

/**
 * Build the kernel triangulation from points already in stable ID order.
 *
 * @remarks
 * Feeding the kernel a canonically ordered point set is what makes the result
 * independent of the order the caller happened to supply. The kernel's own
 * output is order-sensitive - it indexes whatever array it was handed - so
 * ordering the input is the only place that can be fixed.
 */
function buildDelaunay(points: readonly IdentifiedPoint2D[]): Delaunay {
  const flat = new Float64Array(points.length * 2);
  for (let i = 0; i < points.length; i++) {
    flat[i * 2] = points[i].x;
    flat[i * 2 + 1] = points[i].y;
  }
  return new Delaunay(flat);
}

function assertNotCollinear(delaunay: Delaunay, count: number): void {
  // Two points are trivially collinear and still partition the plane, so the
  // kernel does not flag them and neither does this.
  if (count >= 3 && delaunay.collinear) {
    throw new GeometryError(
      'COLLINEAR_POINT_SET',
      'Every point lies on one line. The kernel would perturb the input and ' +
        'report geometry built from points that were never supplied.',
    );
  }
}

/**
 * Delaunay-triangulate a finite point set.
 *
 * @param points - At least three identified points, no two at the same
 *                 position and not all on one line.
 *
 * @returns The points in stable ID order, and the triangles addressed by ID.
 *
 * @remarks
 * Triangles are addressed by semantic ID rather than by array index, because
 * an index is only meaningful next to the exact array it came from. Each
 * triangle is oriented counter-clockwise and rotated so its smallest ID comes
 * first, and the triangle list is then sorted, so the same point set always
 * produces the same result however the caller ordered it.
 *
 * @internal Not a public API. Shape is deliberately not frozen.
 */
export function triangulateDelaunay(points: unknown): TriangulationResult {
  const canonical = canonicalizeIdentifiedPoints(points, 3);
  const delaunay = buildDelaunay(canonical);
  assertNotCollinear(delaunay, canonical.length);

  const indices = delaunay.triangles;
  if (indices.length === 0 || indices.length % 3 !== 0) {
    throw new GeometryError(
      'OPERATION_FAILED',
      `The triangulation kernel returned ${indices.length} vertex indices, ` +
        'which is not a whole number of triangles.',
    );
  }

  const triangles: Triangle2D[] = [];
  for (let i = 0; i < indices.length; i += 3) {
    const corners = [
      canonical[indices[i]],
      canonical[indices[i + 1]],
      canonical[indices[i + 2]],
    ];
    if (corners.some(corner => corner === undefined)) {
      throw new GeometryError(
        'OPERATION_FAILED',
        'The triangulation kernel referenced a point that was not supplied.',
      );
    }

    // Orient counter-clockwise, then rotate the smallest ID to the front.
    // Orienting first keeps the winding meaningful; rotating afterwards makes
    // the three equivalent writings of one triangle a single writing.
    if (signedDoubleArea(corners) < 0) {
      const swap = corners[1];
      corners[1] = corners[2];
      corners[2] = swap;
    }
    let start = 0;
    for (let corner = 1; corner < 3; corner++) {
      if (compareStableIds(corners[corner].id, corners[start].id) < 0) {
        start = corner;
      }
    }
    triangles.push({
      a: corners[start].id,
      b: corners[(start + 1) % 3].id,
      c: corners[(start + 2) % 3].id,
    });
  }

  triangles.sort(
    (left, right) =>
      compareStableIds(left.a, right.a) ||
      compareStableIds(left.b, right.b) ||
      compareStableIds(left.c, right.c),
  );

  return {points: canonical, triangles};
}

function assertInsideBounds(point: IdentifiedPoint2D, bounds: Bounds2D): void {
  if (
    point.x < bounds.minX ||
    point.x > bounds.maxX ||
    point.y < bounds.minY ||
    point.y > bounds.maxY
  ) {
    throw new GeometryError(
      'SEED_OUTSIDE_BOUNDS',
      `Seed ${point.id} at (${point.x}, ${point.y}) lies outside the ` +
        `clipping bounds, so it has no cell to return.`,
    );
  }
}

/**
 * Partition a finite region among finite seeds.
 *
 * @param seeds - At least one identified seed, no two at the same position,
 *                every one inside `bounds`.
 * @param bounds - The finite region to partition.
 *
 * @returns One canonical cell per seed, in stable ID order.
 *
 * @remarks
 * Bounds are required, not optional. An unclipped Voronoi diagram has
 * unbounded cells, and an infinite ray is not geometry a renderer can be
 * handed, so CAP-03 never produces one.
 *
 * A seed outside the region is refused rather than returned without a cell:
 * dropping it would hand back a partition that quietly lost one of its
 * inputs.
 *
 * @internal Not a public API. Shape is deliberately not frozen.
 */
export function partitionVoronoi(
  seeds: unknown,
  bounds: unknown,
): VoronoiResult {
  const region = canonicalizeBounds(bounds);
  const canonical = canonicalizeIdentifiedPoints(seeds, 1, 'seeds');
  for (const seed of canonical) assertInsideBounds(seed, region);

  const delaunay = buildDelaunay(canonical);
  assertNotCollinear(delaunay, canonical.length);
  const diagram = delaunay.voronoi([
    region.minX,
    region.minY,
    region.maxX,
    region.maxY,
  ]);

  const cells: VoronoiCell2D[] = canonical.map((seed, index) => {
    const polygon = diagram.cellPolygon(index);
    if (!polygon || polygon.length < 4) {
      throw new GeometryError(
        'OPERATION_FAILED',
        `The partitioning kernel returned no usable cell for seed ${seed.id}.`,
      );
    }
    return {
      id: seed.id,
      seed: {x: seed.x, y: seed.y},
      ring: canonicalizeRing(
        polygon.map(position => ({x: position[0], y: position[1]})),
        false,
        `cell ${seed.id}`,
      ),
    };
  });

  return {bounds: region, cells};
}
