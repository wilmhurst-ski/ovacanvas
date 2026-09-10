import {Scene3DError} from '../public/errors';
import type {
  LineGeometry3D,
  PointGeometry3D,
  TriangleGeometry3D,
} from '../public/types';
import {computeVertexNormals, normalizeNormalArray} from './normals';

export interface CanonicalTriangleGeometry {
  kind: 'triangles';
  vertexCount: number;
  positions: Float32Array;
  indices: Uint16Array | Uint32Array;
  normals: Float32Array;
  colors?: Float32Array;
}

export interface CanonicalLineGeometry {
  kind: 'lines';
  vertexCount: number;
  positions: Float32Array;
  indices?: Uint16Array | Uint32Array;
  colors?: Float32Array;
  topology: 'segments' | 'strip';
}

export interface CanonicalPointGeometry {
  kind: 'points';
  vertexCount: number;
  positions: Float32Array;
  colors?: Float32Array;
  sizes?: Float32Array;
}

export type CanonicalGeometry =
  | CanonicalTriangleGeometry
  | CanonicalLineGeometry
  | CanonicalPointGeometry;

function toFloat32Array(
  data: readonly number[] | Float32Array,
  expectedMultiple: number,
  field: string,
): Float32Array {
  const len = data.length;
  if (len === 0 || len % expectedMultiple !== 0) {
    throw new Scene3DError(
      'INVALID_GEOMETRY_LENGTH',
      `${field} length (${len}) must be a non-zero multiple of ${expectedMultiple}`,
      {field},
    );
  }

  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const val = data[i];
    if (typeof val !== 'number' || !Number.isFinite(val)) {
      throw new Scene3DError(
        'INVALID_VECTOR',
        `Non-finite value at ${field}[${i}]: ${val}`,
        {field},
      );
    }
    out[i] = Object.is(val, -0) ? 0 : val;
  }
  return out;
}

function canonicalizeColors(
  colors: readonly number[] | Float32Array | undefined,
  vertexCount: number,
  field: string,
): Float32Array | undefined {
  if (!colors) return undefined;
  const len = colors.length;
  const componentsPerVertex = len / vertexCount;

  if (componentsPerVertex !== 3 && componentsPerVertex !== 4) {
    throw new Scene3DError(
      'INVALID_GEOMETRY_LENGTH',
      `${field} must have 3 (RGB) or 4 (RGBA) components per vertex. Got ${len} values for ${vertexCount} vertices`,
      {field},
    );
  }

  // Convert to RGBA Float32Array
  const out = new Float32Array(vertexCount * 4);
  for (let i = 0; i < vertexCount; i++) {
    const srcOffset = i * componentsPerVertex;
    const dstOffset = i * 4;
    const r = colors[srcOffset];
    const g = colors[srcOffset + 1];
    const b = colors[srcOffset + 2];
    const a = componentsPerVertex === 4 ? colors[srcOffset + 3] : 1.0;

    if (
      !Number.isFinite(r) ||
      !Number.isFinite(g) ||
      !Number.isFinite(b) ||
      !Number.isFinite(a)
    ) {
      throw new Scene3DError(
        'INVALID_VECTOR',
        `Non-finite color values for vertex ${i}`,
      );
    }

    out[dstOffset] = Math.max(0, Math.min(1, r));
    out[dstOffset + 1] = Math.max(0, Math.min(1, g));
    out[dstOffset + 2] = Math.max(0, Math.min(1, b));
    out[dstOffset + 3] = Math.max(0, Math.min(1, a));
  }
  return out;
}

