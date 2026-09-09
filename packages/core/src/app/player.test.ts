import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';
import {getAssetReloadSubscriberCount} from '../media';
import {MetaFile} from '../meta';
import type {FullSceneDescription} from '../scenes';
import {GeneratorScene, createSceneMetadata} from '../scenes';
import {Vector2} from '../types';
import {Player} from './Player';
import type {Project} from './Project';
import {bootstrap} from './bootstrap';

/**
 * The smallest scene a `Player` will accept.
 *
 * @remarks
 * These tests exercise scheduling and lifecycle, never drawing, so the view
 * and the draw call are deliberately empty. A real renderer lives in the `2d`
 * package and is not needed - or wanted - to prove that a sleeping player
 * schedules nothing.
 */
class ProbeScene extends GeneratorScene<void> {
  /** Set by a test to park recalculation at a controlled point. */
  public recalculationGate: Promise<void> | null = null;
  /** Called once recalculation has actually suspended. */
  public onRecalculationEntered: (() => void) | null = null;

  public getView(): void {
    // No view.
  }

  protected draw(): void {
    // Nothing to draw.
  }

  public override async recalculate(
    setFrame: (frame: number) => void,
  ): Promise<void> {
    const gate = this.recalculationGate;
    if (gate) {
      this.recalculationGate = null;
      this.onRecalculationEntered?.();
      await gate;
      // Deliberately does not resume into real recalculation. What is under
      // test is what `Player` does at its next checkpoint after an awaited
      // operation returns, not what a disposed scene does when re-entered.
      setFrame(0);
      return;
    }
    return super.recalculate(setFrame);
  }
}

/** A promise a test resolves by hand. */
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(res => {
    resolve = res;
  });
  return {promise, resolve};
}

function probeProject(): Project {
  const description = {
    klass: ProbeScene,
    config: function* () {
      // An empty runner: the loop never has to progress for these tests.
    },
    stack: 'probe',
    meta: createSceneMetadata(),
    name: 'probe-scene',
  } as unknown as FullSceneDescription;

  return bootstrap(
    'probe',
    {core: 'probe', two: null, ui: null, vitePlugin: null},
    [],
    {scenes: [description]},
    new MetaFile('probe'),
    new MetaFile('probe.settings'),
  );
}

/**
 * Animation frames the player asked for, and never got.
 *
 * @remarks
 * Nothing here advances time on its own. A frame runs only when a test calls
 * it, so every assertion about scheduling is deterministic and no test waits
 * on a real clock.
 */
interface FakeScheduler {
  readonly requested: FrameRequestCallback[];
  readonly cancelled: number[];
  nextId: number;
}

/**
 * Sleeping and waking a player, which is what offstage preparation needs.
 *
 * @remarks
 * A candidate presentation is built while another one is on screen. The
 * candidate's player must hold its runtime without burning frames, and a
 * disposed player must not come back to life through work that was already
 * scheduled. Both are lifecycle properties, so they are asserted directly
 * rather than inferred from a rendered result.
 */
