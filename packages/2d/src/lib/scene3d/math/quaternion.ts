import {Scene3DError} from '../public/errors';
import type {QuaternionLike, Vec3Like} from '../public/types';
import {Vector3, assertFinite} from './vector3';

export class Quaternion {
  public static readonly identity = new Quaternion(0, 0, 0, 1);

  public readonly x: number;
  public readonly y: number;
  public readonly z: number;
  public readonly w: number;

  public constructor(x = 0, y = 0, z = 0, w = 1) {
    this.x = assertFinite(x, 'Quaternion.x');
    this.y = assertFinite(y, 'Quaternion.y');
    this.z = assertFinite(z, 'Quaternion.z');
    this.w = assertFinite(w, 'Quaternion.w');
  }

  public static from(
    like?: QuaternionLike | null,
    fallback = Quaternion.identity,
  ): Quaternion {
    if (!like) return fallback;
    if (like instanceof Quaternion) return like;
    if (Array.isArray(like)) {
      if (like.length < 4) {
        throw new Scene3DError(
          'INVALID_VECTOR',
          'Quaternion tuple must have 4 elements [x,y,z,w]',
        );
      }
      return new Quaternion(like[0], like[1], like[2], like[3]);
    }
    if (
      typeof like === 'object' &&
      'x' in like &&
      'y' in like &&
      'z' in like &&
      'w' in like
    ) {
      return new Quaternion(like.x, like.y, like.z, like.w);
    }
    throw new Scene3DError(
      'INVALID_VECTOR',
      `Invalid Quaternion input: ${JSON.stringify(like)}`,
    );
  }

  public static fromAxisAngle(
    axis: Vec3Like,
    angleRadians: number,
  ): Quaternion {
    const v = Vector3.from(axis).normalize();
    const halfAngle = angleRadians * 0.5;
    const s = Math.sin(halfAngle);
    return new Quaternion(
      v.x * s,
      v.y * s,
      v.z * s,
      Math.cos(halfAngle),
    ).normalize();
  }

  /**
   * Create quaternion from Euler angles in radians (intrinsic XYZ order).
   */
  public static fromEuler(
    pitchX: number,
    yawY: number,
    rollZ: number,
  ): Quaternion {
    const c1 = Math.cos(pitchX * 0.5);
    const s1 = Math.sin(pitchX * 0.5);
    const c2 = Math.cos(yawY * 0.5);
    const s2 = Math.sin(yawY * 0.5);
    const c3 = Math.cos(rollZ * 0.5);
    const s3 = Math.sin(rollZ * 0.5);

    return new Quaternion(
      s1 * c2 * c3 + c1 * s2 * s3,
      c1 * s2 * c3 - s1 * c2 * s3,
      c1 * c2 * s3 + s1 * s2 * c3,
      c1 * c2 * c3 - s1 * s2 * s3,
    ).normalize();
  }

  public toArray(): [number, number, number, number] {
    return [this.x, this.y, this.z, this.w];
  }

  public magnitudeSquared(): number {
    return (
      this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w
    );
  }

  public magnitude(): number {
    return Math.sqrt(this.magnitudeSquared());
  }

  public normalize(): Quaternion {
    const len = this.magnitude();
    if (len <= 1e-12) {
      return Quaternion.identity;
    }
    return new Quaternion(
      this.x / len,
      this.y / len,
      this.z / len,
      this.w / len,
    );
  }

  public multiply(other: QuaternionLike): Quaternion {
    const q = Quaternion.from(other);
    return new Quaternion(
      this.w * q.x + this.x * q.w + this.y * q.z - this.z * q.y,
      this.w * q.y - this.x * q.z + this.y * q.w + this.z * q.x,
      this.w * q.z + this.x * q.y - this.y * q.x + this.z * q.w,
      this.w * q.w - this.x * q.x - this.y * q.y - this.z * q.z,
    ).normalize();
  }

  public slerp(target: QuaternionLike, t: number): Quaternion {
    const q = Quaternion.from(target);
    let cosHalfTheta =
      this.x * q.x + this.y * q.y + this.z * q.z + this.w * q.w;

    let targetX = q.x;
    let targetY = q.y;
    let targetZ = q.z;
    let targetW = q.w;

    if (cosHalfTheta < 0) {
      cosHalfTheta = -cosHalfTheta;
      targetX = -targetX;
      targetY = -targetY;
      targetZ = -targetZ;
      targetW = -targetW;
    }

    if (cosHalfTheta >= 1.0 - 1e-6) {
      // Linear interpolation for very close orientations
      return new Quaternion(
        this.x + t * (targetX - this.x),
        this.y + t * (targetY - this.y),
        this.z + t * (targetZ - this.z),
        this.w + t * (targetW - this.w),
      ).normalize();
    }

    const halfTheta = Math.acos(cosHalfTheta);
    const sinHalfTheta = Math.sqrt(1.0 - cosHalfTheta * cosHalfTheta);
    const ratioA = Math.sin((1 - t) * halfTheta) / sinHalfTheta;
    const ratioB = Math.sin(t * halfTheta) / sinHalfTheta;

    return new Quaternion(
      this.x * ratioA + targetX * ratioB,
      this.y * ratioA + targetY * ratioB,
      this.z * ratioA + targetZ * ratioB,
      this.w * ratioA + targetW * ratioB,
    ).normalize();
  }
}
