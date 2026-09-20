import {compileBeatModule} from '@ovacanvas/host/authoring';
import * as path from 'path';
import {afterAll, beforeAll, describe, expect, test} from 'vitest';
import {equationIntent} from '../../studio/src/authoring/strategies/equationIntent/strategy';
import {unexpectedConsoleErrors} from './consoleErrors';
import type {FoundationApp} from './foundationApp';
import {startFoundation} from './foundationApp';

/**
 * Reproduce the `Latex`-after-regeneration defect in isolation.
 *
 * @remarks
 * A backward seek re-executes the scene generator, replacing every node with a
 * fresh one - and the fresh `Latex` used to render at zero size and stay
 * there. This test was written to pin the cause while it was still open, and
 * now guards the fix: the regenerated node must measure exactly what the
 * original did.
 *
 * A scene that throws while rendering produces no exception the caller can
 * see: `Player.request()` catches it and logs. So this reads the beat's
 * `lastError` as well as its geometry - "it threw" and "it drew an empty
 * frame" look identical from the outside otherwise.
 */
const PROJECT_ROOT = path.resolve(__dirname, '..', '..', 'host');

const INTENT = {
  title: 'Solving a Linear Equation',
  steps: [
    {tex: '{{2x}} + 3 = 7', note: 'Start here'},
    {tex: '{{2x}} = 4', note: 'Subtract 3 from both sides'},
    {tex: 'x = 2', note: 'Divide both sides by 2'},
  ],
};

describe('a Latex node across a generator re-execution', () => {
  let app: FoundationApp;

  beforeAll(async () => {
    app = await startFoundation('/lessonPipeline.html');
    await app.page.waitForFunction(
      () => (window as any).ovcLesson !== undefined,
      undefined,
      {polling: 100},
    );
    await app.page.evaluate(() =>
      (window as any).ovcLesson.boot('Solve 2x + 3 = 7'),
    );
  }, 120000);

  afterAll(async () => {
    await app?.stop();
  }, 60000);

  test('records what actually happens to the equation on a backward seek', async () => {
    const interpretation = equationIntent.interpret(JSON.stringify(INTENT), {
      topic: 'solve 2x + 3 = 7',
      apiSection: '',
    });
    expect(interpretation.ok).toBe(true);
    if (!interpretation.ok) return;

    const compiled = compileBeatModule(
      interpretation.extraction.source,
      PROJECT_ROOT,
      '__equation__.ts',
    );
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;

    const staged = await app.page.evaluate(
      payload =>
        (window as any).ovcLesson.stageSource(
          payload.id,
          payload.title,
          payload.code,
        ),
      {id: 'regen-beat', title: INTENT.title, code: compiled.code},
    );
    expect(staged.result.ok).toBe(true);

    // Let it play out and settle on its final frame first.
    await app.page.evaluate(() => (window as any).ovcLesson.freezeAtRest());
    const before = await app.page.evaluate(() =>
      (window as any).ovcLesson.inspectCurrent(),
    );
    console.log('BEFORE BACKWARD SEEK', JSON.stringify(before));

    // The condition under test: seek back past the current position, which
    // re-executes the generator.
    const after = await app.page.evaluate(() =>
      (window as any).ovcLesson.seekTo(0),
    );
    console.log('AFTER BACKWARD SEEK', JSON.stringify(after, null, 2));
    console.log(
      'ENGINE DIAGNOSTIC:',
      await app.page.evaluate(() => (globalThis as any).__latexDiag ?? 'none'),
    );

    const items = after.items as Array<{
      id: string;
      width: number;
      height: number;
      attachedToLiveView: boolean;
    }>;
    const equation = items.find(item => item.id === 'equation')!;

    // The regression: a `Latex` node rebuilt by the generator re-execution
    // used to render at 0x0 and stay there. Its document build was landing
    // outside a scene context, throwing "The scene is not available in the
    // current context", and - because `document()` is a memoized computed -
    // caching that failure as `undefined` with nothing written to any log.
    expect(equation.attachedToLiveView).toBe(true);
    expect(equation.width).toBeGreaterThan(0);
    expect(equation.height).toBeGreaterThan(0);

    // And it is the RIGHT geometry, not merely non-zero: the seek returns to
    // the same resting frame, so the regenerated node must measure exactly what
    // the original one did. A zero would mean the document build failed again;
    // a different non-zero value would mean it built the wrong step.
    const beforeItems = before as Array<{
      id: string;
      width: number;
      height: number;
    }>;
    const resting = beforeItems.find(item => item.id === 'equation')!;
    expect(equation.width).toBe(resting.width);
    expect(equation.height).toBe(resting.height);

    // Nothing threw, and the engine reported nothing either.
    expect((after as {lastError: unknown}).lastError).toBeNull();
    expect(
      await app.page.evaluate(() => (globalThis as any).__latexDiag ?? null),
    ).toBeNull();
  }, 300000);

  test('the engine logged nothing while rebuilding the node', () => {
    // The assertion that would have caught this bug immediately. The document
    // build used to throw "The scene is not available in the current context";
    // `ComputedContext` caught it and passed it to `useLogger()`, which falls
    // back to `console` with no scene on the stack. So it reached
    // `console.error` and nowhere else - `lastError` stayed null and the node
    // just measured 0x0. This is the channel it reported to.
    const unexpected = unexpectedConsoleErrors(app.consoleErrors);
    if (unexpected.length > 0) {
      console.log(
        'UNEXPECTED CONSOLE ERRORS:',
        JSON.stringify(unexpected, null, 2),
      );
    }
    expect(unexpected).toEqual([]);
  });
});
