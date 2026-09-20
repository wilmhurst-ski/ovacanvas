import type {BBox, Vector2} from '@ovacanvas/core';
import {segmentHitsBox} from './routes';
import type {AuditFinding, AuditItem, AuditableNode} from './types';
import {isItemVisible} from './types';
import {isFiniteBBox, worldBBox} from './worldBBox';

/**
 * Every `mayTouch` authorization must carry a non-empty reason. This is
 * checked separately from collision detection so a scene with a suspicious
 * blanket allow-list (every id, or `'*'`, with no stated reason) fails even
 * when nothing currently overlaps — the failure mode lab 2 shipped was an
 * allow-list broad enough to hide a real collision, not a currently-visible
 * one.
 */
export function collectMayTouchReasonErrors(
  items: readonly AuditItem[],
): AuditFinding[] {
  const findings: AuditFinding[] = [];
  for (const item of items) {
    for (const [targetId, reason] of item.mayTouch ?? []) {
      if (!reason.trim()) {
        findings.push({
          ruleId: 'mayTouch-reason',
          severity: 'blocking',
          entities: [item.id, targetId],
          message: `mayTouch authorization ${item.id} x ${targetId} has no reason`,
        });
      }
    }
  }
  return findings;
}

function mayTouchReason(a: AuditItem, b: AuditItem): string | undefined {
  return (
    a.mayTouch?.get(b.id) ??
    a.mayTouch?.get('*') ??
    b.mayTouch?.get(a.id) ??
    b.mayTouch?.get('*')
  );
}

/**
 * Whether `candidate` is a real ancestor of `node` in the actual scene tree
 * (not itself - a node is not its own ancestor).
 */
function isAncestorOf(candidate: AuditableNode, node: AuditableNode): boolean {
  let current = node.parent();
  while (current) {
    if (current === candidate) return true;
    current = current.parent();
  }
  return false;
}

/** A full circle's real disk (`filled`) or ring (`!filled`) footprint in
 * world space, or `null` when `node` isn't a genuine full circle (an
 * arc/sector, an ellipse, or a non-`Circle` shape) - callers fall back to
 * the plain bounding-box check in that case. */
interface CircleFootprint {
  readonly center: Vector2;
  readonly radius: number;
  readonly filled: boolean;
}

function tryCircleFootprint(
  node: AuditableNode,
  halo: number,
): CircleFootprint | null {
  if (
    typeof node.startAngle !== 'function' ||
    typeof node.endAngle !== 'function'
  ) {
    return null;
  }
  // An arc or sector doesn't occupy a full ring/disk - its true footprint is
  // a wedge the bounding box only loosely bounds, so this check backs off
  // to the (correct, if conservative) bounding-box comparison instead of
  // guessing at wedge geometry.
  if (node.startAngle() !== 0 || node.endAngle() !== 360) return null;

  const box = worldBBox(node);
  // A non-uniform scale turns a circle into an ellipse - real ellipse-vs-
  // ellipse intersection is a different (and rarer) problem; fall back
  // rather than approximate it as circular.
  if (Math.abs(box.width - box.height) > 1) return null;

  return {
    center: box.center,
    radius: box.width / 2 + halo,
    filled: (node.fill?.() ?? null) !== null,
  };
}

/**
 * Whether two full circles' real footprints (disks if filled, thin rings
 * if not) actually overlap - unlike their bounding boxes, which always
 * overlap for any two concentric circles regardless of radius, since a
 * smaller circle's square bounding box sits entirely inside a larger one's.
 * A ring's own thickness (a stroked circle's `lineWidth`) isn't threaded
 * through this check; treating a ring as infinitely thin only makes this
 * check slightly more permissive than reality (a hairline-thin true
 * negative in an extreme case), never less permissive, so it cannot turn a
 * real collision into a missed one - the same direction of error the
 * existing per-item `halo` margin already leans by design.
 */
