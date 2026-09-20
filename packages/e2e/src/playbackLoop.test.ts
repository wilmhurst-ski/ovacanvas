import {compileBeatModule} from '@ovacanvas/host/authoring';
import * as path from 'path';
import {afterAll, beforeAll, describe, expect, test} from 'vitest';
import {equationIntent} from '../../studio/src/authoring/strategies/equationIntent/strategy';
import {unexpectedConsoleErrors} from './consoleErrors';
import type {FoundationApp} from './foundationApp';
import {startFoundation} from './foundationApp';

/**
 * Does a beat survive playing all the way through?
 *
 * @remarks
 * A backward seek re-runs the scene generator, which replaces every node with
 * a fresh one - and a regenerated `Latex` node used to never lay out. Measured
 * with looping enabled, the equation's bounds went from 329px wide through the
 * morph down to **0x0** the moment the loop restarted: the equation vanished
 * on every cycle. Looping was switched off while that was true, and this test
 * now guards the fix instead - the beat loops, and its geometry survives every
 * cycle rather than collapsing on the second.
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

describe('a looping beat across several cycles', () => {
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

  test('keeps its geometry all the way through a single playthrough', async () => {
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
      {id: 'loop-beat', title: INTENT.title, code: compiled.code},
    );
    expect(staged.result.ok).toBe(true);

    // Sample across several loop cycles. The scene is ~5.3s at 30fps, so 30
    // samples at 500ms covers roughly three full loops - and a collapse on the
    // second cycle is exactly the failure this is looking for.
    const samples: Array<{at: number; frame: number; items: unknown}> = [];
    for (let i = 0; i < 30; i++) {
      await new Promise(resolve => setTimeout(resolve, 500));
      const state = (await app.page.evaluate(() =>
        (window as any).ovcLesson.playbackState(),
      )) as {frame: number};
      const items = await app.page.evaluate(() =>
        (window as any).ovcLesson.inspectCurrent(),
      );
      samples.push({at: i * 500, frame: Math.round(state.frame), items});

      // Evidence of the morph, captured mid-playthrough: the same scene at
      // step 1 and at the solved answer. Only meaningful because beats now
      // actually play - before the playback driver both frames were frame 0.
      if (i === 1 || i === 9) {
        await app.page.locator('#lesson').screenshot({
          path: path.resolve(
            __dirname,
            `../evidence/equation-morph-${i === 1 ? 'early' : 'late'}.png`,
          ),
        });
      }
    }

    // It really is looping: the playhead must have wrapped at least twice.
    const frames = samples.map(sample => sample.frame);
    const wraps = frames.filter(
      (frame, index) => index > 0 && frame < frames[index - 1],
    ).length;
    expect(wraps).toBeGreaterThanOrEqual(2);

    console.log('LOOP SAMPLES');
    for (const sample of samples) {
      console.log(
        `  t=${sample.at}ms frame=${sample.frame} ${JSON.stringify(sample.items)}`,
      );
    }

    // The claim: the equation has real geometry at EVERY sample, not just at
    // the end. The failure this guards against is a collapse to 0x0 partway
    // through, which a single end-state assertion could miss if the beat
    // happened to finish before the collapse.
    for (const sample of samples) {
      const items = sample.items as Array<{
        id: string;
        width: number;
        height: number;
        attachedToLiveView: boolean;
      }>;
      const equation = items.find(item => item.id === 'equation')!;
      expect(equation.attachedToLiveView, `at ${sample.at}ms`).toBe(true);
      expect(
        equation.width,
        `equation width at ${sample.at}ms`,
      ).toBeGreaterThan(0);
      expect(
        equation.height,
        `equation height at ${sample.at}ms`,
      ).toBeGreaterThan(0);
    }

    // ...and it settles on a frame with content, rather than fading itself out.
    const last = samples.at(-1)!.items as Array<{
      id: string;
      width: number;
      opacity: number;
    }>;
    const settled = last.find(item => item.id === 'equation')!;
    expect(settled.opacity).toBeGreaterThan(0.5);
  }, 300000);

  test('nothing was logged to the console across all those cycles', () => {
    // The guard that would have caught the `Latex` regeneration bug on the
    // first run: a `@computed` that throws is swallowed and logged to
    // `console`, and nothing else - not `lastError`, not a page error. Three
    // loop cycles is a lot of generator re-executions, so a swallowed error
    // here would be loud.
    expect(unexpectedConsoleErrors(app.consoleErrors)).toEqual([]);
    expect(app.pageErrors).toEqual([]);
  });
});
