import {afterAll, beforeAll, describe, expect, test} from 'vitest';
import {PlaybackManager, PlaybackStatus} from '../app';
import {createSignal} from '../signals';
import {threads} from '../threading';
import {endPlayback, startPlayback} from '../utils';
import {all} from './all';
import {growThrough} from './growThrough';
import {waitFor} from './scheduling';

/**
 * Each test compares `growThrough` against the exact hand-assembled
 * `signal(value, duration).wait(hold)` sequence it documents itself as
 * being built from, run concurrently against the same clock via `all()`.
 * If both finish on the same frame, `growThrough` really is that
 * composition and nothing else - no guessed frame-count arithmetic needed.
 */
describe('growThrough()', () => {
  const playback = new PlaybackManager();
  const status = new PlaybackStatus(playback);
  beforeAll(() => startPlayback(status));
  afterAll(() => endPlayback(status));

  test('one step matches tweening then waiting by hand', () => {
    const viaHelper = createSignal(0);
    const viaHand = createSignal(0);
    let helperFrame = -1;
    let handFrame = -1;

    const task = threads(function* () {
      yield* all(
        (function* () {
          yield* growThrough(viaHelper, [10], {
            transitionSeconds: 0.4,
            holdSeconds: 0.3,
          });
          helperFrame = playback.frame;
        })(),
        (function* () {
          yield* viaHand(10, 0.4);
          yield* waitFor(0.3);
          handFrame = playback.frame;
        })(),
      );
    });

    playback.fps = 10;
    playback.frame = 0;
    for (const step of task) {
      void step;
      playback.frame++;
    }

    expect(viaHelper()).toBe(10);
    expect(helperFrame).toBe(handFrame);
  });

  test('multiple states match manually chaining the same tween+wait steps', () => {
    const viaHelper = createSignal(0);
    const viaHand = createSignal(0);
    let helperFrame = -1;
    let handFrame = -1;

    const task = threads(function* () {
      yield* all(
        (function* () {
          yield* growThrough(viaHelper, [10, 20, 30], {
            transitionSeconds: 0.4,
            holdSeconds: 0.2,
          });
          helperFrame = playback.frame;
        })(),
        (function* () {
          yield* viaHand(10, 0.4);
          yield* waitFor(0.2);
          yield* viaHand(20, 0.4);
          yield* waitFor(0.2);
          yield* viaHand(30, 0.4);
          yield* waitFor(0.2);
          handFrame = playback.frame;
        })(),
      );
    });

    playback.fps = 10;
    playback.frame = 0;
    for (const step of task) {
      void step;
      playback.frame++;
    }

    expect(viaHelper()).toBe(30);
    expect(helperFrame).toBe(handFrame);
  });

  test('defaults to a 0.6s transition and a 1s hold per state', () => {
    const viaHelper = createSignal(0);
    const viaHand = createSignal(0);
    let helperFrame = -1;
    let handFrame = -1;

    const task = threads(function* () {
      yield* all(
        (function* () {
          yield* growThrough(viaHelper, [5]);
          helperFrame = playback.frame;
        })(),
        (function* () {
          yield* viaHand(5, 0.6);
          yield* waitFor(1);
          handFrame = playback.frame;
        })(),
      );
    });

    playback.fps = 10;
    playback.frame = 0;
    for (const step of task) {
      void step;
      playback.frame++;
    }

    expect(helperFrame).toBe(handFrame);
  });

  test('an empty state list does nothing', () => {
    const value = createSignal(7);
    const task = threads(function* () {
      yield* growThrough(value, []);
    });

    playback.fps = 10;
    playback.frame = 0;
    for (const step of task) {
      void step;
      playback.frame++;
    }

    expect(value()).toBe(7);
    expect(playback.frame).toBe(0);
  });
});
