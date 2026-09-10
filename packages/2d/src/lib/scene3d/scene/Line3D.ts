import {computeGeometryBounds} from '../geometry/bounds';
import {
  canonicalizeLines,
  type CanonicalLineGeometry,
} from '../geometry/canonicalize';
import {Bounds3} from '../math/bounds3';
import {Matrix4} from '../math/matrix4';
import {Ray3} from '../math/ray3';
import {Vector3} from '../math/vector3';
import {fingerprintLineGeometry} from '../public/fingerprint';
import type {
  ColorLike,
  LineGeometry3D,
  Ray3D,
  Transform3DSpec,
} from '../public/types';
import {Object3D, type RaycastHit} from './Object3D';

export class Line3D extends Object3D {
  public readonly geometry: CanonicalLineGeometry;
  public lineWidth = 1.0;
  public depthTest = true;
  public color: ColorLike = '#ffffff';
  public opacity = 1.0;
  public readonly fingerprint: string;
  private readonly cachedLocalBounds: Bounds3;

  public constructor(
    id: string,
    geometry: LineGeometry3D,
    options: {
      lineWidth?: number;
      depthTest?: boolean;
      color?: ColorLike;
      opacity?: number;
      transform?: Transform3DSpec;
    } = {},
  ) {
    super(id, options.transform);
    this.geometry = canonicalizeLines(geometry);
    if (options.lineWidth !== undefined) {
      this.lineWidth = Math.max(0.1, options.lineWidth);
    }
    if (options.depthTest !== undefined) this.depthTest = options.depthTest;
    if (options.color !== undefined) this.color = options.color;
    if (options.opacity !== undefined) {
      this.opacity = Math.max(0, Math.min(1, options.opacity));
    }
    this.fingerprint = fingerprintLineGeometry(geometry);
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
    const tolerance = 0.05 * this.lineWidth;

    let closestLocalDist = Infinity;
    let closestIndex = -1;
    let closestLocalPoint: Vector3 | null = null;

    if (this.geometry.indices && this.geometry.topology === 'segments') {
      const indices = this.geometry.indices;
      const numSegments = indices.length / 2;
      for (let i = 0; i < numSegments; i++) {
        const i0 = indices[i * 2];
        const i1 = indices[i * 2 + 1];
        const p0 = [
          positions[i0 * 3],
          positions[i0 * 3 + 1],
          positions[i0 * 3 + 2],
        ] as const;
        const p1 = [
          positions[i1 * 3],
          positions[i1 * 3 + 1],
          positions[i1 * 3 + 2],
        ] as const;
        const hit = localRay.intersectSegment(p0, p1, tolerance);
        if (hit && hit.distance < closestLocalDist) {
          closestLocalDist = hit.distance;
          closestIndex = i;
          closestLocalPoint = hit.point;
        }
      }
    } else if (this.geometry.topology === 'strip') {
      for (let i = 0; i < vertexCount - 1; i++) {
        const p0 = [
          positions[i * 3],
          positions[i * 3 + 1],
          positions[i * 3 + 2],
        ] as const;
        const p1 = [
          positions[(i + 1) * 3],
          positions[(i + 1) * 3 + 1],
          positions[(i + 1) * 3 + 2],
        ] as const;
        const hit = localRay.intersectSegment(p0, p1, tolerance);
        if (hit && hit.distance < closestLocalDist) {
          closestLocalDist = hit.distance;
          closestIndex = i;
          closestLocalPoint = hit.point;
        }
      }
    } else {
      // Non-indexed segments
      const numSegments = Math.floor(vertexCount / 2);
      for (let i = 0; i < numSegments; i++) {
        const p0 = [
          positions[i * 6],
          positions[i * 6 + 1],
          positions[i * 6 + 2],
        ] as const;
        const p1 = [
          positions[i * 6 + 3],
          positions[i * 6 + 4],
          positions[i * 6 + 5],
        ] as const;
        const hit = localRay.intersectSegment(p0, p1, tolerance);
        if (hit && hit.distance < closestLocalDist) {
          closestLocalDist = hit.distance;
          closestIndex = i;
          closestLocalPoint = hit.point;
        }
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
      primitiveKind: 'line',
      primitiveIndex: closestIndex,
    };
  }
}
