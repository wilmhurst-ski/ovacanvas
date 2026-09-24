/**
 * Plane geometry for diagrams, in diagram units with y down (as on the
 * stage). Angles a person writes are degrees with 0 = right and 90 = up.
 */

export type Vec = [number, number];

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1]];
export const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1]];
export const mul = (a: Vec, k: number): Vec => [a[0] * k, a[1] * k];
export const dot = (a: Vec, b: Vec): number => a[0] * b[0] + a[1] * b[1];
export const cross = (a: Vec, b: Vec): number => a[0] * b[1] - a[1] * b[0];
export const len = (a: Vec): number => Math.hypot(a[0], a[1]);
export const dist = (a: Vec, b: Vec): number => len(sub(a, b));

export function unit(a: Vec): Vec {
  const l = len(a);
  return l < 1e-12 ? [1, 0] : [a[0] / l, a[1] / l];
}

/** A direction a person names in degrees: 0 = right, 90 = up. */
export function fromDegrees(degrees: number): Vec {
  const r = (degrees * Math.PI) / 180;
  return [Math.cos(r), -Math.sin(r)];
}

/** The degrees (0 = right, 90 = up) of a direction. */
export function toDegrees(v: Vec): number {
  return (Math.atan2(-v[1], v[0]) * 180) / Math.PI;
}

/** A stage rotation (degrees, clockwise on screen) turning +x onto `v`. */
export function stageRotation(v: Vec): number {
  return (Math.atan2(v[1], v[0]) * 180) / Math.PI;
}

export function rotate(v: Vec, stageDegrees: number): Vec {
  const r = (stageDegrees * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [v[0] * c - v[1] * s, v[0] * s + v[1] * c];
}

export function emptyBounds(): Bounds {
  return {minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity};
}

export function grow(b: Bounds, p: Vec, pad = 0): void {
  b.minX = Math.min(b.minX, p[0] - pad);
  b.minY = Math.min(b.minY, p[1] - pad);
  b.maxX = Math.max(b.maxX, p[0] + pad);
  b.maxY = Math.max(b.maxY, p[1] + pad);
}

export function union(a: Bounds, b: Bounds): Bounds {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

export function isEmpty(b: Bounds): boolean {
  return !(b.maxX >= b.minX && b.maxY >= b.minY);
}

export function centerOf(b: Bounds): Vec {
  return [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];
}

/** Where two infinite lines meet, as parameters along each, or null. */
export function lineParams(
  p: Vec,
  r: Vec,
  q: Vec,
  s: Vec,
): {t: number; u: number} | null {
  const d = cross(r, s);
  if (Math.abs(d) < 1e-12) return null;
  const qp = sub(q, p);
  return {t: cross(qp, s) / d, u: cross(qp, r) / d};
}

/** The foot of the perpendicular from `p` to the line through a and b. */
export function foot(p: Vec, a: Vec, b: Vec): Vec {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  if (l2 < 1e-12) return a;
  return add(a, mul(ab, dot(sub(p, a), ab) / l2));
}

export function distanceToSegment(p: Vec, a: Vec, b: Vec): number {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  const t = l2 < 1e-12 ? 0 : Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  return dist(p, add(a, mul(ab, t)));
}

/** Total length of a polyline. */
export function pathLength(points: readonly Vec[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += dist(points[i - 1], points[i]);
  }
  return total;
}

/** The point a fraction `t` of the way along a polyline, and its direction. */
export function along(
  points: readonly Vec[],
  t: number,
): {point: Vec; tangent: Vec} {
  const total = pathLength(points);
  let remaining = Math.max(0, Math.min(1, t)) * total;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const l = dist(a, b);
    if (remaining <= l || i === points.length - 1) {
      const k = l < 1e-12 ? 0 : Math.min(1, remaining / l);
      return {point: add(a, mul(sub(b, a), k)), tangent: unit(sub(b, a))};
    }
    remaining -= l;
  }
  return {point: points[0] ?? [0, 0], tangent: [1, 0]};
}

/**
 * Where a ray from `from` in direction `d` leaves a box, as the distance
 * along the ray (`d` a unit vector), or 0 when it starts outside.
 */
export function exitDistance(from: Vec, d: Vec, b: Bounds): number {
  let best = Infinity;
  const tryPlane = (t: number) => {
    if (t > 1e-9 && t < best) {
      const p = add(from, mul(d, t));
      if (
        p[0] >= b.minX - 1e-6 &&
        p[0] <= b.maxX + 1e-6 &&
        p[1] >= b.minY - 1e-6 &&
        p[1] <= b.maxY + 1e-6
      ) {
        best = t;
      }
    }
  };
  if (Math.abs(d[0]) > 1e-12) {
    tryPlane((b.minX - from[0]) / d[0]);
    tryPlane((b.maxX - from[0]) / d[0]);
  }
  if (Math.abs(d[1]) > 1e-12) {
    tryPlane((b.minY - from[1]) / d[1]);
    tryPlane((b.maxY - from[1]) / d[1]);
  }
  return Number.isFinite(best) ? best : 0;
}

/** Area centroid of a polygon (a turn spins it about its middle). */
export function centroid(points: readonly Vec[]): Vec {
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < points.length; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[(i + 1) % points.length];
    const c = x0 * y1 - x1 * y0;
    area += c;
    cx += (x0 + x1) * c;
    cy += (y0 + y1) * c;
  }
  if (Math.abs(area) < 1e-12) {
    return [
      points.reduce((s, p) => s + p[0], 0) / Math.max(1, points.length),
      points.reduce((s, p) => s + p[1], 0) / Math.max(1, points.length),
    ];
  }
  return [cx / (3 * area), cy / (3 * area)];
}

/** A small deterministic random sequence, seeded by a name. */
export function seeded(name: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let state = h >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 4294967296;
  };
}