function circlesOverlap(a: CircleFootprint, b: CircleFootprint): boolean {
  const distance = a.center.sub(b.center).magnitude;
  if (a.filled && b.filled) return distance < a.radius + b.radius;
  if (a.filled !== b.filled) {
    const [disk, ring] = a.filled ? [a, b] : [b, a];
    // The ring's circle crosses into the disk's area unless every point on
    // the ring is too far away (distance > disk.radius + ring.radius) or
    // the whole ring sits inside the disk's own empty center, further from
    // the disk's edge than the ring's own radius reaches back out
    // (distance < ring.radius - disk.radius).
    return (
      distance < disk.radius + ring.radius &&
      distance > ring.radius - disk.radius
    );
  }
  // Two rings only actually cross where their two circles intersect as
  // curves: too far apart, or one nested wholly inside the other's empty
  // center, and neither line ever touches the other.
  return (
    distance < a.radius + b.radius && distance > Math.abs(a.radius - b.radius)
  );
}

/**
 * Whether a circle's real footprint (disk or thin ring) overlaps an
 * arbitrary axis-aligned box - a label or shape sitting inside a ring's
 * empty center has a bounding box that overlaps the ring's own bounding
 * box every time, without ever crossing the ring's actual drawn line. A
 * disk overlaps the box exactly when the box's nearest point is within
 * the disk's radius (the standard circle-AABB test); a ring additionally
 * needs the box's farthest point to reach at least as far as the ring's
 * radius, or the whole box is nested in the ring's hole and the ring's
 * line never reaches it.
 */
function circleOverlapsBox(circle: CircleFootprint, box: BBox): boolean {
  const nearestX = Math.min(Math.max(circle.center.x, box.left), box.right);
  const nearestY = Math.min(Math.max(circle.center.y, box.top), box.bottom);
  const nearestDistance = Math.hypot(
    circle.center.x - nearestX,
    circle.center.y - nearestY,
  );
  if (circle.filled) return nearestDistance <= circle.radius;

  const corners: readonly [number, number][] = [
    [box.left, box.top],
    [box.right, box.top],
    [box.left, box.bottom],
    [box.right, box.bottom],
  ];
  const farthestDistance = Math.max(
    ...corners.map(([x, y]) =>
      Math.hypot(circle.center.x - x, circle.center.y - y),
    ),
  );
  return nearestDistance <= circle.radius && circle.radius <= farthestDistance;
}

/**
 * A thin polyline's real world-space points, or `null` when `node` isn't a
 * genuine `Line` (a filled/stroked area shape's bounding box is already a
 * reasonable approximation of what it occupies, unlike a diagonal line's).
 */
function tryLineFootprint(node: AuditableNode): readonly Vector2[] | null {
  if (typeof node.parsedPoints !== 'function') return null;
  const matrix = node.localToWorld();
  const points = node
    .parsedPoints()
    .map(point => point.transformAsPoint(matrix));
  return points.length >= 2 ? points : null;
}

