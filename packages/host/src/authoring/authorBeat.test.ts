import * as path from 'path';
import {describe, expect, it, vi} from 'vitest';
import type {BeatManifest} from '../presentation/BeatManifest';
import {authorBeat, type ResolveBeatModule} from './authorBeat';

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

const VALID = `
  import {Rect} from '@ovacanvas/2d';
  export default function* () {}
  export function buildAuditSpec() {
    return {items: [], requiredIds: [], safeArea: {}};
  }
`;

const WRONG_CONTENT = `
  import {Line} from '@ovacanvas/2d';
  export function build() {
    return new Line({start: [0, 0], end: [1, 1], strokeWidth: 2});
  }
`;

/**
 * These exercise the chain's routing, with the browser-side resolve step
 * injected.
 *
 * @remarks
 * The resolve step is deliberately a seam rather than a stub-for-convenience:
 * it cannot run here at all. `resolveBeatSource` needs one live
 * `@ovacanvas/2d` module instance and a real DOM, while the compile step
 * needs `ts.sys` and the real filesystem - the two halves of this chain
 * genuinely live in different processes, which is why `authorBeat` takes a
 * resolver at all. The real resolver is proven against a real browser in
 * `packages/e2e/src/authorBeat.test.ts`, and the real compiler is exercised
 * here by the tests above and in `compileBeatModule.test.ts`.
 */
function fakeManifest(id: string): BeatManifest {
  return {
    id,
    title: id,
    runner: (() => {}) as unknown as BeatManifest['runner'],
    buildAuditSpec: () => ({items: [], requiredIds: [], safeArea: []}),
  };
}

describe('authorBeat', () => {
  it('carries a valid module all the way to a manifest', async () => {
    const resolve = vi.fn(async (id: string) => fakeManifest(id));

    const result = await authorBeat({
      id: 'beat-1',
      title: 'A beat',
      source: VALID,
      projectRoot: PROJECT_ROOT,
      resolve,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manifest.id).toBe('beat-1');
      expect(result.repaired).toBe(false);
      expect(result.code).toContain('buildAuditSpec');
    }
    // The resolver is handed the COMPILED module, not the original source.
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve.mock.calls[0][2]).toContain('exports.buildAuditSpec');
  });

  it('hands the resolver a repaired module and reports that a repair happened', async () => {
    const resolve: ResolveBeatModule = async id => fakeManifest(id);
    const broken = VALID.replace(
      'function* () {}',
      'function* () { return WORLD_LAND; }',
    );

    const result = await authorBeat({
      id: 'beat-2',
      title: 'A repaired beat',
      source: broken,
      projectRoot: PROJECT_ROOT,
      resolve,
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.repaired).toBe(true);
  });

  it('stops at compile failure and never reaches the resolver', async () => {
    const resolve = vi.fn(async (id: string) => fakeManifest(id));

    const result = await authorBeat({
      id: 'beat-3',
      title: 'A wrong beat',
      source: WRONG_CONTENT,
      projectRoot: PROJECT_ROOT,
      resolve,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.stage).toBe('compile');
      expect(result.message).toContain('TS');
    }
    expect(resolve).not.toHaveBeenCalled();
  });

  it('reports a resolver throw as its own stage rather than as a compile failure', async () => {
    const resolve: ResolveBeatModule = async () => {
      throw new Error('beat beat-4 does not export buildAuditSpec(view)');
    };

    const result = await authorBeat({
      id: 'beat-4',
      title: 'A beat that compiles but is not stageable',
      source: VALID,
      projectRoot: PROJECT_ROOT,
      resolve,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.stage).toBe('resolve');
      expect(result.message).toContain('buildAuditSpec');
    }
  });
});
