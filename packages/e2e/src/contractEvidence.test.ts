import {mkdirSync} from 'fs';
import {fileURLToPath} from 'url';
import {afterAll, beforeAll, describe, expect, test} from 'vitest';
import type {FoundationApp} from './foundationApp';
import {startFoundation} from './foundationApp';

const EvidencePath = fileURLToPath(
  new URL('../evidence/contract-composition.png', import.meta.url),
);

describe('OvaCanvas contract composition and verification evidence', () => {
  let app: FoundationApp;

  const snapshot = (id: 'a' | 'b'): Promise<any> =>
    app.page.evaluate(
      runtime => window.ovcContractEvidence.snapshot(runtime),
      id,
    );
  const stage = (id: 'a' | 'b', mode: string): Promise<any> =>
    app.page.evaluate(
      input => window.ovcContractEvidence.stage(input.id, input.mode as any),
      {id, mode},
    );
  const activate = (id: 'a' | 'b'): Promise<any> =>
    app.page.evaluate(
      runtime => window.ovcContractEvidence.activate(runtime),
      id,
    );
  const point = (
    id: 'a' | 'b',
    kind: 'anchor-only' | 'overlap',
  ): Promise<{x: number; y: number}> =>
    app.page.evaluate(
      input => window.ovcContractEvidence.clientPoint(input.id, input.kind)!,
      {id, kind},
    );

  beforeAll(async () => {
    app = await startFoundation('/contractEvidence.html');
    await app.page.waitForFunction(
      () => !!window.ovcContractEvidence,
      undefined,
      {timeout: 60000, polling: 100},
    );
    await app.page.evaluate(() => window.ovcContractEvidence.ready());
  }, 180000);

  afterAll(async () => {
    await app?.stop();
  });

  test('reproduces the shared-registry pointer-capture defect before correction', async () => {
    expect((await stage('a', 'shared-defect')).ok).toBe(true);
    expect((await activate('a')).ok).toBe(true);

    const overlap = await point('a', 'overlap');
    await app.page.mouse.move(overlap.x, overlap.y);
    await app.page.mouse.down();
    const during = await snapshot('a');

    expect(during.current.sharedRegistry).toBe(true);
    expect(during.current.capture.activeSessions).toBe(1);
    expect(during.current.capture.captured).toBe(true);
    expect(during.current.capture.target).toBe('relationship.destination');
    expect(during.current.capture.deniedPresses).toBe(1);
    expect(during.current.capture.interactivePresses).toBe(0);

    await app.page.mouse.up();
  });

  test('renders CAP-02 and CAP-03 together and evaluates actual offstage output', async () => {
    const staged = await stage('a', 'composed-pass');
    const beforeActivation = await snapshot('a');

    expect(staged.ok).toBe(true);
    expect(beforeActivation.phase).toBe('ready');
    expect(beforeActivation.current.mode).toBe('shared-defect');
    expect(beforeActivation.candidate.visible).toBe(false);
    expect(beforeActivation.candidate.renderCount).toBeGreaterThan(0);
    expect(beforeActivation.lastEvaluation.result).toBe('PASS');
    expect(beforeActivation.lastEvaluation.observations.semanticTarget).toBe(
      'relationship.destination',
    );
    expect(
      beforeActivation.lastEvaluation.observations.cap02Pixels,
    ).toBeGreaterThan(80);
    expect(
      beforeActivation.lastEvaluation.observations.cap03Pixels,
    ).toBeGreaterThan(80);

    expect((await activate('a')).ok).toBe(true);
    await app.page.evaluate(() =>
      window.ovcContractEvidence.retireOutgoing('a'),
    );
  });

  test('keeps verification-only addressability out of pointer dispatch', async () => {
    const semantic = await app.page.evaluate(() =>
      window.ovcContractEvidence.semanticProbe('a', 'anchor-only'),
    );
    expect(semantic).toBe('relationship.destination');

    const anchorOnly = await point('a', 'anchor-only');
    await app.page.mouse.move(anchorOnly.x, anchorOnly.y);
    await app.page.mouse.down();
    const during = await snapshot('a');
    expect(during.current.sharedRegistry).toBe(false);
    expect(during.current.semanticTargets).toEqual([
      'relationship.destination',
    ]);
    expect(during.current.interactionTargets).toEqual(['control.destination']);
    expect(during.current.capture.activeSessions).toBe(0);
    expect(during.current.capture.captured).toBe(false);
    expect(during.current.capture.interactivePresses).toBe(0);
    await app.page.mouse.up();
  });

  test('does not let the verification-only node block an interactive node behind it', async () => {
    const beforeA = await snapshot('a');
    const beforeB = await snapshot('b');
    const overlap = await point('a', 'overlap');
    await app.page.mouse.move(overlap.x, overlap.y);
    await app.page.mouse.down();
    const during = await snapshot('a');

    expect(during.current.capture.activeSessions).toBe(1);
    expect(during.current.capture.captured).toBe(true);
    expect(during.current.capture.target).toBe('control.destination');
    expect(during.current.capture.interactivePresses).toBe(1);
    expect(during.runtimeRevision).toBe(beforeA.runtimeRevision + 1);
    expect(during.current.generation).toBe(beforeA.current.generation);
    expect(during.certificationStale).toBe(true);

    await app.page.mouse.up();
    expect(
      await app.page.evaluate(
        (input: {id: 'a' | 'b'; renderCount: number}) =>
          window.ovcContractEvidence.settled(input.id, input.renderCount),
        {id: 'a' as const, renderCount: beforeA.current.renderCount},
      ),
    ).toBe(true);
    const afterB = await snapshot('b');
    expect(afterB.runtimeRevision).toBe(beforeB.runtimeRevision);
    expect(afterB.runtimeState).toEqual(beforeB.runtimeState);
  });

  test('re-evaluates the same live generation at the new runtime revision', async () => {
    const stale = await snapshot('a');
    const previous = stale.currentCertification;
    expect(stale.certificationStale).toBe(true);

    const next = await app.page.evaluate(() =>
      window.ovcContractEvidence.reevaluate('a'),
    );
    const current = await snapshot('a');
    expect(next.result).toBe('PASS');
    expect(next.generation).toBe(previous.generation);
    expect(next.runtimeRevision).toBe(previous.runtimeRevision + 1);
    expect(current.certificationStale).toBe(false);
    expect(current.currentCertification).toEqual(next);
  });

  test('a failed actual-output evaluation cannot become ready or activate', async () => {
    const before = await snapshot('a');
    const result = await stage('a', 'composed-fail');
    await new Promise(resolve => setTimeout(resolve, 0));
    const after = await snapshot('a');

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('not-ready');
    expect(after.phase).toBe('active');
    expect(after.current.generation).toBe(before.current.generation);
    expect(after.current.visible).toBe(true);
    expect(after.lastEvaluation.result).toBe('FAIL');
    expect(after.failedCandidateDisposals).toBe(1);
    expect((await activate('a')).reason).toBe('no-candidate');
  });

  test('semantic identity rebinds across a fresh presentation generation', async () => {
    const beforeGeneration = (await snapshot('a')).current.generation;
    const beforeNode = await app.page.evaluate(() =>
      window.ovcContractEvidence.nodeIdentity('a', 'relationship.destination'),
    );
    expect((await stage('a', 'composed-pass')).ok).toBe(true);
    expect((await activate('a')).ok).toBe(true);
    const after = await snapshot('a');
    const afterNode = await app.page.evaluate(() =>
      window.ovcContractEvidence.nodeIdentity('a', 'relationship.destination'),
    );

    expect(after.current.generation).not.toBe(beforeGeneration);
    expect(afterNode).not.toBe(beforeNode);
    expect(after.current.semanticTargets).toContain('relationship.destination');
    await app.page.evaluate(() =>
      window.ovcContractEvidence.retireOutgoing('a'),
    );
  });

  test('captures the composed presentation for human inspection', async () => {
    mkdirSync(fileURLToPath(new URL('../evidence', import.meta.url)), {
      recursive: true,
    });
    await app.page.locator('[data-runtime="a"]').screenshot({
      path: EvidencePath,
    });
  });

  test('the bounded fixture returns to zero idle and raises no page errors', async () => {
    const idle = await app.page.evaluate(() =>
      window.ovcContractEvidence.idleWindow(220),
    );
    expect(idle).toEqual({raf: 0, renders: 0});
    expect(app.pageErrors).toEqual([]);
    expect(app.consoleErrors).toEqual([]);
  });
});
