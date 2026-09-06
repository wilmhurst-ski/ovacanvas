import {
  PlaybackState,
  Player,
  Stage,
  Vector2,
  createEffect,
  getAssetReloadSubscriberCount,
} from '@ovacanvas/core';
import type {ActivationRejection} from '@ovacanvas/core/lib/internal';
import probeAudio from '../foundation/assets/probe.wav';
import project from '../foundation/project?project';
import type {
  FoundationCapability,
  FoundationGeneration,
  PresentationBinding,
} from '../foundation/runtimeStore';
import {RuntimeStore, registerBinding} from '../foundation/runtimeStore';

export type HostMode =
  | 'boot'
  | 'idle'
  | 'dirty'
  | 'presentation'
  | 'settle'
  | 'seek'
  | 'disposed';

/**
 * Counts every animation frame the *runtime* asks for, so an idle runtime can
 * be proven to schedule nothing at all.
 */
export const rafLedger = {requested: 0, fired: 0};

/**
 * Counts resources whose release is otherwise invisible from script, so that
 * disposal can be asserted to return the page to its baseline.
 */
export const resourceLedger = {
  audioContexts: 0,
  audioContextsClosed: 0,
  get openAudioContexts() {
    return this.audioContexts - this.audioContextsClosed;
  },
};

/** Every audio element the engine creates, so media state can be observed. */
export const audioElements: HTMLAudioElement[] = [];
const NativeAudio = window.Audio;
window.Audio = function trackedAudio(src?: string) {
  const element = new NativeAudio(src);
  audioElements.push(element);
  return element;
} as unknown as typeof Audio;
window.Audio.prototype = NativeAudio.prototype;

const NativeAudioContext = window.AudioContext;
class TrackedAudioContext extends NativeAudioContext {
  private tracked = false;

  public constructor(options?: AudioContextOptions) {
    super(options);
    resourceLedger.audioContexts++;
  }

  public override close(): Promise<void> {
    if (!this.tracked) {
      this.tracked = true;
      resourceLedger.audioContextsClosed++;
    }
    return super.close();
  }
}
window.AudioContext = TrackedAudioContext as unknown as typeof AudioContext;

const NativeRaf = window.requestAnimationFrame.bind(window);
window.requestAnimationFrame = (callback: FrameRequestCallback) => {
  rafLedger.requested++;
  return NativeRaf((time: number) => {
    rafLedger.fired++;
    callback(time);
  });
};

