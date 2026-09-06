import {afterAll, beforeAll, describe, expect, test} from 'vitest';
import type {FoundationApp} from './foundationApp';
import {startFoundation} from './foundationApp';

/**
 * Product interaction regressions against real pointer input.
 *
 * @remarks
 * The rate handle sits at scene x = (rate - 1.5) * 100, so an accepted rate
 * of 1 puts it at -50. Dragging it right by 100 CSS pixels raises the held
 * rate by 1.
 */
describe('learner interaction system', () => {
  let app: FoundationApp;

  const snapshot = (id: string): Promise<any> =>
    app.page.evaluate(r => (window as any).ovcLearner.snapshot(r), id);
  const events = (id: string): Promise<any[]> =>
    app.page.evaluate(r => (window as any).ovcLearner.events(r), id);
  const clearEvents = (id: string) =>
    app.page.evaluate(r => (window as any).ovcLearner.clearEvents(r), id);
  const inspect = (id: string, target: string): Promise<any> =>
    app.page.evaluate(a => (window as any).ovcLearner.inspect(a.id, a.target), {
      id,
      target,
    });
  const commit = (id: string): Promise<any> =>
    app.page.evaluate(r => (window as any).ovcLearner.commit(r), id);
  const discard = (id: string): Promise<any> =>
    app.page.evaluate(r => (window as any).ovcLearner.discard(r), id);
  const setPolicy = (id: string, name: string): Promise<boolean> =>
    app.page.evaluate(a => (window as any).ovcLearner.setPolicy(a.id, a.name), {
      id,
      name,
    });
  const idleWindow = (ms: number): Promise<any> =>
    app.page.evaluate(v => (window as any).ovcLearner.idleWindow(v), ms);

  async function movePointerTo(id: string, x: number, y: number, steps = 1) {
    const point = await app.page.evaluate(
      a => (window as any).ovcLearner.clientPoint(a.id, a.x, a.y),
      {id, x, y},
    );
    await app.page.mouse.move(point.x, point.y, {steps});
  }

  /**
   * Press the rate handle where it currently is.
   *
   * @remarks
   * The handle moves with the value it shows, so the press point has to
   * be read rather than assumed.
   */
  async function pressRateHandle(id: string) {
    const at = await app.page.evaluate(
      r => (window as any).ovcLearner.rateHandlePoint(r),
      id,
    );
    await movePointerTo(id, at.x, at.y);
    await app.page.mouse.down();
    return at;
  }

  /** Press and drag the rate handle, leaving the exploration open. */
  async function dragRate(id: string, deltaX: number) {
    const at = await pressRateHandle(id);
    await movePointerTo(id, at.x + deltaX, at.y, 8);
    await app.page.mouse.up();
    return at;
  }

  async function tap(id: string, x: number, y: number) {
    await movePointerTo(id, x, y);
    await app.page.mouse.down();
    await app.page.mouse.up();
  }

  beforeAll(async () => {
    app = await startFoundation('/learner.html');
    await app.page.waitForFunction(
      () => (window as any).ovcLearner !== undefined,
      undefined,
      {polling: 100},
    );
    await app.page.evaluate(() => (window as any).ovcLearner.ready());
  }, 120000);

  afterAll(async () => {
    await app?.stop();
  });

  // --- A. INSPECTION IS READ-ONLY ---

  test('pressing an inspect-only target returns semantic data and writes nothing', async () => {
    const before = await snapshot('a');
    await clearEvents('a');

    await tap('a', -140, -160);

    const after = await snapshot('a');
    const log = await events('a');

    expect(log[0].kind).toBe('inspect');
    expect(log[0].ok).toBe(true);
    expect(log[0].target).toBe('readout');
    // Semantic identity, and plain data: no node reference came back.
    expect(after.lastInspection.target).toBe('readout');
    expect(after.lastInspection.label).toBe('accepted');
    expect(
      Object.values(after.lastInspection).every(
        v => typeof v !== 'object' || v === null,
      ),
    ).toBe(true);

    // No revision, no exploration, no hold.
    expect(after.revision).toBe(before.revision);
    expect(after.hasActiveExploration).toBe(false);
    expect(after.isPresentationHeld).toBe(false);
    expect(after.holdCalls).toBe(before.holdCalls);
    expect(after.canvasHash).toBe(before.canvasHash);
  });

  test('inspection through the controller is refused for an unknown target', async () => {
    const before = await snapshot('a');
    const result = await inspect('a', 'absent');

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('unknown-target');
    expect((await snapshot('a')).revision).toBe(before.revision);
  });

  // --- B. DISALLOWED INTERACTION ---

  test('a target the policy will not let a learner change refuses with no side effects', async () => {
    const before = await snapshot('a');
    await clearEvents('a');

    // Under the read-only policy nothing may be explored.
    await setPolicy('a', 'readOnly');
    await dragRate('a', 100);

    const after = await snapshot('a');
    const log = await events('a');

    // It resolved to an inspection, never an exploration.
    expect(log.some(e => e.kind === 'begin')).toBe(false);
    expect(log[0].kind).toBe('inspect');
    expect(after.hasActiveExploration).toBe(false);
    expect(after.revision).toBe(before.revision);
    expect(after.acceptedRate).toBe(before.acceptedRate);
    expect(after.displayedRate).toBe(before.acceptedRate);
    expect(after.isPresentationHeld).toBe(false);

    await setPolicy('a', 'default');
  });

  // --- C. TEMPORARY EXPLORATION CHANGES VISIBLE PRESENTATION ---

  test('exploring changes the visible derived response without accepting it', async () => {
    const before = await snapshot('a');
    expect(before.acceptedRate).toBe(1);
    await clearEvents('a');

    await dragRate('a', 100);
    await app.page.evaluate(
      a => (window as any).ovcLearner.settled(a.id, a.before),
      {id: 'a', before: before.renderCount},
    );

    const held = await snapshot('a');

    // The held value moved, and the CAP-05 sample followed it.
    expect(
      Math.abs(held.displayedRate - (before.acceptedRate + 1)),
    ).toBeLessThan(0.05);
    expect(Math.abs(held.sample - Math.exp(-held.displayedRate))).toBeLessThan(
      1e-6,
    );
    expect(held.sample).not.toBeCloseTo(before.acceptedSample, 6);
    expect(held.canvasHash).not.toBe(before.canvasHash);

    // Accepted runtime state is untouched: no revision, same accepted sample,
    // and the accepted CAP-05 model is still the one it was.
    expect(held.revision).toBe(before.revision);
    expect(held.acceptedRate).toBe(1);
    expect(held.acceptedSample).toBe(before.acceptedSample);
    expect(held.acceptedToken).toBe(before.acceptedToken);
    expect(held.hasActiveExploration).toBe(true);
  });

  // --- D. DISCARD ---

  test('discarding restores the accepted value and the accepted trajectory', async () => {
    const before = await snapshot('a');
    expect(before.hasActiveExploration).toBe(true);

    const result = await discard('a');
    await app.page.evaluate(
      a => (window as any).ovcLearner.settled(a.id, a.before),
      {id: 'a', before: before.renderCount},
    );

    const after = await snapshot('a');

    expect(result.ok).toBe(true);
    expect(after.displayedRate).toBe(1);
    expect(after.acceptedRate).toBe(1);
    expect(Math.abs(after.sample - Math.exp(-1))).toBeLessThan(1e-6);
    expect(after.sample).toBe(after.acceptedSample);
    expect(after.revision).toBe(before.revision);
    expect(after.hasActiveExploration).toBe(false);
    expect(after.isPresentationHeld).toBe(false);

    // A later continuation cannot bring the discarded value back.
    await movePointerTo('a', 190, 40, 4);
    await app.page.mouse.up();
    expect((await snapshot('a')).displayedRate).toBe(1);
  });

  // --- E / F. COMMIT THROUGH THE AUTHORIZED BOUNDARY ---

  test('committing promotes the held value into accepted runtime state', async () => {
    const before = await snapshot('a');
    await clearEvents('a');

    await dragRate('a', 50);
    const held = await snapshot('a');
    expect(held.hasActiveExploration).toBe(true);
    expect(
      Math.abs(held.displayedRate - (before.acceptedRate + 0.5)),
    ).toBeLessThan(0.05);
    expect(held.revision).toBe(before.revision);

    const result = await commit('a');
    await app.page.evaluate(
      a => (window as any).ovcLearner.settled(a.id, a.before),
      {id: 'a', before: held.renderCount},
    );
    const after = await snapshot('a');

    expect(result.ok).toBe(true);
    // The write went through the authority: the revision advanced by one.
    expect(after.revision).toBe(before.revision + 1);
    expect(
      Math.abs(after.acceptedRate - (before.acceptedRate + 0.5)),
    ).toBeLessThan(0.05);
    expect(after.displayedRate).toBe(after.acceptedRate);
    expect(after.hasActiveExploration).toBe(false);
    expect(after.isPresentationHeld).toBe(false);

    // CAP-05 sees a new model: a new revision namespace, an empty cache, and
    // a sample that matches the committed rate.
    expect(after.acceptedToken).not.toBe(before.acceptedToken);
    expect(after.acceptedModelRevision).toBe(before.acceptedModelRevision + 1);
    // The old revision cache was dropped at the commit; a later sample
    // repopulates it, so this is measured at the commit itself.
    expect(after.acceptedCheckpointsAtCommit).toBe(0);
    expect(
      Math.abs(after.acceptedSample - Math.exp(-after.acceptedRate)),
    ).toBeLessThan(1e-6);
    expect(after.acceptedSample).not.toBe(before.acceptedSample);
  });

  // --- G. COMMIT AFTER DISCARD FAILS CLOSED ---

  test('commit after discard is refused', async () => {
    const before = await snapshot('a');
    await dragRate('a', 30);
    const exploration = (await snapshot('a')).openExploration;
    expect(exploration).not.toBeNull();

    expect((await discard('a')).ok).toBe(true);

    const refused = await app.page.evaluate(
      a => (window as any).ovcLearner.commitById(a.id, a.exploration),
      {id: 'a', exploration},
    );

    expect(refused.ok).toBe(false);
    expect(refused.reason).toBe('exploration-already-resolved');
    expect((await snapshot('a')).revision).toBe(before.revision);
    expect((await snapshot('a')).acceptedRate).toBe(before.acceptedRate);
  });

  // --- I / J. POLICY CHANGE AND REVOCATION ---

  test('policy can change while the presentation exists', async () => {
    // Commit permission removed, exploring still allowed.
    await setPolicy('a', 'rateExploreOnly');
    const before = await snapshot('a');

    await dragRate('a', 40);
    const held = await snapshot('a');
    expect(held.hasActiveExploration).toBe(true);
    expect(held.displayedRate).not.toBe(before.acceptedRate);

    const refused = await commit('a');
    expect(refused.ok).toBe(false);
    expect(refused.reason).toBe('not-permitted');
    expect((await snapshot('a')).revision).toBe(before.revision);
    // The exploration survived the refused commit.
    expect((await snapshot('a')).hasActiveExploration).toBe(true);

    await discard('a');
    await setPolicy('a', 'default');
  });

  test('revoking mid-exploration drops the held value and blocks continuation', async () => {
    const before = await snapshot('a');

    const at = await pressRateHandle('a');
    await movePointerTo('a', at.x + 100, at.y, 6);

    const held = await snapshot('a');
    expect(held.hasActiveExploration).toBe(true);
    expect(held.displayedRate).not.toBe(before.acceptedRate);

    const revoked = await setPolicy('a', 'readOnly');
    expect(revoked).toBe(true);

    const afterRevoke = await snapshot('a');
    expect(afterRevoke.hasActiveExploration).toBe(false);
    expect(afterRevoke.displayedRate).toBe(afterRevoke.acceptedRate);
    expect(afterRevoke.revision).toBe(before.revision);

    // The first continuation after revocation changes nothing.
    await movePointerTo('a', at.x + 180, at.y, 6);
    await app.page.mouse.up();
    const afterContinuation = await snapshot('a');
    expect(afterContinuation.displayedRate).toBe(afterRevoke.acceptedRate);
    expect(afterContinuation.revision).toBe(before.revision);

    await setPolicy('a', 'default');
  });

  // --- N. INTERRUPT AND RESUME ---

  test('an exploration holds the presentation and it resumes where it was', async () => {
    await app.page.evaluate(
      r => (window as any).ovcLearner.stopPlayback(r),
      'a',
    );
    const startFrame = await app.page.evaluate(
      r => (window as any).ovcLearner.play(r),
      'a',
    );
    expect(startFrame).toBeGreaterThan(0);

    // The learner interrupts a running presentation.
    const at = await pressRateHandle('a');
    await movePointerTo('a', at.x + 60, at.y, 4);

    const held = await snapshot('a');
    expect(held.isPresentationHeld).toBe(true);
    expect(held.heldAtFrame).not.toBeNull();
    expect(held.mode).not.toBe('playing');

    // Presentation does not advance underneath the exploration.
    await idleWindow(300);
    const duringHold = await snapshot('a');
    expect(duringHold.frame).toBe(held.frame);
    expect(duringHold.hasActiveExploration).toBe(true);

    await app.page.mouse.up();
    await discard('a');

    const resumedFrame = await app.page.evaluate(
      r => (window as any).ovcLearner.resume(r),
      'a',
    );

    // Resumed from where it was held, not from zero.
    expect(resumedFrame).toBeGreaterThanOrEqual(held.frame);
    expect(resumedFrame).toBeGreaterThan(0);
    const after = await snapshot('a');
    expect(after.isPresentationHeld).toBe(false);
    expect(after.acceptedRate).toBe(held.acceptedRate);
    await app.page.evaluate(
      r => (window as any).ovcLearner.stopPlayback(r),
      'a',
    );
  });

  // --- K. RESET CANCELS ---

  test('rebuilding presentation resolves the exploration without committing it', async () => {
    const before = await snapshot('a');
    await dragRate('a', 60);
    expect((await snapshot('a')).hasActiveExploration).toBe(true);

    const after = await app.page.evaluate(
      r => (window as any).ovcLearner.resetScene(r),
      'a',
    );

    expect(after.reconstructions).toBeGreaterThan(before.reconstructions);
    expect(after.hasActiveExploration).toBe(false);
    expect(after.revision).toBe(before.revision);
    expect(after.acceptedRate).toBe(before.acceptedRate);
    expect(after.displayedRate).toBe(before.acceptedRate);
  });

  // --- O. MULTI-RUNTIME ISOLATION ---

  test('an exploration, commit or policy change in one runtime never reaches the other', async () => {
    const beforeA = await snapshot('a');
    const beforeB = await snapshot('b');

    await dragRate('a', 80);
    await commit('a');
    await setPolicy('a', 'readOnly');
    await app.page.evaluate(
      a => (window as any).ovcLearner.settled(a.id, a.before),
      {id: 'a', before: beforeA.renderCount},
    );

    const afterA = await snapshot('a');
    const afterB = await snapshot('b');

    expect(afterA.revision).toBe(beforeA.revision + 1);
    expect(afterA.acceptedRate).not.toBe(beforeA.acceptedRate);

    expect(afterB.revision).toBe(beforeB.revision);
    expect(afterB.acceptedRate).toBe(beforeB.acceptedRate);
    expect(afterB.acceptedToken).toBe(beforeB.acceptedToken);
    expect(afterB.hasActiveExploration).toBe(false);
    expect(afterB.renderCount).toBe(beforeB.renderCount);
    expect(await events('b')).toEqual([]);

    await setPolicy('a', 'default');
  });

  // --- P. ZERO IDLE ---

  test('the interaction layer adds no idle scheduling', async () => {
    // The claim is about the interaction layer, not about a presentation
    // the driver deliberately left playing.
    await app.page.evaluate(
      r => (window as any).ovcLearner.stopPlayback(r),
      'a',
    );
    await app.page.evaluate(
      r => (window as any).ovcLearner.stopPlayback(r),
      'b',
    );
    await app.page.evaluate(() => (window as any).ovcLearner.quiesce());

    const idle = await idleWindow(500);
    expect(idle.raf).toBe(0);
    expect(idle.a).toBe(0);
    expect(idle.b).toBe(0);

    // Quiet again after a completed interaction, including while an
    // exploration is open.
    await dragRate('a', 20);
    expect((await snapshot('a')).hasActiveExploration).toBe(true);
    await app.page.evaluate(() => (window as any).ovcLearner.quiesce());
    const duringExploration = await idleWindow(500);
    expect(duringExploration.raf).toBe(0);
    expect(duringExploration.a).toBe(0);

    await discard('a');
    await app.page.evaluate(() => (window as any).ovcLearner.quiesce());
    const afterDiscard = await idleWindow(500);
    expect(afterDiscard.raf).toBe(0);
    expect(afterDiscard.a).toBe(0);
    expect(afterDiscard.b).toBe(0);
  });

  // --- L. GENERATION RETIREMENT ---

  test('a retired generation blocks an exploration continuation', async () => {
    const before = await snapshot('b');

    const at = await pressRateHandle('b');
    await movePointerTo('b', at.x + 70, at.y, 4);
    const held = await snapshot('b');
    expect(held.hasActiveExploration).toBe(true);

    // Accept a successor generation; nothing tells the interaction layer.
    expect(
      await app.page.evaluate(r => (window as any).ovcLearner.retire(r), 'b'),
    ).toBe(true);

    await movePointerTo('b', at.x + 170, at.y, 4);
    await app.page.mouse.up();

    const after = await snapshot('b');
    expect(after.generationAccepted).toBe(false);
    expect(after.hasActiveExploration).toBe(false);
    expect(after.revision).toBe(before.revision);
    expect(after.acceptedRate).toBe(before.acceptedRate);

    const refused = await commit('b');
    expect(refused.ok).toBe(false);
  });

  // --- M. DISPOSAL ---

  test('disposal resolves an exploration without committing it', async () => {
    const before = await snapshot('a');
    await dragRate('a', 90);
    const held = await snapshot('a');
    expect(held.hasActiveExploration).toBe(true);
    expect(held.displayedRate).not.toBe(before.acceptedRate);

    await app.page.evaluate(
      r => (window as any).ovcLearner.disposeRuntime(r),
      'a',
    );

    const after = await snapshot('a');
    expect(after.controllerDisposed).toBe(true);
    expect(after.hasActiveExploration).toBe(false);
    // Disposal is not consent: the accepted value never took the held one.
    expect(after.revision).toBe(before.revision);
    expect(after.acceptedRate).toBe(before.acceptedRate);

    const refused = await commit('a');
    expect(refused.ok).toBe(false);
  });

  test('no page errors were raised across the whole suite', () => {
    expect(app.pageErrors).toEqual([]);
  });
});
