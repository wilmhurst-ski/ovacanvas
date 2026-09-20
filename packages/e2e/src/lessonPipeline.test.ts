import {compileBeatModule} from '@ovacanvas/host/authoring';
import * as path from 'path';
import {afterAll, beforeAll, describe, expect, test} from 'vitest';
import {unexpectedConsoleErrors} from './consoleErrors';
import type {FoundationApp} from './foundationApp';
import {startFoundation} from './foundationApp';

/** A directory whose module resolution can reach the engine packages. */
const PROJECT_ROOT = path.resolve(__dirname, '..', '..', 'host');

/**
 * The load-bearing claim of the whole product, proven in a real browser:
 * `LessonHost.stage()` -\> `BeatStagingCoordinator` -\> `TransitionOwner` -\>
 * `BeatAdapter.prepare()` -\> render -\> `evaluateVisualAudit` -\> mechanical
 * repair -\> `markReady()` -\> activate, where a beat that fails its own audit
 * can never become visible.
 *
 * @remarks
 * Deliberately Playwright against a real canvas rather than jsdom: a mocked
 * canvas would verify nothing about an audit whose entire job is to read real
 * rendered geometry.
 */
describe('lesson pipeline readiness gate', () => {
  let app: FoundationApp;

  const boot = (question: string) =>
    app.page.evaluate(q => (window as any).ovcLesson.boot(q), question);
  const stage = (kind: string) =>
    app.page.evaluate(k => (window as any).ovcLesson.stage(k), kind);
  const activate = () =>
    app.page.evaluate(() => (window as any).ovcLesson.activate());
  const snapshot = () =>
    app.page.evaluate(() => (window as any).ovcLesson.snapshot());
  const reports = () =>
    app.page.evaluate(() => (window as any).ovcLesson.reports());
  const probe = (kind: string) =>
    app.page.evaluate(k => (window as any).ovcLesson.probe(k), kind);
  const attemptsFor = (beatId: string) =>
    app.page.evaluate(b => (window as any).ovcLesson.attemptsFor(b), beatId);
  const currentBeatPositions = () =>
    app.page.evaluate(() => (window as any).ovcLesson.currentBeatPositions());
  const auditCurrent = () =>
    app.page.evaluate(() => (window as any).ovcLesson.auditCurrent());

  beforeAll(async () => {
    app = await startFoundation('/lessonPipeline.html');
    await app.page.waitForFunction(
      () => (window as any).ovcLesson !== undefined,
      undefined,
      {polling: 100},
    );
  }, 120000);

  afterAll(async () => {
    await app?.stop();
  }, 60000);

  test('time to first visual is inside the soft budget, measured not estimated', async () => {
    // The MVP bar names 4s soft / 8s hard and says explicitly to instrument
    // it. This is the number a learner actually waits: from submitting a
    // question to the first thing being on screen. It needs no provider -
    // the opener beat is host-authored - so it is measurable unconditionally
    // and can be a real assertion rather than a note.
    const started = Date.now();
    const booted = await boot(
      'Why does a derivative measure a rate of change?',
    );
    const elapsedMs = Date.now() - started;

    expect(booted.result.ok).toBe(true);
    expect(booted.snapshot.current.visible).toBe(true);
    console.log(`TIME TO FIRST VISUAL: ${elapsedMs}ms (soft budget 4000ms)`);
    expect(elapsedMs).toBeLessThan(4000);
  });

  test('the opener accepts a question written in plain-text maths', async () => {
    // The bug this guards: the opener restates the learner's question, and the
    // audit refuses plain-text maths notation in a `Txt` node. So a learner who
    // typed "solve x^2 - 5x + 6 = 0" - how most people write it - had their own
    // question used to refuse the beat that shows it back to them, and got an
    // error instead of an explanation. The rule is about *authored* content;
    // echoing a question back is not authorship.
    //
    // The exemption had to be threaded through four audit call sites and the
    // cross-frame sampler, which is why this is a test and not a comment: it
    // took three attempts to get right, and each miss looked like success.
    for (const question of [
      'solve x^2 - 5x + 6 = 0',
      'a^b',
      'why does 10^-3 matter?',
      'solve for x: 3/(x - 1) = 2',
    ]) {
      const booted = await boot(question);
      expect(booted.result.ok, question).toBe(true);
    }
  });

  test('an incomplete audit spec fails with a message the retry loop can act on', async () => {
    // A beat's `buildAuditSpec` is compiled but never type-checked against
    // `BeatAuditSpec` - the source is model-generated and only has to compile,
    // so nothing verifies the shape it returns. A spec missing `requiredIds`
    // used to die inside the audit as "Cannot read properties of undefined
    // (reading 'filter')", and that string is exactly what the retry loop feeds
    // back to the model, which cannot act on it. This pins the actionable
    // version, and that the opaque one is gone.
    const source = [
      "import {Txt, makeScene2D} from '@ovacanvas/2d';",
      "import {waitFor} from '@ovacanvas/core';",
      'let title: Txt;',
      'export default makeScene2D(function* (view) {',
      "  title = new Txt({text: 'hello', position: [0, 0]});",
      '  view.add([title]);',
      '  yield* waitFor(1);',
      '});',
      'export function buildAuditSpec() {',
      "  return {items: [{id: 'title', node: title, halo: 10}]};",
      '}',
      '',
    ].join('\n');

    const compiled = compileBeatModule(
      source,
      PROJECT_ROOT,
      '__incomplete__.ts',
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
      {id: 'incomplete-spec', title: 'hello', code: compiled.code},
    );

    expect(staged.result.ok).toBe(false);
    const detail = String(staged.result.detail ?? '');
    expect(detail).toContain('buildAuditSpec() did not return');
    expect(detail).toContain('requiredIds');
    expect(detail).not.toContain('reading');
  });

  test('the host-authored opener beat is the first thing on screen', async () => {
    const started = await boot(
      'Why does the derivative measure a rate of change?',
    );
    expect(started.result.ok).toBe(true);

    const state = await snapshot();
    expect(state.phase).toBe('active');
    expect(state.current.beatId).toBe('opener');
    expect(state.current.visible).toBe(true);
    expect(state.canvasesInSlot).toBe(1);
    expect(state.slotChildren).toBe(1);
  });

  test('a beat whose real overlap cannot be repaired never activates', async () => {
    // First establish, from the raw audit, that this fixture genuinely
    // collides and that repair genuinely cannot clear it - otherwise the
    // refusal below would prove nothing.
    const evidence = await probe('overlap-unrepairable');
    expect(evidence.before.passed).toBe(false);
    expect(evidence.before.findings.join(' ')).toMatch(/Visual collision/);
    expect(evidence.repair.attempted).toBe(true);
    expect(evidence.after.passed).toBe(false);

    const before = await snapshot();
    const staged = await stage('overlap-unrepairable');

    expect(staged.result.ok).toBe(false);
    expect(staged.result.reason).toBe('not-ready');

    const after = await snapshot();
    // The learner's view is untouched: same beat, same generation, nothing
    // disposed, still exactly one canvas in the slot. Render count is
    // deliberately not compared - a playing beat renders continuously, so it
    // is no longer a signal that anything was disturbed.
    expect(after.current.beatId).toBe(before.current.beatId);
    expect(after.activeGeneration).toBe(before.activeGeneration);
    expect(after.current.disposeCount).toBe(0);
    expect(after.candidateGeneration).toBeNull();
    expect(after.canvasesInSlot).toBe(1);
    expect(after.slotChildren).toBe(1);
  });

  test('the same beat with the overlap removed activates', async () => {
    const before = await snapshot();
    const staged = await stage('fixed');
    expect(staged.result.ok).toBe(true);
    expect(staged.snapshot.candidateReady).toBe(true);

    const activated = await activate();
    expect(activated.result.ok).toBe(true);

    const after = await snapshot();
    expect(after.current.beatId).toBe('fixed');
    expect(after.current.visible).toBe(true);
    expect(after.current.ready).toBe(true);
    expect(after.activeGeneration).not.toBe(before.activeGeneration);
    // Exactly one more canvas than before: the new beat, plus the outgoing
    // one still awaiting retirement - never a leftover from the refused beat.
    expect(after.canvasesInSlot).toBe(before.canvasesInSlot + 1);
  });

  test('a repairable collision activates, and the repaired positions are what rendered', async () => {
    // The authored geometry genuinely overlaps...
    const evidence = await probe('repairable');
    expect(evidence.before.passed).toBe(false);
    expect(evidence.repair.attempted).toBe(true);
    expect(evidence.after.passed).toBe(true);

    const authored = evidence.beforePositions as {id: string; x: number}[];
    const repaired = evidence.afterPositions as {id: string; x: number}[];
    const authoredLeft = authored.find(p => p.id === 'left')!.x;
    const authoredRight = authored.find(p => p.id === 'right')!.x;
    const repairedLeft = repaired.find(p => p.id === 'left')!.x;
    const repairedRight = repaired.find(p => p.id === 'right')!.x;
    // Repair really moved them, and pushed them apart rather than together.
    expect(repairedLeft).not.toBeCloseTo(authoredLeft, 1);
    expect(repairedRight).not.toBeCloseTo(authoredRight, 1);
    expect(repairedRight - repairedLeft).toBeGreaterThan(
      authoredRight - authoredLeft,
    );

    const staged = await stage('repairable');
    expect(staged.result.ok).toBe(true);
    expect((await activate()).result.ok).toBe(true);

    const after = await snapshot();
    expect(after.current.beatId).toBe('repairable');

    // ...and the live view now holds the REPAIRED coordinates, not the
    // authored ones - the claim is about what is actually on screen.
    const live = (await currentBeatPositions()) as {id: string; x: number}[];
    const liveLeft = live.find(p => p.id === 'left')!.x;
    const liveRight = live.find(p => p.id === 'right')!.x;
    expect(liveLeft).toBeCloseTo(repairedLeft, 3);
    expect(liveRight).toBeCloseTo(repairedRight, 3);
    expect(liveLeft).not.toBeCloseTo(authoredLeft, 1);
    expect(liveRight).not.toBeCloseTo(authoredRight, 1);

    // The strongest form of the claim: running the real audit over the
    // visible beat right now passes. This is the assertion that catches the
    // engine re-executing the scene generator after `prepare` and silently
    // discarding the repair.
    const liveAudit = await auditCurrent();
    expect(liveAudit.passed).toBe(true);
    expect(liveAudit.findings).toEqual([]);
  });

  test('an unrepairable beat exhausts its retry budget without leaking broken state', async () => {
    const before = await snapshot();

    const results: any[] = [];
    for (let attempt = 0; attempt < 6; attempt++) {
      const staged = await stage('coverage-gap');
      results.push(staged.result);
      if (staged.result.reason === 'attempts-exhausted') break;
    }

    const exhausted = results[results.length - 1];
    expect(exhausted.ok).toBe(false);
    expect(exhausted.reason).toBe('attempts-exhausted');
    expect(exhausted.attempts).toBe(3);
    expect(await attemptsFor('coverage-gap')).toBe(3);

    // The learner is still looking at the last good beat, undisturbed, and
    // not one extra canvas leaked into the slot across all the refusals.
    const after = await snapshot();
    expect(after.current.beatId).toBe(before.current.beatId);
    expect(after.current.visible).toBe(true);
    expect(after.activeGeneration).toBe(before.activeGeneration);
    expect(after.candidateGeneration).toBeNull();
    expect(after.canvasesInSlot).toBe(before.canvasesInSlot);

    // And the gate really did report why, rather than failing silently.
    const all = await reports();
    const coverage = Object.values(all).find((report: any) =>
      report.findings.some((finding: any) => finding.ruleId === 'coverage'),
    );
    expect(coverage).toBeDefined();
  });

  test('an advisory review cannot block a beat the geometry gate accepted', async () => {
    const before = await snapshot();
    const staged = await stage('advisory');
    expect(staged.result.ok).toBe(true);
    expect((await activate()).result.ok).toBe(true);

    const after = await snapshot();
    expect(after.current.beatId).toBe('advisory');
    expect(after.current.visible).toBe(true);

    // The check is fired, never awaited, so its finding lands after the beat
    // is already on screen. Poll for it rather than assuming a timing.
    await app.page.waitForFunction(
      () => {
        const report = (window as any).ovcLesson.lastReport();
        return report?.findings?.some(
          (finding: any) => finding.ruleId === 'vision-layout',
        );
      },
      undefined,
      {timeout: 15000, polling: 100},
    );

    const report = (await reports()) as Record<
      number,
      {passed: boolean; findings: Array<{ruleId: string; severity: string}>}
    >;
    const latest = Object.values(report).at(-1)!;
    const review = latest.findings.find(
      finding => finding.ruleId === 'vision-layout',
    );

    expect(review).toBeDefined();
    // It claimed to be blocking. The host does not believe it - a review that
    // could retroactively fail an accepted beat would make the geometry gate
    // advisory too.
    expect(review!.severity).toBe('advisory');
    expect(latest.passed).toBe(true);
    // ...and the beat that was already accepted is still the one on screen.
    expect((await snapshot()).current.beatId).toBe('advisory');
    expect(before.current.beatId).not.toBe('advisory');
  });

  test('an activated beat actually plays, rather than freezing on one frame', async () => {
    const staged = await stage('fixed');
    expect(staged.result.ok).toBe(true);
    expect((await activate()).result.ok).toBe(true);

    const playbackState = () =>
      app.page.evaluate(() => (window as any).ovcLesson.playbackState());

    const before = await playbackState();
    expect(before.isPlaying).toBe(true);
    // Give the loop time to advance. The scene is ~1s long at 30fps, so this
    // is several frames even on a loaded machine.
    await new Promise(resolve => setTimeout(resolve, 700));
    const after = await playbackState();

    // The claim the whole animation layer rests on: the playhead moves and
    // frames keep rendering. Before the playback driver existed both of these
    // were frozen forever, and every authored entrance and morph was inert.
    expect(after.renderCount).toBeGreaterThan(before.renderCount);
    expect(after.frame).not.toBe(before.frame);

    // Freezing puts it back on the resting frame the gate judged, which is
    // also what makes any later capture deterministic.
    const frozen = await app.page.evaluate(() =>
      (window as any).ovcLesson.freezeAtRest(),
    );
    expect(frozen.isPlaying).toBe(false);
  });

  test('the host-authored fallback beat stages, passes the audit, and is visible', async () => {
    const staged = await app.page.evaluate(() =>
      (window as any).ovcLesson.stageFallback(
        'Why does a derivative measure a rate?',
      ),
    );

    // No model involved, so this must hold unconditionally - it is the beat
    // that exists precisely because nothing else can be relied on.
    expect(staged.result.ok).toBe(true);
    expect((await activate()).result.ok).toBe(true);

    const after = await snapshot();
    expect(after.current.beatId).toBe('fallback');
    expect(after.current.visible).toBe(true);

    const live = await auditCurrent();
    expect(live.passed).toBe(true);
    expect(live.findings).toEqual([]);

    // And it really draws: a fallback that rendered nothing would be a worse
    // experience than no fallback at all.
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
  });

  test('no page errors were raised across the whole suite', () => {
    expect(app.pageErrors).toEqual([]);
  });

  test('nothing was logged to the console, which is where swallowed errors go', () => {
    // A `@computed` that throws is caught by the framework and logged, and
    // `useLogger()` falls back to `console` when no scene is on the stack.
    // That is the only channel this class of failure reports to, so this
    // assertion is the guard against it - see `consoleErrors.ts`.
    expect(unexpectedConsoleErrors(app.consoleErrors)).toEqual([]);
  });
});
