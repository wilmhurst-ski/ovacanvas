export interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * The unit normal of segment `a`-`b` that points away from `awayFrom` -
 * whichever of the two perpendicular directions ends up farther from it.
 *
 * @remarks
 * This is the one piece of geometry every function in this file needs and
 * would otherwise get wrong by guessing: a segment has two perpendiculars,
 * and "outward" only means something relative to a reference point (a
 * triangle's opposite vertex, its centroid, a shape's own center) - never
 * derivable from the segment alone.
 */
function outwardNormal(a: Point, b: Point, awayFrom: Point): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy) || 1;
  const nx = -dy / length;
  const ny = dx / length;
  const midX = (a.x + b.x) / 2;
  const midY = (a.y + b.y) / 2;
  const towardCandidate = Math.hypot(
    midX + nx - awayFrom.x,
    midY + ny - awayFrom.y,
  );
  const awayCandidate = Math.hypot(
    midX - nx - awayFrom.x,
    midY - ny - awayFrom.y,
  );
  return towardCandidate >= awayCandidate ? {x: nx, y: ny} : {x: -nx, y: -ny};
}

export interface LabelOnSegmentOptions {
  /** How far outward (perpendicular to the segment) the label sits, in the
   * same units as the segment's own coordinates. Default 24 - enough to
   * clear a segment's stroke plus a small margin for a typical label size;
   * widen it for a thicker line or a larger label. */
  readonly distance?: number;
  /** Where along the segment the label sits, 0 = at `a`, 1 = at `b`.
   * Default 0.5, the midpoint - the normal place to name a side. */
  readonly t?: number;
}

/**
 * Where a label naming segment `a`-`b` should sit: at the segment's own
 * midpoint (or another point along it), offset perpendicular by `distance`,
 * on whichever side is away from `awayFrom`.
 *
 * @remarks
 * The exact, real failure this exists to fix: a triangle's side labeled "a"
 * placed at a guessed offset from the segment, which as often as not lands
 * ON the line instead of beside it, or beside it but on the WRONG side (into
 * the triangle's interior, overlapping its other sides). Passing the
 * triangle's third vertex (or its centroid) as `awayFrom` guarantees the
 * label lands outside the shape, at a real, computed clearance from the
 * segment - not a position that has to be hand-tuned until the audit stops
 * complaining.
 */
export function labelOnSegment(
  a: Point,
  b: Point,
  awayFrom: Point,
  options: LabelOnSegmentOptions = {},
): Point {
  const {distance = 24, t = 0.5} = options;
  const midX = a.x + (b.x - a.x) * t;
  const midY = a.y + (b.y - a.y) * t;
  const normal = outwardNormal(a, b, awayFrom);
  return {x: midX + normal.x * distance, y: midY + normal.y * distance};
}

export interface SquareOnSegmentResult {
  /** The four corners in order, starting from `a`: `a`, `b`, then the two
   * points `b` and `a` each pushed outward by the segment's own length -
   * this is exactly what `Path`'s `data` (`M x,y L x,y L x,y L x,y Z`) or a
   * `Line`'s `points` (with `closed: true`) wants, in order. */
  readonly corners: readonly [Point, Point, Point, Point];
  readonly center: Point;
}

/**
 * A square built flush against segment `a`-`b`, using it as one full edge,
 * extending outward on whichever side is away from `awayFrom`.
 *
 * @remarks
 * The exact, real failure this exists to fix: a Pythagorean-theorem diagram
 * where a square "built on" a triangle's leg was sized/positioned close to
 * right but not derived from the leg's own two endpoints, so it drifted far
 * enough to cross the triangle's hypotenuse. A square built THIS way shares
 * the segment as a real edge (not an approximation of one) and, since it is
 * only ever pushed outward from `awayFrom`, can never fold back across the
 * triangle's interior or its other sides - the mistake is structurally
 * impossible, not just less likely.
 */
export function squareOnSegment(
  a: Point,
  b: Point,
  awayFrom: Point,
): SquareOnSegmentResult {
  const normal = outwardNormal(a, b, awayFrom);
  const side = Math.hypot(b.x - a.x, b.y - a.y);
  const farB: Point = {x: b.x + normal.x * side, y: b.y + normal.y * side};
  const farA: Point = {x: a.x + normal.x * side, y: a.y + normal.y * side};
  const corners: readonly [Point, Point, Point, Point] = [a, b, farB, farA];
  const center: Point = {
    x: (a.x + b.x + farA.x + farB.x) / 4,
    y: (a.y + b.y + farA.y + farB.y) / 4,
  };
  return {corners, center};
}
