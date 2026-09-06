import {
  AsyncEventDispatcher,
  EventDispatcher,
  ValueDispatcher,
} from '../events';
import {AudioManager, AudioManagerPool, AudioResourceManager} from '../media';
import {Scene, Sound} from '../scenes';
import {EditableTimeEvents} from '../scenes/timeEvents';
import {clamp} from '../tweening';
import {Vector2} from '../types';
import {Semaphore} from '../utils';
import {Logger} from './Logger';
import {PlaybackManager, PlaybackState} from './PlaybackManager';
import {PlaybackStatus} from './PlaybackStatus';
import {Project} from './Project';
import {SharedWebGLContext} from './SharedWebGLContext';

export interface PlayerState extends Record<string, unknown> {
  paused: boolean;
  loop: boolean;
  muted: boolean;
  volume: number;
  speed: number;
}

export interface PlayerSettings {
  range: [number, number];
  fps: number;
  size: Vector2;
  audioOffset: number;
  resolutionScale: number;
}

const MAX_AUDIO_DESYNC = 1 / 50;

/**
 * The player logic used by the editor and embeddable player.
 *
 * @remarks
 * This class builds on top of the `PlaybackManager` to provide a simple
 * interface similar to other media players. It plays through the animation
 * using a real-time update loop and optionally synchronises it with audio.
 */
export class Player {
  /**
   * Triggered during each iteration of the update loop when the frame is ready
   * to be rendered.
   *
   * @remarks
   * Player does not perform any rendering on its own. For the animation to be
   * visible, another class must subscribe to this event and perform the
   * rendering itself. {@link Stage} can be used to display the animation.
   *
   * @eventProperty
   */
  public get onRender() {
    return this.render.subscribable;
  }
  private readonly render = new AsyncEventDispatcher<void>();

  public get onStateChanged() {
    return this.playerState.subscribable;
  }
  private readonly playerState: ValueDispatcher<PlayerState>;

  public get onFrameChanged() {
    return this.frame.subscribable;
  }
  private readonly frame = new ValueDispatcher(0);

  public get onDurationChanged() {
    return this.duration.subscribable;
  }
  private readonly duration = new ValueDispatcher(0);

  /**
   * Triggered right after recalculation finishes.
   *
   * @remarks
   * Can be used to provide visual feedback.
   *
   * @eventProperty
   */
  public get onRecalculated() {
    return this.recalculated.subscribable;
  }
  private readonly recalculated = new EventDispatcher<void>();

  public readonly playback: PlaybackManager;
  public readonly status: PlaybackStatus;
  public readonly audio: AudioManager;
  public readonly audioPool: AudioManagerPool;
  public readonly audioResources: AudioResourceManager;
  public readonly logger: Logger;
  private readonly sharedWebGLContext: SharedWebGLContext;

  private readonly lock = new Semaphore();
  private startTime = 0;
  private endTime = Infinity;
  private requestId: number | null = null;
  private renderTime = 0;
  private requestedSeek = -1;
  private requestedRender = false;
  private requestedRecalculation = true;
  private size: Vector2;
  private resolutionScale: number;
  private active = false;
  private disposed = false;
  /**
   * Incremented on disposal so that work suspended across an `await` can
   * detect that the runtime it belonged to is gone and fail closed.
   */
  private lifecycle = 0;
  private readonly scenes: Scene[] = [];
  private readonly disposers: Array<() => void> = [];

  private get startFrame() {
    return Math.min(
      this.playback.duration,
      this.status.secondsToFrames(this.startTime),
    );
  }

  private get endFrame() {
    return Math.min(
      this.playback.duration,
      this.status.secondsToFrames(this.endTime),
    );
  }

  private get finished() {
    return this.playback.finished || this.playback.frame >= this.endFrame;
  }

