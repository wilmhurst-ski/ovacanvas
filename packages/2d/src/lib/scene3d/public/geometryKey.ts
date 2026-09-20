import type {
  LineGeometry3D,
  PointGeometry3D,
  PrimitiveGeometry3D,
  TriangleGeometry3D,
} from './types';

function hashFloatArray(data: Float32Array | readonly number[]): string {
  let h1 = 0xdeadbeef ^ data.length;
  let h2 = 0x41c6ce57 ^ data.length;
  const len = data.length;
  // Sample up to 128 elements evenly if large, or all if <= 128
  const step = len > 128 ? Math.floor(len / 128) : 1;
  for (let i = 0; i < len; i += step) {
    const v = Math.fround(data[i]);
    const intVal = floatToUint32(v);
    h1 = Math.imul(h1 ^ intVal, 2654435761);
    h2 = Math.imul(h2 ^ (intVal >>> 16), 1597334677);
  }
  h1 =
    Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
    Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 =
    Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^
    Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (
    (h1 >>> 0).toString(16).padStart(8, '0') +
    (h2 >>> 0).toString(16).padStart(8, '0')
  );
}

function hashIntArray(
  data: Uint16Array | Uint32Array | readonly number[],
): string {
  let h1 = 0xdeadbeef ^ data.length;
  let h2 = 0x41c6ce57 ^ data.length;
  const len = data.length;
  const step = len > 128 ? Math.floor(len / 128) : 1;
  for (let i = 0; i < len; i += step) {
    const intVal = data[i] >>> 0;
    h1 = Math.imul(h1 ^ intVal, 2654435761);
    h2 = Math.imul(h2 ^ (intVal >>> 16), 1597334677);
  }
  h1 =
    Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
    Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 =
    Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^
    Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (
    (h1 >>> 0).toString(16).padStart(8, '0') +
    (h2 >>> 0).toString(16).padStart(8, '0')
  );
}

const FLOAT_32_SCRATCH = new Float32Array(1);
const UINT_32_SCRATCH = new Uint32Array(FLOAT_32_SCRATCH.buffer);
function floatToUint32(val: number): number {
  FLOAT_32_SCRATCH[0] = val;
  return UINT_32_SCRATCH[0];
}

/**
 * Deterministically fingerprint a TriangleGeometry3D.
 */
export function fingerprintTriangleGeometry(geom: TriangleGeometry3D): string {
  const pHash = hashFloatArray(geom.positions);
  const iHash = hashIntArray(geom.indices);
  const nHash = geom.normals ? hashFloatArray(geom.normals) : '0';
  const cHash = geom.colors ? hashFloatArray(geom.colors) : '0';
  return `tri:${geom.positions.length}:${pHash}:${geom.indices.length}:${iHash}:${nHash}:${cHash}`;
}

/**
 * Deterministically fingerprint a LineGeometry3D.
 */
export function fingerprintLineGeometry(geom: LineGeometry3D): string {
  const pHash = hashFloatArray(geom.positions);
  const iHash = geom.indices ? hashIntArray(geom.indices) : '0';
  const cHash = geom.colors ? hashFloatArray(geom.colors) : '0';
  return `line:${geom.topology}:${geom.positions.length}:${pHash}:${iHash}:${cHash}`;
}

/**
 * Deterministically fingerprint a PointGeometry3D.
 */
export function fingerprintPointGeometry(geom: PointGeometry3D): string {
  const pHash = hashFloatArray(geom.positions);
  const cHash = geom.colors ? hashFloatArray(geom.colors) : '0';
  const sHash = geom.sizes ? hashFloatArray(geom.sizes) : '0';
  return `pt:${geom.positions.length}:${pHash}:${cHash}:${sHash}`;
}

/**
 * Compute a deterministic geometry fingerprint.
 */
export function fingerprintGeometry(geom: PrimitiveGeometry3D): string {
  switch (geom.kind) {
    case 'triangles':
      return fingerprintTriangleGeometry(geom);
    case 'lines':
      return fingerprintLineGeometry(geom);
    case 'points':
      return fingerprintPointGeometry(geom);
  }
}
