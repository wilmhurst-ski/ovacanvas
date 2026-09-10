import {describe, expect, it} from 'vitest';
import {
  canonicalizeLines,
  canonicalizePoints,
  canonicalizeTriangles,
} from '../geometry/canonicalize';
import {findDegenerateTriangles} from '../geometry/primitives';
import {Scene3DError} from '../public/errors';
import {fingerprintGeometry} from '../public/fingerprint';
import type {TriangleGeometry3D} from '../public/types';
import {createCrossingTriangles} from './fixtures';

describe('scene3d / geometry', () => {
  describe('canonicalizeTriangles', () => {
    it('canonicalizes valid triangle geometry and computes normals', () => {
      const geom: TriangleGeometry3D = {
        kind: 'triangles',
        positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
        indices: [0, 1, 2],
      };

      const canon = canonicalizeTriangles(geom);
      expect(canon.vertexCount).toBe(3);
      expect(canon.positions).toBeInstanceOf(Float32Array);
      expect(canon.indices).toBeInstanceOf(Uint16Array);
      expect(canon.normals).toBeInstanceOf(Float32Array);
      // For CCW triangle in XY plane, normal points +Z
      expect(canon.normals[0]).toBeCloseTo(0);
      expect(canon.normals[1]).toBeCloseTo(0);
      expect(canon.normals[2]).toBeCloseTo(1);
    });

    it('freezes/copies arrays so caller mutation does not affect accepted geometry', () => {
      const positions = [0, 0, 0, 1, 0, 0, 0, 1, 0];
      const canon = canonicalizeTriangles({
        kind: 'triangles',
        positions,
        indices: [0, 1, 2],
      });

      positions[0] = 999;
      expect(canon.positions[0]).toBe(0);
    });

    it('expands RGB vertex colors to RGBA with alpha = 1.0', () => {
      const canon = canonicalizeTriangles({
        kind: 'triangles',
        positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
        indices: [0, 1, 2],
        colors: [1, 0, 0, 0, 1, 0, 0, 0, 1], // 3 RGB tuples
      });

      expect(canon.colors).toBeDefined();
      expect(canon.colors!.length).toBe(12); // 3 * 4
      expect(Array.from(canon.colors!.slice(0, 4))).toEqual([1, 0, 0, 1]);
      expect(Array.from(canon.colors!.slice(4, 8))).toEqual([0, 1, 0, 1]);
      expect(Array.from(canon.colors!.slice(8, 12))).toEqual([0, 0, 1, 1]);
    });

    it('rejects non-finite positions', () => {
      expect(() =>
        canonicalizeTriangles({
          kind: 'triangles',
          positions: [0, 0, NaN, 1, 0, 0, 0, 1, 0],
          indices: [0, 1, 2],
        }),
      ).toThrow(Scene3DError);
    });

    it('rejects indices out of bounds', () => {
      expect(() =>
        canonicalizeTriangles({
          kind: 'triangles',
          positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
          indices: [0, 1, 5],
        }),
      ).toThrow(Scene3DError);
    });

    it('rejects triangles that repeat vertex indices', () => {
      expect(() =>
        canonicalizeTriangles({
          kind: 'triangles',
          positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
          indices: [0, 1, 1], // repeated index 1
        }),
      ).toThrow(Scene3DError);
    });

    it('detects degenerate / zero-area triangles', () => {
      const positions = new Float32Array([
        0,
        0,
        0,
        1,
        0,
        0,
        2,
        0,
        0, // collinear points
      ]);
      const indices = new Uint16Array([0, 1, 2]);
      const diagnostics = findDegenerateTriangles(positions, indices);

      expect(diagnostics.length).toBe(1);
      expect(diagnostics[0].reason).toBe('zero_area');
    });
  });

  describe('canonicalizeLines', () => {
    it('canonicalizes segment topology and verifies length divisible by 2', () => {
      const canon = canonicalizeLines({
        kind: 'lines',
        topology: 'segments',
        positions: [0, 0, 0, 1, 1, 1],
        indices: [0, 1],
      });
      expect(canon.topology).toBe('segments');
      expect(canon.indices!.length).toBe(2);

      expect(() =>
        canonicalizeLines({
          kind: 'lines',
          topology: 'segments',
          positions: [0, 0, 0, 1, 1, 1],
          indices: [0], // invalid odd length
        }),
      ).toThrow(Scene3DError);
    });

    it('canonicalizes line strip topology', () => {
      const canon = canonicalizeLines({
        kind: 'lines',
        topology: 'strip',
        positions: [0, 0, 0, 1, 0, 0, 1, 1, 0],
      });
      expect(canon.vertexCount).toBe(3);
    });
  });

  describe('canonicalizePoints', () => {
    it('canonicalizes points and validates custom point sizes', () => {
      const canon = canonicalizePoints({
        kind: 'points',
        positions: [0, 0, 0, 1, 1, 1],
        sizes: [4.0, 8.0],
      });
      expect(canon.vertexCount).toBe(2);
      expect(canon.sizes![0]).toBe(4.0);
      expect(canon.sizes![1]).toBe(8.0);
    });

    it('rejects mismatched point size count', () => {
      expect(() =>
        canonicalizePoints({
          kind: 'points',
          positions: [0, 0, 0, 1, 1, 1],
          sizes: [4.0], // only 1 size for 2 points
        }),
      ).toThrow(Scene3DError);
    });
  });

  describe('fingerprintGeometry', () => {
    it('computes deterministic fingerprint from geometry data', () => {
      const {triangleA, triangleB} = createCrossingTriangles();
      const fpA1 = fingerprintGeometry(triangleA);
      const fpA2 = fingerprintGeometry(triangleA);
      const fpB = fingerprintGeometry(triangleB);

      expect(fpA1).toBe(fpA2);
      expect(fpA1).not.toBe(fpB);
    });

    it('changes fingerprint when vertex position changes', () => {
      const geom1: TriangleGeometry3D = {
        kind: 'triangles',
        positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
        indices: [0, 1, 2],
      };
      const geom2: TriangleGeometry3D = {
        kind: 'triangles',
        positions: [0, 0, 0, 1, 0, 0, 0, 1.01, 0],
        indices: [0, 1, 2],
      };

      expect(fingerprintGeometry(geom1)).not.toBe(fingerprintGeometry(geom2));
    });
  });
});