  public constructor(
    private project: Project,
    private settings: Partial<PlayerSettings> = {},
    private initialState: Partial<PlayerState> = {},
    private initialFrame = -1,
  ) {
    this.playerState = new ValueDispatcher<PlayerState>({
      loop: true,
      muted: true,
      volume: 1,
      speed: 1,
      ...initialState,
      paused: true,
    });

    this.sharedWebGLContext = new SharedWebGLContext(this.project.logger);
    this.requestedSeek = initialFrame;
    this.logger = this.project.logger;
    this.playback = new PlaybackManager();
    this.status = new PlaybackStatus(this.playback);
    this.audioResources = new AudioResourceManager(this.logger);
    this.audioPool = new AudioManagerPool(this.logger, this.audioResources);
    this.audio = this.audioPool.spawn();
    this.size = settings.size ?? new Vector2(1920, 1080);
    this.resolutionScale = settings.resolutionScale ?? 1;
    this.startTime = settings.range?.[0] ?? 0;
    this.endTime = settings.range?.[1] ?? Infinity;
    this.playback.fps = settings.fps ?? 60;
    this.audio.setOffset(settings.audioOffset ?? 0);

    if (project.audio) {
      this.audio.setSource(project.audio);
    }

    const scenes: Scene[] = [];
    for (const description of project.scenes) {
      const scene = new description.klass({
        ...description,
        playback: this.status,
        logger: this.project.logger,
        size: this.size,
        resolutionScale: this.resolutionScale,
        timeEventsClass: EditableTimeEvents,
        sharedWebGLContext: this.sharedWebGLContext,
        experimentalFeatures: project.experimentalFeatures,
      });
      const unsubscribeReplaced = description.onReplaced?.subscribe(
        description => {
          scene.reload(description);
        },
        false,
      );
      if (unsubscribeReplaced) {
        this.disposers.push(unsubscribeReplaced);
      }
      this.disposers.push(
        scene.onReloaded.subscribe(() => this.requestRecalculation()),
      );
      scene.variables.updateSignals(project.variables ?? {});
      scenes.push(scene);
    }
    this.scenes.push(...scenes);
    this.playback.setup(scenes);
    this.activate();
  }

  public async configure(settings: PlayerSettings) {
    const lifecycle = this.lifecycle;
    await this.lock.acquire();
    // Disposal or replacement may have happened while this waited for the
    // lock. Resuming into a dead runtime would reconfigure released state.
    if (this.isStale(lifecycle)) {
      this.lock.release();
      return;
    }
    let frame = this.playback.frame;
    let recalculate = false;
    this.startTime = settings.range[0];
    this.endTime = settings.range[1];
    const newFps = Math.max(1, settings.fps);
    if (this.playback.fps !== newFps) {
      const ratio = newFps / this.playback.fps;
      this.playback.fps = newFps;
      frame = Math.floor(frame * ratio);
      recalculate = true;
    }
    if (
      !settings.size.exactlyEquals(this.size) ||
      settings.resolutionScale !== this.resolutionScale
    ) {
      this.size = settings.size;
      this.resolutionScale = settings.resolutionScale;
      this.playback.reload({
        size: this.size,
        resolutionScale: this.resolutionScale,
      });
    }
    if (settings.audioOffset !== undefined) {
      this.audio.setOffset(settings.audioOffset);
    }

    this.lock.release();
    if (recalculate) {
      this.playback.reload();
      this.frame.current = frame;
      this.requestRecalculation();
      this.requestedSeek = frame;
    }
  }

  /**
   * Whether the given frame is inside the animation range.
   *
   * @param frame - The frame to check.
   */
  public isInRange(frame: number): boolean {
    return frame >= 0 && frame <= this.playback.duration;
  }

  /**
   * Whether the given frame is inside the user-defined range.
   *
   * @param frame - The frame to check.
   */
  public isInUserRange(frame: number): boolean {
    return frame >= this.startFrame && frame <= this.endFrame;
  }

  public requestSeek(value: number): void {
    this.assertAlive('seek');
    this.requestedSeek = this.clampRange(value);
  }

