/**
 * An entity capable of being faded in or out during a visual transition.
 */
export interface TransitionTarget {
  opacity: number;
  play?(): void;
}

export interface TransitionDriverOptions {
  /** Duration of crossfade in milliseconds. Default: 300ms. */
  readonly durationMs?: number;
  readonly requestAnimationFrame?: (callback: (time: number) => void) => number;
  readonly cancelAnimationFrame?: (handle: number) => void;
  readonly now?: () => number;
}

const DEFAULT_RAF = (cb: (time: number) => void) => {
  if (typeof requestAnimationFrame !== 'undefined') {
    return requestAnimationFrame(cb);
  }
  return setTimeout(() => cb(Date.now()), 16) as unknown as number;
};

const DEFAULT_CAF = (handle: number) => {
  if (typeof cancelAnimationFrame !== 'undefined') {
    cancelAnimationFrame(handle);
  } else {
    clearTimeout(handle as unknown as NodeJS.Timeout);
  }
};

const DEFAULT_NOW = () =>
  typeof performance !== 'undefined' ? performance.now() : Date.now();

/**
 * Coordinates smooth visual crossfades between outgoing and incoming presentations.
 *
 * @remarks
 * Encapsulates the visual transition lifecycle:
 * - Ramps incoming presentation opacity from 0 to 1 while ramping outgoing from 1 to 0.
 * - Supports instant cuts when `durationMs <= 0` or when there is no outgoing presentation.
 * - Handles mid-flight interruptions deterministically: if a new transition begins while
 *   a prior crossfade is running, the prior transition is canceled cleanly, the old
 *   outgoing presentation is retired with opacity 0, and the new transition takes over
 *   without ghosting, opacity leaks, or orphaned timers.
 */
export class TransitionDriver {
  private readonly durationMs: number;
  private readonly raf: (cb: (time: number) => void) => number;
  private readonly caf: (handle: number) => void;
  private readonly now: () => number;

  private activeHandle: number | null = null;
  private currentIncoming: TransitionTarget | null = null;
  private currentOutgoing: TransitionTarget | null = null;
  private currentOnComplete: (() => void) | null = null;
  private disposed = false;

  public constructor(options: TransitionDriverOptions = {}) {
    this.durationMs = options.durationMs ?? 300;
    this.raf = options.requestAnimationFrame ?? DEFAULT_RAF;
    this.caf = options.cancelAnimationFrame ?? DEFAULT_CAF;
    this.now = options.now ?? DEFAULT_NOW;
  }

  public get isTransitioning(): boolean {
    return this.activeHandle !== null;
  }

  public get duration(): number {
    return this.durationMs;
  }

  /**
   * Start a crossfade transition from `outgoing` to `incoming`.
   *
   * @param incoming - Presentation to fade in.
   * @param outgoing - Presentation to fade out, or null if first beat.
   * @param onComplete - Called when the crossfade completes and outgoing can be retired.
   */
  public startTransition(
    incoming: TransitionTarget,
    outgoing: TransitionTarget | null,
    onComplete?: () => void,
  ): void {
    if (this.disposed) {
      incoming.opacity = 1;
      incoming.play?.();
      onComplete?.();
      return;
    }

    // If an animation is currently running, interrupt it cleanly
    if (this.isTransitioning) {
      this.interruptActiveTransition();
    }

    // Instant swap if no outgoing beat or duration <= 0
    if (!outgoing || this.durationMs <= 0) {
      incoming.opacity = 1;
      incoming.play?.();
      if (outgoing) {
        outgoing.opacity = 0;
      }
      onComplete?.();
      return;
    }

    this.currentIncoming = incoming;
    this.currentOutgoing = outgoing;
    this.currentOnComplete = onComplete ?? null;

    incoming.opacity = 0;
    outgoing.opacity = 1;
    incoming.play?.();

    const startTime = this.now();

    const step = () => {
      if (this.disposed || !this.currentIncoming || !this.currentOutgoing) {
        this.activeHandle = null;
        return;
      }

      const elapsed = this.now() - startTime;
      const progress = Math.min(1, Math.max(0, elapsed / this.durationMs));

      this.currentIncoming.opacity = Number(progress.toFixed(4));
      this.currentOutgoing.opacity = Number((1 - progress).toFixed(4));

      if (progress >= 1) {
        this.currentIncoming.opacity = 1;
        this.currentOutgoing.opacity = 0;
        const cb = this.currentOnComplete;
        this.activeHandle = null;
        this.currentIncoming = null;
        this.currentOutgoing = null;
        this.currentOnComplete = null;
        cb?.();
      } else {
        this.activeHandle = this.raf(step);
      }
    };

    this.activeHandle = this.raf(step);
  }

  /**
   * Interrupt whatever crossfade is running mid-flight.
   */
  public interruptActiveTransition(): void {
    if (this.activeHandle !== null) {
      this.caf(this.activeHandle);
      this.activeHandle = null;
    }

    if (this.currentIncoming) {
      this.currentIncoming.opacity = 1;
    }
    if (this.currentOutgoing) {
      this.currentOutgoing.opacity = 0;
    }

    const previousCallback = this.currentOnComplete;
    this.currentIncoming = null;
    this.currentOutgoing = null;
    this.currentOnComplete = null;

    previousCallback?.();
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.interruptActiveTransition();
  }
}
