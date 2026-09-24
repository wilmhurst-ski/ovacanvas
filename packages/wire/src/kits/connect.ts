import {add, len, mul, sub} from '../diagram/geometry.js';
import type {Value} from '../document/model.js';

/**
 * Connectors: how every kit draws an arrow between two things.
 *
 * @remarks
 * One place for the look and the geometry of arrows, so a graph, a
 * diagram and a row of icons draw them alike: a light line with a slim
 * swept head, and a path that can be straight, bent into a curve, follow a
 * circle (a cycle drawn as a ring, not a polygon), pass smoothly through
 * points, or turn a corner softly. Paths are sampled into points, so they
 * trace, tween and audit like any other line, and every path is trimmed to
 * stop a clear gap short of the shapes it joins - a head never presses
 * into a box.
 */

export type Vec = [number, number];

/** How heavy an arrow is drawn. */
export type Weight = 'light' | 'normal' | 'bold';

const LOOK: Readonly<Record<Weight, {lineWidth: number; arrowSize: number}>> =
  {
    light: {lineWidth: 2, arrowSize: 10},
    normal: {lineWidth: 2.5, arrowSize: 13},
    bold: {lineWidth: 3.5, arrowSize: 15},
  };

/** The props that make a Line an arrow in the house style. */
export function arrowProps(
  weight: Weight = 'normal',
  head = true,
): Record<string, Value> {
  const look = LOOK[weight];
  return {
    lineWidth: look.lineWidth,
    lineCap: 'round',
    lineJoin: 'round',
    ...(head
      ? {endArrow: true, arrowSize: look.arrowSize, arrowStyle: 'swept'}
      : {}),
  };
}

/** A thing an arrow leaves or reaches: a box, a circle, or a point. */
export type End =
  | {readonly kind: 'box'; readonly c: Vec; readonly w: number; readonly h: number}
  | {readonly kind: 'circle'; readonly c: Vec; readonly r: number}
  | {readonly kind: 'point'; readonly c: Vec};


/** A quadratic curve from a to b, bowed sideways by `bend` of its length. */
export function curve(a: Vec, b: Vec, bend: number, samples?: number): Vec[] {
  const d = sub(b, a);
  const l = len(d) || 1;
  // About a point every 5px, so the curve never shows its facets.
  const count = samples ?? Math.max(16, Math.ceil((l * (1 + Math.abs(bend))) / 5));
  // Positive bends to the left of the direction of travel (on screen,
  // counter-clockwise).
  const n: Vec = [d[1] / l, -d[0] / l];
  const control = add(mul(add(a, b), 0.5), mul(n, bend * l));
  const out: Vec[] = [];
  for (let i = 0; i <= count; i++) {
    const t = i / count;
    const u = 1 - t;
    out.push([
      u * u * a[0] + 2 * u * t * control[0] + t * t * b[0],
      u * u * a[1] + 2 * u * t * control[1] + t * t * b[1],
    ]);
  }
  return out;
}

/**
 * Part of a circle (or, with `[rx, ry]`, an ellipse) about `center`, from
 * one angle to another (radians, on screen - y down), going the way
 * `clockwise` says. An ellipse's angles are its parametric angles: see
 * {@link ellipseAngle}.
 */
export function arc(
  center: Vec,
  radius: number | readonly [number, number],
  from: number,
  to: number,
  clockwise: boolean,
  /** Pixels per unit, when the arc is in a drawing's own units. */
  scale = 1,
): Vec[] {
  const [rx, ry] = typeof radius === 'number' ? [radius, radius] : radius;
  let sweep = to - from;
  const turn = 2 * Math.PI;
  if (clockwise) while (sweep <= 0) sweep += turn;
  else while (sweep >= 0) sweep -= turn;
  // About a point every 5px along the arc.
  const steps = Math.max(
    12,
    Math.ceil((Math.abs(sweep) * Math.max(rx, ry) * scale) / 5),
  );
  const out: Vec[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = from + (sweep * i) / steps;
    out.push([center[0] + rx * Math.cos(t), center[1] + ry * Math.sin(t)]);
  }
  return out;
}

