import {Scene3DError} from '../public/errors';
import type {Vec3Like} from '../public/types';

export function normalizeZero(val: number): number {
  return Object.is(val, -0) ? 0 : val;
}

export function assertFinite(val: number, field: string): number {
  if (typeof val !== 'number' || !Number.isFinite(val)) {
    throw new Scene3DError(
      'INVALID_VECTOR',
      `Non-finite number for ${field}: ${val}`,
    );
  }
  return normalizeZero(val);
}

export class Vector3 {
  public static readonly zero = new Vector3(0, 0, 0);
  public static readonly one = new Vector3(1, 1, 1);
  public static readonly up = new Vector3(0, 1, 0);
  public static readonly forward = new Vector3(0, 0, -1);
  public static readonly right = new Vector3(1, 0, 0);

  public readonly x: number;
  public readonly y: number;
  public readonly z: number;

  public constructor(x = 0, y = 0, z = 0) {
    this.x = assertFinite(x, 'Vector3.x');
    this.y = assertFinite(y, 'Vector3.y');
    this.z = assertFinite(z, 'Vector3.z');
  }

  public static from(like?: Vec3Like | null, fallback = Vector3.zero): Vector3 {
    if (!like) return fallback;
    if (like instanceof Vector3) return like;
    if (Array.isArray(like)) {
      if (like.length < 3) {
        throw new Scene3DError(
          'INVALID_VECTOR',
          'Vector tuple must have at least 3 elements',
        );
      }
      return new Vector3(like[0], like[1], like[2]);
    }
    if (typeof like === 'object' && 'x' in like && 'y' in like && 'z' in like) {
      return new Vector3(like.x, like.y, like.z);
    }
    throw new Scene3DError(
      'INVALID_VECTOR',
      `Invalid Vector3 input: ${JSON.stringify(like)}`,
    );
  }

  public toArray(): [number, number, number] {
    return [this.x, this.y, this.z];
  }

  public add(other: Vec3Like): Vector3 {
    const v = Vector3.from(other);
    return new Vector3(this.x + v.x, this.y + v.y, this.z + v.z);
  }

  public sub(other: Vec3Like): Vector3 {
    const v = Vector3.from(other);
    return new Vector3(this.x - v.x, this.y - v.y, this.z - v.z);
  }

  public scale(s: number): Vector3 {
    return new Vector3(this.x * s, this.y * s, this.z * s);
  }

  public dot(other: Vec3Like): number {
    const v = Vector3.from(other);
    return this.x * v.x + this.y * v.y + this.z * v.z;
  }

  public cross(other: Vec3Like): Vector3 {
    const v = Vector3.from(other);
    return new Vector3(
      this.y * v.z - this.z * v.y,
      this.z * v.x - this.x * v.z,
      this.x * v.y - this.y * v.x,
    );
  }

  public magnitudeSquared(): number {
    return this.x * this.x + this.y * this.y + this.z * this.z;
  }

  public magnitude(): number {
    return Math.sqrt(this.magnitudeSquared());
  }

  public normalize(): Vector3 {
    const len = this.magnitude();
    if (len <= 1e-12) {
      return Vector3.zero;
    }
    return this.scale(1 / len);
  }

  public distanceTo(other: Vec3Like): number {
    return this.sub(other).magnitude();
  }

  public equals(other: Vec3Like, epsilon = 1e-6): boolean {
    const v = Vector3.from(other);
    return (
      Math.abs(this.x - v.x) <= epsilon &&
      Math.abs(this.y - v.y) <= epsilon &&
      Math.abs(this.z - v.z) <= epsilon
    );
  }

  public negate(): Vector3 {
    return new Vector3(-this.x, -this.y, -this.z);
  }
}
