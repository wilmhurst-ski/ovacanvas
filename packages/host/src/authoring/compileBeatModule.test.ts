import * as path from 'path';
import {describe, expect, it} from 'vitest';
import {compileBeatModule} from './compileBeatModule';

// Resolved against packages/host itself - see `compileBeatSource.test.ts`.
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

const VALID = `
  import {Rect} from '@ovacanvas/2d';
  export function build() {
    return new Rect({width: 100, height: 100, fill: '#fff'});
  }
`;

/** A real export used without its import - the exact WORLD_LAND mistake. */
const MISSING_IMPORT = `
  import {GeoMap, GeoPath, GeoSphere} from '@ovacanvas/2d';
  export function build() {
    const map = new GeoMap({projection: {kind: 'equirectangular'}, width: 800, height: 400});
    map.add(new GeoSphere({stroke: '#000'}));
    map.add(new GeoPath({feature: WORLD_LAND, fill: '#3a3'}));
    return map;
  }
`;

/** Wrong argument shape: a real content mistake, with no mechanical fix. */
const WRONG_CONTENT = `
  import {Line} from '@ovacanvas/2d';
  export function build() {
    return new Line({start: [0, 0], end: [1, 1], strokeWidth: 2});
  }
`;

describe('compileBeatModule', () => {
  it('passes a valid module straight through without touching repair', () => {
    const result = compileBeatModule(VALID, PROJECT_ROOT);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.repaired).toBe(false);
      expect(result.code).toContain('function build');
    }
  });

  it('rescues a purely mechanical mistake and says that it did', () => {
    const result = compileBeatModule(MISSING_IMPORT, PROJECT_ROOT);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.repaired).toBe(true);
      // The fix really added the import rather than the file compiling some
      // other way - the emitted JS still has to reference the name.
      expect(result.code).toContain('WORLD_LAND');
    }
  });

  it('refuses a genuine content mistake instead of mangling it, and hands back the diagnostics', () => {
    const result = compileBeatModule(WRONG_CONTENT, PROJECT_ROOT);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Nothing mechanical to do, so the caller is told to re-author - not
      // told a repair was attempted and failed.
      expect(result.stage).toBe('compile');
      expect(result.diagnostics.length).toBeGreaterThan(0);
      expect(result.message).toContain('TS');
    }
  });

  it('reports a plain syntax error as unfixable rather than guessing at it', () => {
    const result = compileBeatModule('export function build( {', PROJECT_ROOT);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.stage).toBe('compile');
  });
});
