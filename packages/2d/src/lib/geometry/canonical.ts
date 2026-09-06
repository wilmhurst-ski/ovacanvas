import {
  Bounds2D,
  GeometryError,
  IdentifiedPoint2D,
  MultiPolygon2D,
  Point2D,
  Polygon2D,
  Ring2D,
} from './types';

const SEMANTIC_ID = /^[A-Za-z0-9_-]+$/;

/**
 * Normalize a coordinate, refusing anything that is not a finite number.
 *
 * @remarks
 * `-0` becomes `0`. The two are `===` but not `Object.is`, so leaving one in
 * would make two geometrically identical results serialize differently, and
 * canonical output that depends on how a subtraction happened to round is not
 * canonical.
 *
 * No rounding or quantization is applied. Determinism here comes from a
 * deterministic algorithm and a canonical ordering, not from throwing away
 * precision, so coordinates stay full 64-bit floats.
 *
 * @internal Not a public API.
 */
export function normalizeCoordinate(value: unknown, where: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new GeometryError(
      'NON_FINITE_COORDINATE',
      `${where} must be a finite number, received ${String(value)}.`,
    );
  }
  return value === 0 ? 0 : value;
}

/**
 * @internal Not a public API.
 */
export function normalizePoint(value: unknown, where: string): Point2D {
  if (value === null || typeof value !== 'object') {
    throw new GeometryError(
      'INVALID_POINT',
      `${where} must be an object with numeric x and y.`,
    );
  }
  const candidate = value as {x?: unknown; y?: unknown};
  return {
    x: normalizeCoordinate(candidate.x, `${where}.x`),
    y: normalizeCoordinate(candidate.y, `${where}.y`),
  };
}

/**
 * @internal Not a public API.
 */
export function validateSemanticId(value: unknown, where: string): string {
  if (typeof value !== 'string' || !SEMANTIC_ID.test(value)) {
    throw new GeometryError(
      'INVALID_ID',
      `${where} must match the canonical semantic ID grammar [A-Za-z0-9_-]+.`,
    );
  }
  return value;
}

/**
 * Twice the signed area of a ring, by the shoelace formula.
 *
 * @remarks
 * Positive means counter-clockwise in a y-up plane, which is the convention
 * the governing canonical form is written in. CAP-03 works in an abstract
 * plane; whether the presentation surface happens to point y downwards is a
 * rendering concern and deliberately does not reach this far.
 *
 * Expects an open ring - no repeated closing vertex.
 *
 * @internal Not a public API.
 */
export function signedDoubleArea(ring: readonly Point2D[]): number {
  let total = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const current = ring[i];
    const next = ring[(i + 1) % n];
    total += current.x * next.y - next.x * current.y;
  }
  return total;
}

/**
 * @internal Not a public API.
 */
export function comparePoints(a: Point2D, b: Point2D): number {
  if (a.x !== b.x) return a.x < b.x ? -1 : 1;
  if (a.y !== b.y) return a.y < b.y ? -1 : 1;
  return 0;
}

/**
 * @internal Not a public API.
 */
export function compareStableIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Lexicographical comparison over the complete canonical vertex sequence.
 *
 * @remarks
 * Comparing only the minimum vertex does not order two rings that share it,
 * which happens whenever rings touch at a corner or nest against one another.
 * Walking the whole sequence gives a total order, so equivalent geometry
 * always sorts into one arrangement.
 *
 * @internal Not a public API.
 */
export function compareRings(a: Ring2D, b: Ring2D): number {
  const shared = Math.min(a.length, b.length);
  for (let i = 0; i < shared; i++) {
    const point = comparePoints(a[i], b[i]);
    if (point !== 0) return point;
  }
  return a.length - b.length;
}

/**
 * Total order over polygons: outer ring first, then hole sequence, then the
 * number of rings.
 *
 * @internal Not a public API.
 */
export function comparePolygons(a: Polygon2D, b: Polygon2D): number {
  const outer = compareRings(a[0], b[0]);
  if (outer !== 0) return outer;

  const shared = Math.min(a.length, b.length);
  for (let i = 1; i < shared; i++) {
    const hole = compareRings(a[i], b[i]);
    if (hole !== 0) return hole;
  }
  return a.length - b.length;
}

/**
 * Strip the closing vertex and any consecutive duplicates.
 *
 * @remarks
 * A repeated vertex carries no shape, and leaving one in would make an
 * otherwise identical ring compare differently. Removal is cyclic: a ring
 * whose last vertex repeats its first is closed, not different.
 */
function openRing(ring: readonly Point2D[]): Point2D[] {
  const open: Point2D[] = [];
  for (const point of ring) {
    const previous = open[open.length - 1];
    if (previous && previous.x === point.x && previous.y === point.y) continue;
    open.push(point);
  }
  while (
    open.length > 1 &&
    open[0].x === open[open.length - 1].x &&
    open[0].y === open[open.length - 1].y
  ) {
    open.pop();
  }
  return open;
}

/**
 * Rotate a ring so its lexicographically smallest vertex comes first.
 *
 * @remarks
 * Applied after winding is fixed, because rotating a sequence that is about
 * to be reversed picks a different starting point.
 */
function rotateToMinimum(ring: readonly Point2D[]): Point2D[] {
  let best = 0;
  for (let i = 1; i < ring.length; i++) {
    if (comparePoints(ring[i], ring[best]) < 0) best = i;
  }
  return [...ring.slice(best), ...ring.slice(0, best)];
}

