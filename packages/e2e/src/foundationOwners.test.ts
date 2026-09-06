import {afterAll, beforeAll, describe, expect, test} from 'vitest';
import {FoundationApp, startFoundation} from './foundationApp';

/**
 * Terminal-owner and async-race regressions for the owners the
 * post-first-green architecture attack proved were retained without a
 * terminal path: Presenter, Renderer, the replaced embedded Player, and
 * lifecycle-sensitive awaits inside Player.
 */
describe('Terminal owners', () => {
  let app: FoundationApp;
  let suite: any;

  beforeAll(async () => {
    app = await startFoundation('/foundationOwners.html');
    await app.page.waitForFunction(
      () => !!(window as any).__OVC_OWNERS__,
      undefined,
      {timeout: 60000, polling: 100},
    );
    const outcome: any = await app.page.evaluate(() =>
      (window as any).__OVC_OWNERS__.start(),
    );
    if (outcome.failure) throw new Error(outcome.failure);
    suite = outcome.suite;
  }, 240000);

  afterAll(async () => {
    await app?.stop();
  });

  test('every terminal-owner assertion passed', () => {
    const failed = Object.entries(suite.assertions as Record<string, boolean>)
      .filter(([, passed]) => !passed)
      .map(([name]) => name);
    expect(failed).toEqual([]);
  });

  test('Presenter aborts scheduling and disposes terminally', () => {
    expect(suite.presenter.ranFrames).toBe(true);
    expect(suite.presenter.rafDeltaAfterAbort).toBe(0);
    expect(suite.presenter.subscribersBeforeDispose).toBeGreaterThan(0);
    expect(suite.presenter.subscribersAfterDispose).toBe(0);
    expect(suite.presenter.slidesSubscribersAfterDispose).toBe(0);
    expect(suite.presenter.stateSubscribersAfterDispose).toBe(0);
    expect(suite.presenter.scenesDisposed).toBe(true);
    expect(suite.presenter.stageReleased).toBe(true);
    expect(suite.presenter.presentRejected).toBe(true);
  });

  test('Renderer disposes terminally and fails closed', () => {
    expect(suite.renderer.subscribersBeforeDispose).toBeGreaterThan(0);
    expect(suite.renderer.subscribersAfterDispose).toBe(0);
    expect(suite.renderer.stateSubscribersAfterDispose).toBe(0);
    expect(suite.renderer.finishedSubscribersAfterDispose).toBe(0);
    expect(suite.renderer.scenesDisposed).toBe(true);
    expect(suite.renderer.stageReleased).toBe(true);
    expect(suite.renderer.renderRejected).toBe(true);
  });

  test('replacing an embedded player terminally disposes the old one', () => {
    expect(suite.embedded.oldPlayerDisposed).toBe(true);
    expect(suite.embedded.oldPlayerRejected).toBe(true);
    expect(suite.embedded.oldSceneDisposed).toBe(true);
    expect(suite.embedded.replacementUsable).toBe(true);
    expect(suite.embedded.contextsWithFirst).toBeGreaterThan(
      suite.embedded.contextsBefore,
    );
    expect(suite.embedded.contextsReturned).toBe(true);
  });

  test('a stale async continuation cannot touch a disposed runtime', () => {
    expect(suite.race.disposed).toBe(true);
    expect(suite.race.configureResolvedWithoutThrowing).toBe(true);
    expect(suite.race.fpsUnchanged).toBe(true);
    expect(suite.race.idleRafDelta).toBe(0);
  });
});
