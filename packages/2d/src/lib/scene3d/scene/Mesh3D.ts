import {computeGeometryBounds} from '../geometry/bounds';
import {
  canonicalizeTriangles,
  type CanonicalTriangleGeometry,
} from '../geometry/canonicalize';
import {Bounds3} from '../math/bounds3';
import {Matrix4} from '../math/matrix4';
import {Ray3} from '../math/ray3';
import {Vector3} from '../math/vector3';
import {fingerprintTriangleGeometry} from '../public/fingerprint';
import type {
  Material3DSpec,
  Ray3D,
  Transform3DSpec,
  TriangleGeometry3D,
} from '../public/types';
import {Object3D, type RaycastHit} from './Object3D';

export class Mesh3D extends Object3D {
  public readonly geometry: CanonicalTriangleGeometry;
  public readonly material: Material3DSpec;
  public readonly fingerprint: string;
  private readonly cachedLocalBounds: Bounds3;

  public constructor(
    id: string,
    geometry: TriangleGeometry3D,
    material: Material3DSpec = {kind: 'unlit', color: '#ffffff'},
    transform?: Transform3DSpec,
  ) {
    super(id, transform);
    this.geometry = canonicalizeTriangles(geometry);
    this.material = material;
    this.fingerprint = fingerprintTriangleGeometry(geometry);
    this.cachedLocalBounds = computeGeometryBounds(this.geometry);
  }

  public override getLocalBounds(): Bounds3 {
    return this.cachedLocalBounds;
  }

  public override raycast(ray: Ray3D): RaycastHit | null {
    if (!this.visible) return null;

    const worldMatrix = this.getWorldMatrix();
    let invWorld: Matrix4;
    try {
      invWorld = worldMatrix.invert();
    } catch {
      return null;
    }

    // Transform ray to local space
    const localOrigin = invWorld.transformPoint(ray.origin);
    const localTarget = invWorld.transformPoint(
      Vector3.from(ray.origin).add(Vector3.from(ray.direction)),
    );
    const localDirection = localTarget.sub(localOrigin).normalize();
    const localRay = new Ray3(localOrigin, localDirection);

    // Fast bounds rejection
    const boxHit = localRay.intersectBox(this.cachedLocalBounds);
    if (boxHit === null) {
      return null;
    }

    const positions = this.geometry.positions;
    const indices = this.geometry.indices;
    const numTriangles = indices.length / 3;

    const cullBackface = this.material.side === 'front';

    let closestLocalDist = Infinity;
    let closestIndex = -1;
    let closestBarycentric: [number, number, number] | undefined;
    let closestLocalPoint: Vector3 | null = null;

    for (let i = 0; i < numTriangles; i++) {
      const i0 = indices[i * 3];
      const i1 = indices[i * 3 + 1];
      const i2 = indices[i * 3 + 2];

      const v0 = [
        positions[i0 * 3],
        positions[i0 * 3 + 1],
        positions[i0 * 3 + 2],
      ] as const;
      const v1 = [
        positions[i1 * 3],
        positions[i1 * 3 + 1],
        positions[i1 * 3 + 2],
      ] as const;
      const v2 = [
        positions[i2 * 3],
        positions[i2 * 3 + 1],
        positions[i2 * 3 + 2],
      ] as const;

      const hit = localRay.intersectTriangle(v0, v1, v2, cullBackface);
      if (hit && hit.distance < closestLocalDist) {
        closestLocalDist = hit.distance;
        closestIndex = i;
        closestBarycentric = hit.barycentric;
        closestLocalPoint = hit.point;
      }
    }

    if (!closestLocalPoint || closestIndex === -1) {
      return null;
    }

    const worldHitPos = worldMatrix.transformPoint(closestLocalPoint);
    const worldDist = Vector3.from(ray.origin).distanceTo(worldHitPos);

    return {
      objectId: this.id,
      distance: worldDist,
      worldPosition: worldHitPos,
      localPosition: closestLocalPoint,
      primitiveKind: 'triangle',
      primitiveIndex: closestIndex,
      barycentric: closestBarycentric,
    };
  }
}
