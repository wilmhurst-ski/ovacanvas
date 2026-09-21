import {theme} from '@ovacanvas/2d/lib/theme/theme';
import type {BeatPresentation} from './BeatPresentation';

export interface BeatScrubberOptions {
  /** Optional custom CSS class name for the scrubber container. */
  readonly className?: string;
  /** Initial presentation to attach to. */
  readonly presentation?: BeatPresentation | null;
  /** Whether to show time label next to the scrubber track. Defaults to true. */
  readonly showTimeLabel?: boolean;
}

export interface ScrubberState {
  readonly isDragging: boolean;
  readonly progressRatio: number;
  readonly currentFrame: number;
  readonly duration: number;
}

/**
 * Timeline scrubber interactivity primitive.
 *
 * @remarks
 * Grounded in Bret Victor's Explorable Explanations research: gives the learner
 * interactive control of time via a draggable handle on a horizontal track.
 *
 * Drives the identical real seek mechanism used by the playback loop
 * (`player.requestSeek(frame)`), with zero duplicate or parallel rendering paths.
 * Pauses autoplay while the learner actively drags the handle, and resumes
 * playback from the scrubbed position upon release.
 */
export class BeatScrubber {
  public readonly element: HTMLElement;
  public readonly trackElement: HTMLElement;
  public readonly fillElement: HTMLElement;
  public readonly handleElement: HTMLElement;
  public readonly timeElement: HTMLElement | null = null;
  public readonly currentTimeElement: HTMLElement | null = null;
  public readonly durationTimeElement: HTMLElement | null = null;

  private presentation: BeatPresentation | null = null;
  private isDragging = false;
  private scrubFrame: number | null = null;
  private wasPlayingBeforeDrag = false;
  private disposers: Array<() => void> = [];
  private playerSubscription: (() => void) | null = null;
  private disposed = false;

  public constructor(
    container: HTMLElement,
    options: BeatScrubberOptions = {},
  ) {
    const currentTheme = theme();

    this.element = document.createElement('div');
    this.element.className = options.className
      ? `ovc-scrubber ${options.className}`
      : 'ovc-scrubber';
    this.applyBaseStyles(this.element, {
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      width: '100%',
      maxWidth: '960px',
      padding: '8px 16px',
      boxSizing: 'border-box',
      userSelect: 'none',
    });

    // Horizontal track
    this.trackElement = document.createElement('div');
    this.trackElement.className = 'ovc-scrubber-track';
    this.applyBaseStyles(this.trackElement, {
      position: 'relative',
      flex: '1',
      height: '8px',
      backgroundColor: currentTheme.hairline,
      borderRadius: '4px',
      cursor: 'pointer',
      touchAction: 'none',
    });

    // Filled progress bar
    this.fillElement = document.createElement('div');
    this.fillElement.className = 'ovc-scrubber-fill';
    this.applyBaseStyles(this.fillElement, {
      position: 'absolute',
      top: '0',
      left: '0',
      height: '100%',
      width: '0%',
      backgroundColor: currentTheme.blue,
      borderRadius: '4px',
      pointerEvents: 'none',
    });

    // Draggable handle
    this.handleElement = document.createElement('div');
    this.handleElement.className = 'ovc-scrubber-handle';
    this.handleElement.setAttribute('role', 'slider');
    this.handleElement.setAttribute('tabindex', '0');
    this.handleElement.setAttribute('aria-label', 'Timeline scrubber');
    this.handleElement.setAttribute('aria-valuemin', '0');
    this.handleElement.setAttribute('aria-valuemax', '100');
    this.handleElement.setAttribute('aria-valuenow', '0');
    this.applyBaseStyles(this.handleElement, {
      position: 'absolute',
      top: '50%',
      left: '0%',
      width: '18px',
      height: '18px',
      backgroundColor: currentTheme.clearField,
      border: `2px solid ${currentTheme.blue}`,
      borderRadius: '50%',
      transform: 'translate(-50%, -50%)',
      cursor: 'grab',
      outline: 'none',
      boxShadow: '0 1px 4px rgba(0, 0, 0, 0.25)',
      boxSizing: 'border-box',
    });

    this.trackElement.append(this.fillElement, this.handleElement);
    this.element.append(this.trackElement);

    if (options.showTimeLabel ?? true) {
      this.timeElement = document.createElement('div');
      this.timeElement.className = 'ovc-scrubber-time';
      this.applyBaseStyles(this.timeElement, {
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: '12px',
        color: currentTheme.secondaryInk,
        minWidth: '70px',
        textAlign: 'right',
      });

      this.currentTimeElement = document.createElement('span');
      this.currentTimeElement.className = 'ovc-scrubber-current';
      this.currentTimeElement.textContent = '0:00';

      const separator = document.createTextNode(' / ');

      this.durationTimeElement = document.createElement('span');
      this.durationTimeElement.className = 'ovc-scrubber-duration';
      this.durationTimeElement.textContent = '0:00';

      this.timeElement.append(
        this.currentTimeElement,
        separator,
        this.durationTimeElement,
      );
      this.element.append(this.timeElement);
    }

    container.append(this.element);
    this.setupEvents();

    if (options.presentation) {
      this.attach(options.presentation);
    }
  }

