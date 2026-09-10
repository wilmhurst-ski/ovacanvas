import {mat3, mat4, vec3, vec4} from 'gl-matrix';
import {Scene3DError} from '../public/errors';
import type {QuaternionLike, Vec3Like} from '../public/types';
import {Quaternion} from './quaternion';
import {Vector3, assertFinite} from './vector3';

export type Matrix4Like = readonly number[] | Float32Array;
export type Matrix3Like = readonly number[] | Float32Array;

export class Matrix4 {
  public static readonly identity = new Matrix4(
    1,
    0,
    0,
    0,
    0,
    1,
    0,
    0,
    0,
    0,
    1,
    0,
    0,
    0,
    0,
    1,
  );

  public readonly elements: Float32Array;

  public constructor(
    m00 = 1,
    m01 = 0,
    m02 = 0,
    m03 = 0,
    m10 = 0,
    m11 = 1,
    m12 = 0,
    m13 = 0,
    m20 = 0,
    m21 = 0,
    m22 = 1,
    m23 = 0,
    m30 = 0,
    m31 = 0,
    m32 = 0,
    m33 = 1,
  ) {
    this.elements = new Float32Array([
      assertFinite(m00, 'm00'),
      assertFinite(m01, 'm01'),
      assertFinite(m02, 'm02'),
      assertFinite(m03, 'm03'),
      assertFinite(m10, 'm10'),
      assertFinite(m11, 'm11'),
      assertFinite(m12, 'm12'),
      assertFinite(m13, 'm13'),
      assertFinite(m20, 'm20'),
      assertFinite(m21, 'm21'),
      assertFinite(m22, 'm22'),
      assertFinite(m23, 'm23'),
      assertFinite(m30, 'm30'),
      assertFinite(m31, 'm31'),
      assertFinite(m32, 'm32'),
      assertFinite(m33, 'm33'),
    ]);
  }

  public static fromArray(arr: Matrix4Like): Matrix4 {
    if (arr.length !== 16) {
      throw new Scene3DError(
        'INVALID_MATRIX',
        `Matrix4 requires exactly 16 values, got ${arr.length}`,
      );
    }
    return new Matrix4(
      arr[0],
      arr[1],
      arr[2],
      arr[3],
      arr[4],
      arr[5],
      arr[6],
      arr[7],
      arr[8],
      arr[9],
      arr[10],
      arr[11],
      arr[12],
      arr[13],
      arr[14],
      arr[15],
    );
  }

  public static compose(
    translation?: Vec3Like,
    rotation?: QuaternionLike,
    scale?: Vec3Like,
  ): Matrix4 {
    const t = Vector3.from(translation);
    const q = Quaternion.from(rotation);
    const s = Vector3.from(scale, Vector3.one);

    const out = mat4.create();
    mat4.fromRotationTranslationScale(
      out,
      q.toArray(),
      t.toArray(),
      s.toArray(),
    );
    return Matrix4.fromArray(out);
  }

  public static lookAt(
    eyeLike: Vec3Like,
    targetLike: Vec3Like,
    upLike?: Vec3Like,
  ): Matrix4 {
    const eye = Vector3.from(eyeLike);
    const target = Vector3.from(targetLike);
    const up = Vector3.from(upLike, Vector3.up);

    if (eye.equals(target, 1e-6)) {
      throw new Scene3DError(
        'INVALID_CAMERA',
        'Camera eye and target cannot be coincident',
      );
    }
    if (up.magnitudeSquared() < 1e-12) {
      throw new Scene3DError(
        'INVALID_CAMERA',
        'Camera up vector cannot be zero',
      );
    }

    const viewDir = target.sub(eye).normalize();
    const upNorm = up.normalize();
    if (Math.abs(viewDir.dot(upNorm)) > 0.999999) {
      throw new Scene3DError(
        'INVALID_CAMERA',
        'Camera view direction and up vector are collinear',
      );
    }

    const out = mat4.create();
    mat4.lookAt(out, eye.toArray(), target.toArray(), upNorm.toArray());
    return Matrix4.fromArray(out);
  }

  public static perspective(
    verticalFovRadians: number,
    aspect: number,
    near: number,
    far: number,
  ): Matrix4 {
    if (
      !Number.isFinite(verticalFovRadians) ||
      verticalFovRadians <= 0 ||
      verticalFovRadians >= Math.PI
    ) {
      throw new Scene3DError(
        'INVALID_CAMERA',
        `Invalid vertical FOV: ${verticalFovRadians}`,
      );
    }
    if (!Number.isFinite(aspect) || aspect <= 0) {
      throw new Scene3DError(
        'INVALID_CAMERA',
        `Invalid camera aspect ratio: ${aspect}`,
      );
    }
    if (!Number.isFinite(near) || near <= 0) {
      throw new Scene3DError(
        'INVALID_CAMERA',
        `Invalid perspective near plane: ${near}`,
      );
    }
    if (!Number.isFinite(far) || far <= near) {
      throw new Scene3DError(
        'INVALID_CAMERA',
        `Invalid perspective far plane: ${far} (must be > near ${near})`,
      );
    }

    const out = mat4.create();
    mat4.perspective(out, verticalFovRadians, aspect, near, far);
    return Matrix4.fromArray(out);
  }

  public static orthographic(
    left: number,
    right: number,
    bottom: number,
    top: number,
    near: number,
    far: number,
  ): Matrix4 {
    if (left === right || bottom === top || near === far) {
      throw new Scene3DError(
        'INVALID_CAMERA',
        'Orthographic bounds cannot have zero extent',
      );
    }
    const out = mat4.create();
    mat4.ortho(out, left, right, bottom, top, near, far);
    return Matrix4.fromArray(out);
  }

  public multiply(other: Matrix4): Matrix4 {
    const out = mat4.create();
    mat4.multiply(out, this.elements, other.elements);
    return Matrix4.fromArray(out);
  }

  public invert(): Matrix4 {
    const out = mat4.create();
    const det = mat4.invert(out, this.elements);
    if (!det) {
      throw new Scene3DError(
        'SINGULAR_TRANSFORM',
        'Matrix is not invertible (determinant is 0)',
      );
    }
    return Matrix4.fromArray(out);
  }

  public transpose(): Matrix4 {
    const out = mat4.create();
    mat4.transpose(out, this.elements);
    return Matrix4.fromArray(out);
  }

  /**
   * Computes the 3x3 normal matrix (inverse transpose of upper 3x3) as a 9-element Float32Array.
   */
  public normalMatrix(): Float32Array {
    const out = mat3.create();
    mat3.normalFromMat4(out, this.elements);
    return new Float32Array(out);
  }

  public transformPoint(point: Vec3Like): Vector3 {
    const p = Vector3.from(point);
    const v = vec4.fromValues(p.x, p.y, p.z, 1.0);
    vec4.transformMat4(v, v, this.elements);
    if (v[3] !== 0 && v[3] !== 1) {
      return new Vector3(v[0] / v[3], v[1] / v[3], v[2] / v[3]);
    }
    return new Vector3(v[0], v[1], v[2]);
  }

  public transformVector(vector: Vec3Like): Vector3 {
    const v = Vector3.from(vector);
    const out = vec3.fromValues(v.x, v.y, v.z);
    vec3.transformMat4(out, out, this.elements);
    return new Vector3(out[0], out[1], out[2]);
  }

  public toArray(): number[] {
    return Array.from(this.elements);
  }
}
