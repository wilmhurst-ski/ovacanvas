import * as fs from 'fs';
import * as path from 'path';
import {fileURLToPath} from 'url';
import {afterAll, beforeAll, describe, expect, test} from 'vitest';
import {FoundationApp, startFoundation} from './foundationApp';

const ScenePath = path.resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '../foundation/scenes/foundation.tsx',
);

/**
 * Promoted from the OVC-A003 real-Vite HMR probe. Edits a scene on disk and
 * asserts that hot module replacement reconstructs presentation while the
 * runtime keeps its authority, and that the single module-lifetime asset
 * listener is left with no stale subscribers.
 */
describe('Foundation HMR', () => {
  let app: FoundationApp;
  const original = fs.readFileSync(ScenePath, 'utf-8');

  const snapshot = () =>
    app.page.evaluate(() => (window as any).__OVC_FOUNDATION__.snapshot());

  beforeAll(async () => {
    app = await startFoundation();
    await app.page.waitForFunction(
      () => !!(window as any).__OVC_FOUNDATION__,
      undefined,
      {timeout: 60000, polling: 100},
    );
    await app.page.evaluate(() =>
      (window as any).__OVC_FOUNDATION__.waitReady(),
    );
  }, 240000);

  afterAll(async () => {
    fs.writeFileSync(ScenePath, original, 'utf-8');
    await app?.stop();
  });

  test('a real edit reconstructs presentation without losing authority', async () => {
    const before = await snapshot();
    expect(before.a.hmrReloads).toBe(0);

    // Write a genuinely different scene and let Vite push the update.
    fs.writeFileSync(
      ScenePath,
      original.replace("fill={'#e13238'}", "fill={'#2e8b57'}"),
      'utf-8',
    );

    await app.page.waitForFunction(
      () => (window as any).__OVC_FOUNDATION__.snapshot().a.hmrReloads > 0,
      undefined,
      {timeout: 60000, polling: 100},
    );
    // Let the woken frame settle.
    await app.page.waitForFunction(
      () => (window as any).__OVC_FOUNDATION__.snapshot().a.mode === 'idle',
      undefined,
      {timeout: 30000, polling: 100},
    );

    const after = await snapshot();

    // Authority survived the reconstruction.
    expect(after.a.width).toBe(before.a.width);
    expect(after.a.revision).toBe(before.a.revision);

    // Presentation was reconstructed and the semantic ID rebound.
    expect(after.a.generation).toBeGreaterThan(before.a.generation);
    expect(after.a.nodeKey).not.toBeNull();

    // The scene actually changed on screen.
    expect(after.a.canvasHash).not.toBe(before.a.canvasHash);

    // The runtime went back to sleep afterwards.
    expect(after.a.mode).toBe('idle');
    expect(app.pageErrors).toEqual([]);
  }, 240000);

  test('runtime asset subscriptions are symmetrical', async () => {
    const baseline: number = await app.page.evaluate(() =>
      (window as any).__OVC_FOUNDATION__.assetBaseline(),
    );
    const before = await snapshot();

    // Every live runtime adds subscribers to the one module-lifetime
    // listener: an audio manager, an audio resource manager and a scene.
    expect(before.assetSubscribers).toBeGreaterThan(baseline);

    const afterDispose: number = await app.page.evaluate(() =>
      (window as any).__OVC_FOUNDATION__.disposeAll(),
    );

    // Teardown is symmetrical: back to exactly the module-lifetime
    // subscribers that existed before any runtime was created.
    expect(afterDispose).toBe(baseline);
  }, 120000);
});
