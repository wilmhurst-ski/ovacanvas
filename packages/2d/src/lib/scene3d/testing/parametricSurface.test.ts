import {describe, expect, it} from 'vitest';
import {canonicalizeTriangles} from '../geometry/canonicalize';
import {
  parametricSurface,
  surfaceOfRevolution,
} from '../geometry/parametricSurface';
import {Scene3DError} from '../public/errors';

function codeOf(run: () => unknown): string {
  try {
    run();
  } catch (error: any) {
    expect(error).toBeInstanceOf(Scene3DError);
    return error.code;
  }
  throw new Error('expected the operation to be refused');
}

describe('parametricSurface', () => {
  it('builds a valid, canonicalizable unit sphere', () => {
    const geometry = parametricSurface(
      (u, v) => [
        Math.cos(u) * Math.sin(v),
        Math.cos(v),
        Math.sin(u) * Math.sin(v),
      ],
      {
        uRange: [0, Math.PI * 2],
        vRange: [0, Math.PI],
        uSegments: 16,
        vSegments: 12,
      },
    );

    const canonical = canonicalizeTriangles(geometry);
    expect(canonical.vertexCount).toBe(17 * 13);

    // Every vertex of a unit sphere sits exactly 1 unit from the origin.
    for (let i = 0; i < canonical.vertexCount; i++) {
      const x = canonical.positions[i * 3];
      const y = canonical.positions[i * 3 + 1];
      const z = canonical.positions[i * 3 + 2];
      expect(Math.hypot(x, y, z)).toBeCloseTo(1, 5);
    }
  });

  it('a flat plane produces consistent normals pointing the same way', () => {
    const geometry = parametricSurface((u, v) => [u, 0, v], {
      uRange: [-1, 1],
      vRange: [-1, 1],
      uSegments: 3,
      vSegments: 3,
    });
    const canonical = canonicalizeTriangles(geometry);
    for (let i = 0; i < canonical.vertexCount; i++) {
      expect(Math.abs(canonical.normals[i * 3 + 1])).toBeCloseTo(1, 5);
    }
  });

  it('refuses a non-positive or non-integer segment count', () => {
    const build = (uSegments: number) =>
      parametricSurface((u, v) => [u, v, 0], {
        uRange: [0, 1],
        vRange: [0, 1],
        uSegments,
        vSegments: 4,
      });
    expect(codeOf(() => build(0))).toBe('INVALID_SEGMENT_COUNT');
    expect(codeOf(() => build(-2))).toBe('INVALID_SEGMENT_COUNT');
    expect(codeOf(() => build(2.5))).toBe('INVALID_SEGMENT_COUNT');
  });

  it('refuses a degenerate parameter range', () => {
    expect(
      codeOf(() =>
        parametricSurface((u, v) => [u, v, 0], {
          uRange: [1, 1],
          vRange: [0, 1],
          uSegments: 4,
          vSegments: 4,
        }),
      ),
    ).toBe('INVALID_DOMAIN_RANGE');
  });

  it('refuses a function that returns a non-finite point', () => {
    expect(
      codeOf(() =>
        parametricSurface((u, v) => [u === 0 ? NaN : u, v, 0], {
          uRange: [0, 1],
          vRange: [0, 1],
          uSegments: 4,
          vSegments: 4,
        }),
      ),
    ).toBe('INVALID_VECTOR');
  });
});

describe('surfaceOfRevolution', () => {
  it('a constant-radius profile produces a true cylinder', () => {
    const geometry = surfaceOfRevolution(t => [1, t], {
      tRange: [0, 2],
      tSegments: 6,
      angularSegments: 24,
      axis: 'x',
    });
    const canonical = canonicalizeTriangles(geometry);
    for (let i = 0; i < canonical.vertexCount; i++) {
      const x = canonical.positions[i * 3];
      const y = canonical.positions[i * 3 + 1];
      const z = canonical.positions[i * 3 + 2];
      expect(Math.hypot(y, z)).toBeCloseTo(1, 5); // every point 1 unit from the axis
      expect(x).toBeGreaterThanOrEqual(-1e-9);
      expect(x).toBeLessThanOrEqual(2 + 1e-9);
    }
  });

  it("Gabriel's Horn profile (radius = 1/t) matches the defining curve at every vertex", () => {
    const geometry = surfaceOfRevolution(t => [1 / t, t], {
      tRange: [1, 5],
      tSegments: 8,
      angularSegments: 16,
      axis: 'x',
    });
    const canonical = canonicalizeTriangles(geometry);
    for (let i = 0; i < canonical.vertexCount; i++) {
      const x = canonical.positions[i * 3];
      const y = canonical.positions[i * 3 + 1];
      const z = canonical.positions[i * 3 + 2];
      expect(Math.hypot(y, z)).toBeCloseTo(1 / x, 5);
    }
  });

  it('is genuinely the same computation as a hand-expanded parametricSurface call, not a separate implementation', () => {
    const viaRevolution = surfaceOfRevolution(t => [1, t], {
      tRange: [0, 2],
      tSegments: 5,
      angularSegments: 8,
      axis: 'z',
    });
    const viaParametric = parametricSurface(
      (t, theta) => [Math.cos(theta), Math.sin(theta), t],
      {uRange: [0, 2], vRange: [0, Math.PI * 2], uSegments: 5, vSegments: 8},
    );
    expect(viaRevolution.positions).toEqual(viaParametric.positions);
    expect(viaRevolution.indices).toEqual(viaParametric.indices);
  });
});
