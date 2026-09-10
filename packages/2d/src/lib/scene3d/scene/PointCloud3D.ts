import {computeGeometryBounds} from '../geometry/bounds';
import {
  canonicalizePoints,
  type CanonicalPointGeometry,
} from '../geometry/canonicalize';
import {Bounds3} from '../math/bounds3';
import {Matrix4} from '../math/matrix4';
import {Ray3} from '../math/ray3';
import {Vector3} from '../math/vector3';
import {fingerprintPointGeometry} from '../public/fingerprint';
import type {
  ColorLike,
  PointGeometry3D,
  Ray3D,
  Transform3DSpec,
} from '../public/types';
import {Object3D, type RaycastHit} from './Object3D';

export class PointCloud3D extends Object3D {
  public readonly geometry: CanonicalPointGeometry;
  public pointSize = 5.0;
  public depthTest = true;
  public color: ColorLike = '#ffffff';
  public opacity = 1.0;
  public readonly fingerprint: string;
  private readonly cachedLocalBounds: Bounds3;

  public constructor(
    id: string,
    geometry: PointGeometry3D,
    options: {
      pointSize?: number;
      depthTest?: boolean;
      color?: ColorLike;
      opacity?: number;
      transform?: Transform3DSpec;
    } = {},
  ) {
    super(id, options.transform);
    this.geometry = canonicalizePoints(geometry);
    if (options.pointSize !== undefined)
      {this.pointSize = Math.max(1, Math.min(64, options.pointSize));}
    if (options.depthTest !== undefined) this.depthTest = options.depthTest;
    if (options.color !== undefined) this.color = options.color;
    if (options.opacity !== undefined)
      {this.opacity = Math.max(0, Math.min(1, options.opacity));}
    this.fingerprint = fingerprintPointGeometry(geometry);
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

    const localOrigin = invWorld.transformPoint(ray.origin);
    const localTarget = invWorld.transformPoint(
      Vector3.from(ray.origin).add(Vector3.from(ray.direction)),
    );
    const localDirection = localTarget.sub(localOrigin).normalize();
    const localRay = new Ray3(localOrigin, localDirection);

    const positions = this.geometry.positions;
    const vertexCount = this.geometry.vertexCount;
    const defaultTolerance = 0.05 * (this.pointSize / 5.0);

    let closestLocalDist = Infinity;
    let closestIndex = -1;
    let closestLocalPoint: Vector3 | null = null;

    for (let i = 0; i < vertexCount; i++) {
      const pt = [
        positions[i * 3],
        positions[i * 3 + 1],
        positions[i * 3 + 2],
      ] as const;
      const tol = this.geometry.sizes
        ? 0.05 * (this.geometry.sizes[i] / 5.0)
        : defaultTolerance;
      const hit = localRay.intersectPoint(pt, tol);
      if (hit && hit.distance < closestLocalDist) {
        closestLocalDist = hit.distance;
        closestIndex = i;
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
      primitiveKind: 'point',
      primitiveIndex: closestIndex,
    };
  }
}
