import {compileBeatModule} from '@ovacanvas/host/authoring';
import * as path from 'path';
import {afterAll, beforeAll, describe, expect, test} from 'vitest';
import {unexpectedConsoleErrors} from './consoleErrors';
import type {FoundationApp} from './foundationApp';
import {startFoundation} from './foundationApp';

/**
 * The Phase-2 chain proven end to end: authored source text becomes a
 * visible beat, with each half running in the environment it actually
 * belongs in.
 *
 * @remarks
 * The compile half runs here, in Node, against packages/host's real installed
 * `@ovacanvas/*` declarations. The resolve half runs in the browser, against
 * the real engine. The compiled `code` string between them is exactly what
 * crosses that boundary in the product, so this test exercises the real
 * interface rather than a convenient in-process shortcut.
 */
const PROJECT_ROOT = path.resolve(__dirname, '..', '..', 'host');

describe('authoring glue reaches the visible stage', () => {
  let app: FoundationApp;

  const stageSource = (id: string, title: string, code: string) =>
    app.page.evaluate(
      payload =>
        (window as any).ovcLesson.stageSource(
          payload.id,
          payload.title,
          payload.code,
        ),
      {id, title, code},
    );

  beforeAll(async () => {
    app = await startFoundation('/lessonPipeline.html');
    await app.page.waitForFunction(
      () => (window as any).ovcLesson !== undefined,
      undefined,
      {polling: 100},
    );
    await app.page.evaluate(() =>
      (window as any).ovcLesson.boot('What is a derivative?'),
    );
  }, 120000);

  afterAll(async () => {
    await app?.stop();
  }, 60000);

  test('a hand-written source string compiles, resolves and activates', async () => {
    const source = `
      import {Txt, makeScene2D} from '@ovacanvas/2d';
      import {BBox, waitFor} from '@ovacanvas/core';

      let title: Txt;

      export default makeScene2D(function* (view) {
        title = new Txt({text: 'Compiled from a string', fontSize: 56, position: [0, 0]});
        view.add(title);
        yield* waitFor(1);
      });

      export function buildAuditSpec() {
        return {
          items: [{id: 'title', node: title, halo: 10}],
          requiredIds: ['title'],
          safeArea: new BBox(60, 60, 1800, 960),
        };
      }
    `;

    const compiled = compileBeatModule(source, PROJECT_ROOT, '__authored__.ts');
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;

    const staged = await stageSource(
      'authored-1',
      'Authored beat',
      compiled.code,
    );
    expect(staged.resolved).toBe(true);
    expect(staged.result.ok).toBe(true);
    expect(staged.after.current.beatId).toBe('authored-1');
    expect(staged.after.current.visible).toBe(true);
  });

  test('a module that compiles but throws in its generator is refused, not shown', async () => {
    const source = `
      import {Txt, makeScene2D} from '@ovacanvas/2d';
      import {BBox, waitFor} from '@ovacanvas/core';

      let title: Txt;

      export default makeScene2D(function* (view) {
        title = new Txt({text: 'never', fontSize: 56, position: [0, 0]});
        view.add(title);
        throw new Error('boom inside the scene generator');
      });

      export function buildAuditSpec() {
        return {
          items: [{id: 'title', node: title, halo: 10}],
          requiredIds: ['title'],
          safeArea: new BBox(60, 60, 1800, 960),
        };
      }
    `;

    const compiled = compileBeatModule(source, PROJECT_ROOT, '__authored__.ts');
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;

    const before = await app.page.evaluate(() =>
      (window as any).ovcLesson.snapshot(),
    );
    const staged = await stageSource(
      'authored-throws',
      'Broken beat',
      compiled.code,
    );

    expect(staged.resolved).toBe(true);
    expect(staged.result.ok).toBe(false);
    // A scene that errors while rendering is the beat's own fault, so it is
    // charged against its budget and re-authorable.
    expect(staged.result.reason).toBe('preparation-failed');

    const after = await app.page.evaluate(() =>
      (window as any).ovcLesson.snapshot(),
    );
    expect(after.current.beatId).toBe(before.current.beatId);
    // Not the render count: a playing beat renders continuously, so it is no
    // longer evidence that the refusal left the current beat alone.
    expect(after.activeGeneration).toBe(before.activeGeneration);
    expect(after.current.disposeCount).toBe(0);
  });

  test('a module without buildAuditSpec is refused with a useful reason', async () => {
    const source = `
      import {Txt, makeScene2D} from '@ovacanvas/2d';
      import {waitFor} from '@ovacanvas/core';

      export default makeScene2D(function* (view) {
        view.add(new Txt({text: 'no audit spec', fontSize: 56}));
        yield* waitFor(1);
      });
    `;

    const compiled = compileBeatModule(source, PROJECT_ROOT, '__authored__.ts');
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;

    const staged = await stageSource(
      'authored-no-spec',
      'Incomplete beat',
      compiled.code,
    );
    expect(staged.resolved).toBe(false);
    expect(staged.error).toContain('buildAuditSpec');
  });

  test('a source string that does not compile is stopped before it ever reaches the browser', async () => {
    const compiled = compileBeatModule(
      `import {Line} from '@ovacanvas/2d';
       export function build() { return new Line({start: [0,0], strokeWidth: 2}); }`,
      PROJECT_ROOT,
      '__authored__.ts',
    );

    expect(compiled.ok).toBe(false);
    if (!compiled.ok) {
      expect(compiled.stage).toBe('compile');
      expect(compiled.diagnostics.length).toBeGreaterThan(0);
    }
  });

  test('no page errors were raised across the authoring chain', () => {
    expect(app.pageErrors).toEqual([]);
  });

  test('nothing was logged to the console, which is where swallowed errors go', () => {
    expect(unexpectedConsoleErrors(app.consoleErrors)).toEqual([]);
  });
});
