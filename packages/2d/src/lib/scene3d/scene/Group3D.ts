import {Bounds3} from '../math/bounds3';
import {Scene3DError} from '../public/errors';
import type {Ray3D, Transform3DSpec} from '../public/types';
import {Object3D, type RaycastHit} from './Object3D';

export class Group3D extends Object3D {
  private readonly childNodes: Object3D[] = [];

  public constructor(id: string, transform?: Transform3DSpec) {
    super(id, transform);
  }

  public get children(): readonly Object3D[] {
    return this.childNodes;
  }

  public add(child: Object3D): this {
    if (child === this) {
      throw new Scene3DError(
        'SINGULAR_TRANSFORM',
        'Cannot add an object as a child of itself',
      );
    }
    // Check for ancestor cycle
    let ancestor: Group3D | null = this.parent;
    while (ancestor) {
      if (ancestor === child) {
        throw new Scene3DError(
          'SINGULAR_TRANSFORM',
          'Cannot add ancestor as a child (cycle detected)',
        );
      }
      ancestor = ancestor.parent;
    }

    if (child.parent && child.parent !== this) {
      child.parent.remove(child);
    }

    const existingIndex = this.childNodes.indexOf(child);
    if (existingIndex === -1) {
      this.childNodes.push(child);
      child.parent = this;
      child.markWorldMatrixDirty();
    }
    return this;
  }

  public remove(child: Object3D): this {
    const idx = this.childNodes.indexOf(child);
    if (idx !== -1) {
      this.childNodes.splice(idx, 1);
      child.parent = null;
      child.markWorldMatrixDirty();
    }
    return this;
  }

  public override markWorldMatrixDirty(): void {
    super.markWorldMatrixDirty();
    for (const child of this.childNodes) {
      child.markWorldMatrixDirty();
    }
  }

  public override getLocalBounds(): Bounds3 {
    let combined = Bounds3.empty;
    for (const child of this.childNodes) {
      if (!child.visible) continue;
      const childBounds = child
        .getLocalBounds()
        .transform(child.getLocalMatrix());
      combined = combined.expandByBounds(childBounds);
    }
    return combined;
  }

  public override raycast(ray: Ray3D): RaycastHit | null {
    if (!this.visible) return null;

    let closest: RaycastHit | null = null;
    for (const child of this.childNodes) {
      if (!child.visible) continue;
      const hit = child.raycast(ray);
      if (hit && (!closest || hit.distance < closest.distance)) {
        closest = hit;
      }
    }
    return closest;
  }

  public override dispose(): void {
    for (const child of [...this.childNodes]) {
      child.dispose();
    }
    this.childNodes.length = 0;
    super.dispose();
  }
}