describe('Player scheduling lifecycle', () => {
  let scheduler: FakeScheduler;
  let restore: (() => void) | null = null;
  let player: Player | null = null;

  function newPlayer(): Player {
    player = new Player(
      probeProject(),
      {size: new Vector2(64, 64), resolutionScale: 1, fps: 30},
      {paused: true, loop: false, muted: true},
      0,
    );
    return player;
  }

  beforeEach(() => {
    scheduler = {requested: [], cancelled: [], nextId: 0};
    const globals = globalThis as Record<string, unknown>;
    const previous = {
      raf: globals.requestAnimationFrame,
      caf: globals.cancelAnimationFrame,
      audioContext: globals.AudioContext,
      audioElement: globals.Audio,
    };

    globals.requestAnimationFrame = (callback: FrameRequestCallback) => {
      scheduler.requested.push(callback);
      return ++scheduler.nextId;
    };
    globals.cancelAnimationFrame = (id: number) => {
      scheduler.cancelled.push(id);
    };
    // jsdom has no Web Audio, and its media element throws "not implemented"
    // for playback. The player builds its audio pool eagerly and these tests
    // never play anything, so both are replaced with inert stand-ins.
    globals.Audio = class {
      public pause() {}
      public load() {}
      public removeAttribute() {}
      public addEventListener() {}
      public removeEventListener() {}
    };
    globals.AudioContext = class {
      public readonly destination = {};
      public close() {
        return Promise.resolve();
      }
      public createGain() {
        return {connect() {}, disconnect() {}, gain: {value: 1}};
      }
      public createMediaElementSource() {
        return {connect() {}, disconnect() {}};
      }
    };

    restore = () => {
      globals.requestAnimationFrame = previous.raf;
      globals.cancelAnimationFrame = previous.caf;
      globals.AudioContext = previous.audioContext;
      globals.Audio = previous.audioElement;
    };
  });

  afterEach(() => {
    player?.dispose();
    player = null;
    restore?.();
    restore = null;
  });

  test('a new player asks for exactly one frame', () => {
    const active = newPlayer();

    expect(scheduler.requested).toHaveLength(1);
    expect(scheduler.cancelled).toEqual([]);
    expect(active.isDisposed()).toBe(false);
  });

  test('sleeping cancels the frame that was already requested', () => {
    const active = newPlayer();
    expect(scheduler.requested).toHaveLength(1);

    active.sleep();

    expect(scheduler.cancelled).toEqual([1]);
    expect(scheduler.requested).toHaveLength(1);
  });

  test('a sleeping player schedules nothing, even when asked to render', () => {
    const active = newPlayer();
    active.sleep();
    const before = scheduler.requested.length;

    // Requesting work records the intent; it deliberately does not wake the
    // loop, which is what keeps an offstage player at zero frames.
    active.requestRender();
    active.requestSeek(5);
    active.requestReset();

    expect(scheduler.requested).toHaveLength(before);

    // Only the host waking it resumes scheduling.
    active.wake();
    expect(scheduler.requested).toHaveLength(before + 1);
  });

  test('sleeping releases no runtime resources', () => {
    const active = newPlayer();
    const scene = active.playback.currentScene;
    // Stand in for retained progress the host would rather not lose.
    active.playback.frame = 7;

    active.sleep();

    expect(active.isDisposed()).toBe(false);
    // The same scene object, not a rebuilt one.
    expect(active.playback.currentScene).toBe(scene);
    expect(active.playback.frame).toBe(7);
    expect(active.status.fps).toBe(30);
  });

  test('waking resumes the retained runtime rather than resetting it', () => {
    const active = newPlayer();
    const scene = active.playback.currentScene;
    active.playback.frame = 12;
    active.sleep();

    active.wake();

    expect(active.playback.frame).toBe(12);
    expect(active.playback.currentScene).toBe(scene);
    expect(active.isDisposed()).toBe(false);
  });

  test('repeated sleeping and waking stays balanced', () => {
    const active = newPlayer();
    active.sleep();
    active.sleep();
    active.sleep();

    // Only the first sleep had a frame to cancel.
    expect(scheduler.cancelled).toEqual([1]);

    const before = scheduler.requested.length;
    active.wake();
    active.wake();
    active.wake();

    // Waking coalesces: one outstanding frame, not one per call.
    expect(scheduler.requested).toHaveLength(before + 1);
  });

  test('disposal while sleeping is terminal and idempotent', () => {
    const active = newPlayer();
    active.sleep();
    const cancelled = scheduler.cancelled.length;

    active.dispose();
    active.dispose();
    active.dispose();

    expect(active.isDisposed()).toBe(true);
    // Nothing left to cancel: sleeping had already released the frame.
    expect(scheduler.cancelled).toHaveLength(cancelled);
    // Asset-reload listeners the player owned are gone.
    expect(getAssetReloadSubscriberCount()).toBe(0);
  });

  test('waking a disposed player fails closed', () => {
    const active = newPlayer();
    active.dispose();

    expect(() => active.wake()).toThrow(/disposed Player/);
    expect(() => active.requestRender()).toThrow(/disposed Player/);
    expect(scheduler.requested).toHaveLength(1);
  });

  test('a frame that runs after disposal does no work', async () => {
    const active = newPlayer();
    const frame = scheduler.requested[0];
    let rendered = 0;
    active.onRender.subscribe(async () => {
      rendered++;
    });
    active.playback.frame = 3;

    active.dispose();
    // The frame was scheduled by a runtime that no longer exists. It observes
    // its lifecycle token and returns without touching released state.
    await frame(1000);

    expect(rendered).toBe(0);
    expect(active.playback.frame).toBe(3);
    expect(active.isDisposed()).toBe(true);
  });

  test('sleeping keeps a player usable for a later transition', () => {
    const active = newPlayer();
    // The shape an offstage candidate takes: prepared, then parked.
    active.sleep();
    expect(scheduler.requested).toHaveLength(1);

    // Much later, the host decides to show it.
    active.wake();
    active.requestRender();

    expect(scheduler.requested).toHaveLength(2);
    expect(active.isDisposed()).toBe(false);
  });

  test('disposal during a suspended run touches no released resource', async () => {
    const active = newPlayer();
    const scene = active.playback.currentScene as ProbeScene;

    // Suspend the run inside the recalculation it performs on its first frame.
    const gate = deferred();
    const entered = deferred();
    scene.recalculationGate = gate.promise;
    scene.onRecalculationEntered = entered.resolve;

    // Anything the run would touch *after* resuming.
    const setupPool = vi.spyOn(active.audioPool, 'setupPool');
    let rendered = 0;
    active.onRender.subscribe(async () => {
      rendered++;
    });

    // Start the frame without awaiting it, then wait for the suspension.
    const frame = scheduler.requested[0];
    const running = frame(1000);
    await entered.promise;
    expect(setupPool).not.toHaveBeenCalled();

    // The runtime goes away while the run is parked mid-await.
    active.dispose();
    gate.resolve();
    await running;

    // The lifecycle token stopped the run at its next checkpoint: the audio
    // pool of a disposed player was never reconfigured, nothing was drawn,
    // and no further frame was scheduled.
    expect(setupPool).not.toHaveBeenCalled();
    expect(rendered).toBe(0);
    expect(scheduler.requested).toHaveLength(1);
    // The frame that ran cleared itself and queued no replacement.
    expect(active.isDisposed()).toBe(true);
    active.dispose();
    expect(active.isDisposed()).toBe(true);
  });
});