  public requestPreviousFrame(): void {
    this.requestedSeek = this.frame.current - this.playback.speed;
  }

  public requestNextFrame(): void {
    this.requestedSeek = this.frame.current + this.playback.speed;
  }

  public requestReset(): void {
    this.assertAlive('reset');
    this.requestedSeek = 0;
  }

  public requestRender(): void {
    this.assertAlive('render');
    this.requestedRender = true;
  }

  public toggleLoop(value = !this.playerState.current.loop) {
    if (value !== this.playerState.current.loop) {
      this.playerState.current = {
        ...this.playerState.current,
        loop: value,
      };
    }
  }

  public togglePlayback(
    value: boolean = this.playerState.current.paused,
  ): void {
    this.assertAlive('change playback');
    // Ensure the AudioContext is resumed by user interaction.
    this.audioPool.resume();

    if (value === this.playerState.current.paused) {
      this.playerState.current = {
        ...this.playerState.current,
        paused: !value,
      };

      // hitting play after the animation has finished should reset the
      // playback, even if looping is disabled.
      if (
        value &&
        !this.playerState.current.loop &&
        this.playback.frame === this.playback.duration
      ) {
        this.requestReset();
      }
    }
  }

  public toggleAudio(value: boolean = this.playerState.current.muted): void {
    if (value === this.playerState.current.muted) {
      this.playerState.current = {
        ...this.playerState.current,
        muted: !value,
      };
    }
  }

  public setAudioVolume(value: number): void {
    const clampedValue = clamp(0, 1, value);
    if (clampedValue !== this.playerState.current.volume) {
      this.playerState.current = {
        ...this.playerState.current,
        volume: clampedValue,
      };
    }
  }

  public addAudioVolume(value: number): void {
    this.setAudioVolume(this.playerState.current.volume + value);
  }

  public setSpeed(value: number) {
    if (value !== this.playerState.current.speed) {
      this.playback.speed = value;
      this.playback.reload();
      this.playerState.current = {
        ...this.playerState.current,
        speed: value,
      };
      this.requestRecalculation();
    }
  }

  public setVariables(variables: Record<string, unknown>) {
    for (const scene of this.playback.onScenesRecalculated.current) {
      scene.variables.updateSignals(variables);
    }
  }

  /**
   * Activate the player.
   *
   * @remarks
   * A player needs to be active in order for the update loop to run. Each
   * player is active by default.
   */
  public activate() {
    this.assertAlive('activate');
    this.active = true;
    this.request();
  }

  /**
   * Deactivate the player.
   *
   * @remarks
   * Deactivating the player prevents its update loop from running. This should
   * be done before disposing the player, to prevent it from running in the
   * background.
   *
   * Just pausing the player does not stop the loop.
   */
  public deactivate() {
    this.stopScheduling();
    this.sharedWebGLContext.dispose();
  }

  /**
   * Suspend the update loop without releasing any runtime resources.
   *
   * @remarks
   * Sleeping is non-destructive: the scene graph, caches, audio context and
   * shared WebGL context are all retained, so {@link wake} resumes exactly
   * where the player left off. A sleeping player performs no
   * `requestAnimationFrame` work at all.
   *
   * This is the counterpart of {@link deactivate}, which additionally
   * destroys the shared WebGL context and therefore cannot be resumed without
   * rebuilding GPU resources.
   */
  public sleep() {
    if (this.disposed) return;
    this.stopScheduling();
  }

  /**
   * Resume the update loop suspended by {@link sleep}.
   *
   * @remarks
   * Waking re-enters the loop against the retained runtime state. It is the
   * host's job to decide *why* the player woke - a dirty visual dependency, a
   * presentation step, an explicit seek or render, or a host resize.
   */
  public wake() {
    this.activate();
  }