/** The parametric angle of a point on an ellipse about `center`. */
export function ellipseAngle(
  p: Vec,
  center: Vec,
  radii: readonly [number, number],
): number {
  return Math.atan2((p[1] - center[1]) / radii[1], (p[0] - center[0]) / radii[0]);
}

/** A smooth path through every point (a Catmull-Rom spline). */
export function smooth(points: readonly Vec[], perSegment?: number): Vec[] {
  if (points.length < 3) return [...points];
  const out: Vec[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    const steps = perSegment ?? Math.max(6, Math.ceil(len(sub(p2, p1)) / 5));
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push([
        0.5 *
          (2 * p1[0] +
            (-p0[0] + p2[0]) * t +
            (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
            (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 *
          (2 * p1[1] +
            (-p0[1] + p2[1]) * t +
            (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
            (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      ]);
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

/** Whether a point is inside a shape grown by `pad`. */
function inside(p: Vec, end: End, pad: number): boolean {
  if (end.kind === 'point') return len(sub(p, end.c)) < pad;
  if (end.kind === 'circle') return len(sub(p, end.c)) < end.r + pad;
  return (
    Math.abs(p[0] - end.c[0]) < end.w / 2 + pad &&
    Math.abs(p[1] - end.c[1]) < end.h / 2 + pad
  );
}

/** Where a path first leaves a shape, walking from its start. */
function leave(points: readonly Vec[], end: End, pad: number): {i: number; p: Vec} | null {
  if (!inside(points[0], end, pad)) return {i: 0, p: points[0]};
  for (let i = 1; i < points.length; i++) {
    if (inside(points[i], end, pad)) continue;
    // Bisect the segment for the crossing.
    let lo = points[i - 1];
    let hi = points[i];
    for (let k = 0; k < 24; k++) {
      const mid: Vec = mul(add(lo, hi), 0.5);
      if (inside(mid, end, pad)) lo = mid;
      else hi = mid;
    }
    return {i, p: hi};
  }
  return null;
}

/**
 * The path cut to start where it leaves `from` and stop where it reaches
 * `to`, each a `gap` clear of the shape.
 */
export function trim(
  points: readonly Vec[],
  from: End | null,
  to: End | null,
  gap = 8,
): Vec[] {
  let path = [...points];
  if (from && from.kind !== 'point') {
    const hit = leave(path, from, gap);
    if (hit) path = [hit.p, ...path.slice(hit.i)];
  }
  if (to && to.kind !== 'point') {
    const reversed = [...path].reverse();
    const hit = leave(reversed, to, gap);
    if (hit) path = [hit.p, ...reversed.slice(hit.i)].reverse();
  }
  // Drop repeated points (in whatever units the path is in).
  let total = 0;
  for (let i = 1; i < path.length; i++) total += len(sub(path[i], path[i - 1]));
  const out: Vec[] = [];
  for (const p of path) {
    if (!out.length || len(sub(p, out[out.length - 1])) > total * 1e-4) out.push(p);
  }
  return out.length >= 2 ? out : [points[0], points[points.length - 1]];
}

/** Round a path's points for a document. */
export function rounded(points: readonly Vec[]): Value {
  return points.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]);
}

/** Whether two paths cross or touch anywhere. */
export function pathsCross(a: readonly Vec[], b: readonly Vec[]): boolean {
  const d = (p: Vec, q: Vec, r: Vec) =>
    (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  for (let i = 1; i < a.length; i++) {
    for (let j = 1; j < b.length; j++) {
      const [p1, p2, p3, p4] = [a[i - 1], a[i], b[j - 1], b[j]];
      if (d(p3, p4, p1) * d(p3, p4, p2) < 0 && d(p1, p2, p3) * d(p1, p2, p4) < 0) {
        return true;
      }
    }
  }
  return false;
}
