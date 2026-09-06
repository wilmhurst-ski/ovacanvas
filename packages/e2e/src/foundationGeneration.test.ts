import {afterAll, beforeAll, describe, expect, test} from 'vitest';
import {FoundationApp, startFoundation} from './foundationApp';

/**
 * The five attack regressions demanded by the post-first-green architecture
 * attack. Each proves a property of the generation/activation foundation, not
 * a public API shape.
 */
describe('Generation safety', () => {
  let app: FoundationApp;
  let suite: any;

  beforeAll(async () => {
    app = await startFoundation('/foundationGeneration.html');
    await app.page.waitForFunction(
      () => !!(window as any).__OVC_GENERATION__,
      undefined,
      {timeout: 60000, polling: 100},
    );
    const outcome: any = await app.page.evaluate(() =>
      (window as any).__OVC_GENERATION__.start(),
    );
    if (outcome.failure) throw new Error(outcome.failure);
    suite = outcome.suite;
  }, 240000);

  afterAll(async () => {
    await app?.stop();
  });

  test('the page raised no errors', () => {
    expect(app.pageErrors).toEqual([]);
  });

  test('every generation-safety assertion passed', () => {
    const failed = Object.entries(suite.assertions as Record<string, boolean>)
      .filter(([, passed]) => !passed)
      .map(([name]) => name);
    expect(failed).toEqual([]);
  });

  test('1. a capability captured before replacement fails closed', () => {
    const attack = suite.staleMutation;
    expect(attack.committed).toBe(true);
    expect(attack.capabilityStillValid).toBe(false);
    expect(attack.rejected).toBe(true);
    expect(attack.rejectionMessage).toMatch(
      /Rejected a mutation from generation/,
    );
    expect(attack.revisionAfter).toBe(attack.revisionBefore);
    expect(attack.widthAfter).toBe(attack.widthBefore);
    expect(attack.canvasHashAfter).toBe(attack.canvasHashBefore);
  });

  test('2. failed preparation leaves the accepted presentation intact', () => {
    const attack = suite.failedPreparation;
    expect(attack.becameReady).toBe(false);
    expect(attack.stagedState).toBe('discarded');
    expect(attack.activeStillAccepted).toBe(true);
    expect(attack.acceptedGenerationUnchanged).toBe(true);
    expect(attack.bindingPreserved).toBe(true);
    expect(attack.authorityUnchanged).toBe(true);
    expect(attack.presentationUnchanged).toBe(true);
    expect(attack.activeRendersDuringFailure).toBe(0);
    expect(attack.returnedToIdle).toBe(true);
    expect(attack.idleRafDelta).toBe(0);
    expect(attack.subscribersReturned).toBe(true);
    expect(attack.contextsReturned).toBe(true);
    expect(attack.stillWritable).toBe(true);
  });

  test('3. activation is refused once the accepted revision moves on', () => {
    const attack = suite.staleActivation;
    expect(attack.prepared).toBe(true);
    expect(attack.revisionAtCommit).toBeGreaterThan(attack.preparedAtRevision);
    expect(attack.commitRejected).toBe(true);
    expect(attack.rejectionReason).toBe('stale-revision');
    expect(attack.stagedState).toBe('discarded');
    expect(attack.stagedDisposed).toBe(true);
    expect(attack.activeStillAccepted).toBe(true);
    expect(attack.activeBindingPreserved).toBe(true);
    expect(attack.activeMode).toBe('idle');
  });

  test('4. work becomes ready while invisible and costs no frames', () => {
    const attack = suite.readyBeforeVisible;
    expect(attack.prepared).toBe(true);
    expect(attack.connectedWhilePrepared).toBe(false);
    expect(attack.acceptedWhilePrepared).toBe(false);
    expect(attack.stateWhilePrepared).toBe('ready');
    expect(attack.idleRafDelta).toBe(0);
    expect(attack.idleRenderDelta).toBe(0);
    expect(attack.activatedAfterWaiting).toBe(true);
    expect(attack.connectedAfterCommit).toBe(true);
    expect(attack.acceptedAfterCommit).toBe(true);
  });

  test('5. a successful commit retires the old generation cleanly', () => {
    const attack = suite.successfulReplacement;
    expect(attack.committed).toBe(true);
    expect(attack.retiredGeneration).toBe(attack.oldGenerationBefore);
    expect(attack.oldCapabilityStale).toBe(true);
    expect(attack.oldPlayerDisposed).toBe(true);
    expect(attack.incomingAccepted).toBe(true);
    expect(attack.incomingBoundSemanticNode).toBe(true);
    expect(attack.incomingCanvasConnected).toBe(true);
    expect(attack.incomingWidthAfterWrite).toBe(321);
    expect(attack.incomingRendered).toBe(true);
    expect(attack.incomingReturnedToIdle).toBe(true);
    expect(attack.trackedGenerations).toBe(1);
  });
});
