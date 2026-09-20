import {canonicalizeRing, signedDoubleArea} from './canonical';
import {GeometryError, Point2D, Ring2D} from './types';

function validateCutFraction(t: unknown): number {
  if (typeof t !== 'number' || !Number.isFinite(t) || t <= 0 || t >= 1) {
    throw new GeometryError(
      'INVALID_RATIO',
      `cut fraction must be a finite number strictly between 0 and 1, received ${String(t)}.`,
    );
  }
  return t;
}

function ringArea(ring: Ring2D): number {
  return Math.abs(signedDoubleArea(ring.slice(0, -1))) / 2;
}

/**
 * The polygon formed by cutting every edge of `ring` at the same fraction
 * `t` along its direction of travel, and connecting those cut points in
 * order.
 *
 * @remarks
 * Applying the same cut to every edge, in the same rotational direction, is
 * what makes the result a rotated, scaled copy of a regular polygon rather
 * than an arbitrary inscribed shape - the construction behind "whirling
 * squares"/"whirling polygons" spirals and their kin (`t = 0.5`, cutting at
 * each edge's midpoint, is the classic case). `t` near 0 or 1 barely moves
 * each new vertex off the last one's original position, so the shape barely
 * shrinks per step; both endpoints are refused since they degenerate to the
 * input ring itself.
 *
 * @param ring - A polygon ring, open or closed.
 * @param t - Where along each edge to cut, strictly between 0 and 1.
 *
 * @internal Not a public API. Shape is deliberately not frozen.
 */
export function inscribedRing(ring: unknown, t: number): Ring2D {
  const cut = validateCutFraction(t);
  const canonical = canonicalizeRing(ring, false, 'ring');
  const open = canonical.slice(0, -1);

  const cutPoints: Point2D[] = open.map((point, index) => {
    const next = open[(index + 1) % open.length];
    return {
      x: point.x + cut * (next.x - point.x),
      y: point.y + cut * (next.y - point.y),
    };
  });

  return canonicalizeRing(cutPoints, false, 'inscribedRing result');
}

export interface SelfSimilarStep {
  /** 0 for the input ring itself, incrementing by one cut per step. */
  readonly iteration: number;
  readonly ring: Ring2D;
  readonly area: number;
}

export interface SelfSimilarSequence {
  readonly steps: readonly SelfSimilarStep[];
  /**
   * `area(steps[1]) / area(steps[0])` - constant across every step for a
   * regular polygon, since the same cut fraction applied uniformly to every
   * edge is a similarity transform. This is the number a "proof without
   * words" geometric-series diagram's algebraic side is written in terms
   * of - computed once here from the actual geometry and handed back as
   * data, instead of a scene deriving and re-typing it separately from the
   * diagram, which is exactly the kind of duplication that lets a lesson's
   * picture and its equation quietly drift apart.
   */
  readonly ratio: number;
}

/**
 * Repeatedly inscribe a ring inside itself by the same cut fraction,
 * collecting every intermediate ring.
 *
 * @remarks
 * The general capability behind the whole "recursive/self-similar
 * construction" genre of visual explanation - nested-polygon spirals,
 * whirling-square/golden-spiral diagrams, and any other "keep applying the
 * same shrink-and-rotate step" picture - factored out from any one of
 * them. A scene draws `steps[i].ring` as a `Line`, and builds its paired
 * `growThrough` sum using `ratio` directly rather than a second, independent
 * calculation that could disagree with what actually got drawn.
 *
 * @param ring - The starting ring, open or closed.
 * @param t - The cut fraction applied at every step; see {@link inscribedRing}.
 * @param iterations - How many more rings to produce beyond the starting one.
 */
export function iterateInscribedRings(
  ring: unknown,
  t: number,
  iterations: number,
): SelfSimilarSequence {
  if (!Number.isInteger(iterations) || iterations < 1) {
    throw new GeometryError(
      'INVALID_ITERATION_COUNT',
      `iterations must be a positive integer, received ${String(iterations)}.`,
    );
  }

  const first = canonicalizeRing(ring, false, 'ring');
  const steps: SelfSimilarStep[] = [
    {iteration: 0, ring: first, area: ringArea(first)},
  ];

  let current = first;
  for (let i = 1; i <= iterations; i++) {
    current = inscribedRing(current, t);
    steps.push({iteration: i, ring: current, area: ringArea(current)});
  }

  const ratio = steps[1].area / steps[0].area;
  return {steps, ratio};
}
