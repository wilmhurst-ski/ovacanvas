import {Scene3DError} from '../public/errors';
import type {Camera3DSpec, FitCameraOptions} from '../public/types';
import {Bounds3} from './bounds3';
import {Matrix4} from './matrix4';
import {Vector3} from './vector3';

export interface ResolvedCameraMatrices {
  view: Matrix4;
  projection: Matrix4;
  viewProjection: Matrix4;
  eye: Vector3;
  target: Vector3;
  up: Vector3;
  near: number;
  far: number;
}

export function resolveCameraMatrices(
  spec: Camera3DSpec,
  aspect: number,
): ResolvedCameraMatrices {
  const eye = Vector3.from(spec.eye);
  const target = Vector3.from(spec.target);
  const up = Vector3.from(spec.up, Vector3.up);

  const view = Matrix4.lookAt(eye, target, up);

  let projection: Matrix4;
  if (spec.kind === 'perspective') {
    projection = Matrix4.perspective(
      spec.verticalFovRadians,
      aspect,
      spec.near,
      spec.far,
    );
  } else if (spec.kind === 'orthographic') {
    if (spec.verticalSize <= 0) {
      throw new Scene3DError(
        'INVALID_CAMERA',
        `Orthographic verticalSize must be positive, got ${spec.verticalSize}`,
      );
    }
    const halfH = spec.verticalSize * 0.5;
    const halfW = halfH * aspect;
    projection = Matrix4.orthographic(
      -halfW,
      halfW,
      -halfH,
      halfH,
      spec.near,
      spec.far,
    );
  } else {
    throw new Scene3DError(
      'INVALID_CAMERA',
      `Unknown camera kind: ${(spec as any).kind}`,
    );
  }

  const viewProjection = projection.multiply(view);

  return {
    view,
    projection,
    viewProjection,
    eye,
    target,
    up,
    near: spec.near,
    far: spec.far,
  };
}

export function fitCameraToBounds(options: FitCameraOptions): Camera3DSpec {
  const bounds = new Bounds3(options.bounds.min, options.bounds.max);
  if (bounds.isEmpty()) {
    throw new Scene3DError(
      'INVALID_CAMERA',
      'Cannot fit camera to empty bounds',
    );
  }

  const center = bounds.getCenter();
  const radius = bounds.getRadius();
  const padding = options.padding ?? 1.2;
  const effectiveRadius = radius * padding;

  const aspect = options.aspectRatio;
  const direction = options.direction
    ? Vector3.from(options.direction).normalize()
    : new Vector3(1, 1, 1).normalize();

  if (options.kind === 'orthographic') {
    const verticalSize = (effectiveRadius * 2) / Math.min(1, aspect);
    const distance = effectiveRadius * 2;
    const eye = center.add(direction.scale(distance));
    return {
      kind: 'orthographic',
      eye: eye.toArray(),
      target: center.toArray(),
      up: [0, 1, 0],
      verticalSize,
      near: 0.1,
      far: distance * 4 + effectiveRadius,
    };
  }

  // Default: perspective
  const fov = options.verticalFovRadians ?? (45 * Math.PI) / 180;
  const halfFovY = fov * 0.5;
  const halfFovX = Math.atan(Math.tan(halfFovY) * aspect);
  const minHalfFov = Math.min(halfFovY, halfFovX);

  const distance = effectiveRadius / Math.sin(minHalfFov);
  const eye = center.add(direction.scale(distance));
  const near = Math.max(0.1, distance - effectiveRadius * 2);
  const far = distance + effectiveRadius * 4;

  return {
    kind: 'perspective',
    eye: eye.toArray(),
    target: center.toArray(),
    up: [0, 1, 0],
    verticalFovRadians: fov,
    near,
    far,
  };
}
