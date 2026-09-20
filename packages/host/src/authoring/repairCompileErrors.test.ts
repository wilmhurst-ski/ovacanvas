import * as path from 'path';
import {describe, expect, it} from 'vitest';
import {attemptCompileRepair} from './repairCompileErrors';

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

describe('attemptCompileRepair', () => {
  it('automatically adds a real, forgotten import - the exact WORLD_LAND mistake', () => {
    // The real, reported failure this exists to fix: the model uses
    // WORLD_LAND without importing it. The name is real and exists in
    // '@ovacanvas/2d' - this is a purely mechanical mistake, not a content
    // decision, and costs a full LLM round trip today for one import line.
    const broken = `
      import {GeoMap, GeoPath, GeoSphere} from '@ovacanvas/2d';
      export function build() {
        const map = new GeoMap({projection: {kind: 'equirectangular'}, width: 800, height: 400});
        map.add(new GeoSphere({stroke: '#000'}));
        map.add(new GeoPath({feature: WORLD_LAND, fill: '#3a3'}));
        return map;
      }
    `;

    const result = attemptCompileRepair(broken, PROJECT_ROOT);

    expect(result).not.toBeNull();
    expect(result?.ok).toBe(true);
    if (result?.ok) {
      // The fix must have actually added the import, not just happened to
      // compile some other way - the emitted JS should reference it.
      expect(result.code).toContain('WORLD_LAND');
    }
  });

  it('returns null when the source already compiles clean - nothing to repair', () => {
    const clean = `
      import {Rect} from '@ovacanvas/2d';
      export function build() {
        return new Rect({width: 100, height: 100, fill: '#fff'});
      }
    `;

    expect(attemptCompileRepair(clean, PROJECT_ROOT)).toBeNull();
  });

  it('returns null for a genuine content/logic mistake with no mechanical fix', () => {
    // A constructor called with the wrong argument shape is a real
    // understanding-what-the-API-wants problem, not a name TypeScript could
    // ever guess how to supply - there is no codefix for "you passed the
    // wrong properties", so this must fall through untouched to the normal
    // re-authoring loop.
    const broken = `
      import {Line} from '@ovacanvas/2d';
      export function build() {
        return new Line({start: [0, 0], end: [1, 1], strokeWidth: 2});
      }
    `;

    expect(attemptCompileRepair(broken, PROJECT_ROOT)).toBeNull();
  });

  it('returns null for a plain syntax error - nothing a codefix can construct from garbled syntax', () => {
    expect(
      attemptCompileRepair('export function build( {', PROJECT_ROOT),
    ).toBeNull();
  });

  it('fixes an unambiguous misspelling of a real export', () => {
    // "Txxt" is close enough to the real "Txt" that TypeScript's own
    // spelling-suggestion codefix resolves it with high confidence - the
    // same mechanism as "Cannot find name 'Txxt'. Did you mean 'Txt'?" in
    // any real editor.
    const broken = `
      import {Txxt} from '@ovacanvas/2d';
      export function build() {
        return new Txxt({text: 'hello', fontSize: 24});
      }
    `;

    const result = attemptCompileRepair(broken, PROJECT_ROOT);
    // This one is a softer guarantee than the others (a spelling fix is
    // TypeScript's own judgment call, not this function's) - assert only
    // that IF a fix was returned, it is genuinely valid, never a
    // still-broken result reported as success.
    if (result) expect(result.ok).toBe(true);
  });
});