/**
 * Bring one ring to canonical form.
 *
 * @param ring - The raw ring, closed or open.
 * @param hole - Whether this ring bounds a void, which decides its winding.
 * @param where - Where this ring came from, for a refusal message.
 *
 * @returns A closed ring: canonical winding, rotated to its minimum vertex,
 *          with the first vertex repeated at the end.
 *
 * @internal Not a public API.
 */
export function canonicalizeRing(
  ring: unknown,
  hole: boolean,
  where: string,
): Ring2D {
  if (!Array.isArray(ring)) {
    throw new GeometryError('INVALID_RING', `${where} must be an array.`);
  }

  const normalized = ring.map((point, index) =>
    normalizePoint(point, `${where}[${index}]`),
  );
  const open = openRing(normalized);
  if (open.length < 3) {
    throw new GeometryError(
      'INVALID_RING',
      `${where} needs at least three distinct vertices, found ${open.length}.`,
    );
  }

  const area = signedDoubleArea(open);
  if (area === 0) {
    throw new GeometryError('DEGENERATE_RING', `${where} encloses no area.`);
  }

  // Outer rings counter-clockwise, holes clockwise. The clipping kernel emits
  // both windings the same way and distinguishes them by ring position, so
  // this is applied on the way out rather than trusted on the way in.
  const wantsCounterClockwise = !hole;
  const oriented =
    area > 0 === wantsCounterClockwise ? open : [...open].reverse();
  const rotated = rotateToMinimum(oriented);
  return [...rotated, rotated[0]];
}

/**
 * Bring one polygon to canonical form: canonical outer ring, canonical holes,
 * holes in total order.
 *
 * @internal Not a public API.
 */
export function canonicalizePolygon(
  polygon: unknown,
  where: string,
): Polygon2D {
  if (!Array.isArray(polygon) || polygon.length === 0) {
    throw new GeometryError(
      'INVALID_POLYGON',
      `${where} must be a non-empty array of rings.`,
    );
  }

  const outer = canonicalizeRing(polygon[0], false, `${where}[0]`);
  const holes = polygon
    .slice(1)
    .map((ring, index) =>
      canonicalizeRing(ring, true, `${where}[${index + 1}]`),
    )
    .sort(compareRings);

  return [outer, ...holes];
}

/**
 * Bring a multipolygon to canonical form and put its polygons in total order.
 *
 * @internal Not a public API.
 */
export function canonicalizeMultiPolygon(
  multipolygon: unknown,
  where = 'multipolygon',
): MultiPolygon2D {
  if (!Array.isArray(multipolygon)) {
    throw new GeometryError(
      'INVALID_MULTIPOLYGON',
      `${where} must be an array of polygons.`,
    );
  }
  return multipolygon
    .map((polygon, index) => canonicalizePolygon(polygon, `${where}[${index}]`))
    .sort(comparePolygons);
}

/**
 * @internal Not a public API.
 */
export function canonicalizeBounds(bounds: unknown): Bounds2D {
  if (bounds === null || typeof bounds !== 'object') {
    throw new GeometryError(
      'INVALID_BOUNDS',
      'Bounds must be an object with finite minX, minY, maxX and maxY.',
    );
  }
  const candidate = bounds as Record<string, unknown>;
  const minX = normalizeCoordinate(candidate.minX, 'bounds.minX');
  const minY = normalizeCoordinate(candidate.minY, 'bounds.minY');
  const maxX = normalizeCoordinate(candidate.maxX, 'bounds.maxX');
  const maxY = normalizeCoordinate(candidate.maxY, 'bounds.maxY');

  if (!(maxX > minX) || !(maxY > minY)) {
    throw new GeometryError(
      'INVALID_BOUNDS',
      `Bounds must have positive extent, received x [${minX}, ${maxX}] and y [${minY}, ${maxY}].`,
    );
  }
  return {minX, minY, maxX, maxY};
}

/**
 * Validate a point set, reject repeated positions, and put it in stable ID
 * order.
 *
 * @remarks
 * Duplicate positions are refused rather than merged. A partition cannot say
 * which of two seeds sharing a position owns the region around it, and the
 * kernel silently drops one, so accepting them would mean returning a result
 * that quietly lost an input.
 *
 * @internal Not a public API.
 */
export function canonicalizeIdentifiedPoints(
  points: unknown,
  minimum: number,
  where = 'points',
): IdentifiedPoint2D[] {
  if (!Array.isArray(points)) {
    throw new GeometryError(
      'INSUFFICIENT_POINTS',
      `${where} must be an array.`,
    );
  }
  if (points.length < minimum) {
    throw new GeometryError(
      'INSUFFICIENT_POINTS',
      `${where} needs at least ${minimum} points, received ${points.length}.`,
    );
  }

  const ids = new Set<string>();
  const positions = new Set<string>();
  const canonical = points.map((point, index) => {
    const raw = point as {id?: unknown};
    const id = validateSemanticId(raw?.id, `${where}[${index}].id`);
    if (ids.has(id)) {
      throw new GeometryError('DUPLICATE_ID', `Duplicate point ID: ${id}.`);
    }
    ids.add(id);

    const {x, y} = normalizePoint(point, `${where}[${index}]`);
    const key = `${x},${y}`;
    if (positions.has(key)) {
      throw new GeometryError(
        'DUPLICATE_POINT',
        `Point ${id} repeats the position (${x}, ${y}) of an earlier point.`,
      );
    }
    positions.add(key);
    return {id, x, y};
  });

  canonical.sort((a, b) => compareStableIds(a.id, b.id));
  return canonical;
}