  public get isScrubbing(): boolean {
    return this.isDragging;
  }

  public getState(): ScrubberState {
    const duration = this.presentation?.player.playback.duration ?? 0;
    const currentFrame =
      this.isDragging && this.scrubFrame !== null
        ? this.scrubFrame
        : (this.presentation?.player.playback.frame ?? 0);
    const progressRatio = duration > 0 ? currentFrame / duration : 0;
    return {
      isDragging: this.isDragging,
      progressRatio,
      currentFrame,
      duration,
    };
  }

  /**
   * Bind the scrubber to an active beat presentation.
   */
  public attach(presentation: BeatPresentation | null): void {
    if (this.playerSubscription) {
      this.playerSubscription();
      this.playerSubscription = null;
    }

    this.presentation = presentation;
    if (!presentation) {
      this.updateVisual(0, 0);
      return;
    }

    // Subscribe to player render events to advance scrubber during playback
    const unsub = presentation.player.onRender.subscribe(async () => {
      if (!this.isDragging && !this.disposed) {
        const frame = presentation.player.playback.frame;
        const duration = presentation.player.playback.duration;
        this.updateVisual(frame, duration);
      }
    });

    this.playerSubscription = () => {
      unsub();
    };

    const initialFrame = presentation.player.playback.frame;
    const duration = presentation.player.playback.duration;
    this.updateVisual(initialFrame, duration);
  }

