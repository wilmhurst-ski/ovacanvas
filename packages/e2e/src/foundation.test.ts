import {afterAll, beforeAll, describe, expect, test} from 'vitest';
import {FoundationApp, startFoundation} from './foundationApp';

/**
 * Promoted from the OVC-A003 static runtime probe. Proves the frozen
 * foundation invariants the fork must never regress: frame-0 reactive
 * binding, coalesced dirty wake, zero-RAF idle, authority survival across
 * seek, multi-runtime isolation and deterministic export.
 */
describe('Foundation runtime', () => {
  let app: FoundationApp;
  let assertions: Record<string, boolean>;
  let suite: any;

  beforeAll(async () => {
    app = await startFoundation();
    // Wait for the harness with timer polling, never rAF: Playwright's default
    // rAF polling would itself schedule animation frames and destroy the
    // zero-RAF measurement. The suite then runs inside a single evaluate, so
    // the driver is completely idle while scheduling is being measured.
    await app.page.waitForFunction(
      () => !!(window as any).__OVC_FOUNDATION__,
      undefined,
      {timeout: 60000, polling: 100},
    );
    const outcome: any = await app.page.evaluate(() =>
      (window as any).__OVC_FOUNDATION__.start(),
    );
    if (outcome.failure) throw new Error(outcome.failure);
    suite = outcome.suite;
    assertions = suite.assertions;
  }, 240000);

  afterAll(async () => {
    await app?.stop();
  });

  test('the page raised no errors', () => {
    expect(app.pageErrors).toEqual([]);
  });

  test('every foundation assertion passed', () => {
    const failed = Object.entries(assertions)
      .filter(([, passed]) => !passed)
      .map(([name]) => name);
    expect(failed).toEqual([]);
  });

  test('an idle runtime schedules nothing', () => {
    expect(suite.idle).toEqual({
      aRenderDelta: 0,
      bRenderDelta: 0,
      rafDelta: 0,
    });
  });

  test('synchronous writes coalesce into a single render', () => {
    expect(suite.dirty1.renders).toBe(1);
    expect(suite.dirty10.renders).toBe(1);
    expect(suite.dirty100.renders).toBe(1);
    expect(suite.dirty100.raf).toBe(1);
  });

  test('seeking does not rewind authoritative state', () => {
    for (const snapshot of suite.seek.snapshots) {
      expect(snapshot.width).toBe(suite.seek.semanticBeforeSeek.width);
      expect(snapshot.revision).toBe(suite.seek.semanticBeforeSeek.revision);
    }
  });

  test('export repeats bit-exactly over genuinely distinct frames', () => {
    expect(suite.export.passTwo).toEqual(suite.export.passOne);
    expect(new Set(suite.export.passOne).size).toBe(
      suite.export.passOne.length,
    );
  });

  test('disposal is terminal, idempotent and fails closed', () => {
    expect(suite.disposal.rendersAfterDispose).toBe(0);
    expect(suite.disposal.snapshot.playerDisposed).toBe(true);
    expect(suite.disposal.failClosed).toEqual({
      seek: true,
      reset: true,
      render: true,
      playback: true,
      wake: true,
    });
    expect(suite.disposal.postDisposeWriteRejected).toBe(true);
    expect(suite.disposal.snapshot.disposeCalls).toBe(101);
    expect(suite.disposal.snapshot.disposeExecutions).toBe(1);
  });

  test('every frozen wake source wakes the scheduler exactly once', () => {
    expect(suite.wakeSources.dirtyDependency).toEqual({raf: 1, renders: 1});
    expect(suite.wakeSources.explicitSeek).toEqual({raf: 1, renders: 1});
    expect(suite.wakeSources.explicitRender).toEqual({raf: 1, renders: 1});
    expect(suite.wakeSources.hostResize.renders).toBe(1);
    expect(suite.wakeSources.presentation.renders).toBeGreaterThan(1);
  });

  test('the scheduler is completely quiet between wake sources', () => {
    for (const name of [
      'dirtyDependency',
      'explicitSeek',
      'explicitRender',
      'hostResize',
      'presentation',
    ]) {
      expect(suite.wakeSources[`${name}Idle`]).toEqual({raf: 0, renders: 0});
    }
  });

  test('the audio clock stays aligned with the presentation clock', () => {
    expect(suite.audio.roundTripExact).toBe(true);
    expect(
      Math.abs(suite.audio.actualAudioTime - suite.audio.expectedAudioTime),
    ).toBeLessThan(1 / 30);
    expect(suite.audio.pausedWhileIdle).toBe(true);
    expect(suite.audio.sourceBeforeDispose).toBe(true);
    expect(suite.audioAfterDispose).toEqual({paused: true, released: true});
  });

  test('media elements are owned per node, never pooled globally', () => {
    expect(suite.media.bothReady).toBe(true);
    expect(suite.media.distinctElements).toBe(true);
    expect(suite.media.disposedReleased).toBe(true);
    expect(suite.media.peerRetained).toBe(true);
    expect(suite.mediaAfterBoth.peerReleased).toBe(true);
  });

  test('repeated create/use/dispose returns resources to baseline', () => {
    expect(suite.lifecycleCycles.allReady).toBe(true);
    expect(suite.lifecycleCycles.contextsWhileAlive).toBeGreaterThan(
      suite.lifecycleCycles.contextsBeforeCycles,
    );
    expect(suite.lifecycleCycles.contextsAfterDispose).toBe(
      suite.lifecycleCycles.contextsBeforeCycles,
    );
    expect(suite.lifecycleCycles.callbacksAfterDispose).toBe(0);
  });
});
