import {afterAll, beforeAll, describe, expect, test} from 'vitest';
import type {FoundationApp} from './foundationApp';
import {startFoundation} from './foundationApp';

/**
 * CAP-01 regressions against real pointer input.
 *
 * @remarks
 * Driven with Playwright's mouse rather than synthetic events on purpose:
 * pointer capture only exists for a pointer the browser considers active, so
 * a dispatched `PointerEvent` would silently skip the very mechanism the drag
 * regressions are about.
 */
describe('CAP-01 interactive spatial picking and pointer dispatch', () => {
  let app: FoundationApp;

  const snapshot = (id: string): Promise<any> =>
    app.page.evaluate(
      runtime => (window as any).ovcInteraction.snapshot(runtime),
      id,
    );
  const events = (id: string): Promise<any[]> =>
    app.page.evaluate(
      runtime => (window as any).ovcInteraction.events(runtime),
      id,
    );
  const clearEvents = (id: string) =>
    app.page.evaluate(
      runtime => (window as any).ovcInteraction.clearEvents(runtime),
      id,
    );
  const reset = (id: string): Promise<any> =>
    app.page.evaluate(
      runtime => (window as any).ovcInteraction.reset(runtime),
      id,
    );
  const settled = (id: string, before: number) =>
    app.page.evaluate(
      arg => (window as any).ovcInteraction.settled(arg.id, arg.before),
      {id, before},
    );
  const idleWindow = (ms: number): Promise<any> =>
    app.page.evaluate(
      value => (window as any).ovcInteraction.idleWindow(value),
      ms,
    );
  const exportPass = (id: string, frames: number[]): Promise<number[]> =>
    app.page.evaluate(
      arg => (window as any).ovcInteraction.exportPass(arg.id, arg.frames),
      {id, frames},
    );

  async function movePointerTo(id: string, x: number, y: number, steps = 1) {
    const point = await app.page.evaluate(
      arg => (window as any).ovcInteraction.clientPoint(arg.id, arg.x, arg.y),
      {id, x, y},
    );
    await app.page.mouse.move(point.x, point.y, {steps});
  }

  /** A press and release with no meaningful travel. */
  async function tap(id: string, x: number, y: number) {
    await movePointerTo(id, x, y);
    await app.page.mouse.down();
    await app.page.mouse.up();
    return events(id);
  }

  async function lastEvent(id: string) {
    const log = await events(id);
    return log[log.length - 1] ?? null;
  }

  beforeAll(async () => {
    app = await startFoundation('/interaction.html');
    // The driver is an ES module Vite transforms on demand, so it can still be
    // evaluating when navigation resolves. Poll on a timer rather than on
    // animation frames: the idle regression counts those.
    await app.page.waitForFunction(
      () => (window as any).ovcInteraction !== undefined,
      undefined,
      {polling: 100},
    );
    await app.page.evaluate(() => (window as any).ovcInteraction.ready());
  }, 120000);

  afterAll(async () => {
    await app?.stop();
  });

  // --- A. TOPMOST PICK ---

  test('the visually topmost eligible target wins an overlap', async () => {
    await reset('a');

    // Inside both boxes. Beta is painted last, so it is on top.
    let log = await tap('a', -10, -110);
    expect(log.at(-1).kind).toBe('release');
    expect(log[0].kind).toBe('press');
    expect(log[0].target).toBe('target.beta');

    await clearEvents('a');
    log = await tap('a', -45, -80);
    expect(log[0].target).toBe('target.alpha');

    await clearEvents('a');
    log = await tap('a', 60, -110);
    expect(log[0].target).toBe('target.beta');
  });

  test('a fully transparent target does not swallow the one beneath it', async () => {
    await reset('a');
    const log = await tap('a', -130, 20);

    // The ghost is painted last and contains the point, but the renderer
    // skips it, so picking must too.
    expect(log[0].target).toBe('target.under');
  });

  test('decoration that was never registered does not occlude', async () => {
    await reset('a');
    // A rect is painted directly over alpha here, and nothing bound it.
    const log = await tap('a', -80, -110);

    expect(log[0].target).toBe('target.alpha');
  });

  // --- B. TRANSFORMED PICK ---

  test('a target under nested rotation and scale resolves with local coordinates', async () => {
    await reset('a');
    // The world position of the point 15 right and 10 up of gamma's own
    // origin, pushed out through the group's 25 degree rotation and 1.3 scale.
    const log = await tap('a', 156.73, 27.45);

    expect(log[0].target).toBe('target.gamma');
    expect(Math.abs(log[0].local.x - 15)).toBeLessThan(2);
    expect(Math.abs(log[0].local.y + 10)).toBeLessThan(2);
    // The scene-space position is the untransformed one.
    expect(Math.abs(log[0].scene.x - 156.73)).toBeLessThan(2);
    expect(Math.abs(log[0].scene.y - 27.45)).toBeLessThan(2);
  });

  // --- C. MISS ---

  test('a pointer outside every eligible target starts nothing and changes nothing', async () => {
    const before = await reset('a');

    await tap('a', 0, -20);
    await tap('a', 190, 190);
    await tap('a', -190, -190);

    const after = await snapshot('a');
    expect(await events('a')).toEqual([]);
    expect(after.activeSessions).toBe(0);
    expect(after.revision).toBe(before.revision);
    expect(after.canvasHash).toBe(before.canvasHash);
  });

  // --- D. POINTER CAPTURE ---

  test('a drag survives leaving the target and the canvas entirely', async () => {
    await reset('a');
    await movePointerTo('a', 60, -110);
    await app.page.mouse.down();

    expect((await snapshot('a')).activeSessions).toBe(1);

    // Scene y = 300 is a hundred CSS pixels below the canvas, so without
    // pointer capture no move would reach this listener at all.
    await movePointerTo('a', 0, 300, 8);

    const moves = (await events('a')).filter(e => e.kind === 'move');
    expect(moves.length).toBeGreaterThan(0);
    expect(moves.at(-1).target).toBe('target.beta');
    expect(moves.at(-1).moved).toBe(true);
    expect(moves.at(-1).phase).toBe('dragging');
    expect(Math.abs(moves.at(-1).scene.y - 300)).toBeLessThan(2);
    // The target did not move, so the pointer really is outside it.
    expect(Math.abs(moves.at(-1).local.y - 410)).toBeLessThan(3);

    await app.page.mouse.up();

    const release = await lastEvent('a');
    expect(release.kind).toBe('release');
    expect(release.phase).toBe('ended');
    expect(release.moved).toBe(true);
    expect((await snapshot('a')).activeSessions).toBe(0);
  });

  test('a press and release without travel is not reported as a drag', async () => {
    await reset('a');
    await tap('a', 60, -110);

    const log = await events('a');
    expect(log.map(e => e.kind)).toEqual(['press', 'release']);
    expect(log.at(-1).moved).toBe(false);
    expect(log.at(-1).phase).toBe('ended');
  });

  // --- E. AUTHORIZED MUTATION ---

  test('dragging a target mutates through its generation and repaints', async () => {
    const before = await reset('a');
    expect(before.handle).toEqual({x: 0, y: 130});

    await movePointerTo('a', 0, 130);
    await app.page.mouse.down();
    await movePointerTo('a', 70, 90, 10);
    await app.page.mouse.up();

    await settled('a', before.renderCount);

    const after = await snapshot('a');
    expect(Math.abs(after.handle.x - 70)).toBeLessThan(2);
    expect(Math.abs(after.handle.y - 90)).toBeLessThan(2);
    // One accepted press plus at least one accepted move.
    expect(after.revision).toBeGreaterThan(before.revision + 1);
    expect(after.presses).toBe(1);
    expect(after.renderCount).toBeGreaterThan(before.renderCount);
    expect(after.canvasHash).not.toBe(before.canvasHash);

    const log = await events('a');
    expect(log.every(e => e.generation === after.generation)).toBe(true);
    expect(
      log.filter(e => e.kind === 'move' && e.mutated).length,
    ).toBeGreaterThan(0);
    expect(log.some(e => e.refusal !== null)).toBe(false);
  });

  // --- J. MULTI-RUNTIME ---

  test('interaction with one runtime never reaches the other', async () => {
    const beforeA = await reset('a');
    const beforeB = await reset('b');

    await movePointerTo('a', 0, 130);
    await app.page.mouse.down();
    await movePointerTo('a', -60, 130, 8);
    await app.page.mouse.up();
    await settled('a', beforeA.renderCount);

    let afterA = await snapshot('a');
    let afterB = await snapshot('b');
    expect(Math.abs(afterA.handle.x + 60)).toBeLessThan(2);
    expect(afterA.revision).toBeGreaterThan(beforeA.revision);
    expect(afterB.handle).toEqual(beforeB.handle);
    expect(afterB.revision).toBe(beforeB.revision);
    expect(afterB.renderCount).toBe(beforeB.renderCount);
    expect(await events('b')).toEqual([]);

    // And the other way round.
    const midA = await snapshot('a');
    await movePointerTo('b', 0, 130);
    await app.page.mouse.down();
    await movePointerTo('b', 50, 160, 8);
    await app.page.mouse.up();
    await settled('b', beforeB.renderCount);

    afterA = await snapshot('a');
    afterB = await snapshot('b');
    expect(Math.abs(afterB.handle.x - 50)).toBeLessThan(2);
    expect(afterA.handle).toEqual(midA.handle);
    expect(afterA.revision).toBe(midA.revision);
  });

  // --- I. ZERO IDLE ---

  test('an attached interaction subsystem schedules nothing on its own', async () => {
    await reset('a');
    await reset('b');

    const idle = await idleWindow(500);

    expect(idle.sessionsA).toBe(0);
    expect(idle.raf).toBe(0);
    expect(idle.a).toBe(0);
    expect(idle.b).toBe(0);

    // Still quiet after a completed interaction, not merely before the first.
    await tap('a', 60, -110);
    const quietAfter = await idleWindow(500);
    expect(quietAfter.raf).toBe(0);
    expect(quietAfter.a).toBe(0);
    expect(quietAfter.b).toBe(0);

    const shot = await snapshot('a');
    expect(shot.activeSessions).toBe(0);
    expect(shot.mode).toBe('idle');
  });

  test('a headless export pass does not depend on live interaction', async () => {
    await reset('a');
    const quiet = await exportPass('a', [0, 30, 60]);

    expect(quiet).toHaveLength(3);
    expect(new Set(quiet).size).toBe(3);

    // Hold a live pointer session across a second export pass.
    await clearEvents('a');
    await movePointerTo('a', 60, -110);
    await app.page.mouse.down();
    expect((await snapshot('a')).activeSessions).toBe(1);

    const duringSession = await exportPass('a', [0, 30, 60]);
    expect(duringSession).toEqual(quiet);

    // Rebuilding presentation for the export ended the session rather than
    // leaving it pointing at nodes that no longer exist.
    const shot = await snapshot('a');
    expect(shot.activeSessions).toBe(0);
    expect((await events('a')).at(-1).kind).toBe('cancel');

    await app.page.mouse.up();
    // Interaction still works afterwards.
    await clearEvents('a');
    const log = await tap('a', 60, -110);
    expect(log[0].target).toBe('target.beta');
  });

  // --- G. RESET AND CANCEL ---

  test('a host cancellation ends the session and later events do nothing', async () => {
    await reset('a');
    await movePointerTo('a', 60, -110);
    await app.page.mouse.down();
    expect((await snapshot('a')).activeSessions).toBe(1);

    const cancelled = await app.page.evaluate(
      runtime => (window as any).ovcInteraction.cancelAll(runtime),
      'a',
    );
    expect(cancelled).toBe(1);

    const cancel = await lastEvent('a');
    expect(cancel.kind).toBe('cancel');
    expect(cancel.reason).toBe('reset');
    expect(cancel.phase).toBe('cancelled');

    const afterCancel = await snapshot('a');
    expect(afterCancel.activeSessions).toBe(0);

    const countAfterCancel = (await events('a')).length;
    await movePointerTo('a', 0, 0, 6);
    await app.page.mouse.up();

    expect((await events('a')).length).toBe(countAfterCancel);
    expect((await snapshot('a')).revision).toBe(afterCancel.revision);
  });

  test('rebuilding presentation rebinds the targets and ends live sessions', async () => {
    const before = await reset('a');
    await movePointerTo('a', 60, -110);
    await app.page.mouse.down();
    expect((await snapshot('a')).activeSessions).toBe(1);

    const after = await app.page.evaluate(
      runtime => (window as any).ovcInteraction.resetScene(runtime),
      'a',
    );

    expect(after.reconstructions).toBeGreaterThan(before.reconstructions);
    expect(after.activeSessions).toBe(0);
    expect((await events('a')).at(-1).kind).toBe('cancel');
    // The same semantic ids came back on freshly built nodes.
    expect(after.boundTargets).toEqual([
      'target.alpha',
      'target.beta',
      'target.gamma',
      'target.ghost',
      'target.handle',
      'target.under',
    ]);

    await app.page.mouse.up();
    await clearEvents('a');
    const log = await tap('a', 60, -110);
    expect(log[0].target).toBe('target.beta');
  });

  // --- F. STALE SESSION ---

  test('a session started before a generation retired cannot mutate its successor', async () => {
    const before = await reset('a');

    await movePointerTo('a', 0, 130);
    await app.page.mouse.down();
    await movePointerTo('a', 40, 130, 6);

    const live = await snapshot('a');
    expect(live.activeSessions).toBe(1);
    expect(live.revision).toBeGreaterThan(before.revision);
    expect(live.accepted).toBe(true);

    // Accept a successor generation. Nothing tells the dispatcher.
    const retired = await app.page.evaluate(
      runtime => (window as any).ovcInteraction.retire(runtime),
      'a',
    );
    expect(retired.ok).toBe(true);

    const atRetirement = await snapshot('a');
    expect(atRetirement.accepted).toBe(false);
    expect(atRetirement.authorized).toBe(false);

    await clearEvents('a');
    await movePointerTo('a', 120, 60, 6);

    // The very first continuation event ends the session. No move callback is
    // dispatched at all, so nothing downstream even gets the chance to try.
    const afterMove = await snapshot('a');
    expect(afterMove.activeSessions).toBe(0);
    expect(afterMove.revision).toBe(atRetirement.revision);
    expect(afterMove.handle).toEqual(atRetirement.handle);

    const duringMove = await events('a');
    expect(duringMove.map(e => e.kind)).toEqual(['cancel']);
    expect(duringMove[0].reason).toBe('generation-retired');
    expect(duringMove[0].phase).toBe('cancelled');

    await app.page.mouse.up();

    const afterContinuation = await snapshot('a');
    expect(afterContinuation.revision).toBe(atRetirement.revision);
    expect(afterContinuation.handle).toEqual(atRetirement.handle);
    expect(afterContinuation.activeSessions).toBe(0);

    const log = await events('a');
    // The release found no session, so it added nothing.
    expect(log.map(e => e.kind)).toEqual(['cancel']);
    expect(log.some(e => e.mutated)).toBe(false);

    // A fresh press under the retired generation opens no session at all.
    await clearEvents('a');
    await tap('a', 60, -110);
    expect(await events('a')).toEqual([]);
    expect((await snapshot('a')).revision).toBe(atRetirement.revision);

    // The authority itself is alive: its accepted generation still writes,
    // which is what makes the refusals above refusals and not a dead runtime.
    const revision = await app.page.evaluate(
      x => (window as any).ovcInteraction.successorWrite(x),
      -77,
    );
    expect(revision).toBe(atRetirement.revision + 1);
    expect((await snapshot('a')).handle.x).toBe(-77);
  });

  // --- H. DISPOSAL ---

  test('disposing the interaction subsystem removes every listener it added', async () => {
    const before = await reset('b');
    expect(before.listeners.added).toBeGreaterThan(0);
    expect(before.listeners.removed).toBe(0);
    expect(before.dispatcherDisposed).toBe(false);

    const disposed = await app.page.evaluate(
      runtime => (window as any).ovcInteraction.disposeInteraction(runtime),
      'b',
    );

    expect(disposed.dispatcherDisposed).toBe(true);
    expect(disposed.authorized).toBe(false);
    expect(disposed.listeners.removed).toBe(disposed.listeners.added);

    await clearEvents('b');
    await movePointerTo('b', 0, 130);
    await app.page.mouse.down();
    await movePointerTo('b', 60, 90, 6);
    await app.page.mouse.up();
    await app.page.evaluate(
      arg =>
        (window as any).ovcInteraction.syntheticPointer(
          arg.id,
          arg.type,
          arg.x,
          arg.y,
        ),
      {id: 'b', type: 'pointerdown', x: 0, y: 130},
    );

    const after = await snapshot('b');
    expect(await events('b')).toEqual([]);
    expect(after.revision).toBe(disposed.revision);
    expect(after.handle).toEqual(disposed.handle);
    expect(after.activeSessions).toBe(0);

    // Terminal and idempotent: a second disposal removes nothing more.
    const again = await app.page.evaluate(
      runtime => (window as any).ovcInteraction.disposeInteraction(runtime),
      'b',
    );
    expect(again.listeners.removed).toBe(disposed.listeners.removed);
  });

  test('no page errors were raised across the whole suite', () => {
    expect(app.pageErrors).toEqual([]);
  });
});
