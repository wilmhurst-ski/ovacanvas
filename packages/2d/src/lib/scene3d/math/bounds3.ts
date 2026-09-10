import type {Bounds3D, Vec3Like} from '../public/types';
import type {Matrix4} from './matrix4';
import {Vector3} from './vector3';

export class Bounds3 {
  public static readonly empty = new Bounds3(Vector3.zero, Vector3.zero, true);

  public readonly min: Vector3;
  public readonly max: Vector3;
  private readonly emptyFlag: boolean;

  public constructor(min: Vec3Like, max: Vec3Like, empty = false) {
    this.min = Vector3.from(min);
    this.max = Vector3.from(max);
    this.emptyFlag = empty;
  }

  public static fromPoints(
    positions: readonly number[] | Float32Array,
  ): Bounds3 {
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;

    const len = positions.length;
    for (let i = 0; i < len; i += 3) {
      const x = positions[i];
      const y = positions[i + 1];
      const z = positions[i + 2];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }

    if (minX === Infinity) {
      return Bounds3.empty;
    }
    return new Bounds3(
      new Vector3(minX, minY, minZ),
      new Vector3(maxX, maxY, maxZ),
    );
  }

  public isEmpty(): boolean {
    return (
      this.emptyFlag ||
      this.min.x > this.max.x ||
      this.min.y > this.max.y ||
      this.min.z > this.max.z
    );
  }

  public getCenter(): Vector3 {
    if (this.isEmpty()) return Vector3.zero;
    return new Vector3(
      (this.min.x + this.max.x) * 0.5,
      (this.min.y + this.max.y) * 0.5,
      (this.min.z + this.max.z) * 0.5,
    );
  }

  public getSize(): Vector3 {
    if (this.isEmpty()) return Vector3.zero;
    return new Vector3(
      this.max.x - this.min.x,
      this.max.y - this.min.y,
      this.max.z - this.min.z,
    );
  }

  public getRadius(): number {
    return this.getSize().magnitude() * 0.5;
  }

  public expandByPoint(p: Vec3Like): Bounds3 {
    const v = Vector3.from(p);
    if (this.isEmpty()) {
      return new Bounds3(v, v);
    }
    return new Bounds3(
      new Vector3(
        Math.min(this.min.x, v.x),
        Math.min(this.min.y, v.y),
        Math.min(this.min.z, v.z),
      ),
      new Vector3(
        Math.max(this.max.x, v.x),
        Math.max(this.max.y, v.y),
        Math.max(this.max.z, v.z),
      ),
    );
  }

  public expandByBounds(other: Bounds3): Bounds3 {
    if (other.isEmpty()) return this;
    if (this.isEmpty()) return other;
    return new Bounds3(
      new Vector3(
        Math.min(this.min.x, other.min.x),
        Math.min(this.min.y, other.min.y),
        Math.min(this.min.z, other.min.z),
      ),
      new Vector3(
        Math.max(this.max.x, other.max.x),
        Math.max(this.max.y, other.max.y),
        Math.max(this.max.z, other.max.z),
      ),
    );
  }

  public transform(m: Matrix4): Bounds3 {
    if (this.isEmpty()) return Bounds3.empty;

    const corners = [
      new Vector3(this.min.x, this.min.y, this.min.z),
      new Vector3(this.max.x, this.min.y, this.min.z),
      new Vector3(this.min.x, this.max.y, this.min.z),
      new Vector3(this.max.x, this.max.y, this.min.z),
      new Vector3(this.min.x, this.min.y, this.max.z),
      new Vector3(this.max.x, this.min.y, this.max.z),
      new Vector3(this.min.x, this.max.y, this.max.z),
      new Vector3(this.max.x, this.max.y, this.max.z),
    ];

    let result = Bounds3.empty;
    for (const c of corners) {
      result = result.expandByPoint(m.transformPoint(c));
    }
    return result;
  }

  public toSpec(): Bounds3D {
    return {
      min: {x: this.min.x, y: this.min.y, z: this.min.z},
      max: {x: this.max.x, y: this.max.y, z: this.max.z},
    };
  }
}
