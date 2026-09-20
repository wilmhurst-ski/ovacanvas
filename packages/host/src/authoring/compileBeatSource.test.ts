import * as path from 'path';
import {describe, expect, it} from 'vitest';
import {
  clearCompilerCache,
  compileBeatSource,
  getCompilerCacheStats,
} from './compileBeatSource';

// Resolved against packages/host itself: it has @ovacanvas/2d and
// @ovacanvas/core as real dependencies, so module resolution for a beat's
// imports works the same way it would in any real consuming project.
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

describe('compileBeatSource', () => {
  it('compiles valid beat source and returns emitted JS', () => {
    const result = compileBeatSource(
      `
        import {Rect} from '@ovacanvas/2d';
        export function build() {
          return new Rect({width: 100, height: 100, fill: '#fff'});
        }
      `,
      PROJECT_ROOT,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.code).toContain('function build');
    }
  });

  it('rejects a constructor call with no required argument (TS2554)', () => {
    const result = compileBeatSource(
      `
        import {Node} from '@ovacanvas/2d';
        export function build() {
          return new Node();
        }
      `,
      PROJECT_ROOT,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.some(d => d.message.includes('Expected'))).toBe(
        true,
      );
    }
  });

  it('rejects an object literal with an excess/unknown property (TS2353/TS2322)', () => {
    const result = compileBeatSource(
      `
        import {Line} from '@ovacanvas/2d';
        export function build() {
          return new Line({start: [0, 0], end: [1, 1], strokeWidth: 2});
        }
      `,
      PROJECT_ROOT,
    );

    expect(result.ok).toBe(false);
  });

  it('rejects plain syntax errors', () => {
    const result = compileBeatSource('export function build( {', PROJECT_ROOT);
    expect(result.ok).toBe(false);
  });

  it('proves the speed hypothesis: warm compile with program cache is substantially faster than cold start', () => {
    clearCompilerCache();

    const sampleSource = `
      import {Rect} from '@ovacanvas/2d';
      export function build() {
        return new Rect({width: 200, height: 100, fill: '#123'});
      }
    `;

    // 1. Cold start (empty cache)
    const t0 = performance.now();
    const coldResult = compileBeatSource(
      sampleSource,
      PROJECT_ROOT,
      '__cold__.ts',
    );
    const coldMs = performance.now() - t0;
    expect(coldResult.ok).toBe(true);

    // 2. Warm compile (reusing program and parsed ASTs)
    const t1 = performance.now();
    const warmResult = compileBeatSource(
      sampleSource,
      PROJECT_ROOT,
      '__warm__.ts',
    );
    const warmMs = performance.now() - t1;
    expect(warmResult.ok).toBe(true);

    const stats = getCompilerCacheStats();
    expect(stats.cachedRoots).toBeGreaterThanOrEqual(1);
    expect(stats.cachedFilesCount).toBeGreaterThan(10);

    console.log(
      `COMPILE SPEED BENCHMARK: cold = ${coldMs.toFixed(1)}ms, warm = ${warmMs.toFixed(1)}ms (${(coldMs / Math.max(1, warmMs)).toFixed(1)}x speedup)`,
    );

    // Warm compile is demonstrably faster than cold start
    expect(warmMs).toBeLessThan(coldMs);
  });
});