  /**
   * Programmatically seek the scrubber and player to a normalized ratio [0, 1].
   */
  public seekToRatio(ratio: number): void {
    if (!this.presentation) return;
    const clamped = Math.max(0, Math.min(1, ratio));
    const duration = this.presentation.player.playback.duration;
    const targetFrame = Math.round(clamped * duration);
    this.presentation.seek(targetFrame);
    this.updateVisual(targetFrame, duration);
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.playerSubscription) {
      this.playerSubscription();
      this.playerSubscription = null;
    }
    for (const d of this.disposers) {
      d();
    }
    this.disposers = [];
    this.element.remove();
  }

  private setupEvents(): void {
    // Pointer down starts dragging
    const onPointerDown = (event: PointerEvent | MouseEvent) => {
      if (this.disposed || !this.presentation) return;
      this.isDragging = true;
      this.handleElement.style.cursor = 'grabbing';
      this.wasPlayingBeforeDrag = this.presentation.isPlaying;

      if (this.wasPlayingBeforeDrag) {
        this.presentation.pause();
      }

      const pointerId = (event as PointerEvent).pointerId;
      if (
        pointerId !== undefined &&
        typeof this.trackElement.setPointerCapture === 'function'
      ) {
        try {
          this.trackElement.setPointerCapture(pointerId);
        } catch {
          // Ignored if capture unsupported
        }
      }

      this.handlePointerPosition(event.clientX);
      event.preventDefault();
    };

    const onPointerMove = (event: PointerEvent | MouseEvent) => {
      if (!this.isDragging || this.disposed || !this.presentation) return;
      this.handlePointerPosition(event.clientX);
      event.preventDefault();
    };

    const onPointerUp = (event: PointerEvent | MouseEvent) => {
      if (!this.isDragging || this.disposed) return;
      this.isDragging = false;
      this.scrubFrame = null;
      this.handleElement.style.cursor = 'grab';

      const pointerId = (event as PointerEvent).pointerId;
      if (
        pointerId !== undefined &&
        typeof this.trackElement.releasePointerCapture === 'function'
      ) {
        try {
          this.trackElement.releasePointerCapture(pointerId);
        } catch {
          // Ignored
        }
      }

      // If playback was active prior to scrubbing, resume playback seamlessly
      if (this.wasPlayingBeforeDrag && this.presentation) {
        this.presentation.play();
      }
      event.preventDefault();
    };

    this.trackElement.addEventListener(
      'pointerdown',
      onPointerDown as EventListener,
    );
    this.trackElement.addEventListener(
      'mousedown',
      onPointerDown as EventListener,
    );
    window.addEventListener('pointermove', onPointerMove as EventListener);
    window.addEventListener('mousemove', onPointerMove as EventListener);
    window.addEventListener('pointerup', onPointerUp as EventListener);
    window.addEventListener('mouseup', onPointerUp as EventListener);
    window.addEventListener('pointercancel', onPointerUp as EventListener);

    // Keyboard accessibility
    const onKeyDown = (event: KeyboardEvent) => {
      if (!this.presentation) return;
      const duration = this.presentation.player.playback.duration;
      const current = this.presentation.player.playback.frame;
      const fps = 30; // standard beat fps
      let targetFrame = current;

      if (event.key === 'ArrowLeft') {
        targetFrame = Math.max(0, current - fps * 0.5);
      } else if (event.key === 'ArrowRight') {
        targetFrame = Math.min(duration, current + fps * 0.5);
      } else if (event.key === 'Home') {
        targetFrame = 0;
      } else if (event.key === 'End') {
        targetFrame = duration;
      } else {
        return;
      }

      event.preventDefault();
      this.presentation.seek(targetFrame);
      this.updateVisual(targetFrame, duration);
    };

    this.handleElement.addEventListener('keydown', onKeyDown);

    this.disposers.push(() => {
      this.trackElement.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      this.handleElement.removeEventListener('keydown', onKeyDown);
    });
  }

  private handlePointerPosition(clientX: number): void {
    if (!this.presentation) return;
    const rect = this.trackElement.getBoundingClientRect();
    const width = rect.width;
    if (width <= 0) return;

    const offsetX = clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, offsetX / width));
    const duration = this.presentation.player.playback.duration;
    const targetFrame = Math.round(ratio * duration);
    this.scrubFrame = targetFrame;

    this.presentation.seek(targetFrame);
    this.updateVisual(targetFrame, duration);
  }

  private updateVisual(frame: number, duration: number): void {
    const ratio = duration > 0 ? Math.max(0, Math.min(1, frame / duration)) : 0;
    const percent = `${(ratio * 100).toFixed(2)}%`;

    this.fillElement.style.width = percent;
    this.handleElement.style.left = percent;
    this.handleElement.setAttribute(
      'aria-valuenow',
      String(Math.round(ratio * 100)),
    );
    this.handleElement.setAttribute('aria-valuemax', String(duration));

    if (this.currentTimeElement && this.durationTimeElement) {
      this.currentTimeElement.textContent = this.formatTime(frame);
      this.durationTimeElement.textContent = this.formatTime(duration);
    }
  }

  private formatTime(frame: number, fps = 30): string {
    const totalSeconds = Math.floor(frame / fps);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  private applyBaseStyles(
    element: HTMLElement,
    styles: Partial<CSSStyleDeclaration>,
  ): void {
    Object.assign(element.style, styles);
  }
}