function hashCanvas(stage: Stage, size: number) {
  const {data} = stage.context.getImageData(0, 0, size, size);
  let hash = 2166136261;
  for (let i = 0; i < data.length; i += 4) {
    hash ^=
      data[i] | (data[i + 1] << 8) | (data[i + 2] << 16) | (data[i + 3] << 24);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

const SIZE = 320;

/**
 * The smallest runtime host that can exercise the frozen foundation
 * invariants. It owns the Store, the Stage and the Player; the Player and
 * Scene own no semantic truth.
 */
/**
 * A commit outcome flattened for fixture use.
 *
 * @remarks
 * The core `ActivationResult` is a discriminated union, but this workspace's
 * inherited tsconfig has `strict` off, where discriminant narrowing is not
 * dependable. Flattening here keeps the regressions readable.
 */
export interface CommitOutcome {
  ok: boolean;
  reason: string | null;
  activated: number | null;
  retired: number | null;
}

export interface HostOptions {
  withMedia?: boolean;
  /** Share an existing authority instead of creating one. */
  store?: RuntimeStore;
  /** Make the scene generator throw before it can report readiness. */
  failOnPrepare?: boolean;
  /**
   * Whether this presentation commits itself as soon as it is ready.
   *
   * @remarks
   * Staged replacements set this to `false`: preparation must be able to
   * finish and reach a ready state *without* becoming accepted, so the driver
   * decides when the commit boundary happens.
   */
  autoActivate?: boolean;
}

export class FoundationHost {
  public readonly store: RuntimeStore;
  public readonly stage = new Stage();
  public readonly player: Player;

  /**
   * The generation this presentation realizes, and the capability that lets
   * the *host* - never scene code - request accepted mutations.
   */
  public readonly generation: FoundationGeneration;
  public readonly binding: PresentationBinding;
  private readonly capability: FoundationCapability;

  public mode: HostMode = 'boot';
  public renderCount = 0;
  public wakeCalls = 0;
  public sleepCalls = 0;
  public resetEvents = 0;
  public hmrReloads = 0;
  public assetEvents = 0;
  public ready = false;

  private ownsStore: boolean;
  private readonly autoActivate: boolean;
  private readonly container: HTMLElement;
  private dirtyPending = false;
  private settle: (() => void) | null = null;
  private readonly disposers: Array<() => void> = [];

  public constructor(
    public readonly id: string,
    container: HTMLElement,
    options: HostOptions | boolean = {},
  ) {
    const resolved: HostOptions =
      typeof options === 'boolean' ? {withMedia: options} : options;
    const withMedia = resolved.withMedia ?? false;

    this.store = resolved.store ?? new RuntimeStore(id);
    this.ownsStore = resolved.store === undefined;
    this.autoActivate = resolved.autoActivate ?? true;
    this.container = container;

    const {prepared, binding} = this.store.prepareGeneration();
    this.generation = prepared;
    this.binding = binding;
    this.capability = prepared.capability;
    binding.withMedia = withMedia;
    binding.failOnPrepare = resolved.failOnPrepare ?? false;

    this.stage.configure({
      size: new Vector2(SIZE, SIZE),
      resolutionScale: 1,
      background: '#101216',
    });
    container.append(this.stage.finalBuffer);

    this.player = new Player(
      project,
      {size: new Vector2(SIZE, SIZE), resolutionScale: 1, fps: 30},
      {paused: true, loop: false, muted: true},
      0,
    );

    if (withMedia) {
      this.audioIndex = audioElements.length - 1;
      this.player.audio.setSource(probeAudio);
    }

    // Bind this generation's read-only projection to the scene *before* the
    // first frame runs. The scene never receives the capability.
    registerBinding(this.player.playback.currentScene, this.binding);

    this.disposers.push(
      this.player.playback.currentScene.onReset.subscribe(() => {
        this.resetEvents++;
        this.binding.beginReconstruction();
      }),
    );

    this.disposers.push(
      this.player.playback.currentScene.onReloaded.subscribe(() => {
        if (this.mode === 'disposed') {
          this.callbacksAfterDispose++;
          return;
        }
        this.hmrReloads++;
        // HMR reconstructs presentation; the host decides to wake.
        this.mode = 'dirty';
        this.player.requestRender();
        this.player.wake();
        this.wakeCalls++;
      }),
    );

    this.disposers.push(
      this.player.onRender.subscribe(async () => {
        if (this.mode === 'disposed') {
          this.callbacksAfterDispose++;
          return;
        }
        await this.stage.render(
          this.player.playback.currentScene,
          this.player.playback.previousScene,
        );
        this.renderCount++;

        if (
          this.mode === 'boot' ||
          this.mode === 'dirty' ||
          this.mode === 'seek'
        ) {
          this.sleepNow();
          if (!this.ready) {
            this.ready = true;
            // Readiness is reported separately from becoming accepted.
            this.generation.markReady();
            if (this.autoActivate) {
              this.store.authority.activate(this.generation);
            }
          }
          this.resolveSettle();
        } else if (
          this.mode === 'presentation' &&
          this.player.playback.finished
        ) {
          this.player.togglePlayback(false);
          this.mode = 'settle';
        } else if (this.mode === 'settle') {
          this.sleepNow();
          this.resolveSettle();
        }
      }),
    );

    // Authoritative visual dependency changes automatically wake rendering.
    this.disposers.push(
      createEffect(() => {
        this.binding.width();
        this.binding.doubled();
        if (this.ready && this.mode !== 'disposed') this.markDirty();
      }),
    );
  }

  private sleepNow() {
    this.player.sleep();
    this.sleepCalls++;
    this.mode = 'idle';
  }

  private resolveSettle() {
    const settle = this.settle;
    this.settle = null;
    settle?.();
  }

  private operation() {
    return new Promise<void>(resolve => (this.settle = resolve));
  }

  /** Coalesce every synchronous dirty write in this task into one wake. */
  private markDirty() {
    if (this.dirtyPending || this.mode !== 'idle') return;
    this.dirtyPending = true;
    queueMicrotask(() => {
      this.dirtyPending = false;
      if (this.mode !== 'idle') return;
      this.mode = 'dirty';
      this.player.requestRender();
      this.player.wake();
      this.wakeCalls++;
    });
  }

  /**
   * The host's own mutation path. Presentation cannot reach this: the
   * capability belongs to the host, and is only usable while this generation
   * is the accepted one.
   */
  public write(width: number): number {
    return this.capability.write(draft => {
      draft.width = width;
    });
  }

  /** The capability for this generation, so a regression can capture it. */
  public mutationCapability(): FoundationCapability {
    return this.capability;
  }

  public async writeAndWait(width: number) {
    const before = this.renderCount;
    this.write(width);
    while (this.renderCount <= before) await wait(2);
  }

  public async present() {
    const settled = this.operation();
    this.mode = 'presentation';
    if (this.player.playback.frame >= this.player.playback.duration) {
      this.player.requestReset();
    }
    this.player.togglePlayback(true);
    this.player.wake();
    this.wakeCalls++;
    await settled;
  }

  public async seek(frame: number) {
    const settled = this.operation();
    this.mode = 'seek';
    this.player.requestSeek(frame);
    this.player.wake();
    this.wakeCalls++;
    await settled;
  }

  /**
   * Export runs off a frozen semantic snapshot and must not depend on the
   * interactive scheduler.
   */
  public async exportPass(frames: number[]) {
    const previous = this.mode;
    this.mode = 'seek';
    this.player.playback.state = PlaybackState.Rendering;
    await this.player.playback.recalculate();
    await this.player.playback.reset();
    const hashes: number[] = [];
    for (const frame of frames) {
      await this.player.playback.seek(frame);
      await this.stage.render(
        this.player.playback.currentScene,
        this.player.playback.previousScene,
      );
      hashes.push(hashCanvas(this.stage, SIZE));
    }
    this.player.playback.state = PlaybackState.Paused;
    this.mode = previous === 'disposed' ? 'disposed' : 'idle';
    return hashes;
  }

  private audioIndex = -1;

  /** The audio element this runtime's Player owns. */
  public audioElement(): HTMLAudioElement {
    const element = audioElements[this.audioIndex];
    if (!element) throw new Error(`runtime ${this.id} owns no audio element`);
    return element;
  }

  /**
   * Round trip between absolute audio time and presentation time, the
   * mapping that syncAudio() relies on.
   */
  public audioTimeRoundTrip(offset: number, absolute: number) {
    this.player.audio.setOffset(offset);
    this.player.audio.setTime(absolute);
    return this.player.audio.getTime();
  }

  /** Presentation seconds for a frame, as the player computes them. */
  public framesToSeconds(frame: number) {
    return this.player.status.framesToSeconds(frame);
  }

  /** The audio clock as the player currently sees it. */
  public audioTime() {
    return this.player.audio.getTime();
  }

  public disposeCalls = 0;
  public disposeExecutions = 0;
  public callbacksAfterDispose = 0;

  /**
   * Terminal teardown of this runtime. Idempotent: repeated calls execute the
   * body exactly once.
   */
  public dispose() {
    this.disposeCalls++;
    if (this.mode === 'disposed') return;
    this.disposeExecutions++;
    this.mode = 'disposed';
    this.dirtyPending = false;
    for (const dispose of this.disposers.splice(0)) dispose();
    this.player.dispose();
    this.stage.dispose();
    this.generation.discard();
    if (this.ownsStore) this.store.dispose();
  }

  /**
   * Explicit render request - one of the frozen wake-source classes.
   */
  public async requestRenderAndWait() {
    const settled = this.operation();
    this.mode = 'dirty';
    this.player.requestRender();
    this.player.wake();
    this.wakeCalls++;
    await settled;
  }

  /**
   * Host resize - one of the frozen wake-source classes. Reconfiguring the
   * stage and the player forces a recalculation and a redraw.
   */
  public async resizeAndWait(size: number) {
    const settled = this.operation();
    this.mode = 'seek';
    this.stage.configure({size: new Vector2(size, size)});
    await this.player.configure({
      size: new Vector2(size, size),
      resolutionScale: 1,
      fps: 30,
      range: [0, Infinity],
      audioOffset: 0,
    });
    this.player.requestRender();
    this.player.wake();
    this.wakeCalls++;
    await settled;
  }

  /**
   * Prepare a replacement presentation out of place.
   *
   * @remarks
   * The replacement is a separate presentation instance in a detached
   * container sharing this host's authority. Beginning it touches nothing that
   * is currently accepted, which is the whole point: the donor's in-place
   * `Scene.reload()` path disposes the live node generation before it knows
   * whether the replacement works.
   */
  public prepareReplacement(
    id: string,
    options: {failOnPrepare?: boolean; withMedia?: boolean} = {},
  ): FoundationHost {
    const detached = document.createElement('div');
    return new FoundationHost(id, detached, {
      store: this.store,
      autoActivate: false,
      failOnPrepare: options.failOnPrepare ?? false,
      withMedia: options.withMedia ?? false,
    });
  }

  /**
   * Wait for a staged presentation to report readiness.
   *
   * @returns `true` if it became ready, `false` if preparation failed.
   */
  public static async awaitPrepared(
    staged: FoundationHost,
    timeout = 8000,
  ): Promise<boolean> {
    const deadline = Date.now() + timeout;
    while (!staged.ready && Date.now() < deadline) await wait(5);
    return staged.ready;
  }

  /**
   * The single commit boundary.
   *
   * @remarks
   * Delegates freshness validation to the authority. On refusal the staged
   * work is torn down and this presentation is left exactly as it was. On
   * success the staged canvas replaces this one, the retired generation loses
   * its mutation authority immediately, and its resources are released here.
   */
  public commitReplacement(staged: FoundationHost): CommitOutcome {
    const result = this.store.authority.activate(staged.generation);

    if (!result.ok) {
      staged.dispose();
      // This workspace inherits a non-strict tsconfig, where narrowing into
      // the `false` branch of a boolean-literal discriminant is not
      // dependable. The runtime shape is guaranteed by `activate()`.
      const rejection = result as ActivationRejection;
      return {
        ok: false,
        reason: rejection.reason,
        activated: null,
        retired: null,
      };
    }

    // The outgoing presentation may legitimately outlive the commit; this
    // fixture retires it immediately rather than choosing a transition.
    this.container.append(staged.stage.finalBuffer);
    staged.container.replaceChildren();
    // The shared authority must survive this host's teardown.
    staged.ownsStore = this.ownsStore;
    this.ownsStore = false;
    this.dispose();
    this.store.authority.release(result.retired!);

    return {
      ok: true,
      reason: null,
      activated: result.activated,
      retired: result.retired,
    };
  }

  /** The media element owned by this runtime's media node. */
  public videoElement(): HTMLVideoElement {
    const video = this.binding.boundVideo;
    if (!video) throw new Error(`runtime ${this.id} mounted no media node`);
    return video.elementForProbe();
  }

  /** Every mutating entry point must throw once the runtime is disposed. */
  public failClosed() {
    const attempt = (operation: () => void) => {
      try {
        operation();
        return false;
      } catch {
        return true;
      }
    };
    return {
      seek: attempt(() => this.player.requestSeek(1)),
      reset: attempt(() => this.player.requestReset()),
      render: attempt(() => this.player.requestRender()),
      playback: attempt(() => this.player.togglePlayback(true)),
      wake: attempt(() => this.player.wake()),
    };
  }

  public snapshot() {
    return {
      id: this.id,
      mode: this.mode,
      frame: this.player.playback.frame,
      duration: this.player.playback.duration,
      width: this.binding.width(),
      revision: this.store.revision,
      acceptedGeneration: this.binding.generation,
      isAccepted: this.binding.isAccepted(),
      generation: this.binding.reconstructions,
      nodeKey: this.binding.boundNode?.key ?? null,
      renderCount: this.renderCount,
      wakeCalls: this.wakeCalls,
      sleepCalls: this.sleepCalls,
      resetEvents: this.resetEvents,
      canvasHash:
        this.mode === 'disposed' ? null : hashCanvas(this.stage, SIZE),
      hmrReloads: this.hmrReloads,
      disposeCalls: this.disposeCalls,
      disposeExecutions: this.disposeExecutions,
      callbacksAfterDispose: this.callbacksAfterDispose,
      playerDisposed: this.player.isDisposed(),
    };
  }
}

/** Live subscribers behind the single module-lifetime asset listener. */
export const assetSubscriberCount = () => getAssetReloadSubscriberCount();

export const wait = (ms: number) =>
  new Promise<void>(resolve => setTimeout(resolve, ms));
