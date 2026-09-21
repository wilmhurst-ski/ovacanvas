import {describe, expect, it} from 'vitest';
import {TransitionDriver, type TransitionTarget} from './TransitionDriver';

function createMockTarget(
  initialOpacity = 1,
): TransitionTarget & {played: boolean} {
  return {
    opacity: initialOpacity,
    played: false,
    play() {
      this.played = true;
    },
  };
}

describe('TransitionDriver', () => {
  it('performs an immediate transition if outgoing is null', () => {
    const incoming = createMockTarget(0);
    const driver = new TransitionDriver({durationMs: 300});

    let completed = false;
    driver.startTransition(incoming, null, () => {
      completed = true;
    });

    expect(incoming.opacity).toBe(1);
    expect(incoming.played).toBe(true);
    expect(completed).toBe(true);
    expect(driver.isTransitioning).toBe(false);
  });

  it('performs an immediate transition if durationMs is 0', () => {
    const incoming = createMockTarget(0);
    const outgoing = createMockTarget(1);
    const driver = new TransitionDriver({durationMs: 0});

    let completed = false;
    driver.startTransition(incoming, outgoing, () => {
      completed = true;
    });

    expect(incoming.opacity).toBe(1);
    expect(outgoing.opacity).toBe(0);
    expect(completed).toBe(true);
    expect(driver.isTransitioning).toBe(false);
  });

  it('progressively steps opacities during crossfade and fires completion', () => {
    let currentTime = 1000;
    let scheduledCallback: ((time: number) => void) | null = null;
    let nextHandle = 1;

    const mockRaf = (cb: (time: number) => void) => {
      scheduledCallback = cb;
      return nextHandle++;
    };
    const mockCaf = () => {
      scheduledCallback = null;
    };
    const mockNow = () => currentTime;

    const driver = new TransitionDriver({
      durationMs: 300,
      requestAnimationFrame: mockRaf,
      cancelAnimationFrame: mockCaf,
      now: mockNow,
    });

    const incoming = createMockTarget(0);
    const outgoing = createMockTarget(1);
    let completed = false;

    driver.startTransition(incoming, outgoing, () => {
      completed = true;
    });

    expect(driver.isTransitioning).toBe(true);
    expect(incoming.opacity).toBe(0);
    expect(outgoing.opacity).toBe(1);
    expect(incoming.played).toBe(true);

    // Advance halfway (150ms)
    currentTime += 150;
    scheduledCallback?.(currentTime);

    expect(incoming.opacity).toBe(0.5);
    expect(outgoing.opacity).toBe(0.5);
    expect(completed).toBe(false);
    expect(driver.isTransitioning).toBe(true);

    // Advance past end (300ms)
    currentTime += 150;
    scheduledCallback?.(currentTime);

    expect(incoming.opacity).toBe(1);
    expect(outgoing.opacity).toBe(0);
    expect(completed).toBe(true);
    expect(driver.isTransitioning).toBe(false);
  });

  it('handles mid-flight interruption deterministically without leaking or ghosting', () => {
    let currentTime = 1000;
    let scheduledCallback: ((time: number) => void) | null = null;
    let nextHandle = 1;

    const mockRaf = (cb: (time: number) => void) => {
      scheduledCallback = cb;
      return nextHandle++;
    };
    const mockCaf = () => {
      scheduledCallback = null;
    };

    const driver = new TransitionDriver({
      durationMs: 300,
      requestAnimationFrame: mockRaf,
      cancelAnimationFrame: mockCaf,
      now: () => currentTime,
    });

    const beatA = createMockTarget(1);
    const beatB = createMockTarget(0);
    let firstCompleted = false;

    // Start transition from A to B
    driver.startTransition(beatB, beatA, () => {
      firstCompleted = true;
    });

    // Advance 100ms
    currentTime += 100;
    scheduledCallback?.(currentTime);
    expect(beatB.opacity).toBeCloseTo(0.3333, 2);
    expect(beatA.opacity).toBeCloseTo(0.6667, 2);

    // Now, mid-flight interruption: beat C arrives!
    const beatC = createMockTarget(0);
    let secondCompleted = false;

    driver.startTransition(beatC, beatB, () => {
      secondCompleted = true;
    });

    // The first transition was interrupted: beat A was retired (opacity 0), beat B became 1, first callback fired
    expect(firstCompleted).toBe(true);
    expect(beatA.opacity).toBe(0);

    // New transition starts from B (outgoing) to C (incoming)
    expect(beatC.opacity).toBe(0);
    expect(beatB.opacity).toBe(1);
    expect(driver.isTransitioning).toBe(true);

    // Finish transition to C
    currentTime += 300;
    scheduledCallback?.(currentTime);

    expect(beatC.opacity).toBe(1);
    expect(beatB.opacity).toBe(0);
    expect(secondCompleted).toBe(true);
    expect(driver.isTransitioning).toBe(false);
  });

  it('cleans up active transitions on dispose', () => {
    let scheduledCallback: ((time: number) => void) | null = null;
    const driver = new TransitionDriver({
      durationMs: 300,
      requestAnimationFrame: cb => {
        scheduledCallback = cb;
        return 1;
      },
      cancelAnimationFrame: () => {
        scheduledCallback = null;
      },
    });

    const incoming = createMockTarget(0);
    const outgoing = createMockTarget(1);
    let completed = false;

    driver.startTransition(incoming, outgoing, () => {
      completed = true;
    });

    expect(driver.isTransitioning).toBe(true);
    expect(scheduledCallback).not.toBeNull();

    driver.dispose();

    expect(driver.isTransitioning).toBe(false);
    expect(scheduledCallback).toBeNull();
    expect(incoming.opacity).toBe(1);
    expect(outgoing.opacity).toBe(0);
    expect(completed).toBe(true);
  });
});
