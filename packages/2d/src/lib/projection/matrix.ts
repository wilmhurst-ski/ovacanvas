import {mat4, vec4} from 'gl-matrix';
import {
  Camera3D,
  Matrix4,
  OrthographicProjection,
  PerspectiveProjection,
  ProjectionError,
  Transform3D,
  Vec3,
  Vec4,
} from './types';

export const DEFAULT_SINGULARITY_EPSILON = 1e-9;

export function normalizeFinite(value: number, description: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ProjectionError(
      'NON_FINITE_NUMBER',
      `${description} must be a finite number.`,
    );
  }
  return Object.is(value, -0) ? 0 : value;
}

export function validateVec3(value: Vec3, description: string): Vec3 {
  if (value === null || typeof value !== 'object') {
    throw new ProjectionError(
      'NON_FINITE_NUMBER',
      `${description} must be a finite Vec3.`,
    );
  }
  return {
    x: normalizeFinite(value.x, `${description}.x`),
    y: normalizeFinite(value.y, `${description}.y`),
    z: normalizeFinite(value.z, `${description}.z`),
  };
}

function fromGlMatrix(value: Iterable<number>): Matrix4 {
  const values = Array.from(value, (entry, index) =>
    normalizeFinite(entry, `Matrix entry ${index}`),
  );
  if (values.length !== 16) {
    throw new ProjectionError(
      'INVALID_MATRIX',
      'A Matrix4 must contain exactly 16 values.',
    );
  }
  return values as unknown as Matrix4;
}

function toGlMatrix(value: Matrix4, description = 'Matrix') {
  validateMatrix4(value, description);
  return mat4.fromValues(...value);
}

export function validateMatrix4(value: Matrix4, description = 'Matrix') {
  if (!Array.isArray(value) || value.length !== 16) {
    throw new ProjectionError(
      'INVALID_MATRIX',
      `${description} must contain exactly 16 finite values.`,
    );
  }
  value.forEach((entry, index) =>
    normalizeFinite(entry, `${description}[${index}]`),
  );
}

export function assertInvertibleMatrix4(
  value: Matrix4,
  description: string,
  epsilon = DEFAULT_SINGULARITY_EPSILON,
) {
  const determinant = mat4.determinant(toGlMatrix(value, description));
  if (!Number.isFinite(determinant) || Math.abs(determinant) <= epsilon) {
    throw new ProjectionError(
      'SINGULAR_MATRIX',
      `${description} must be invertible.`,
    );
  }
}

/** @internal The CAP-04 matrix shape is not a frozen public API. */
export function identityMatrix4(): Matrix4 {
  return fromGlMatrix(mat4.create());
}

/** @internal The CAP-04 matrix shape is not a frozen public API. */
export function multiplyMatrix4(left: Matrix4, right: Matrix4): Matrix4 {
  return fromGlMatrix(
    mat4.multiply(mat4.create(), toGlMatrix(left), toGlMatrix(right)),
  );
}

/**
 * Compose scale, then X/Y/Z Euler rotations, then translation.
 *
 * @internal The CAP-04 matrix shape is not a frozen public API.
 */
export function composeModelMatrix(transform: Transform3D = {}): Matrix4 {
  if (transform === null || typeof transform !== 'object') {
    throw new ProjectionError(
      'INVALID_MATRIX',
      'Model transform must be an object.',
    );
  }
  const translation = validateVec3(
    transform.translation ?? {x: 0, y: 0, z: 0},
    'translation',
  );
  const rotation = validateVec3(
    transform.rotation ?? {x: 0, y: 0, z: 0},
    'rotation',
  );
  const scale = validateVec3(transform.scale ?? {x: 1, y: 1, z: 1}, 'scale');
  if (Math.abs(scale.x * scale.y * scale.z) <= DEFAULT_SINGULARITY_EPSILON) {
    throw new ProjectionError(
      'SINGULAR_MATRIX',
      'Model scale must produce an invertible transform.',
    );
  }

  const output = mat4.create();
  mat4.translate(output, output, [translation.x, translation.y, translation.z]);
  mat4.rotateZ(output, output, rotation.z);
  mat4.rotateY(output, output, rotation.y);
  mat4.rotateX(output, output, rotation.x);
  mat4.scale(output, output, [scale.x, scale.y, scale.z]);
  return fromGlMatrix(output);
}

/** @internal The CAP-04 camera shape is not a frozen public API. */
export function lookAtViewMatrix(camera: Camera3D): Matrix4 {
  if (camera === null || typeof camera !== 'object') {
    throw new ProjectionError('INVALID_CAMERA', 'Camera must be an object.');
  }
  const eye = validateVec3(camera.eye, 'camera.eye');
  const target = validateVec3(camera.target, 'camera.target');
  const up = validateVec3(camera.up ?? {x: 0, y: 1, z: 0}, 'camera.up');
  const direction = {
    x: target.x - eye.x,
    y: target.y - eye.y,
    z: target.z - eye.z,
  };
  const directionLength = Math.hypot(direction.x, direction.y, direction.z);
  const upLength = Math.hypot(up.x, up.y, up.z);
  const crossLength = Math.hypot(
    direction.y * up.z - direction.z * up.y,
    direction.z * up.x - direction.x * up.z,
    direction.x * up.y - direction.y * up.x,
  );
  if (
    directionLength <= DEFAULT_SINGULARITY_EPSILON ||
    upLength <= DEFAULT_SINGULARITY_EPSILON ||
    crossLength <= DEFAULT_SINGULARITY_EPSILON
  ) {
    throw new ProjectionError(
      'INVALID_CAMERA',
      'Camera eye, target, and up must define a non-degenerate view.',
    );
  }
  return fromGlMatrix(
    mat4.lookAt(
      mat4.create(),
      [eye.x, eye.y, eye.z],
      [target.x, target.y, target.z],
      [up.x, up.y, up.z],
    ),
  );
}

