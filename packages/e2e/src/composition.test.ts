import {afterAll, beforeAll, describe, expect, test} from 'vitest';
import type {FoundationApp} from './foundationApp';
import {startFoundation} from './foundationApp';

/**
 * Product interaction composed with product transitions, against real pointer
 * input and real presentations.
 *
 * @remarks
 * Nothing new coordinates these. Each presentation carries the accepted
 * production surfaces - CAP-01 pointer dispatch, the interaction controller,
 * a generation of one shared authority - and the transition owner decides
 * which presentation is current. CAP-05 supplies the derived value both the
 * accepted and the provisional presentations display.
 */
describe('interaction and transition composition', () => {
  let app: FoundationApp;

  const snapshot = (id: string): Promise<any> =>
    app.page.evaluate(r => (window as any).ovcComposition.snapshot(r), id);
  const stage = (id: string): Promise<any> =>
    app.page.evaluate(r => (window as any).ovcComposition.stage(r), id);
  const activate = (id: string): Promise<any> =>
    app.page.evaluate(r => (window as any).ovcComposition.activate(r), id);
  const retireOutgoing = (id: string): Promise<boolean> =>
    app.page.evaluate(
      r => (window as any).ovcComposition.retireOutgoing(r),
      id,
    );
  const advanceOverlap = (id: string, steps: number): Promise<number> =>
    app.page.evaluate(
      a => (window as any).ovcComposition.advanceOverlap(a.id, a.steps),
      {id, steps},
    );
  const commit = (id: string): Promise<any> =>
    app.page.evaluate(r => (window as any).ovcComposition.commit(r), id);
  const discard = (id: string): Promise<any> =>
    app.page.evaluate(r => (window as any).ovcComposition.discard(r), id);
  const inspect = (id: string, target: string): Promise<any> =>
    app.page.evaluate(
      a => (window as any).ovcComposition.inspect(a.id, a.target),
      {id, target},
    );
  const nodeIdentity = (
    id: string,
    which: 'current' | 'outgoing',
    target: string,
  ): Promise<number | null> =>
    app.page.evaluate(
      a => (window as any).ovcComposition.nodeIdentity(a.id, a.which, a.target),
      {id, which, target},
    );
  const writeFrom = (
    id: string,
    which: 'current' | 'outgoing',
    rate: number,
  ): Promise<number | false | null> =>
    app.page.evaluate(
      a => (window as any).ovcComposition.writeFrom(a.id, a.which, a.rate),
      {id, which, rate},
    );
  const idleWindow = (ms: number): Promise<any> =>
    app.page.evaluate(v => (window as any).ovcComposition.idleWindow(v), ms);
  const quiesce = () =>
    app.page.evaluate(() => (window as any).ovcComposition.quiesce());

  async function movePointerTo(id: string, x: number, y: number, steps = 1) {
    const point = await app.page.evaluate(
      a => (window as any).ovcComposition.clientPoint(a.id, a.x, a.y),
      {id, x, y},
    );
    await app.page.mouse.move(point.x, point.y, {steps});
  }

  /** Press the rate handle where it currently is, leaving the pointer down. */
  async function pressRateHandle(id: string) {
    const at = await app.page.evaluate(
      r => (window as any).ovcComposition.rateHandlePoint(r),
      id,
    );
    await movePointerTo(id, at.x, at.y);
    await app.page.mouse.down();
    return at;
  }

  /** A real drag that leaves the exploration open after release. */
  async function dragRate(id: string, deltaX: number) {
    const at = await pressRateHandle(id);
    await movePointerTo(id, at.x + deltaX, at.y, 8);
    await app.page.mouse.up();
    return at;
  }

  beforeAll(async () => {
    app = await startFoundation('/composition.html');
    await app.page.waitForFunction(
      () => (window as any).ovcComposition !== undefined,
      undefined,
      {polling: 100},
    );
    await app.page.evaluate(() => (window as any).ovcComposition.ready());
  }, 120000);

  afterAll(async () => {
    await app?.stop();
  });

  // --- SCENARIO A / B. EXPLORATION WHILE A CANDIDATE PREPARES ---

  test('a learner explores in A while a candidate prepares against R1', async () => {
    const before = await snapshot('a');
    expect(before.phase).toBe('active');
    expect(before.acceptedRate).toBe(1);

    // Stage B against R1 first; it must be invisible and non-writable.
    const stagedB = await stage('a');
    expect(stagedB.ok).toBe(true);
    expect(stagedB.preparedAtRevision).toBe(before.revision);

    const withCandidate = await snapshot('a');
    expect(withCandidate.candidate.visible).toBe(false);
    expect(withCandidate.candidate.writable).toBe(false);
    expect(withCandidate.canvasesInSlot).toBe(1);

    // A real pointer drag on the live presentation.
    await dragRate('a', 100);
    await app.page.evaluate(
      a => (window as any).ovcComposition.settled(a.id, a.before),
      {id: 'a', before: before.current.renderCount},
    );

    const held = await snapshot('a');
    // The exploration is visible in A and derived through CAP-05.
    expect(held.current.hasActiveExploration).toBe(true);
    expect(
      Math.abs(held.current.displayedRate - (before.acceptedRate + 1)),
    ).toBeLessThan(0.05);
    expect(
      Math.abs(held.current.sample - Math.exp(-held.current.displayedRate)),
    ).toBeLessThan(1e-6);
    expect(held.current.hash).not.toBe(before.current.hash);

    // Provisional only: accepted runtime state has not moved.
    expect(held.revision).toBe(before.revision);
    expect(held.acceptedRate).toBe(before.acceptedRate);
    expect(held.acceptedSample).toBe(before.acceptedSample);
    expect(held.acceptedToken).toBe(before.acceptedToken);

    // The candidate is still what it was, prepared against the same revision.
    expect(held.candidate.writable).toBe(false);
    expect(held.candidate.visible).toBe(false);
    expect(held.candidateReady).toBe(true);
  });

  // --- SCENARIO F. INSPECTION WHILE A CANDIDATE EXISTS ---

  test('read-only inspection does not disturb the candidate or the authority', async () => {
    const before = await snapshot('a');

    const result = await inspect('a', 'readout');

    expect(result.ok).toBe(true);
    expect(result.data.target).toBe('readout');
    const after = await snapshot('a');
    // No revision, no new session, candidate freshness untouched.
    expect(after.revision).toBe(before.revision);
    expect(after.candidate.writable).toBe(false);
    expect(after.candidateReady).toBe(true);
    expect(after.candidateGeneration).toBe(before.candidateGeneration);
    // The exploration already open is the same one; inspection opened nothing.
    expect(after.current.openExploration).toBe(before.current.openExploration);
  });

  // --- SCENARIO A (cont) / C. QUIESCENCE IS NON-CONSENT ---

  test('activation resolves the exploration without committing it', async () => {
    const before = await snapshot('a');
    expect(before.current.hasActiveExploration).toBe(true);
    const exploredRate = before.current.displayedRate;
    const candidateGeneration = before.candidateGeneration;

    const result = await activate('a');

    expect(result.ok).toBe(true);
    expect(result.resolvedInteractions).toBe(1);
    expect(result.activated).toBe(candidateGeneration);

    const after = await snapshot('a');
    // Non-consent: the held value was discarded, not promoted.
    expect(after.revision).toBe(before.revision);
    expect(after.acceptedRate).toBe(before.acceptedRate);
    expect(after.acceptedToken).toBe(before.acceptedToken);
    expect(after.outgoing.hasActiveExploration).toBe(false);

    // The discarded provisional value does not appear in the incoming
    // presentation, which shows accepted state.
    expect(after.current.generation).toBe(candidateGeneration);
    expect(after.current.displayedRate).toBe(after.acceptedRate);
    expect(after.current.displayedRate).not.toBe(exploredRate);
    expect(after.current.provisionalRate).toBeNull();
    expect(Math.abs(after.current.sample - after.acceptedSample)).toBeLessThan(
      1e-9,
    );
  });

  // --- SCENARIO G. HOLD / RELEASE BALANCE ---

  test('the presentation hold is balanced and is not inherited', async () => {
    const after = await snapshot('a');

    // The outgoing presentation held once and released once.
    expect(after.outgoing.holdCalls).toBe(1);
    expect(after.outgoing.releaseCalls).toBe(1);
    expect(after.outgoing.isPresentationHeld).toBe(false);
    // The incoming presentation inherited no hold at all.
    expect(after.current.holdCalls).toBe(0);
    expect(after.current.releaseCalls).toBe(0);
    expect(after.current.isPresentationHeld).toBe(false);
  });

  // --- SCENARIO B / H. STALE POINTER AND OUTGOING AUTHORITY ---

  test('a stale pointer continuation from the outgoing presentation cannot mutate', async () => {
    const before = await snapshot('a');
    expect(before.outgoing).not.toBeNull();

    const outgoingEventsBefore = before.outgoing.events.length;

    // A pointer that finds the still-visible outgoing canvas.
    await app.page.evaluate(
      a => (window as any).ovcComposition.raiseOutgoing(a.id, a.raised),
      {id: 'a', raised: true},
    );
    await dragRate('a', 60);
    await app.page.evaluate(
      a => (window as any).ovcComposition.raiseOutgoing(a.id, a.raised),
      {id: 'a', raised: false},
    );

    const after = await snapshot('a');
    // CAP-01 refused at the pointer layer: the retired generation cannot
    // even open a session, so no handler ran at all.
    expect(after.outgoing.events.length).toBe(outgoingEventsBefore);
    // Visible does not mean authoritative: no session, no write, no overlay.
    expect(after.outgoing.hasActiveExploration).toBe(false);
    expect(after.outgoing.openExploration).toBeNull();
    expect(after.outgoing.provisionalRate).toBeNull();
    expect(after.outgoing.writable).toBe(false);
    expect(after.revision).toBe(before.revision);
    expect(after.acceptedRate).toBe(before.acceptedRate);
    // The incoming generation is the writable one and is unharmed.
    expect(after.current.writable).toBe(true);
    expect(await writeFrom('a', 'outgoing', 9)).toBe(false);
    expect((await snapshot('a')).revision).toBe(before.revision);
  });

  // --- SCENARIO C. INTERACTION AFTER TRANSITION ---

  test('the same semantic identity continues on a different node in the incoming presentation', async () => {
    const outgoingNode = await nodeIdentity('a', 'outgoing', 'rate');
    const incomingNode = await nodeIdentity('a', 'current', 'rate');
    const after = await snapshot('a');

    expect(outgoingNode).not.toBeNull();
    expect(incomingNode).not.toBeNull();
    expect(incomingNode).not.toBe(outgoingNode);
    expect(after.current.targets).toEqual(['offset', 'rate', 'readout']);
    expect(after.outgoing.targets).toEqual(['offset', 'rate', 'readout']);
  });

  test('the outgoing presentation retires and the incoming one stays interactive', async () => {
    await advanceOverlap('a', 4);
    expect(await retireOutgoing('a')).toBe(true);

    const after = await snapshot('a');
    expect(after.phase).toBe('active');
    expect(after.outgoing).toBeNull();
    expect(after.canvasesInSlot).toBe(1);

    // A fresh real interaction on the incoming presentation works normally.
    await dragRate('a', 50);
    const explored = await snapshot('a');
    expect(explored.current.hasActiveExploration).toBe(true);
    expect(
      Math.abs(explored.current.displayedRate - (after.acceptedRate + 0.5)),
    ).toBeLessThan(0.05);
    expect(explored.revision).toBe(after.revision);

    expect((await discard('a')).ok).toBe(true);
    expect((await snapshot('a')).current.displayedRate).toBe(
      after.acceptedRate,
    );
  });

  // --- SCENARIO D. LEARNER COMMIT MAKES A PREPARED CANDIDATE STALE ---

  test('a learner commit advances the accepted revision and the CAP-05 model', async () => {
    const before = await snapshot('a');

    // Stage a candidate against R1 first, so the commit can make it stale.
    const stagedB = await stage('a');
    expect(stagedB.ok).toBe(true);
    expect(stagedB.preparedAtRevision).toBe(before.revision);

    // Then the learner explores and deliberately commits.
    await dragRate('a', 80);
    expect((await snapshot('a')).current.hasActiveExploration).toBe(true);
    const result = await commit('a');
    await quiesce();

    expect(result.ok).toBe(true);
    const after = await snapshot('a');
    expect(after.revision).toBe(before.revision + 1);
    expect(
      Math.abs(after.acceptedRate - (before.acceptedRate + 0.8)),
    ).toBeLessThan(0.05);
    // CAP-05 sees a new accepted model, and the sample follows it.
    expect(after.acceptedToken).not.toBe(before.acceptedToken);
    expect(
      Math.abs(after.acceptedSample - Math.exp(-after.acceptedRate)),
    ).toBeLessThan(1e-6);
    expect(after.current.provisionalRate).toBeNull();
    expect(after.current.displayedRate).toBe(after.acceptedRate);
  });

  test('the candidate prepared before the commit is refused as stale', async () => {
    const before = await snapshot('a');
    const candidateGeneration = before.candidateGeneration;
    expect(candidateGeneration).not.toBeNull();

    const refused = await activate('a');

    expect(refused.ok).toBe(false);
    expect(refused.reason).toBe('stale-revision');
    expect(refused.preparedAtRevision).toBe(before.revision - 1);
    expect(refused.currentRevision).toBe(before.revision);

    const after = await snapshot('a');
    // The stale candidate never became visible or current, and is gone.
    expect(after.candidate).toBeNull();
    expect(after.outgoing).toBeNull();
    expect(after.canvasesInSlot).toBe(1);
    expect(after.activeGeneration).not.toBe(candidateGeneration);
    // A survives at R2, and the committed learner value was not rolled back.
    expect(after.phase).toBe('active');
    expect(after.current.generation).toBe(before.current.generation);
    expect(after.current.visible).toBe(true);
    expect(after.current.writable).toBe(true);
    expect(after.revision).toBe(before.revision);
    expect(after.acceptedRate).toBe(before.acceptedRate);
  });

  // --- SCENARIO I. STALE REFUSAL LEAVES A INTERACTIVE ---

  test('refusing a stale candidate leaves the learner able to interact', async () => {
    const before = await snapshot('a');

    await dragRate('a', -40);
    const explored = await snapshot('a');
    expect(explored.current.hasActiveExploration).toBe(true);
    expect(explored.current.displayedRate).not.toBe(before.acceptedRate);
    expect(explored.revision).toBe(before.revision);

    expect((await discard('a')).ok).toBe(true);
    const after = await snapshot('a');
    expect(after.current.displayedRate).toBe(after.acceptedRate);
    expect(after.revision).toBe(before.revision);
  });

  // --- SCENARIO E. REPREPARE AGAINST THE NEW REVISION ---

  test('a candidate prepared after the commit reflects it and activates', async () => {
    const before = await snapshot('a');

    const stagedC = await stage('a');
    expect(stagedC.ok).toBe(true);
    expect(stagedC.preparedAtRevision).toBe(before.revision);

    // The new candidate read accepted R2 state through the normal path.
    const withCandidate = await snapshot('a');
    expect(withCandidate.candidate.displayedRate).toBe(before.acceptedRate);
    expect(
      Math.abs(withCandidate.candidate.sample - before.acceptedSample),
    ).toBeLessThan(1e-9);

    const result = await activate('a');
    expect(result.ok).toBe(true);
    expect(result.retired).toBe(before.current.generation);

    const after = await snapshot('a');
    expect(after.current.generation).toBe(withCandidate.candidateGeneration);
    expect(after.current.writable).toBe(true);
    expect(after.outgoing.writable).toBe(false);
    // The committed learner value is represented by the new presentation.
    expect(after.current.displayedRate).toBe(after.acceptedRate);
    expect(after.acceptedRate).toBe(before.acceptedRate);
    expect(after.revision).toBe(before.revision);

    await advanceOverlap('a', 4);
    expect(await retireOutgoing('a')).toBe(true);
    expect((await snapshot('a')).phase).toBe('active');
  });

  test('interaction still works on the presentation prepared after the commit', async () => {
    const before = await snapshot('a');

    await dragRate('a', 30);
    const explored = await snapshot('a');
    expect(explored.current.hasActiveExploration).toBe(true);

    const committed = await commit('a');
    await quiesce();

    expect(committed.ok).toBe(true);
    const after = await snapshot('a');
    expect(after.revision).toBe(before.revision + 1);
    expect(after.acceptedToken).not.toBe(before.acceptedToken);
    expect(after.current.displayedRate).toBe(after.acceptedRate);
  });

  // --- SCENARIO S. MULTI-RUNTIME ---

  test('the whole sequence in one runtime never reaches the other', async () => {
    const beforeB = await snapshot('b');

    expect((await stage('a')).ok).toBe(true);
    expect((await activate('a')).ok).toBe(true);
    await advanceOverlap('a', 4);
    await retireOutgoing('a');
    await dragRate('a', 20);
    await commit('a');
    await quiesce();

    const afterB = await snapshot('b');
    expect(afterB.revision).toBe(beforeB.revision);
    expect(afterB.acceptedRate).toBe(beforeB.acceptedRate);
    expect(afterB.acceptedToken).toBe(beforeB.acceptedToken);
    expect(afterB.activeGeneration).toBe(beforeB.activeGeneration);
    expect(afterB.phase).toBe('active');
    expect(afterB.current.renderCount).toBe(beforeB.current.renderCount);
    expect(afterB.current.hasActiveExploration).toBe(false);
  });

  // --- SCENARIO R. ZERO IDLE AFTER THE COMBINED SEQUENCE ---

  test('the combined sequence returns to zero idle', async () => {
    await app.page.evaluate(r => (window as any).ovcComposition.stop(r), 'a');
    await app.page.evaluate(r => (window as any).ovcComposition.stop(r), 'b');
    await quiesce();

    const idle = await idleWindow(500);

    expect(idle.raf).toBe(0);
    expect(idle.a).toBe(0);
    expect(idle.b).toBe(0);
    const after = await snapshot('a');
    expect(after.phase).toBe('active');
    expect(after.current.hasActiveExploration).toBe(false);
  });

  test('no page errors were raised across the whole suite', () => {
    expect(app.pageErrors).toEqual([]);
  });
});
