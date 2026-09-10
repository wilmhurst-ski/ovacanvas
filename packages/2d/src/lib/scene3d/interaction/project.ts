import {Vector2} from '@ovacanvas/core';
import {resolveCameraMatrices} from '../math/camera';
import {Vector3} from '../math/vector3';
import type {Camera3DSpec, ProjectedAnchor3D, Vec3Like} from '../public/types';

export interface ProjectedPointResult {
  position: Vector2;
  depth: number;
  inFront: boolean;
  insideClip: boolean;
  insideViewport: boolean;
}

export function projectPointToViewport3D(
  pointLike: Vec3Like,
  cameraSpec: Camera3DSpec,
  viewport: {width: number; height: number},
): ProjectedPointResult {
  const p = Vector3.from(pointLike);
  const aspect = viewport.width / viewport.height;
  const camera = resolveCameraMatrices(cameraSpec, aspect);

  // Transform to eye space
  const eyeSpaceP = camera.view.transformPoint(p);
  const inFront = -eyeSpaceP.z > 0;

  // Transform to clip space [-1, 1]
  const clipP = camera.viewProjection.transformPoint(p);

  // Viewport mapping [0, width], [0, height] centered at 0,0 for OvaCanvas
  // In OvaCanvas 2D coordinate system, (0, 0) is the center of the node/view
  const screenX = clipP.x * 0.5 * viewport.width;
  const screenY = -clipP.y * 0.5 * viewport.height;

  // Normalized depth [0, 1]
  const normalizedDepth = clipP.z * 0.5 + 0.5;

  const insideClip =
    clipP.x >= -1.0 &&
    clipP.x <= 1.0 &&
    clipP.y >= -1.0 &&
    clipP.y <= 1.0 &&
    clipP.z >= -1.0 &&
    clipP.z <= 1.0;

  const insideViewport =
    Math.abs(screenX) <= viewport.width * 0.5 &&
    Math.abs(screenY) <= viewport.height * 0.5;

  return {
    position: new Vector2(screenX, screenY),
    depth: normalizedDepth,
    inFront,
    insideClip,
    insideViewport,
  };
}

export function projectAnchor3D(
  pointLike: Vec3Like,
  cameraSpec: Camera3DSpec,
  viewport: {width: number; height: number},
  normalLike?: Vec3Like,
): ProjectedAnchor3D {
  const proj = projectPointToViewport3D(pointLike, cameraSpec, viewport);

  let facingCamera: boolean | undefined;
  if (normalLike) {
    const pt = Vector3.from(pointLike);
    const norm = Vector3.from(normalLike).normalize();
    const eye = Vector3.from(cameraSpec.eye);
    const toEye = eye.sub(pt).normalize();
    facingCamera = norm.dot(toEye) > 0;
  }

  return {
    position: proj.position,
    depth: proj.depth,
    inFront: proj.inFront,
    insideClip: proj.insideClip,
    insideViewport: proj.insideViewport,
    facingCamera,
  };
}
