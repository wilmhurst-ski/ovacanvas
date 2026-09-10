import type {Ray3D, Vec3Like} from '../public/types';
import type {Bounds3} from './bounds3';
import {Vector3} from './vector3';

export interface TriangleIntersection {
  distance: number;
  point: Vector3;
  barycentric: [number, number, number];
}

export interface SegmentIntersection {
  distance: number;
  point: Vector3;
}

export interface PointIntersection {
  distance: number;
  point: Vector3;
}

export class Ray3 implements Ray3D {
  public readonly origin: Vector3;
  public readonly direction: Vector3;

  public constructor(origin: Vec3Like, direction: Vec3Like) {
    this.origin = Vector3.from(origin);
    this.direction = Vector3.from(direction).normalize();
  }

  public at(t: number): Vector3 {
    return this.origin.add(this.direction.scale(t));
  }

  /**
   * Ray-AABB intersection using Kay-Kayasia slab test.
   */
  public intersectBox(box: Bounds3): number | null {
    if (box.isEmpty()) return null;

    let tmin = -Infinity;
    let tmax = Infinity;

    const min = box.min;
    const max = box.max;

    const axes: Array<'x' | 'y' | 'z'> = ['x', 'y', 'z'];
    for (const axis of axes) {
      const invD =
        1.0 / (this.direction[axis] !== 0 ? this.direction[axis] : 1e-12);
      let t0 = (min[axis] - this.origin[axis]) * invD;
      let t1 = (max[axis] - this.origin[axis]) * invD;

      if (invD < 0.0) {
        const tmp = t0;
        t0 = t1;
        t1 = tmp;
      }

      tmin = Math.max(tmin, t0);
      tmax = Math.min(tmax, t1);

      if (tmax < tmin || tmax < 0) {
        return null;
      }
    }

    return tmin >= 0 ? tmin : tmax >= 0 ? 0 : null;
  }

  /**
   * Möller–Trumbore intersection algorithm.
   */
  public intersectTriangle(
    v0Like: Vec3Like,
    v1Like: Vec3Like,
    v2Like: Vec3Like,
    cullBackface = false,
  ): TriangleIntersection | null {
    const v0 = Vector3.from(v0Like);
    const v1 = Vector3.from(v1Like);
    const v2 = Vector3.from(v2Like);

    const edge1 = v1.sub(v0);
    const edge2 = v2.sub(v0);

    const pvec = this.direction.cross(edge2);
    const det = edge1.dot(pvec);

    if (cullBackface) {
      if (det < 1e-8) return null;
    } else {
      if (Math.abs(det) < 1e-8) return null;
    }

    const invDet = 1.0 / det;
    const tvec = this.origin.sub(v0);
    const u = tvec.dot(pvec) * invDet;
    if (u < 0.0 || u > 1.0) return null;

    const qvec = tvec.cross(edge1);
    const v = this.direction.dot(qvec) * invDet;
    if (v < 0.0 || u + v > 1.0) return null;

    const t = edge2.dot(qvec) * invDet;
    if (t < 1e-6) return null;

    const hitPoint = this.at(t);
    const w = 1.0 - u - v;
    return {
      distance: t,
      point: hitPoint,
      barycentric: [w, u, v],
    };
  }

  /**
   * Shortest distance from ray to segment [p0, p1].
   */
  public intersectSegment(
    p0Like: Vec3Like,
    p1Like: Vec3Like,
    tolerance = 0.05,
  ): SegmentIntersection | null {
    const p0 = Vector3.from(p0Like);
    const p1 = Vector3.from(p1Like);

    const u = this.direction;
    const v = p1.sub(p0);
    const w0 = this.origin.sub(p0);

    const a = u.dot(u); // 1.0
    const b = u.dot(v);
    const c = v.dot(v);
    const d = u.dot(w0);
    const e = v.dot(w0);

    const denom = a * c - b * b;
    let sN: number;
    let sD = denom;
    let tN: number;
    let tD = denom;

    if (denom < 1e-8) {
      sN = 0.0;
      sD = 1.0;
      tN = e;
      tD = c;
    } else {
      sN = b * e - c * d;
      tN = a * e - b * d;
      if (sN < 0.0) {
        sN = 0.0;
        tN = e;
        tD = c;
      }
    }

    if (tN < 0.0) {
      tN = 0.0;
      if (-d < 0.0) {
        sN = 0.0;
      } else {
        sN = -d;
        sD = a;
      }
    } else if (tN > tD) {
      tN = tD;
      if (-d + b < 0.0) {
        sN = 0.0;
      } else {
        sN = -d + b;
        sD = a;
      }
    }

    const sc = Math.abs(sN) < 1e-8 ? 0.0 : sN / sD;
    const tc = Math.abs(tN) < 1e-8 ? 0.0 : tN / tD;

    const rayPoint = this.origin.add(u.scale(sc));
    const segPoint = p0.add(v.scale(tc));

    const dist = rayPoint.distanceTo(segPoint);
    if (dist <= tolerance && sc >= 0) {
      return {
        distance: sc,
        point: segPoint,
      };
    }

    return null;
  }

  /**
   * Shortest distance from ray to a point.
   */
  public intersectPoint(
    pointLike: Vec3Like,
    tolerance = 0.05,
  ): PointIntersection | null {
    const pt = Vector3.from(pointLike);
    const v = pt.sub(this.origin);
    const proj = v.dot(this.direction);
    if (proj < 0) return null;

    const closestOnRay = this.origin.add(this.direction.scale(proj));
    const dist = closestOnRay.distanceTo(pt);
    if (dist <= tolerance) {
      return {
        distance: proj,
        point: pt,
      };
    }
    return null;
  }
}
