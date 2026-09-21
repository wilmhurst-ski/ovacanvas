import {beforeEach, describe, expect, it, vi} from 'vitest';
import {BeatScrubber} from './BeatScrubber';

if (typeof globalThis.PointerEvent === 'undefined') {
  class PointerEvent extends MouseEvent {
    public pointerId: number;
    public constructor(
      type: string,
      dict: MouseEventInit & {pointerId?: number} = {},
    ) {
      super(type, dict);
      this.pointerId = dict.pointerId ?? 1;
    }
  }
  globalThis.PointerEvent =
    PointerEvent as unknown as typeof globalThis.PointerEvent;
}

function createMockPlayer() {
  let frame = 0;
  let duration = 180;
  let paused = true;
  const renderCallbacks: Array<() => void> = [];

  return {
    playback: {
      get frame() {
        return frame;
      },
      set frame(f: number) {
        frame = f;
      },
      get duration() {
        return duration;
      },
      set duration(d: number) {
        duration = d;
      },
    },
    onRender: {
      subscribe(cb: () => void) {
        renderCallbacks.push(cb);
        return () => {
          const idx = renderCallbacks.indexOf(cb);
          if (idx >= 0) renderCallbacks.splice(idx, 1);
        };
      },
    },
    requestSeek: vi.fn((f: number) => {
      frame = f;
    }),
    requestRender: vi.fn(),
    wake: vi.fn(),
    triggerRender() {
      for (const cb of [...renderCallbacks]) cb();
    },
    get isPaused() {
      return paused;
    },
    set isPaused(p: boolean) {
      paused = p;
    },
  };
}

function createMockPresentation(initialPlaying = true) {
  const player = createMockPlayer();
  let playing = initialPlaying;

  return {
    player,
    get isPlaying() {
      return playing;
    },
    play: vi.fn(() => {
      playing = true;
      player.isPaused = false;
    }),
    pause: vi.fn(() => {
      playing = false;
      player.isPaused = true;
    }),
    seek: vi.fn((frame: number) => {
      player.requestSeek(frame);
      player.requestRender();
      player.wake();
    }),
  } as unknown as import('./BeatPresentation').BeatPresentation;
}

