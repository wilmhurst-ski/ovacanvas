import {
  BBox,
  DependencyContext,
  PlaybackState,
  SerializedVector2,
  SignalValue,
  SimpleSignal,
  clamp,
  isReactive,
  useLogger,
  useThread,
} from '@ovacanvas/core';
import {computed, initial, nodeName, signal} from '../decorators';
import {DesiredLength} from '../partials';
import {drawImage} from '../utils';
import {Rect, RectProps} from './Rect';
import reactivePlaybackRate from './__logs__/reactive-playback-rate.md';

export interface VideoProps extends RectProps {
  /**
   * {@inheritDoc Video.src}
   */
  src?: SignalValue<string>;
  /**
   * {@inheritDoc Video.alpha}
   */
  alpha?: SignalValue<number>;
  /**
   * {@inheritDoc Video.smoothing}
   */
  smoothing?: SignalValue<boolean>;
  /**
   * {@inheritDoc Video.loop}
   */
  loop?: SignalValue<boolean>;
  /**
   * {@inheritDoc Video.playbackRate}
   */
  playbackRate?: number;
  /**
   * The starting time for this video in seconds.
   */
  time?: SignalValue<number>;
  play?: boolean;
}

@nodeName('Video')
export class Video extends Rect {
  /**
   * Video elements owned by *this node*, keyed by source.
   *
   * @remarks
   * Deliberately not a static pool. A process-global dictionary of media
   * elements outlives every runtime on the page: the elements, their decoder
   * threads and their buffered data are never released, and two runtimes
   * showing the same source silently share one element, so disposing either
   * one breaks the other.
   */
  private readonly resources = new Map<string, HTMLVideoElement>();

  /**
   * Settlers for media-event promises that are still pending, so that
   * disposal can resolve them instead of leaving awaiting work hanging.
   */
  private readonly pendingListeners = new Set<() => void>();

  private videoDisposed = false;

  /**
   * The source of this video.
   *
   * @example
   * Using a local video:
   * ```tsx
   * import video from './example.mp4';
   * // ...
   * view.add(<Video src={video} />)
   * ```
   * Loading an image from the internet:
   * ```tsx
   * view.add(<Video src="https://example.com/video.mp4" />)
   * ```
   */
  @signal()
  public declare readonly src: SimpleSignal<string, this>;

  /**
   * The alpha value of this video.
   *
   * @remarks
   * Unlike opacity, the alpha value affects only the video itself, leaving the
   * fill, stroke, and children intact.
   */
  @initial(1)
  @signal()
  public declare readonly alpha: SimpleSignal<number, this>;

  /**
   * Whether the video should be smoothed.
   *
   * @remarks
   * When disabled, the video will be scaled using the nearest neighbor
   * interpolation with no smoothing. The resulting video will appear pixelated.
   *
   * @defaultValue true
   */
  @initial(true)
  @signal()
  public declare readonly smoothing: SimpleSignal<boolean, this>;

  /**
   * Whether this video should loop upon reaching the end.
   */
  @initial(false)
  @signal()
  public declare readonly loop: SimpleSignal<boolean, this>;

  /**
   * The rate at which the video plays, as multiples of the normal speed.
   *
   * @defaultValue 1
   */
  @initial(1)
  @signal()
  public declare readonly playbackRate: SimpleSignal<number, this>;

  @initial(0)
  @signal()
  protected declare readonly time: SimpleSignal<number, this>;

  @initial(false)
  @signal()
  protected declare readonly playing: SimpleSignal<boolean, this>;

  private lastTime = -1;

  public constructor({play, ...props}: VideoProps) {
    super(props);
    if (play) {
      this.play();
    }
  }

  /**
   * {@inheritDoc Curve.completion}
   */
  public curveCompletion(): number {
    return super.completion();
  }

  public isPlaying(): boolean {
    return this.playing();
  }

  public getCurrentTime(): number {
    return this.clampTime(this.time());
  }

  public getDuration(): number {
    return this.video().duration;
  }

  protected override desiredSize(): SerializedVector2<DesiredLength> {
    const custom = super.desiredSize();
    if (custom.x === null && custom.y === null) {
      const image = this.video();
      return {
        x: image.videoWidth,
        y: image.videoHeight,
      };
    }

    return custom;
  }

  /**
   * The completion of this video in the range from 0 to 1.
   *
   * @remarks
   * To get the percentage of the stroke that's currently visible, use
   * {@link Video.curveCompletion} instead.
   */
  @computed()
  public override completion(): number {
    return this.clampTime(this.time()) / this.video().duration;
  }

  @computed()
  protected video(): HTMLVideoElement {
    if (this.videoDisposed) {
      throw new Error('Cannot acquire media from a disposed Video node.');
    }

    const src = this.src();
    let video = this.resources.get(src);
    if (!video) {
      video = document.createElement('video');
      video.src = src;
      this.resources.set(src, video);
    }

    if (video.readyState < 2) {
      DependencyContext.collectPromise(this.waitFor(video, 'canplay'));
    }

    return video;
  }