  /**
   * Stop the update loop and cancel any frame already requested.
   *
   * @remarks
   * Scheduling is the only thing this releases; it owns no resources.
   */
  /**
   * Permanently release every resource this player owns.
   *
   * @remarks
   * Terminal and idempotent. Disposal becomes *visible* before anything is
   * destroyed - `disposed` is set and the lifecycle token bumped first - so
   * that work already queued behind an `await` observes a dead runtime and
   * fails closed instead of touching released resources.
   *
   * Ordering: mark disposed, stop scheduling, release external
   * subscriptions, release media, dispose owned scenes, release the shared
   * WebGL context, then empty the player's own dispatchers.
   */
  public dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.lifecycle++;

    this.stopScheduling();
    for (const dispose of this.disposers.splice(0)) dispose();

    this.render.clear();
    this.audio.dispose();
    this.audioPool.dispose();
    this.audioResources.dispose();
    for (const scene of this.scenes.splice(0)) scene.dispose();
    this.sharedWebGLContext.dispose();

    this.recalculated.clear();
    this.playerState.clear();
    this.frame.clear();
    this.duration.clear();
  }

  /**
   * Whether this player has been terminally disposed.
   */
  public isDisposed(): boolean {
    return this.disposed;
  }

  private stopScheduling() {
    this.active = false;
    if (this.requestId !== null) {
      cancelAnimationFrame(this.requestId);
      this.requestId = null;
    }
  }

  private assertAlive(operation: string) {
    if (this.disposed) {
      throw new Error(`Cannot ${operation} on a disposed Player.`);
    }
  }

  private requestRecalculation() {
    this.requestedRecalculation = true;
    this.request();
  }

  /**
   * @param lifecycle - The lifecycle token captured when this run was
   *                    scheduled, re-checked after every await.
   */
  private async prepare(
    lifecycle: number,
  ): Promise<PlayerState & {seek: number; render: boolean}> {
    const state = {
      ...this.playerState.current,
      seek: this.requestedSeek,
      render: this.requestedRender,
    };
    this.requestedSeek = -1;
    this.requestedRender = false;

    // Recalculate the project if necessary
    if (this.requestedRecalculation) {
      if (state.seek < 0) {
        state.seek = this.playback.frame;
      }
      try {
        await this.playback.recalculate();
        if (this.isStale(lifecycle)) return state;
        this.duration.current = this.playback.frame;

        const sounds: Sound[] = [];
        for (const scene of this.playback.onScenesRecalculated.current) {
          sounds.push(...scene.sounds.getSounds());
        }
        await this.audioPool.setupPool(sounds);
        if (this.isStale(lifecycle)) return state;

        this.recalculated.dispatch();
      } catch (e) {
        this.requestSeek(state.seek);
        throw e;
      } finally {
        this.requestedRecalculation = false;
      }
    }

    // Pause if reached the end or the range is 0
    // Seek to the beginning for non-empty scenes
    if (
      (!state.loop && this.finished && !state.paused && state.seek < 0) ||
      this.endFrame === this.startFrame
    ) {
      this.togglePlayback(false);
      state.paused = true;
      state.seek =
        this.endFrame === this.startFrame ? state.seek : this.startFrame;
    }

    // Seek to the beginning if looping is enabled
    if (
      state.loop &&
      (state.seek > this.endFrame || (this.finished && !state.paused)) &&
      this.startFrame !== this.endTime
    ) {
      state.seek = this.startFrame;
    }

    // Pause / play sounds.
    this.audioPool.prepare(this.status.time);
    await this.audioPool.setPaused(state.paused || this.finished);
    if (this.isStale(lifecycle)) return state;
    this.audioPool.setMuted(state.muted);
    this.audioPool.setVolume(state.volume);

    // Pause / play audio.
    const audioPaused =
      state.paused || this.finished || !this.audio.isInRange(this.status.time);
    const audioStarted = await this.audio.setPaused(audioPaused);
    if (this.isStale(lifecycle)) return state;
    if (audioStarted) {
      this.syncAudio(-3);
    }
    this.audio.setMuted(state.muted);
    this.audio.setVolume(state.volume);

    return state;
  }

  /**
   * @param lifecycle - The lifecycle token captured when this run was
   *                    scheduled. Every resumption point re-checks it so that
   *                    a run interrupted by disposal aborts instead of
   *                    touching released resources.
   */
  private async run(lifecycle: number) {
    const state = await this.prepare(lifecycle);
    if (this.isStale(lifecycle)) return;
    const previousState = this.playback.state;
    this.playback.state = state.paused
      ? PlaybackState.Paused
      : PlaybackState.Playing;

    // Seek to the given frame
    if (state.seek >= 0 || !this.isInUserRange(this.status.frame)) {
      const seekFrame = state.seek < 0 ? this.status.frame : state.seek;
      const clampedFrame = this.clampRange(seekFrame);
      this.logger.profile('seek time');
      await this.playback.seek(clampedFrame);
      if (this.isStale(lifecycle)) return;
      this.logger.profile('seek time');
      this.syncAudio(-3);
    }
    // Do nothing if paused or is ahead of the audio.
    else if (
      state.paused ||
      (state.speed === 1 &&
        this.audio.isReady() &&
        this.audio.isInRange(this.status.time) &&
        this.audio.getTime() < this.status.time)
    ) {
      if (
        state.render ||
        (state.paused && previousState !== PlaybackState.Paused)
      ) {
        await this.render.dispatch();
        if (this.isStale(lifecycle)) return;
      }

      // Sync the audio if the animation is too far ahead.
      if (
        !state.paused &&
        this.status.time > this.audio.getTime() + MAX_AUDIO_DESYNC
      ) {
        this.syncAudio();
      }

      this.request();
      return;
    }
    // Seek to synchronize animation with audio.
    else if (
      this.audio.isReady() &&
      state.speed === 1 &&
      this.audio.isInRange(this.status.time) &&
      this.status.framesToSeconds(this.playback.frame + 1) <
        this.audio.getTime() - MAX_AUDIO_DESYNC
    ) {
      const seekFrame = this.status.secondsToFrames(this.audio.getTime());
      await this.playback.seek(seekFrame);
      if (this.isStale(lifecycle)) return;
    }
    // Simply move forward one frame
    else if (this.status.frame < this.endFrame) {
      await this.playback.progress();
      if (this.isStale(lifecycle)) return;

      if (state.speed !== 1) {
        this.syncAudio();
      }
    }

    // Pause if a new slide has just started.
    if (!state.paused && this.playback.currentScene.slides.isWaiting()) {
      this.togglePlayback(false);
      state.paused = true;
    }

    // Draw the project
    await this.render.dispatch();
    if (this.isStale(lifecycle)) return;
    this.frame.current = this.playback.frame;

    this.request();
  }

  private request() {
    if (!this.active || this.disposed) return;

    const lifecycle = this.lifecycle;
    this.requestId ??= requestAnimationFrame(async time => {
      this.requestId = null;
      if (!this.active || this.isStale(lifecycle)) return;
      if (time - this.renderTime >= 1000 / (this.status.fps + 5)) {
        this.renderTime = time;
        await this.lock.acquire();
        try {
          await this.run(lifecycle);
        } catch (e: any) {
          this.logger.error(e);
        }
        this.lock.release();
      } else {
        this.request();
      }
    });
  }

  /**
   * Whether the runtime that scheduled this work has since been disposed or
   * replaced.
   */
  private isStale(lifecycle: number) {
    return this.disposed || lifecycle !== this.lifecycle;
  }

  public clampRange(frame: number): number {
    return clamp(this.startFrame, this.endFrame, frame);
  }

  private syncAudio(frameOffset = 0) {
    const time = this.status.framesToSeconds(this.playback.frame + frameOffset);
    this.audio.setTime(time);

    this.audioPool.prepare(time);
    this.audioPool.setTime(time);
  }
}
