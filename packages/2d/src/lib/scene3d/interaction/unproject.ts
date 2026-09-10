import {resolveCameraMatrices} from '../math/camera';
import {Ray3} from '../math/ray3';
import {Vector3} from '../math/vector3';
import type {Camera3DSpec} from '../public/types';

export function unprojectPoint3D(
  localCoord: {x: number; y: number},
  normalizedDepth: number,
  cameraSpec: Camera3DSpec,
  viewport: {width: number; height: number},
): Vector3 {
  const aspect = viewport.width / viewport.height;
  const camera = resolveCameraMatrices(cameraSpec, aspect);
  const invVP = camera.viewProjection.invert();

  // Convert centered viewport coordinate to NDC [-1, 1]
  const ndcX = localCoord.x / (viewport.width * 0.5);
  const ndcY = -localCoord.y / (viewport.height * 0.5);
  const ndcZ = normalizedDepth * 2.0 - 1.0;

  return invVP.transformPoint(new Vector3(ndcX, ndcY, ndcZ));
}

export function createRayFromViewport(
  localCoord: {x: number; y: number},
  cameraSpec: Camera3DSpec,
  viewport: {width: number; height: number},
): Ray3 {
  const nearPoint = unprojectPoint3D(localCoord, 0.0, cameraSpec, viewport);
  const farPoint = unprojectPoint3D(localCoord, 1.0, cameraSpec, viewport);
  const direction = farPoint.sub(nearPoint).normalize();

  if (cameraSpec.kind === 'orthographic') {
    // For orthographic, ray origin is nearPoint, direction is camera forward
    const eye = Vector3.from(cameraSpec.eye);
    const target = Vector3.from(cameraSpec.target);
    const orthoDir = target.sub(eye).normalize();
    return new Ray3(nearPoint, orthoDir);
  }

  // For perspective, ray originates at camera eye (or nearPoint)
  return new Ray3(nearPoint, direction);
}
