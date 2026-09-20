import {describe, expect, it} from 'vitest';
import {RunTelemetry, STAGE} from './telemetry';

describe('RunTelemetry', () => {
  it('records how long a started stage took', () => {
    const telemetry = new RunTelemetry();
    telemetry.start(STAGE.authoring, 1000);
    const ms = telemetry.finish(STAGE.authoring, 1750);

    expect(ms).toBe(750);
    expect(telemetry.latest(STAGE.authoring)).toBe(750);
  });

  it('returns zero for a stage that was never started, rather than throwing', () => {
    // Timing must never be the reason a learner's beat fails to appear.
    const telemetry = new RunTelemetry();
    expect(telemetry.finish(STAGE.resolve)).toBe(0);
    expect(telemetry.latest(STAGE.resolve)).toBeNull();
  });

  it('discards an earlier start when a stage is restarted', () => {
    const telemetry = new RunTelemetry();
    telemetry.start(STAGE.authoring, 1000);
    telemetry.start(STAGE.authoring, 5000); // a retry, say
    expect(telemetry.finish(STAGE.authoring, 5200)).toBe(200);
  });

  it('accepts a duration measured elsewhere', () => {
    // The server reports its own authoring time; the client does not measure
    // it, but the report should still carry it.
    const telemetry = new RunTelemetry();
    telemetry.record(STAGE.authoring, 12_000);
    expect(telemetry.latest(STAGE.authoring)).toBe(12_000);
  });

  it('reports percentiles across every sample, not just the last', () => {
    const telemetry = new RunTelemetry();
    for (const ms of [100, 200, 300, 400, 5000]) {
      telemetry.record(STAGE.beatVisible, ms);
    }

    const {percentiles} = telemetry.summary();
    expect(percentiles[STAGE.beatVisible].samples).toBe(5);
    expect(percentiles[STAGE.beatVisible].p50).toBe(300);
    // A mean would sit around 1200ms and hide the outlier entirely.
    expect(percentiles[STAGE.beatVisible].p90).toBe(5000);
    expect(percentiles[STAGE.beatVisible].max).toBe(5000);
  });

  it('keeps the latest value per stage, in the order stages were first seen', () => {
    const telemetry = new RunTelemetry();
    telemetry.record(STAGE.openerVisible, 500);
    telemetry.record(STAGE.beatVisible, 9000);
    telemetry.record(STAGE.openerVisible, 700);

    const {latest} = telemetry.summary();
    expect(latest.map(sample => sample.stage)).toEqual([
      STAGE.openerVisible,
      STAGE.beatVisible,
    ]);
    expect(latest[0].ms).toBe(700);
  });

  it('rounds to whole milliseconds', () => {
    const telemetry = new RunTelemetry();
    telemetry.record(STAGE.resolve, 12.6);
    expect(telemetry.latest(STAGE.resolve)).toBe(13);
  });

  it('resets cleanly, so one interaction cannot leak into the next', () => {
    const telemetry = new RunTelemetry();
    telemetry.start(STAGE.authoring, 0);
    telemetry.record(STAGE.beatVisible, 100);
    telemetry.reset();

    expect(telemetry.summary().latest).toEqual([]);
    expect(telemetry.summary().percentiles).toEqual({});
    expect(telemetry.finish(STAGE.authoring)).toBe(0);
  });

  it('summarises an empty run without inventing numbers', () => {
    expect(new RunTelemetry().summary()).toEqual({latest: [], percentiles: {}});
  });
});
