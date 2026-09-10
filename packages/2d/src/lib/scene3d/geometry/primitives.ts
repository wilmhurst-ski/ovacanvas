import type {TriangleGeometry3D} from '../public/types';

export interface DegenerateTriangleDiagnostic {
  triangleIndex: number;
  indices: [number, number, number];
  reason: 'collinear' | 'repeated_index' | 'zero_area';
}

export function findDegenerateTriangles(
  positions: Float32Array,
  indices: Uint16Array | Uint32Array,
  epsilon = 1e-10,
): DegenerateTriangleDiagnostic[] {
  const diagnostics: DegenerateTriangleDiagnostic[] = [];
  const numTriangles = indices.length / 3;

  for (let i = 0; i < numTriangles; i++) {
    const i0 = indices[i * 3];
    const i1 = indices[i * 3 + 1];
    const i2 = indices[i * 3 + 2];

    if (i0 === i1 || i1 === i2 || i2 === i0) {
      diagnostics.push({
        triangleIndex: i,
        indices: [i0, i1, i2],
        reason: 'repeated_index',
      });
      continue;
    }

    const p0x = positions[i0 * 3];
    const p0y = positions[i0 * 3 + 1];
    const p0z = positions[i0 * 3 + 2];

    const p1x = positions[i1 * 3];
    const p1y = positions[i1 * 3 + 1];
    const p1z = positions[i1 * 3 + 2];

    const p2x = positions[i2 * 3];
    const p2y = positions[i2 * 3 + 1];
    const p2z = positions[i2 * 3 + 2];

    const e1x = p1x - p0x;
    const e1y = p1y - p0y;
    const e1z = p1z - p0z;

    const e2x = p2x - p0x;
    const e2y = p2y - p0y;
    const e2z = p2z - p0z;

    const cx = e1y * e2z - e1z * e2y;
    const cy = e1z * e2x - e1x * e2z;
    const cz = e1x * e2y - e1y * e2x;

    const areaSq = cx * cx + cy * cy + cz * cz;
    if (areaSq <= epsilon) {
      diagnostics.push({
        triangleIndex: i,
        indices: [i0, i1, i2],
        reason: 'zero_area',
      });
    }
  }

  return diagnostics;
}

/**
 * Creates two mutually intersecting crossing triangles for Stage B & Witness 1 depth tests.
 * Triangle A: red, slopes from z = -0.5 to z = 0.5
 * Triangle B: blue, slopes from z = 0.5 to z = -0.5
 * They cross along the line x = 0 at z = 0.
 */
export function createCrossingTrianglesGeometry(): {
  triangleA: TriangleGeometry3D;
  triangleB: TriangleGeometry3D;
} {
  const triangleA: TriangleGeometry3D = {
    kind: 'triangles',
    positions: [-1.0, -1.0, -0.5, 1.0, -1.0, 0.5, 0.0, 1.0, 0.0],
    indices: [0, 1, 2],
    colors: [1.0, 0.0, 0.0, 1.0, 1.0, 0.0, 0.0, 1.0, 1.0, 0.0, 0.0, 1.0],
  };

  const triangleB: TriangleGeometry3D = {
    kind: 'triangles',
    positions: [-1.0, -1.0, 0.5, 1.0, -1.0, -0.5, 0.0, 1.0, 0.0],
    indices: [0, 1, 2],
    colors: [0.0, 0.0, 1.0, 1.0, 0.0, 0.0, 1.0, 1.0, 0.0, 0.0, 1.0, 1.0],
  };

  return {triangleA, triangleB};
}