export function canonicalizeTriangles(
  geom: TriangleGeometry3D,
): CanonicalTriangleGeometry {
  const positions = toFloat32Array(geom.positions, 3, 'Triangle positions');
  const vertexCount = positions.length / 3;

  const idxLen = geom.indices.length;
  if (idxLen === 0 || idxLen % 3 !== 0) {
    throw new Scene3DError(
      'INVALID_GEOMETRY_LENGTH',
      `Triangle indices length (${idxLen}) must be a non-zero multiple of 3`,
    );
  }

  const indices =
    vertexCount > 65535 ? new Uint32Array(idxLen) : new Uint16Array(idxLen);

  for (let i = 0; i < idxLen; i += 3) {
    const i0 = geom.indices[i];
    const i1 = geom.indices[i + 1];
    const i2 = geom.indices[i + 2];

    if (
      !Number.isInteger(i0) ||
      i0 < 0 ||
      i0 >= vertexCount ||
      !Number.isInteger(i1) ||
      i1 < 0 ||
      i1 >= vertexCount ||
      !Number.isInteger(i2) ||
      i2 < 0 ||
      i2 >= vertexCount
    ) {
      throw new Scene3DError(
        'INVALID_INDEX',
        `Index out of range [0, ${vertexCount - 1}] at triangle ${i / 3}: (${i0}, ${i1}, ${i2})`,
      );
    }

    if (i0 === i1 || i1 === i2 || i2 === i0) {
      throw new Scene3DError(
        'DEGENERATE_PRIMITIVE',
        `Triangle ${i / 3} repeats vertex indices: (${i0}, ${i1}, ${i2})`,
      );
    }

    indices[i] = i0;
    indices[i + 1] = i1;
    indices[i + 2] = i2;
  }

  let normals: Float32Array;
  if (geom.normals && geom.normals.length > 0) {
    if (geom.normals.length !== positions.length) {
      throw new Scene3DError(
        'INVALID_GEOMETRY_LENGTH',
        `Normals length (${geom.normals.length}) must match positions length (${positions.length})`,
      );
    }
    normals = normalizeNormalArray(
      toFloat32Array(geom.normals, 3, 'Triangle normals'),
    );
  } else {
    normals = computeVertexNormals(positions, indices);
  }

  const colors = canonicalizeColors(
    geom.colors,
    vertexCount,
    'Triangle colors',
  );

  return {
    kind: 'triangles',
    vertexCount,
    positions,
    indices,
    normals,
    colors,
  };
}

export function canonicalizeLines(geom: LineGeometry3D): CanonicalLineGeometry {
  const positions = toFloat32Array(geom.positions, 3, 'Line positions');
  const vertexCount = positions.length / 3;

  let indices: Uint16Array | Uint32Array | undefined;
  if (geom.indices && geom.indices.length > 0) {
    const idxLen = geom.indices.length;
    if (geom.topology === 'segments' && idxLen % 2 !== 0) {
      throw new Scene3DError(
        'INVALID_GEOMETRY_LENGTH',
        `Line segment indices length (${idxLen}) must be a multiple of 2`,
      );
    }

    indices =
      vertexCount > 65535 ? new Uint32Array(idxLen) : new Uint16Array(idxLen);
    for (let i = 0; i < idxLen; i++) {
      const idx = geom.indices[i];
      if (!Number.isInteger(idx) || idx < 0 || idx >= vertexCount) {
        throw new Scene3DError(
          'INVALID_INDEX',
          `Line index out of bounds: ${idx}`,
        );
      }
      indices[i] = idx;
    }
  }

  const colors = canonicalizeColors(geom.colors, vertexCount, 'Line colors');

  return {
    kind: 'lines',
    vertexCount,
    positions,
    indices,
    colors,
    topology: geom.topology,
  };
}

export function canonicalizePoints(
  geom: PointGeometry3D,
): CanonicalPointGeometry {
  const positions = toFloat32Array(geom.positions, 3, 'Point positions');
  const vertexCount = positions.length / 3;

  const colors = canonicalizeColors(geom.colors, vertexCount, 'Point colors');

  let sizes: Float32Array | undefined;
  if (geom.sizes && geom.sizes.length > 0) {
    if (geom.sizes.length !== vertexCount) {
      throw new Scene3DError(
        'INVALID_GEOMETRY_LENGTH',
        `Point sizes count (${geom.sizes.length}) must equal vertex count (${vertexCount})`,
      );
    }
    sizes = new Float32Array(vertexCount);
    for (let i = 0; i < vertexCount; i++) {
      const s = geom.sizes[i];
      if (!Number.isFinite(s) || s < 0) {
        throw new Scene3DError(
          'INVALID_VECTOR',
          `Invalid point size at ${i}: ${s}`,
        );
      }
      sizes[i] = s;
    }
  }

  return {
    kind: 'points',
    vertexCount,
    positions,
    colors,
    sizes,
  };
}
