import {Scene3DError} from '../public/errors';
import type {TriangleGeometry3D} from '../public/types';

export interface ParametricSurfaceOptions {
  readonly uRange: readonly [number, number];
  readonly vRange: readonly [number, number];
  readonly uSegments: number;
  readonly vSegments: number;
}

function validateSegments(value: unknown, field: string): number {
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new Scene3DError(
      'INVALID_SEGMENT_COUNT',
      `${field} must be a positive integer, received ${String(value)}.`,
    );
  }
  return value as number;
}

function validateRange(
  range: readonly number[],
  field: string,
): readonly [number, number] {
  const [a, b] = range;
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) {
    throw new Scene3DError(
      'INVALID_DOMAIN_RANGE',
      `${field} must be two distinct finite numbers, received ${JSON.stringify(range)}.`,
    );
  }
  return [a, b];
}

/**
 * Triangulate the surface a function `(u, v) => (x, y, z)` describes over a
 * rectangular parameter domain.
 *
 * @remarks
 * The general capability behind every quadric surface (sphere, ellipsoid,
 * paraboloid, hyperboloid, cylinder...) and any other "surface defined by
 * an equation" visual - one grid-sampling routine, not a named class per
 * shape. `Mesh3D` already computes vertex normals from topology when none
 * are supplied (see `canonicalizeTriangles`), so this never needs the
 * function's analytic derivative: it hands back positions and indices only
 * and lets the existing renderer pipeline do the rest - exactly what the
 * scene3d test suite's own "Witness 6" fixture already proved works
 * end-to-end, just promoted here into real, reusable library code instead
 * of a test-only inline function.
 *
 * @param f - Maps a point in the parameter domain to a 3D position.
 * @param options - The parameter domain and how finely to sample it.
 */
export function parametricSurface(
  f: (u: number, v: number) => readonly [number, number, number],
  options: ParametricSurfaceOptions,
): TriangleGeometry3D {
  const uSegments = validateSegments(options.uSegments, 'uSegments');
  const vSegments = validateSegments(options.vSegments, 'vSegments');
  const [u0, u1] = validateRange(options.uRange, 'uRange');
  const [v0, v1] = validateRange(options.vRange, 'vRange');

  const positions: number[] = [];
  const stride = vSegments + 1;

  for (let i = 0; i <= uSegments; i++) {
    const u = u0 + ((u1 - u0) * i) / uSegments;
    for (let j = 0; j <= vSegments; j++) {
      const v = v0 + ((v1 - v0) * j) / vSegments;
      const point = f(u, v);
      const [x, y, z] = point;
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        throw new Scene3DError(
          'INVALID_VECTOR',
          `Surface function returned a non-finite point at (u=${u}, v=${v}): ${JSON.stringify(point)}.`,
        );
      }
      positions.push(x, y, z);
    }
  }

  const indices: number[] = [];
  for (let i = 0; i < uSegments; i++) {
    for (let j = 0; j < vSegments; j++) {
      const p00 = i * stride + j;
      const p10 = (i + 1) * stride + j;
      const p01 = i * stride + (j + 1);
      const p11 = (i + 1) * stride + (j + 1);
      indices.push(p00, p10, p01);
      indices.push(p01, p10, p11);
    }
  }

  return {kind: 'triangles', positions, indices};
}

export interface SurfaceOfRevolutionOptions {
  readonly tRange: readonly [number, number];
  readonly tSegments: number;
  readonly angularSegments: number;
  /** Which axis the profile revolves around. Default `'x'`. */
  readonly axis?: 'x' | 'y' | 'z';
}

/**
 * Rotate a 2D profile curve around an axis to build a 3D surface.
 *
 * @remarks
 * Not a separate mechanism from {@link parametricSurface} - a special case
 * of it, literally implemented as one call to it: the revolution angle is
 * just the surface's second parameter. A cylinder, a cone, a sphere built
 * by rotating a semicircle, and Gabriel's Horn (rotating `y = 1/x`) are all
 * the same function with a different profile.
 *
 * @param profile - Maps a position along the axis (`t`) to the profile's
 *                  `[radius, axial position]` at that point.
 * @param options - The parameter range along the profile and how finely to
 *                  sample both the profile and the rotation angle.
 */
export function surfaceOfRevolution(
  profile: (t: number) => readonly [radius: number, axial: number],
  options: SurfaceOfRevolutionOptions,
): TriangleGeometry3D {
  const axis = options.axis ?? 'x';
  return parametricSurface(
    (t, theta) => {
      const [radius, axial] = profile(t);
      const a = radius * Math.cos(theta);
      const b = radius * Math.sin(theta);
      switch (axis) {
        case 'x':
          return [axial, a, b];
        case 'y':
          return [a, axial, b];
        default:
          return [a, b, axial];
      }
    },
    {
      uRange: options.tRange,
      vRange: [0, Math.PI * 2],
      uSegments: options.tSegments,
      vSegments: options.angularSegments,
    },
  );
}
