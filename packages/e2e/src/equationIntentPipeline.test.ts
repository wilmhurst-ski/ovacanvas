import {compileBeatModule} from '@ovacanvas/host/authoring';
import * as path from 'path';
import {afterAll, beforeAll, describe, expect, test} from 'vitest';
import {equationIntent} from '../../studio/src/authoring/strategies/equationIntent/strategy';
import {unexpectedConsoleErrors} from './consoleErrors';
import type {FoundationApp} from './foundationApp';
import {startFoundation} from './foundationApp';

/**
 * The intent-compiler path, proven all the way to a visible beat.
 *
 * @remarks
 * Compiling is a weak guarantee on its own - a module can typecheck and still
 * render nothing, collide, or blow the beat's duration cap. The claim worth
 * testing is the one a learner experiences: that the deterministic template
 * produces something the real audit passes and the host actually puts on
 * screen. So this drives the same browser harness the hand-authored beats use,
 * and then re-runs the audit against the beat that is genuinely on screen.
 */
const PROJECT_ROOT = path.resolve(__dirname, '..', '..', 'host');

const INTENT = {
  title: 'Solving a Linear Equation',
  steps: [
    {tex: '{{2x}} + 3 = 7'},
    {tex: '{{2x}} = 4', note: 'Subtract 3 from both sides'},
    {tex: 'x = 2', note: 'Divide both sides by 2'},
  ],
};

describe('equation intent compiler, end to end', () => {
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

  test('an intent becomes a visible, audit-passing beat', async () => {
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
      {id: 'equation-beat', title: INTENT.title, code: compiled.code},
    );

    // Surface the resolver's own message on failure - a bare boolean here
    // would hide exactly the detail needed to fix it.
    if (!staged.resolved || !staged.result.ok) {
      console.log('STAGE REJECTED:', JSON.stringify(staged, null, 2));
      const report = await app.page.evaluate(() =>
        (window as any).ovcLesson.lastReport(),
      );
      console.log('AUDIT REPORT:', JSON.stringify(report, null, 2));
    }
    expect(staged.resolved).toBe(true);
    expect(staged.result.ok).toBe(true);
    expect(staged.after.current.beatId).toBe('equation-beat');
    expect(staged.after.current.visible).toBe(true);

    // Freeze on the resting frame first: the beat plays on a loop, and the
    // template ends by fading out, so an arbitrary sample could legitimately
    // catch a blank moment and prove nothing.
    const frozen = await app.page.evaluate(() =>
      (window as any).ovcLesson.freezeAtRest(),
    );
    expect(frozen.isPlaying).toBe(false);

    // The strongest form: the beat that is on screen right now passes the
    // same audit that gates every other beat.
    const live = await app.page.evaluate(() =>
      (window as any).ovcLesson.auditCurrent(),
    );
    if (!live.passed) {
      console.log('LIVE AUDIT FAILED:', JSON.stringify(live, null, 2));
      console.log('PLAYBACK STATE:', JSON.stringify(frozen));
      console.log(
        'POSITIONS:',
        JSON.stringify(
          await app.page.evaluate(() =>
            (window as any).ovcLesson.currentBeatPositions(),
          ),
        ),
      );
    }
    expect(live.passed).toBe(true);
    expect(live.findings).toEqual([]);

    // The beat must actually draw something. This is not a cosmetic check:
    // an earlier version of this template faded its content in from opacity 0,
    // and because a beat is inert once shown, the learner saw an empty canvas
    // while the audit reported `passed: true`. Reading the pixels is the only
    // assertion that catches that.
    const hasInk = await app.page.evaluate(() => {
      const canvas = document.querySelector(
        '#lesson canvas',
      ) as HTMLCanvasElement | null;
      if (!canvas) return false;
      const context = canvas.getContext('2d');
      if (!context) return false;
      const {data} = context.getImageData(0, 0, canvas.width, canvas.height);
      const distinct = new Set<string>();
      for (let index = 0; index < data.length; index += 4 * 997) {
        distinct.add(`${data[index]},${data[index + 1]},${data[index + 2]}`);
        if (distinct.size > 4) return true;
      }
      return distinct.size > 1;
    });
    expect(hasInk).toBe(true);

    // Evidence alongside the other e2e captures. Worth keeping because the
    // intent compiler is deterministic - this image is what the template
    // produces, reproducible without a model in the loop.
    await app.page
      .locator('#lesson')
      .screenshot({
        path: path.resolve(__dirname, '../evidence/equation-intent-beat.png'),
      });
  });

  test('no page errors were raised by the compiled template', () => {
    expect(app.pageErrors).toEqual([]);
  });

  test('nothing was logged to the console, which is where swallowed errors go', () => {
    expect(unexpectedConsoleErrors(app.consoleErrors)).toEqual([]);
  });
});