  @computed()
  protected seekedVideo(): HTMLVideoElement {
    const video = this.video();
    const time = this.clampTime(this.time());

    video.playbackRate = this.playbackRate();

    if (!video.paused) {
      video.pause();
    }

    if (this.lastTime === time) {
      return video;
    }

    this.setCurrentTime(time);

    return video;
  }

  @computed()
  protected fastSeekedVideo(): HTMLVideoElement {
    const video = this.video();
    const time = this.clampTime(this.time());

    video.playbackRate = this.playbackRate();

    if (this.lastTime === time) {
      return video;
    }

    const playing =
      this.playing() && time < video.duration && video.playbackRate > 0;
    if (playing) {
      if (video.paused) {
        DependencyContext.collectPromise(video.play());
      }
    } else {
      if (!video.paused) {
        video.pause();
      }
    }

    if (Math.abs(video.currentTime - time) > 0.2) {
      this.setCurrentTime(time);
    } else if (!playing) {
      video.currentTime = time;
    }

    return video;
  }

  protected override draw(context: CanvasRenderingContext2D) {
    this.drawShape(context);
    const alpha = this.alpha();
    if (alpha > 0) {
      const playbackState = this.view().playbackState();
      const video =
        playbackState === PlaybackState.Playing ||
        playbackState === PlaybackState.Presenting
          ? this.fastSeekedVideo()
          : this.seekedVideo();

      const box = BBox.fromSizeCentered(this.computedSize());
      context.save();
      context.clip(this.getPath());
      if (alpha < 1) {
        context.globalAlpha *= alpha;
      }
      context.imageSmoothingEnabled = this.smoothing();
      drawImage(context, video, box);
      context.restore();
    }

    if (this.clip()) {
      context.clip(this.getPath());
    }

    this.drawChildren(context);
  }

  protected override applyFlex() {
    super.applyFlex();
    const video = this.video();
    this.element.style.aspectRatio = (
      this.ratio() ?? video.videoWidth / video.videoHeight
    ).toString();
  }

  protected setCurrentTime(value: number) {
    const video = this.video();
    if (video.readyState < 2) return;

    video.currentTime = value;
    this.lastTime = value;
    if (video.seeking) {
      DependencyContext.collectPromise(this.waitFor(video, 'seeked'));
    }
  }

  protected setPlaybackRate(playbackRate: number) {
    let value: number;
    if (isReactive(playbackRate)) {
      value = playbackRate();
      useLogger().warn({
        message: 'Invalid value set as the playback rate',
        remarks: reactivePlaybackRate,
        inspect: this.key,
        stack: new Error().stack,
      });
    } else {
      value = playbackRate;
    }
    this.playbackRate.context.setter(value);

    if (this.playing()) {
      if (value === 0) {
        this.pause();
      } else {
        const time = useThread().time;
        const start = time();
        const offset = this.time();
        this.time(() => this.clampTime(offset + (time() - start) * value));
      }
    }
  }

  public play() {
    const time = useThread().time;
    const start = time();
    const offset = this.time();
    const playbackRate = this.playbackRate();
    this.playing(true);
    this.time(() => this.clampTime(offset + (time() - start) * playbackRate));
  }

  public pause() {
    this.playing(false);
    this.time.save();
    this.video().pause();
  }

  public seek(time: number) {
    const playing = this.playing();
    this.time(this.clampTime(time));
    if (playing) {
      this.play();
    } else {
      this.pause();
    }
  }

  public clampTime(time: number): number {
    const duration = this.video().duration;
    if (this.loop()) {
      time %= duration;
    }
    return clamp(0, duration, time);
  }

  protected override collectAsyncResources() {
    super.collectAsyncResources();
    this.seekedVideo();
  }

  /**
   * Terminally release every video element owned by this node.
   *
   * @remarks
   * Pending media-event promises are settled first so that nothing stays
   * awaiting a listener that is about to be removed. `removeAttribute('src')`
   * followed by `load()` is the documented way to make the browser tear down
   * the decoder and release buffered data.
   */
  public override dispose() {
    if (this.videoDisposed) {
      super.dispose();
      return;
    }
    this.videoDisposed = true;

    for (const settle of [...this.pendingListeners]) settle();
    this.pendingListeners.clear();

    for (const video of this.resources.values()) {
      video.pause();
      video.removeAttribute('src');
      video.load();
    }
    this.resources.clear();

    super.dispose();
  }

  /**
   * Await a media event, tracking the settler so disposal can release it.
   */
  private waitFor(video: HTMLVideoElement, event: string): Promise<void> {
    return new Promise<void>(resolve => {
      let settled = false;
      const settle = () => {
        if (settled) return;
        settled = true;
        video.removeEventListener(event, settle);
        this.pendingListeners.delete(settle);
        resolve();
      };
      this.pendingListeners.add(settle);
      video.addEventListener(event, settle);
    });
  }
}