function orientation(p: Vector2, q: Vector2, r: Vector2): number {
  return (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
}

function onSegment(p: Vector2, q: Vector2, r: Vector2): boolean {
  return (
    Math.min(p.x, r.x) <= q.x &&
    q.x <= Math.max(p.x, r.x) &&
    Math.min(p.y, r.y) <= q.y &&
    q.y <= Math.max(p.y, r.y)
  );
}

/** Real 2D segment-vs-segment intersection (the standard orientation test),
 * including the collinear-overlap edge case. */
function segmentsIntersect(
  a1: Vector2,
  a2: Vector2,
  b1: Vector2,
  b2: Vector2,
): boolean {
  const o1 = orientation(a1, a2, b1);
  const o2 = orientation(a1, a2, b2);
  const o3 = orientation(b1, b2, a1);
  const o4 = orientation(b1, b2, a2);
  if (
    o1 !== 0 &&
    o2 !== 0 &&
    o3 !== 0 &&
    o4 !== 0 &&
    o1 > 0 !== o2 > 0 &&
    o3 > 0 !== o4 > 0
  ) {
    return true;
  }
  if (o1 === 0 && onSegment(a1, b1, a2)) return true;
  if (o2 === 0 && onSegment(a1, b2, a2)) return true;
  if (o3 === 0 && onSegment(b1, a1, b2)) return true;
  return o4 === 0 && onSegment(b1, a2, b2);
}

function distanceToSegment(p: Vector2, a: Vector2, b: Vector2): number {
  const ab = b.sub(a);
  const lengthSquared = ab.dot(ab);
  if (lengthSquared === 0) return p.sub(a).magnitude;
  const t = Math.max(0, Math.min(1, p.sub(a).dot(ab) / lengthSquared));
  return p.sub(a.add(ab.scale(t))).magnitude;
}

function pointsEqual(a: Vector2, b: Vector2, epsilon = 0.01): boolean {
  return Math.abs(a.x - b.x) < epsilon && Math.abs(a.y - b.y) < epsilon;
}

/** Whether two segments share a declared endpoint (the normal shape of a
 * tree/graph's own edges - two edges from a common parent, or a route that
 * continues from where the last one ended). A segment can't also cross its
 * neighbor somewhere else while sharing one of its own endpoints with it
 * (short of an exactly-collinear overlap, a degenerate case not worth
 * special-casing here), so this is a safe, cheap check to do first. */
function segmentsShareEndpoint(
  a1: Vector2,
  a2: Vector2,
  b1: Vector2,
  b2: Vector2,
): boolean {
  return (
    pointsEqual(a1, b1) ||
    pointsEqual(a1, b2) ||
    pointsEqual(a2, b1) ||
    pointsEqual(a2, b2)
  );
}

/**
 * Whether two real polylines (each possibly more than one segment) ever
 * actually overlap - unlike their bounding boxes, which always overlap for
 * two segments that share or fan out from a common point (e.g. sibling tree
 * edges from the same parent), since a diagonal segment's AABB covers the
 * whole rectangle between its endpoints, far more area than the thin line
 * itself actually occupies.
 *
 * @remarks
 * A shared endpoint (two edges meeting at their common parent/child node) is
 * treated as a zero-area touch, not an overlap - the same convention
 * `BBox`'s own `intersects()` already uses for two boxes that merely share
 * an edge (e.g. adjacent grid cells at `halo: 0`). A genuine mid-segment
 * crossing (two edges of an X, say) is real ink overlap regardless of halo -
 * a halo widens how close two DISTINCT lines may pass without touching, it
 * cannot excuse two lines that actually cross through each other.
 */
function linesOverlap(
  a: readonly Vector2[],
  b: readonly Vector2[],
  halo: number,
): boolean {
  for (let i = 0; i < a.length - 1; i++) {
    for (let j = 0; j < b.length - 1; j++) {
      const [a1, a2, b1, b2] = [a[i], a[i + 1], b[j], b[j + 1]];
      if (segmentsShareEndpoint(a1, a2, b1, b2)) continue;
      if (segmentsIntersect(a1, a2, b1, b2)) return true;
      const distance = Math.min(
        distanceToSegment(a1, b1, b2),
        distanceToSegment(a2, b1, b2),
        distanceToSegment(b1, a1, a2),
        distanceToSegment(b2, a1, a2),
      );
      if (distance < halo) return true;
    }
  }
  return false;
}

/** Whether a real polyline ever actually crosses `box` (already expanded by
 * the box's own halo) - `halo` here is the LINE's own halo, applied by
 * further expanding the box, since a segment has no "shape" of its own to
 * expand the way a box does. */
function lineNearBox(
  points: readonly Vector2[],
  box: BBox,
  halo: number,
): boolean {
  const expanded = halo > 0 ? box.expand(halo) : box;
  for (let i = 0; i < points.length - 1; i++) {
    if (segmentHitsBox(points[i], points[i + 1], expanded)) return true;
  }
  return false;
}

/**
 * Whether `inner`'s box sits almost entirely inside `outer`'s, AND `outer`
 * is dramatically bigger - the geometric signature of a container/content
 * relationship (a piece inside a board's border, a label inside a cell, an
 * icon inside a badge) rather than two independently-placed things that
 * happen to overlap.
 *
 * @remarks
 * Both conditions matter, not just containment: two same-sized labels
 * placed on top of each other by mistake are also "almost entirely
 * contained" in one another (each is ~100% inside the other, since they're
 * nearly the same box) - the size-ratio requirement is what tells that
 * apart from a real container, where the outer item is typically several
 * times larger by design, not by coincidence.
 */
function containsSubstantially(
  outer: BBox,
  inner: BBox,
  containmentThreshold = 0.85,
  // A real container (a board's border, a cell wall, a badge) is typically
  // one to several ORDERS of magnitude bigger than what it holds - a
  // dramatic, unambiguous size difference, not merely "somewhat bigger". A
  // threshold as low as 3x-8x also matches two items that are simply
  // different sizes and genuinely overlap by mistake (confirmed by a real
  // regression: a small dot crossing paths with a label mid-animation, an
  // 8x area ratio, was wrongly exempted at that threshold - a real,
  // intended collision, not a container relationship).
  sizeRatioThreshold = 20,
): boolean {
  const innerArea = inner.width * inner.height;
  const outerArea = outer.width * outer.height;
  if (innerArea <= 0 || outerArea <= 0) return false;
  if (outerArea / innerArea < sizeRatioThreshold) return false;
  const overlap = inner.intersection(outer);
  const overlapArea = Math.max(0, overlap.width) * Math.max(0, overlap.height);
  return overlapArea / innerArea >= containmentThreshold;
}

/**
 * Whether two boxes' overlap is explained by an implicit container/content
 * relationship in EITHER direction - the general-purpose fallback for the
 * same real pattern `mayTouch: '*'` already covers by hand (a board's
 * border frame drawn around every piece on it, a cell wall drawn around
 * every organelle, a badge drawn around its own label). This makes that
 * pattern work automatically, without depending on the LLM remembering to
 * declare it - the exact class of mistake that kept shipping as
 * `border x piece_16`, `border x piece_17`, ... one finding per content
 * item, every time a background/container shape was drawn after the fact
 * (a follow-up "add borders" edit, say) without updating every existing
 * item's registration to match.
 *
 * @remarks
 * Deliberately NOT applied when either side is a recognized circle or line
 * - those already have real, more precise geometric models (a ring's actual
 * empty center, a segment's actual thin path) that a bare bounding-box
 * containment ratio would only approximate, and could override a
 * deliberately-tested real collision (a filled disk genuinely resting on
 * its own orbit ring, say, whose boxes also happen to satisfy a size-ratio
 * and containment check).
 */
function isImplicitContainment(a: BBox, b: BBox): boolean {
  return containsSubstantially(a, b) || containsSubstantially(b, a);
}

export function collectCollisions(items: readonly AuditItem[]): AuditFinding[] {
  const findings: AuditFinding[] = [];
  const visible = items.filter(item => isItemVisible(item));
  for (let i = 0; i < visible.length; i++) {
    for (let j = i + 1; j < visible.length; j++) {
      const a = visible[i];
      const b = visible[j];
      if (mayTouchReason(a, b) !== undefined) continue;
      // A container's own bounding box always encloses its children's -
      // that is what a bounding box of a node WITH children means, not an
      // accidental overlap between two independently-placed things. Without
      // this, registering a container (a `GeoMap`, a grouping `Node`)
      // alongside its own contents is a guaranteed false "collision" every
      // single time, for every scene that ever registers both - a real,
      // reproducible failure this check would otherwise report.
      if (isAncestorOf(a.node, b.node) || isAncestorOf(b.node, a.node)) {
        continue;
      }

      // A node whose bounds never resolved to real numbers (NaN/Infinity)
      // cannot meaningfully "overlap" anything - that defect is reported once
      // by the safe-area check as `non-finite-bounds`, not re-reported here as
      // a garbage collision against every other item in the scene.
      const aRaw = worldBBox(a.node);
      const bRaw = worldBBox(b.node);
      if (!isFiniteBBox(aRaw) || !isFiniteBBox(bRaw)) continue;

      const aBox = aRaw.expand(a.halo);
      const bBox = bRaw.expand(b.halo);
      if (!aBox.intersects(bBox)) continue;

      // Two full circles (e.g. concentric orbit rings around a nucleus) can
      // have fully-overlapping bounding boxes while their real drawn shapes
      // never touch at all - resolve that with real circle geometry before
      // reporting a bounding-box overlap as a visual collision. The same is
      // true of a circle next to any other shape (a label sitting inside a
      // ring's empty center, say): its bounding box overlaps the ring's
      // every time even when nothing about it ever crosses the drawn line.
      const circleA = tryCircleFootprint(a.node, a.halo);
      const circleB = tryCircleFootprint(b.node, b.halo);
      // Two thin lines (tree/graph edges, arrows, connectors) sharing or
      // fanning out from a common point have fully-overlapping bounding
      // boxes even when their actual drawn strokes only ever meet at that
      // one shared point - resolve that with real segment geometry the same
      // way concentric circles are resolved with real circle geometry above.
      const lineA = tryLineFootprint(a.node);
      const lineB = tryLineFootprint(b.node);
      if (circleA && circleB) {
        if (!circlesOverlap(circleA, circleB)) continue;
      } else if (circleA && !circleOverlapsBox(circleA, bBox)) {
        continue;
      } else if (circleB && !circleOverlapsBox(circleB, aBox)) {
        continue;
      } else if (lineA && lineB) {
        if (!linesOverlap(lineA, lineB, a.halo + b.halo)) continue;
      } else if (lineA && !lineNearBox(lineA, bBox, a.halo)) {
        continue;
      } else if (lineB && !lineNearBox(lineB, aBox, b.halo)) {
        continue;
      } else if (
        !circleA &&
        !circleB &&
        !lineA &&
        !lineB &&
        isImplicitContainment(aBox, bBox)
      ) {
        continue;
      }

      const geometry = aBox.intersection(bBox);
      // A grid computed by dividing a board's width by its column count (a
      // real chessboard's own math: boardWidth / 8) routinely lands on a
      // non-integer cell size, leaving neighboring cells overlapping along
      // their shared edge by a tiny fraction of a pixel - genuine
      // floating-point rounding noise from the scene's own arithmetic, not
      // a visible defect a viewer could ever perceive. That shows up as a
      // THIN SLIVER: one dimension of the overlap near zero (the rounding
      // error itself) while the other spans the whole shared edge (e.g. a
      // 1px-wide, 53px-tall overlap between two cells sharing a vertical
      // edge) - unlike a genuine 2D overlap between two things that were
      // never meant to touch, which is substantial in BOTH dimensions.
      // `BBox.intersects` already treats an EXACT zero-width touch as not
      // colliding; this extends that same tolerance to a few pixels of
      // rounding slop along one axis only.
      const subpixelEpsilon = 10;
      if (Math.min(geometry.width, geometry.height) < subpixelEpsilon) {
        continue;
      }
      findings.push({
        ruleId: 'collision',
        severity: 'blocking',
        entities: [a.id, b.id],
        geometry,
        message: `Visual collision: ${a.id} x ${b.id} at ${geometry.toString()}`,
      });
    }
  }
  return findings;
}

export function assertNoNodeCollisions(items: readonly AuditItem[]): void {
  const reasonErrors = collectMayTouchReasonErrors(items);
  if (reasonErrors.length > 0) throw new Error(reasonErrors[0].message);
  const collisions = collectCollisions(items);
  if (collisions.length > 0) throw new Error(collisions[0].message);
}