describe('BeatScrubber timeline interactivity primitive', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    return () => {
      container.remove();
    };
  });

  it('renders a real DOM scrubber control with accessible ARIA slider semantics', () => {
    const scrubber = new BeatScrubber(container);

    expect(scrubber.element.parentElement).toBe(container);
    expect(scrubber.handleElement.getAttribute('role')).toBe('slider');
    expect(scrubber.handleElement.getAttribute('aria-label')).toBe(
      'Timeline scrubber',
    );
    expect(scrubber.handleElement.getAttribute('aria-valuemin')).toBe('0');
    expect(scrubber.handleElement.getAttribute('aria-valuenow')).toBe('0');

    expect(scrubber.timeElement).not.toBeNull();
    expect(scrubber.currentTimeElement?.textContent).toBe('0:00');
    expect(scrubber.durationTimeElement?.textContent).toBe('0:00');

    scrubber.dispose();
  });

  it('synchronizes track fill and handle position during active playback', () => {
    const presentation = createMockPresentation(true);
    const scrubber = new BeatScrubber(container, {presentation});

    const mockPlayer = presentation.player as unknown as ReturnType<
      typeof createMockPlayer
    >;

    // Advance frame to 90 out of 180 (50%)
    mockPlayer.playback.frame = 90;
    mockPlayer.playback.duration = 180;
    mockPlayer.triggerRender();

    const state = scrubber.getState();
    expect(state.currentFrame).toBe(90);
    expect(state.duration).toBe(180);
    expect(state.progressRatio).toBe(0.5);

    expect(scrubber.fillElement.style.width).toBe('50.00%');
    expect(scrubber.handleElement.style.left).toBe('50.00%');
    expect(scrubber.currentTimeElement?.textContent).toBe('0:03');
    expect(scrubber.durationTimeElement?.textContent).toBe('0:06');

    scrubber.dispose();
  });

  it('pauses autoplay during active scrubbing and resumes playback upon release', () => {
    const presentation = createMockPresentation(true);
    const scrubber = new BeatScrubber(container, {presentation});

    // Mock bounding client rect for track: width 200px from left: 100
    vi.spyOn(scrubber.trackElement, 'getBoundingClientRect').mockReturnValue({
      left: 100,
      width: 200,
      top: 0,
      bottom: 10,
      right: 300,
      height: 10,
      x: 100,
      y: 0,
      toJSON: () => {},
    });

    expect(presentation.isPlaying).toBe(true);

    // 1. Pointer down at clientX: 150 (25% along the track)
    scrubber.trackElement.dispatchEvent(
      new PointerEvent('pointerdown', {clientX: 150, pointerId: 1}),
    );

    expect(scrubber.isScrubbing).toBe(true);
    // Pauses autoplay while learner actively drags
    expect(presentation.pause).toHaveBeenCalledTimes(1);
    expect(presentation.seek).toHaveBeenCalledWith(45); // 25% of 180 = 45

    // 2. Pointer move to clientX: 200 (50% along the track)
    window.dispatchEvent(
      new PointerEvent('pointermove', {clientX: 200, pointerId: 1}),
    );
    expect(presentation.seek).toHaveBeenCalledWith(90); // 50% of 180 = 90

    // 3. Pointer up: release drag
    window.dispatchEvent(
      new PointerEvent('pointerup', {clientX: 200, pointerId: 1}),
    );
    expect(scrubber.isScrubbing).toBe(false);

    // Autoplay resumes seamlessly from the scrubbed position
    expect(presentation.play).toHaveBeenCalledTimes(1);

    scrubber.dispose();
  });

  it('supports programmatic seek via seekToRatio', () => {
    const presentation = createMockPresentation(false);
    const scrubber = new BeatScrubber(container, {presentation});

    scrubber.seekToRatio(0.75); // 75% of 180 = 135
    expect(presentation.seek).toHaveBeenCalledWith(135);

    const state = scrubber.getState();
    expect(state.progressRatio).toBe(0.75);
    expect(scrubber.fillElement.style.width).toBe('75.00%');

    scrubber.dispose();
  });

  it('supports keyboard navigation via arrow keys', () => {
    const presentation = createMockPresentation(false);
    const scrubber = new BeatScrubber(container, {presentation});

    const mockPlayer = presentation.player as unknown as ReturnType<
      typeof createMockPlayer
    >;
    mockPlayer.playback.frame = 30; // 1s
    mockPlayer.playback.duration = 180; // 6s

    // ArrowRight advances by 15 frames (0.5s)
    scrubber.handleElement.dispatchEvent(
      new KeyboardEvent('keydown', {key: 'ArrowRight', bubbles: true}),
    );
    expect(presentation.seek).toHaveBeenCalledWith(45);

    // ArrowLeft steps backward by 15 frames
    mockPlayer.playback.frame = 45;
    scrubber.handleElement.dispatchEvent(
      new KeyboardEvent('keydown', {key: 'ArrowLeft', bubbles: true}),
    );
    expect(presentation.seek).toHaveBeenCalledWith(30);

    // Home jumps to 0
    scrubber.handleElement.dispatchEvent(
      new KeyboardEvent('keydown', {key: 'Home', bubbles: true}),
    );
    expect(presentation.seek).toHaveBeenCalledWith(0);

    scrubber.dispose();
  });

  it('cleans up all subscriptions and removes DOM element on dispose', () => {
    const presentation = createMockPresentation(true);
    const scrubber = new BeatScrubber(container, {presentation});

    expect(container.contains(scrubber.element)).toBe(true);
    scrubber.dispose();
    expect(container.contains(scrubber.element)).toBe(false);
  });
});
