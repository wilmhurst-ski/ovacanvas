/**
 * Computes deterministic area-weighted vertex normals for indexed triangles.
 */
export function computeVertexNormals(
  positions: Float32Array,
  indices: Uint16Array | Uint32Array,
): Float32Array {
  const vertexCount = positions.length / 3;
  const normals = new Float32Array(positions.length);

  const idxLen = indices.length;
  for (let i = 0; i < idxLen; i += 3) {
    const i0 = indices[i];
    const i1 = indices[i + 1];
    const i2 = indices[i + 2];

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

    // Cross product (e1 x e2) - magnitude is proportional to triangle area
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;

    normals[i0 * 3] += nx;
    normals[i0 * 3 + 1] += ny;
    normals[i0 * 3 + 2] += nz;

    normals[i1 * 3] += nx;
    normals[i1 * 3 + 1] += ny;
    normals[i1 * 3 + 2] += nz;

    normals[i2 * 3] += nx;
    normals[i2 * 3 + 1] += ny;
    normals[i2 * 3 + 2] += nz;
  }

  // Normalize each vertex normal
  for (let i = 0; i < vertexCount; i++) {
    const offset = i * 3;
    const x = normals[offset];
    const y = normals[offset + 1];
    const z = normals[offset + 2];
    const lenSq = x * x + y * y + z * z;
    if (lenSq > 1e-12) {
      const invLen = 1.0 / Math.sqrt(lenSq);
      normals[offset] = x * invLen;
      normals[offset + 1] = y * invLen;
      normals[offset + 2] = z * invLen;
    } else {
      // Degenerate or flat: default to up vector
      normals[offset] = 0;
      normals[offset + 1] = 1;
      normals[offset + 2] = 0;
    }
  }

  return normals;
}

/**
 * Normalizes an existing array of normal vectors.
 */
export function normalizeNormalArray(normals: Float32Array): Float32Array {
  const count = normals.length / 3;
  const out = new Float32Array(normals.length);
  for (let i = 0; i < count; i++) {
    const offset = i * 3;
    const x = normals[offset];
    const y = normals[offset + 1];
    const z = normals[offset + 2];
    const lenSq = x * x + y * y + z * z;
    if (lenSq > 1e-12) {
      const invLen = 1.0 / Math.sqrt(lenSq);
      out[offset] = x * invLen;
      out[offset + 1] = y * invLen;
      out[offset + 2] = z * invLen;
    } else {
      out[offset] = 0;
      out[offset + 1] = 1;
      out[offset + 2] = 0;
    }
  }
  return out;
}
