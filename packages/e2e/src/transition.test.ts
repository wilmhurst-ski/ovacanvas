import {afterAll, beforeAll, describe, expect, test} from 'vitest';
import type {FoundationApp} from './foundationApp';
import {startFoundation} from './foundationApp';

/**
 * Product transition regressions against real presentations.
 *
 * @remarks
 * Each presentation is its own Stage, Player and scene bound to a generation
 * of one shared authority. The crossfade is a probe for overlap, not the
 * transition language.
 */
describe('product transition system', () => {
  let app: FoundationApp;

  const snapshot = (id: string): Promise<any> =>
    app.page.evaluate(r => (window as any).ovcTransition.snapshot(r), id);
  const stage = (id: string, options: any = {}): Promise<any> =>
    app.page.evaluate(
      a => (window as any).ovcTransition.stage(a.id, a.options),
      {id, options},
    );
  const activate = (id: string): Promise<any> =>
    app.page.evaluate(r => (window as any).ovcTransition.activate(r), id);
  const retireOutgoing = (id: string): Promise<boolean> =>
    app.page.evaluate(r => (window as any).ovcTransition.retireOutgoing(r), id);
  const advanceOverlap = (id: string, steps: number): Promise<number> =>
    app.page.evaluate(
      a => (window as any).ovcTransition.advanceOverlap(a.id, a.steps),
      {id, steps},
    );
  const writeAccepted = (id: string, rate: number): Promise<number | null> =>
    app.page.evaluate(
      a => (window as any).ovcTransition.writeAccepted(a.id, a.rate),
      {id, rate},
    );
  const nodeIdentity = (
    id: string,
    which: 'current' | 'outgoing',
    target: string,
  ): Promise<number | null> =>
    app.page.evaluate(
      a => (window as any).ovcTransition.nodeIdentity(a.id, a.which, a.target),
      {id, which, target},
    );
  const idleWindow = (ms: number): Promise<any> =>
    app.page.evaluate(v => (window as any).ovcTransition.idleWindow(v), ms);
  const quiesce = () =>
    app.page.evaluate(() => (window as any).ovcTransition.quiesce());

  /** Stage, activate, run the crossfade, retire. */
  async function fullTransition(id: string, steps = 4) {
    expect((await stage(id)).ok).toBe(true);
    const result = await activate(id);
    expect(result.ok).toBe(true);
    await advanceOverlap(id, steps);
    await retireOutgoing(id);
    return result;
  }

  beforeAll(async () => {
    app = await startFoundation('/transition.html');
    await app.page.waitForFunction(
      () => (window as any).ovcTransition !== undefined,
      undefined,
      {polling: 100},
    );
    await app.page.evaluate(() => (window as any).ovcTransition.ready());
  }, 120000);

  afterAll(async () => {
    await app?.stop();
  });

  // --- A / B. CURRENT SURVIVES PREPARATION; CANDIDATE IS INVISIBLE ---

  test('the current presentation stays live and visible while a candidate prepares', async () => {
    const before = await snapshot('a');
    expect(before.phase).toBe('active');
    expect(before.current.visible).toBe(true);

    expect((await stage('a')).ok).toBe(true);
    const during = await snapshot('a');

    // A is untouched: same generation, still visible, still writable.
    expect(during.current.generation).toBe(before.current.generation);
    expect(during.current.visible).toBe(true);
    expect(during.current.opacity).toBe(1);
    expect(during.current.writable).toBe(true);
    expect(during.phase).toBe('ready');

    // A still renders and still accepts a write.
    expect(await writeAccepted('a', 1.25)).toBe(before.revision + 1);
    expect((await snapshot('a')).acceptedRate).toBe(1.25);
  });

  test('a candidate is built offstage and cannot write before activation', async () => {
    const during = await snapshot('a');

    expect(during.candidate).not.toBeNull();
    expect(during.candidate.generation).not.toBe(during.current.generation);
    // Built, rendered, and not in the document.
    expect(during.candidate.renderCount).toBeGreaterThan(0);
    expect(during.candidate.visible).toBe(false);
    expect(during.canvasesInSlot).toBe(1);
    // Being under construction grants no write authority.
    expect(during.candidate.writable).toBe(false);
    expect(
      await app.page.evaluate(
        r => (window as any).ovcTransition.candidateCanWrite(r),
        'a',
      ),
    ).toBe(false);
    expect((await snapshot('a')).revision).toBe(during.revision);

    // Clean up this candidate; it was prepared against an older revision now.
    await app.page.evaluate(
      r => (window as any).ovcTransition.cancelCandidate(r),
      'a',
    );
  });

  // --- C / G / M / N. ACTIVATION AND OVERLAP ---

  test('a ready candidate becomes current and the previous one becomes outgoing', async () => {
    const before = await snapshot('a');
    expect((await stage('a')).ok).toBe(true);
    const candidateGeneration = (await snapshot('a')).candidate.generation;

    const result = await activate('a');

    expect(result.ok).toBe(true);
    expect(result.activated).toBe(candidateGeneration);
    expect(result.retired).toBe(before.current.generation);

    const after = await snapshot('a');
    expect(after.phase).toBe('overlapping');
    expect(after.current.generation).toBe(candidateGeneration);
    expect(after.outgoing.generation).toBe(before.current.generation);
    // Both are in the document: a real overlap, not a swap.
    expect(after.canvasesInSlot).toBe(2);
    expect(after.current.visible).toBe(true);
    expect(after.outgoing.visible).toBe(true);
    // Incoming is writable; outgoing is presentation-only.
    expect(after.current.writable).toBe(true);
    expect(after.outgoing.writable).toBe(false);
  });

  test('the same semantic identity rebinds to a different node instance', async () => {
    const outgoingNode = await nodeIdentity('a', 'outgoing', 'rate');
    const incomingNode = await nodeIdentity('a', 'current', 'rate');
    const after = await snapshot('a');

    expect(outgoingNode).not.toBeNull();
    expect(incomingNode).not.toBeNull();
    // Same semantic id, different node object.
    expect(incomingNode).not.toBe(outgoingNode);
    expect(after.current.targets).toEqual(['offset', 'rate', 'readout']);
  });

  test('a stale outgoing write cannot reach the incoming generation', async () => {
    const before = await snapshot('a');

    const wrote = await app.page.evaluate(
      r => (window as any).ovcTransition.outgoingCanWrite(r),
      'a',
    );

    expect(wrote).toBe(false);
    const after = await snapshot('a');
    expect(after.revision).toBe(before.revision);
    expect(after.acceptedRate).toBe(before.acceptedRate);
    expect(after.current.writable).toBe(true);
  });

  // --- O. REAL VISUAL OVERLAP ---

  test('the crossfade really overlaps both presentations', async () => {
    const start = await snapshot('a');
    expect(start.current.opacity).toBe(0);
    expect(start.outgoing.opacity).toBe(1);

    await advanceOverlap('a', 1);
    const mid = await snapshot('a');

    // Both on screen at once, moving in opposite directions.
    expect(mid.canvasesInSlot).toBe(2);
    expect(mid.current.opacity).toBeGreaterThan(0);
    expect(mid.current.opacity).toBeLessThan(1);
    expect(mid.outgoing.opacity).toBeGreaterThan(0);
    expect(mid.outgoing.opacity).toBeLessThan(1);
    expect(mid.current.opacity + mid.outgoing.opacity).toBeCloseTo(1, 6);
    // The incoming presentation drew real frames during the fade.
    expect(mid.current.renderCount).toBeGreaterThan(start.current.renderCount);

    const progress = await advanceOverlap('a', 3);
    expect(progress).toBe(1);
    const end = await snapshot('a');
    expect(end.current.opacity).toBe(1);
    expect(end.outgoing.opacity).toBe(0);
  });

  // --- P / Q. RETIREMENT ---

  test('retiring the outgoing presentation leaves the incoming one intact', async () => {
    const before = await snapshot('a');
    expect(before.outgoing).not.toBeNull();

    expect(await retireOutgoing('a')).toBe(true);

    const after = await snapshot('a');
    expect(after.phase).toBe('active');
    expect(after.outgoing).toBeNull();
    expect(after.canvasesInSlot).toBe(1);
    // The incoming presentation is unharmed and still authoritative.
    expect(after.current.generation).toBe(before.current.generation);
    expect(after.current.writable).toBe(true);
    expect(after.current.visible).toBe(true);
    expect(await writeAccepted('a', 1.5)).toBe(before.revision + 1);

    // Idempotent.
    expect(await retireOutgoing('a')).toBe(false);
    expect((await snapshot('a')).canvasesInSlot).toBe(1);
  });

  // --- D. PREPARATION FAILURE ---

  test('a failing candidate leaves the current presentation intact', async () => {
    const before = await snapshot('a');

    const refused = await stage('a', {failPrepare: true});

    expect(refused.ok).toBe(false);
    expect(refused.reason).toBe('preparation-failed');
    expect(refused.detail).toContain('probe-candidate-failure');

    const after = await snapshot('a');
    // No blank presentation, no reconstruction, no lost authority.
    expect(after.current.generation).toBe(before.current.generation);
    expect(after.current.visible).toBe(true);
    expect(after.current.opacity).toBe(1);
    expect(after.current.writable).toBe(true);
    expect(after.canvasesInSlot).toBe(1);
    expect(after.revision).toBe(before.revision);
    expect(after.acceptedRate).toBe(before.acceptedRate);
    expect(after.phase).toBe('active');
    expect(after.candidate).toBeNull();
    // The partly built candidate was released, not leaked.
    expect(after.partialReleases).toBeGreaterThan(before.partialReleases);
    expect(after.trackedGenerations).toBe(before.trackedGenerations);

    // A still works, and a later candidate still succeeds.
    expect(await writeAccepted('a', 1.75)).toBe(before.revision + 1);
    expect((await stage('a')).ok).toBe(true);
    await app.page.evaluate(
      r => (window as any).ovcTransition.cancelCandidate(r),
      'a',
    );
  });

  test('a candidate that never declares readiness cannot activate', async () => {
    const before = await snapshot('a');

    const refused = await stage('a', {skipReady: true});

    expect(refused.ok).toBe(false);
    expect(refused.reason).toBe('not-ready');
    const after = await snapshot('a');
    expect(after.candidate).toBeNull();
    expect(after.current.generation).toBe(before.current.generation);
    expect((await activate('a')).reason).toBe('no-candidate');
  });

  // --- E. STALE CANDIDATE ---

  test('a candidate prepared against an older revision refuses to activate', async () => {
    const before = await snapshot('a');
    expect((await stage('a')).ok).toBe(true);
    const candidateGeneration = (await snapshot('a')).candidate.generation;

    // Accepted runtime state moves on after the candidate was prepared.
    const revision = await writeAccepted('a', 2.25);

    const refused = await activate('a');

    expect(refused.ok).toBe(false);
    expect(refused.reason).toBe('stale-revision');
    expect(refused.preparedAtRevision).toBe(before.revision);
    expect(refused.currentRevision).toBe(revision);

    const after = await snapshot('a');
    // A is untouched and still current; the stale candidate is gone.
    expect(after.current.generation).toBe(before.current.generation);
    expect(after.current.visible).toBe(true);
    expect(after.current.writable).toBe(true);
    expect(after.candidate).toBeNull();
    expect(after.outgoing).toBeNull();
    expect(after.canvasesInSlot).toBe(1);
    expect(after.acceptedRate).toBe(2.25);
    // The refused generation never became active.
    expect(after.activeGeneration).not.toBe(candidateGeneration);

    // A fresh candidate against the new revision activates normally.
    await fullTransition('a');
    expect((await snapshot('a')).phase).toBe('active');
  });

  // --- J / K. INTERACTION QUIESCENCE ---

  test('an active exploration is resolved through the seam and not committed', async () => {
    const before = await snapshot('a');
    const opened = await app.page.evaluate(
      r => (window as any).ovcTransition.beginExploration(r),
      'a',
    );
    expect(opened.ok).toBe(true);
    expect((await snapshot('a')).current.hasActiveExploration).toBe(true);

    expect((await stage('a')).ok).toBe(true);
    const result = await activate('a');

    expect(result.ok).toBe(true);
    expect(result.resolvedInteractions).toBe(1);
    const after = await snapshot('a');
    // A transition is not consent: nothing held was committed.
    expect(after.revision).toBe(before.revision);
    expect(after.acceptedRate).toBe(before.acceptedRate);
    expect(after.outgoing.writable).toBe(false);

    await advanceOverlap('a', 2);
    await retireOutgoing('a');
  });

  // --- R. SUPERSESSION AND CANCELLATION ---

  test('a second candidate is refused and the first is left alone', async () => {
    expect((await stage('a')).ok).toBe(true);
    const first = (await snapshot('a')).candidate.generation;

    const refused = await stage('a');

    expect(refused.ok).toBe(false);
    expect(refused.reason).toBe('candidate-in-progress');
    const after = await snapshot('a');
    expect(after.candidate.generation).toBe(first);
    expect(after.candidateReady).toBe(true);
  });

  test('a cancelled candidate never becomes visible', async () => {
    const before = await snapshot('a');
    expect(before.candidate).not.toBeNull();

    expect(
      await app.page.evaluate(
        r => (window as any).ovcTransition.cancelCandidate(r),
        'a',
      ),
    ).toBe(true);

    const after = await snapshot('a');
    expect(after.candidate).toBeNull();
    expect(after.canvasesInSlot).toBe(1);
    expect(after.current.generation).toBe(before.current.generation);
    expect(after.phase).toBe('active');
    expect((await activate('a')).reason).toBe('no-candidate');
  });

  test('cancelling a candidate mid-preparation leaks nothing', async () => {
    const before = await snapshot('a');

    await app.page.evaluate(
      r => (window as any).ovcTransition.stageDetached(r, {delayMs: 120}),
      'a',
    );
    expect(
      await app.page.evaluate(
        r => (window as any).ovcTransition.cancelCandidate(r),
        'a',
      ),
    ).toBe(true);
    const refused = await app.page.evaluate(
      r => (window as any).ovcTransition.awaitPending(r),
      'a',
    );

    expect(refused.ok).toBe(false);
    expect(refused.reason).toBe('cancelled');
    const after = await snapshot('a');
    expect(after.candidate).toBeNull();
    expect(after.canvasesInSlot).toBe(1);
    expect(after.current.generation).toBe(before.current.generation);
    expect(after.current.writable).toBe(true);
    expect(after.trackedGenerations).toBe(before.trackedGenerations);
  });

  // --- S. MULTI-RUNTIME ISOLATION ---

  test('a transition in one runtime never reaches the other', async () => {
    const beforeA = await snapshot('a');
    const beforeB = await snapshot('b');

    await fullTransition('a');
    await quiesce();

    const afterA = await snapshot('a');
    const afterB = await snapshot('b');

    expect(afterA.current.generation).not.toBe(beforeA.current.generation);

    // B kept its presentation, its authority and its render count.
    expect(afterB.current.generation).toBe(beforeB.current.generation);
    expect(afterB.revision).toBe(beforeB.revision);
    expect(afterB.acceptedRate).toBe(beforeB.acceptedRate);
    expect(afterB.current.writable).toBe(true);
    expect(afterB.current.renderCount).toBe(beforeB.current.renderCount);
    expect(afterB.phase).toBe('active');
    expect(afterB.outgoing).toBeNull();
  });

  // --- T / U. ZERO IDLE ---

  test('a detached ready candidate schedules nothing', async () => {
    await quiesce();
    expect((await stage('a')).ok).toBe(true);
    expect((await snapshot('a')).candidate.visible).toBe(false);
    await quiesce();

    const idle = await idleWindow(500);

    expect(idle.raf).toBe(0);
    expect(idle.a).toBe(0);
    expect(idle.b).toBe(0);
  });

  test('a completed transition returns to zero idle', async () => {
    const result = await activate('a');
    expect(result.ok).toBe(true);
    await advanceOverlap('a', 3);
    await retireOutgoing('a');
    await quiesce();

    const idle = await idleWindow(500);

    expect(idle.raf).toBe(0);
    expect(idle.a).toBe(0);
    expect(idle.b).toBe(0);
    expect((await snapshot('a')).phase).toBe('active');
  });

  test('a refused candidate leaves nothing scheduled', async () => {
    await stage('a', {failPrepare: true});
    expect((await stage('a')).ok).toBe(true);
    await writeAccepted('a', 3.5);
    expect((await activate('a')).reason).toBe('stale-revision');
    await quiesce();

    const idle = await idleWindow(500);

    expect(idle.raf).toBe(0);
    expect(idle.a).toBe(0);
    expect(idle.b).toBe(0);
  });

  test('records representative transition timings', async () => {
    const shot = await snapshot('a');
    // Representative observation only; there is no threshold to meet.
    console.info(`TRANSITION_TIMINGS ${JSON.stringify(shot.timings)}`);
    expect(shot.timings.prepareMs).toBeGreaterThan(0);
    expect(shot.timings.activateMs).toBeGreaterThanOrEqual(0);
  });

  test('no page errors were raised across the whole suite', () => {
    expect(app.pageErrors).toEqual([]);
  });
});
