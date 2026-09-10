import {Bounds3} from '../math/bounds3';
import {Matrix4} from '../math/matrix4';
import {Quaternion} from '../math/quaternion';
import {Vector3} from '../math/vector3';
import {Scene3DError} from '../public/errors';
import type {
  QuaternionLike,
  Ray3D,
  Transform3DSpec,
  Vec3Like,
} from '../public/types';
import type {Group3D} from './Group3D';

export interface RaycastHit {
  objectId: string;
  distance: number;
  worldPosition: Vector3;
  localPosition: Vector3;
  primitiveKind: 'triangle' | 'line' | 'point';
  primitiveIndex: number;
  barycentric?: readonly [number, number, number];
}

export abstract class Object3D {
  public readonly id: string;
  public parent: Group3D | null = null;

  public visible = true;
  public renderOrder = 0;

  private localTranslation = Vector3.zero;
  private localRotation = Quaternion.identity;
  private localScale = Vector3.one;

  private localMatrixInternal = Matrix4.identity;
  private worldMatrixInternal = Matrix4.identity;
  private localMatrixDirty = true;
  private worldMatrixDirty = true;

  protected disposed = false;

  public constructor(id: string, transform?: Transform3DSpec) {
    if (!id || typeof id !== 'string' || id.trim().length === 0) {
      throw new Scene3DError(
        'DUPLICATE_OBJECT_ID',
        'Object3D must be created with a non-empty string id',
      );
    }
    this.id = id;

    if (transform) {
      if (transform.translation)
        {this.localTranslation = Vector3.from(transform.translation);}
      if (transform.rotation)
        {this.localRotation = Quaternion.from(transform.rotation);}
      if (transform.scale)
        {this.localScale = Vector3.from(transform.scale, Vector3.one);}
    }
  }

  public get translation(): Vector3 {
    return this.localTranslation;
  }

  public set translation(val: Vec3Like) {
    this.localTranslation = Vector3.from(val);
    this.markDirty();
  }

  public get rotation(): Quaternion {
    return this.localRotation;
  }

  public set rotation(val: QuaternionLike) {
    this.localRotation = Quaternion.from(val);
    this.markDirty();
  }

  public get scale(): Vector3 {
    return this.localScale;
  }

  public set scale(val: Vec3Like) {
    this.localScale = Vector3.from(val, Vector3.one);
    this.markDirty();
  }

  public markDirty(): void {
    this.localMatrixDirty = true;
    this.markWorldMatrixDirty();
  }

  public markWorldMatrixDirty(): void {
    this.worldMatrixDirty = true;
  }

  public getLocalMatrix(): Matrix4 {
    if (this.localMatrixDirty) {
      this.localMatrixInternal = Matrix4.compose(
        this.localTranslation,
        this.localRotation,
        this.localScale,
      );
      this.localMatrixDirty = false;
    }
    return this.localMatrixInternal;
  }

  public getWorldMatrix(): Matrix4 {
    const local = this.getLocalMatrix();
    if (this.worldMatrixDirty) {
      if (this.parent) {
        this.worldMatrixInternal = this.parent.getWorldMatrix().multiply(local);
      } else {
        this.worldMatrixInternal = local;
      }
      this.worldMatrixDirty = false;
    }
    return this.worldMatrixInternal;
  }

  public abstract getLocalBounds(): Bounds3;

  public getWorldBounds(): Bounds3 {
    return this.getLocalBounds().transform(this.getWorldMatrix());
  }

  public abstract raycast(ray: Ray3D): RaycastHit | null;

  public dispose(): void {
    this.disposed = true;
    if (this.parent) {
      this.parent.remove(this);
      this.parent = null;
    }
  }

  public isDisposed(): boolean {
    return this.disposed;
  }
}