/** @internal The CAP-04 projection shape is not a frozen public API. */
export function perspectiveMatrix(config: PerspectiveProjection): Matrix4 {
  if (
    config === null ||
    typeof config !== 'object' ||
    config.kind !== 'perspective'
  ) {
    throw new ProjectionError(
      'INVALID_PROJECTION',
      'Perspective projection configuration is required.',
    );
  }
  const fov = normalizeFinite(config.verticalFovRadians, 'verticalFovRadians');
  const aspect = normalizeFinite(config.aspect, 'aspect');
  const near = normalizeFinite(config.near, 'near');
  const far = normalizeFinite(config.far, 'far');
  if (
    fov <= DEFAULT_SINGULARITY_EPSILON ||
    fov >= Math.PI - DEFAULT_SINGULARITY_EPSILON ||
    aspect <= DEFAULT_SINGULARITY_EPSILON ||
    near <= DEFAULT_SINGULARITY_EPSILON ||
    far <= near
  ) {
    throw new ProjectionError(
      'INVALID_PROJECTION',
      'Perspective projection requires 0 < fov < PI, aspect > 0, and 0 < near < far.',
    );
  }
  return fromGlMatrix(
    mat4.perspectiveNO(mat4.create(), fov, aspect, near, far),
  );
}

/** @internal The CAP-04 projection shape is not a frozen public API. */
export function orthographicMatrix(config: OrthographicProjection): Matrix4 {
  if (
    config === null ||
    typeof config !== 'object' ||
    config.kind !== 'orthographic'
  ) {
    throw new ProjectionError(
      'INVALID_PROJECTION',
      'Orthographic projection configuration is required.',
    );
  }
  const left = normalizeFinite(config.left, 'left');
  const right = normalizeFinite(config.right, 'right');
  const bottom = normalizeFinite(config.bottom, 'bottom');
  const top = normalizeFinite(config.top, 'top');
  const near = normalizeFinite(config.near, 'near');
  const far = normalizeFinite(config.far, 'far');
  if (
    Math.abs(right - left) <= DEFAULT_SINGULARITY_EPSILON ||
    Math.abs(top - bottom) <= DEFAULT_SINGULARITY_EPSILON ||
    near <= DEFAULT_SINGULARITY_EPSILON ||
    far <= near
  ) {
    throw new ProjectionError(
      'INVALID_PROJECTION',
      'Orthographic projection requires non-zero bounds and 0 < near < far.',
    );
  }
  return fromGlMatrix(
    mat4.orthoNO(mat4.create(), left, right, bottom, top, near, far),
  );
}

export function projectionMatrix(
  config: PerspectiveProjection | OrthographicProjection,
): Matrix4 {
  if (config === null || typeof config !== 'object') {
    throw new ProjectionError(
      'INVALID_PROJECTION',
      'Projection configuration must be an object.',
    );
  }
  return config.kind === 'perspective'
    ? perspectiveMatrix(config)
    : orthographicMatrix(config);
}

/** @internal The CAP-04 vector shape is not a frozen public API. */
export function transformVector4(matrix: Matrix4, vector: Vec4): Vec4 {
  validateMatrix4(matrix);
  if (vector === null || typeof vector !== 'object') {
    throw new ProjectionError(
      'NON_FINITE_NUMBER',
      'Vector must be a finite Vec4.',
    );
  }
  const input = vec4.fromValues(
    normalizeFinite(vector.x, 'vector.x'),
    normalizeFinite(vector.y, 'vector.y'),
    normalizeFinite(vector.z, 'vector.z'),
    normalizeFinite(vector.w, 'vector.w'),
  );
  const output = vec4.transformMat4(vec4.create(), input, toGlMatrix(matrix));
  return {
    x: normalizeFinite(output[0], 'transformed.x'),
    y: normalizeFinite(output[1], 'transformed.y'),
    z: normalizeFinite(output[2], 'transformed.z'),
    w: normalizeFinite(output[3], 'transformed.w'),
  };
}

export function transformPoint3(matrix: Matrix4, point: Vec3): Vec3 {
  const transformed = transformVector4(matrix, {
    ...validateVec3(point, 'point'),
    w: 1,
  });
  const divided = homogeneousDivide(transformed);
  return divided;
}

/** Perform the explicit per-vertex homogeneous division required by CAP-04. */
export function homogeneousDivide(
  clip: Vec4,
  epsilon = DEFAULT_SINGULARITY_EPSILON,
): Vec3 {
  const value = {
    x: normalizeFinite(clip.x, 'clip.x'),
    y: normalizeFinite(clip.y, 'clip.y'),
    z: normalizeFinite(clip.z, 'clip.z'),
    w: normalizeFinite(clip.w, 'clip.w'),
  };
  const threshold = normalizeFinite(epsilon, 'singularityEpsilon');
  if (threshold <= 0 || value.w <= threshold) {
    throw new ProjectionError(
      'PROJECTION_SINGULARITY',
      'Projection requires clip.w to be greater than the singularity epsilon.',
    );
  }
  return {
    x: normalizeFinite(value.x / value.w, 'ndc.x'),
    y: normalizeFinite(value.y / value.w, 'ndc.y'),
    z: normalizeFinite(value.z / value.w, 'ndc.z'),
  };
}
