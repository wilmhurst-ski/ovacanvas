/**
 * Timing instrumentation for one learner interaction.
 *
 * @remarks
 * The MVP bar names a specific number - time to first visual, 4s soft and 8s
 * hard - and says explicitly to *instrument* it rather than estimate it. This
 * is that instrument. Until it existed, the only latency figure anywhere in
 * this project was the authoring round trip in the corpus, which is one of
 * several stages a learner actually waits through and not the one they
 * experience first.
 *
 * Two properties worth stating, because they are what make the numbers mean
 * something:
 *
 * - **It measures from the learner's clock.** `start()` is called when the
 *   question is submitted, not when a request is sent. A stage that is fast
 *   server-side but slow to reach the screen is exactly the thing this exists
 *   to catch.
 * - **It keeps every sample, not just the last.** A single interaction's
 *   timings say nothing about the product; `summary()` reports percentiles
 *   across everything recorded, which is the only form in which "fast enough"
 *   is a real claim.
 */

export interface StageSample {
  readonly stage: string;
  readonly ms: number;
}

export interface StagePercentiles {
  readonly samples: number;
  readonly p50: number;
  readonly p90: number;
  readonly max: number;
}

export interface TelemetrySummary {
  /** The most recent value recorded for each stage, in the order recorded. */
  readonly latest: readonly StageSample[];
  readonly percentiles: Readonly<Record<string, StagePercentiles>>;
}

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(fraction * sorted.length) - 1),
  );
  return sorted[index];
}

/** Round to whole milliseconds: sub-millisecond precision here is noise. */
function round(ms: number): number {
  return Math.round(ms);
}

export class RunTelemetry {
  private readonly open = new Map<string, number>();
  private readonly recorded = new Map<string, number[]>();
  private readonly order: string[] = [];

  /** Begin timing a stage. Re-starting an open stage discards the earlier start. */
  public start(stage: string, at: number = performance.now()): void {
    this.open.set(stage, at);
  }

  /**
   * Finish a stage and record how long it took.
   *
   * @remarks
   * Returns the elapsed time so a caller can log or assert on it directly, and
   * returns `0` for a stage that was never started rather than throwing -
   * timing must never be the reason a learner's beat fails to appear.
   */
  public finish(stage: string, at: number = performance.now()): number {
    const startedAt = this.open.get(stage);
    if (startedAt === undefined) return 0;
    this.open.delete(stage);
    const ms = at - startedAt;
    this.record(stage, ms);
    return ms;
  }

  /** Record an already-measured duration, for a stage timed elsewhere. */
  public record(stage: string, ms: number): void {
    if (!this.recorded.has(stage)) {
      this.recorded.set(stage, []);
      this.order.push(stage);
    }
    this.recorded.get(stage)!.push(ms);
  }

  /**
   * The most recent value for one stage, or `null` if it was never recorded.
   *
   * @remarks
   * Rounded the same way `summary()` rounds, so a number read here and the
   * same number read from a report never disagree by a fraction of a
   * millisecond and send someone looking for a bug that is not there.
   */
  public latest(stage: string): number | null {
    const samples = this.recorded.get(stage);
    if (!samples || samples.length === 0) return null;
    return round(samples[samples.length - 1]);
  }

  public summary(): TelemetrySummary {
    const latest: StageSample[] = [];
    const percentiles: Record<string, StagePercentiles> = {};

    for (const stage of this.order) {
      const samples = this.recorded.get(stage)!;
      const sorted = [...samples].sort((a, b) => a - b);
      latest.push({stage, ms: round(sorted[sorted.length - 1])});
      percentiles[stage] = {
        samples: sorted.length,
        p50: round(percentile(sorted, 0.5)),
        p90: round(percentile(sorted, 0.9)),
        max: round(sorted[sorted.length - 1]),
      };
    }

    return {latest, percentiles};
  }

  public reset(): void {
    this.open.clear();
    this.recorded.clear();
    this.order.length = 0;
  }
}

/**
 * The stage names this product measures, in the order a learner waits through
 * them.
 *
 * @remarks
 * Exported as constants rather than written as string literals at each call
 * site, because a typo in a stage name produces a silently missing row rather
 * than an error - and a latency report that quietly omits its most important
 * stage is worse than no report.
 */
export const STAGE = {
  /** Question submitted -\> the host-authored opener beat is on screen. */
  openerVisible: 'opener-visible',
  /** Question submitted -\> the authored beat has been asked for. */
  authoring: 'authoring',
  /** Authoring reply -\> the compiled module has resolved into a beat. */
  resolve: 'resolve',
  /** Resolve -\> the beat passed its audit and was activated. */
  stageAndAudit: 'stage-and-audit',
  /** Question submitted -\> the authored beat is on screen. */
  beatVisible: 'beat-visible',
} as const;

export type StageName = (typeof STAGE)[keyof typeof STAGE];
