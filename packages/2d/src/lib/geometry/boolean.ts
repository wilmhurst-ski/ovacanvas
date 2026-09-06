import * as martinez from 'martinez-polygon-clipping';
import {canonicalizeMultiPolygon} from './canonical';
import {GeometryError, MultiPolygon2D, Point2D} from './types';

/**
 * Which set operation to apply.
 *
 * @internal Not a public API.
 */
export type BooleanOperation = 'union' | 'intersection' | 'difference' | 'xor';

type Kernel = (
  subject: martinez.Geometry,
  clipping: martinez.Geometry,
) => martinez.Geometry | null;

const Kernels: Record<BooleanOperation, Kernel> = {
  union: martinez.union,
  intersection: martinez.intersection,
  difference: martinez.diff,
  xor: martinez.xor,
};

function toKernelGeometry(multipolygon: MultiPolygon2D): martinez.Geometry {
  return multipolygon.map(polygon =>
    polygon.map(ring =>
      ring.map(point => [point.x, point.y] as [number, number]),
    ),
  );
}

function fromKernelGeometry(result: unknown): Point2D[][][] {
  if (result === null || result === undefined) return [];
  if (!Array.isArray(result)) {
    throw new GeometryError(
      'OPERATION_FAILED',
      'The clipping kernel returned something that is not geometry.',
    );
  }
  return (result as number[][][][]).map(polygon =>
    polygon.map(ring =>
      ring.map(position => ({x: position[0], y: position[1]})),
    ),
  );
}

/**
 * Apply a boolean set operation to two areas and canonicalize the result.
 *
 * @param subject - The left operand.
 * @param clipping - The right operand.
 * @param operation - Which set operation to apply.
 *
 * @returns A canonical multipolygon. An empty array is a legitimate answer:
 *          disjoint shapes have an empty intersection.
 *
 * @remarks
 * Both operands are canonicalized before the kernel sees them and the result
 * is canonicalized again afterwards. That second pass is the point: the
 * kernel's output order, ring start vertex and hole winding are incidental to
 * how it walked the sweep line, and two callers describing the same two
 * shapes differently would otherwise receive results that differ only in
 * arrangement.
 *
 * The kernel computes and nothing else. It draws nothing, owns no element,
 * and schedules no work.
 *
 * @internal Not a public API. Shape is deliberately not frozen.
 */
export function booleanOperation(
  subject: unknown,
  clipping: unknown,
  operation: BooleanOperation,
): MultiPolygon2D {
  const kernel = Kernels[operation];
  if (!kernel) {
    throw new GeometryError(
      'OPERATION_FAILED',
      `Unknown boolean operation: ${String(operation)}.`,
    );
  }

  const left = canonicalizeMultiPolygon(subject, 'subject');
  const right = canonicalizeMultiPolygon(clipping, 'clipping');

  let raw: unknown;
  try {
    raw = kernel(toKernelGeometry(left), toKernelGeometry(right));
  } catch (error: any) {
    throw new GeometryError(
      'OPERATION_FAILED',
      `The clipping kernel refused the ${operation}: ${String(
        error?.message ?? error,
      )}`,
    );
  }

  const decoded = fromKernelGeometry(raw);
  // A kernel component with no rings, or a ring the kernel collapsed to a
  // segment, is dropped rather than canonicalized: it carries no area, and
  // refusing it would turn a legitimate empty overlap into an error.
  const meaningful = decoded.filter(
    polygon => polygon.length > 0 && polygon[0].length >= 4,
  );
  return canonicalizeMultiPolygon(meaningful, `${operation} result`);
}

/**
 * @internal Not a public API.
 */
export function unionAreas(
  subject: unknown,
  clipping: unknown,
): MultiPolygon2D {
  return booleanOperation(subject, clipping, 'union');
}

/**
 * @internal Not a public API.
 */
export function intersectAreas(
  subject: unknown,
  clipping: unknown,
): MultiPolygon2D {
  return booleanOperation(subject, clipping, 'intersection');
}

/**
 * @internal Not a public API.
 */
export function differenceAreas(
  subject: unknown,
  clipping: unknown,
): MultiPolygon2D {
  return booleanOperation(subject, clipping, 'difference');
}

/**
 * @internal Not a public API.
 */
export function xorAreas(subject: unknown, clipping: unknown): MultiPolygon2D {
  return booleanOperation(subject, clipping, 'xor');
}
