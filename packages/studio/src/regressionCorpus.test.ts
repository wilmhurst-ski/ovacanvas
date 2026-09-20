import {describe, expect, it} from 'vitest';
import {
  compareRuns,
  formatCorpusReport,
  formatTrendReport,
  measurableResults,
  summariseCorpus,
  trendAcrossRuns,
  type CorpusRun,
  type CorpusTopicResult,
} from './regressionCorpus';

function result(
  overrides: Partial<CorpusTopicResult> & {id: string},
): CorpusTopicResult {
  return {
    domain: 'math',
    topic: overrides.id,
    ok: true,
    attempts: 1,
    firstAttempt: true,
    repaired: false,
    strategy: 'full-code-gen',
    provider: 'gemini',
    model: 'm',
    durationMs: 1000,
    outputCharacters: 500,
    usage: null,
    ...overrides,
  };
}

const OUTAGE: Partial<CorpusTopicResult> = {
  ok: false,
  attempts: 0,
  firstAttempt: false,
  reason: 'attempts-exhausted',
  detail:
    'the provider failed 3 time(s) without ever returning an answer: HTTP 429',
};

describe('measurableResults', () => {
  it('excludes a topic whose provider never answered', () => {
    const results = [
      result({id: 'a'}),
      result({id: 'b', ...OUTAGE}),
      result({
        id: 'c',
        ok: false,
        attempts: 3,
        firstAttempt: false,
        reason: 'attempts-exhausted',
        detail: 'no stageable beat was produced in 3 attempt(s)',
      }),
    ];
    // `b` is an outage; `c` spent its budget on content that would not compile,
    // which is a real result. The distinction is the whole point.
    expect(measurableResults(results).map(r => r.id)).toEqual(['a', 'c']);
  });

  it('treats an unrecoverable provider failure and a missing key as outages too', () => {
    const results = [
      result({
        id: 'a',
        ok: false,
        attempts: 1,
        firstAttempt: false,
        reason: 'unrecoverable-provider',
      }),
      result({
        id: 'b',
        ok: false,
        attempts: 0,
        firstAttempt: false,
        reason: 'no-provider-key',
      }),
    ];
    expect(measurableResults(results)).toEqual([]);
  });
});

describe('summariseCorpus', () => {
  it('computes rates over measured topics, not over all of them', () => {
    const summary = summariseCorpus([
      result({id: 'a'}),
      result({id: 'b', attempts: 3, firstAttempt: false}),
      result({id: 'c', ...OUTAGE}),
    ]);

    expect(summary.total).toBe(3);
    expect(summary.measured).toBe(2);
    expect(summary.succeeded).toBe(2);
    expect(summary.successRate).toBe(1);
    expect(summary.firstAttempt).toBe(1);
    expect(summary.firstAttemptRate).toBe(0.5);
    expect(summary.meanAttempts).toBe(2);
  });

  it('reports latency percentiles rather than only a mean', () => {
    const summary = summariseCorpus(
      [100, 200, 300, 400, 5000].map((durationMs, index) =>
        result({id: `t${index}`, durationMs}),
      ),
    );
    // The mean would hide the 5000ms outlier; p90 and max do not.
    expect(summary.latencyMs.p50).toBe(300);
    expect(summary.latencyMs.p90).toBe(5000);
    expect(summary.latencyMs.max).toBe(5000);
  });

  it('breaks the result down by domain', () => {
    const summary = summariseCorpus([
      result({id: 'm1', domain: 'math'}),
      result({
        id: 'm2',
        domain: 'math',
        ok: false,
        attempts: 3,
        firstAttempt: false,
      }),
      result({id: 'g1', domain: 'geography'}),
    ]);
    expect(summary.byDomain.math).toEqual({
      measured: 2,
      succeeded: 1,
      firstAttempt: 1,
    });
    expect(summary.byDomain.geography).toEqual({
      measured: 1,
      succeeded: 1,
      firstAttempt: 1,
    });
  });

  it('breaks the result down by genre and records attempt distribution', () => {
    const summary = summariseCorpus([
      result({
        id: 'det1',
        domain: 'math',
        genre: 'step-by-step',
        deterministic: true,
        attempts: 0,
        firstAttempt: false,
      }),
      result({
        id: 'step1',
        domain: 'cs',
        genre: 'step-by-step',
        attempts: 1,
        firstAttempt: true,
      }),
      result({
        id: 'time1',
        domain: 'history',
        genre: 'timeline',
        attempts: 2,
        firstAttempt: false,
      }),
      result({
        id: 'fail1',
        domain: 'physics',
        genre: 'diagram',
        ok: false,
        attempts: 3,
        firstAttempt: false,
      }),
    ]);

    expect(summary.byGenre['step-by-step']).toEqual({
      measured: 2,
      succeeded: 2,
      firstAttempt: 1,
    });
    expect(summary.byGenre.timeline).toEqual({
      measured: 1,
      succeeded: 1,
      firstAttempt: 0,
    });
    expect(summary.byGenre.diagram).toEqual({
      measured: 1,
      succeeded: 0,
      firstAttempt: 0,
    });

    expect(summary.attemptDistribution).toEqual({
      deterministic: 1,
      attempt1: 1,
      attempt2: 1,
      attempt3: 0,
      failed: 1,
    });
  });

  it('totals tokens across every attempt, including the ones that failed', () => {
    // A topic that fails after three attempts is the most expensive kind, and
    // a cost figure that only counted successes would describe the most
    // wasteful case as the cheapest.
    const summary = summariseCorpus([
      result({id: 'a', usage: {promptTokens: 4000, completionTokens: 900}}),
      result({
        id: 'b',
        ok: false,
        attempts: 3,
        firstAttempt: false,
        reason: 'attempts-exhausted',
        detail: 'no stageable beat was produced in 3 attempt(s)',
        usage: {promptTokens: 12_000, completionTokens: 400},
      }),
      // An outage billed nothing and must not distort the total.
      result({id: 'c', ...OUTAGE, usage: null}),
    ]);

    expect(summary.usage).toEqual({
      promptTokens: 16_000,
      completionTokens: 1300,
    });
  });

  it('reports no token total when no provider reported usage', () => {
    const summary = summariseCorpus([result({id: 'a'}), result({id: 'b'})]);
    expect(summary.usage).toBeNull();
  });

  it('reports zeroes rather than NaN when nothing was measured', () => {
    const summary = summariseCorpus([result({id: 'a', ...OUTAGE})]);
    expect(summary.measured).toBe(0);
    expect(summary.successRate).toBe(0);
    expect(summary.meanAttempts).toBe(0);
    expect(summary.latencyMs).toEqual({p50: 0, p90: 0, max: 0});
  });
});

function run(
  results: readonly CorpusTopicResult[],
  version = '1.0.0',
  startedAt = '2026-09-20T00:00:00.000Z',
): CorpusRun {
  return {
    startedAt,
    corpusVersion: version,
    provider: 'gemini',
    model: 'm',
    summary: summariseCorpus(results),
    results,
  };
}

describe('compareRuns', () => {
  it('reports a topic that used to pass and now does not', () => {
    const comparison = compareRuns(
      run([result({id: 'a'}), result({id: 'b'})]),
      run([
        result({id: 'a'}),
        result({
          id: 'b',
          ok: false,
          attempts: 3,
          firstAttempt: false,
          reason: 'attempts-exhausted',
          detail: 'no stageable beat was produced in 3 attempt(s)',
        }),
      ]),
    );
    expect(comparison.regressions.map(c => c.id)).toEqual(['b']);
    expect(comparison.improvements).toEqual([]);
  });

  it('reports an improvement', () => {
    const comparison = compareRuns(
      run([
        result({
          id: 'a',
          ok: false,
          attempts: 3,
          firstAttempt: false,
          reason: 'attempts-exhausted',
          detail: 'no stageable beat',
        }),
      ]),
      run([result({id: 'a'})]),
    );
    expect(comparison.improvements.map(c => c.id)).toEqual(['a']);
    expect(comparison.regressions).toEqual([]);
  });

  it('does NOT report a regression when the provider simply never answered', () => {
    // The failure mode this whole distinction exists for: a quota wall must
    // not read as "the pipeline broke".
    const comparison = compareRuns(
      run([result({id: 'a'}), result({id: 'b'})]),
      run([result({id: 'a'}), result({id: 'b', ...OUTAGE})]),
    );
    expect(comparison.regressions).toEqual([]);
    expect(comparison.other).toEqual([
      {id: 'b', topic: 'b', from: 'pass', to: 'unmeasured'},
    ]);
  });

  it('treats a topic missing from either run as a change, not a silent pass', () => {
    const comparison = compareRuns(
      run([result({id: 'a'})]),
      run([result({id: 'b'})]),
    );
    expect(comparison.other.map(c => c.id)).toEqual(['a', 'b']);
  });

  it('reports nothing when nothing changed', () => {
    const comparison = compareRuns(
      run([result({id: 'a'})]),
      run([result({id: 'a'})]),
    );
    expect(comparison).toEqual({regressions: [], improvements: [], other: []});
  });
});

const FAILED: Partial<CorpusTopicResult> = {
  ok: false,
  attempts: 3,
  firstAttempt: false,
  reason: 'attempts-exhausted',
  detail: 'no stageable beat was produced in 3 attempt(s)',
};

describe('trendAcrossRuns', () => {
  it('orders runs chronologically even when handed them out of order', () => {
    const trend = trendAcrossRuns([
      run([result({id: 'a'})], '1.0.0', '2026-09-22T00:00:00.000Z'),
      run([result({id: 'a', ...FAILED})], '1.0.0', '2026-09-20T00:00:00.000Z'),
      run([result({id: 'a'})], '1.0.0', '2026-09-21T00:00:00.000Z'),
    ]);

    expect(trend.runs).toBe(3);
    expect(trend.topics[0].history).toEqual(['fail', 'pass', 'pass']);
    expect(trend.firstStartedAt).toBe('2026-09-20T00:00:00.000Z');
  });

  it('surfaces a flaky topic, which a single-run report cannot see', () => {
    // Passes sometimes and fails sometimes: a bug that reaches a learner on
    // the wrong day, and the most actionable thing a corpus can report.
    const trend = trendAcrossRuns([
      run([result({id: 'a'})], '1.0.0', '2026-09-20T00:00:00.000Z'),
      run([result({id: 'a', ...FAILED})], '1.0.0', '2026-09-21T00:00:00.000Z'),
      run([result({id: 'a'})], '1.0.0', '2026-09-22T00:00:00.000Z'),
    ]);
    expect(trend.flaky).toEqual(['a']);
    expect(trend.neverPassed).toEqual([]);
  });

  it('separates "never passed" from "flaky"', () => {
    const trend = trendAcrossRuns([
      run(
        [result({id: 'broken', ...FAILED})],
        '1.0.0',
        '2026-09-20T00:00:00.000Z',
      ),
      run(
        [result({id: 'broken', ...FAILED})],
        '1.0.0',
        '2026-09-21T00:00:00.000Z',
      ),
    ]);
    expect(trend.neverPassed).toEqual(['broken']);
    expect(trend.flaky).toEqual([]);
  });

  it('does not call a quota wall a failure', () => {
    const trend = trendAcrossRuns([
      run([result({id: 'a'})], '1.0.0', '2026-09-20T00:00:00.000Z'),
      run([result({id: 'a', ...OUTAGE})], '1.0.0', '2026-09-21T00:00:00.000Z'),
    ]);
    expect(trend.topics[0].history).toEqual(['pass', 'unmeasured']);
    // Not flaky: it has never actually failed.
    expect(trend.flaky).toEqual([]);
    expect(trend.neverPassed).toEqual([]);
  });

  it('counts how long since a topic last passed', () => {
    const trend = trendAcrossRuns([
      run([result({id: 'a'})], '1.0.0', '2026-09-20T00:00:00.000Z'),
      run([result({id: 'a', ...FAILED})], '1.0.0', '2026-09-21T00:00:00.000Z'),
      run([result({id: 'a', ...FAILED})], '1.0.0', '2026-09-22T00:00:00.000Z'),
    ]);
    expect(trend.topics[0].runsSinceLastPass).toBe(2);
  });

  it('reports null rather than zero for a topic that has never passed', () => {
    const trend = trendAcrossRuns([
      run([result({id: 'a', ...FAILED})], '1.0.0', '2026-09-20T00:00:00.000Z'),
    ]);
    // Zero would read as "passed just now".
    expect(trend.topics[0].runsSinceLastPass).toBeNull();
  });

  it('handles a topic that appears in only some runs', () => {
    const trend = trendAcrossRuns([
      run([result({id: 'a'})], '1.0.0', '2026-09-20T00:00:00.000Z'),
      run(
        [result({id: 'a'}), result({id: 'b'})],
        '1.1.0',
        '2026-09-21T00:00:00.000Z',
      ),
    ]);
    const b = trend.topics.find(topic => topic.id === 'b')!;
    expect(b.history).toEqual(['unmeasured', 'pass']);
    // A topic added later is not a topic that regressed.
    expect(trend.flaky).toEqual([]);
  });

  it('summarises an empty history without inventing a run', () => {
    expect(trendAcrossRuns([])).toEqual({
      runs: 0,
      firstStartedAt: null,
      lastStartedAt: null,
      successRates: [],
      tokensPerRun: [],
      topics: [],
      flaky: [],
      neverPassed: [],
    });
  });
});

describe('formatTrendReport', () => {
  it('draws a readable history line and names the flaky topics', () => {
    const trend = trendAcrossRuns([
      run(
        [result({id: 'a'}), result({id: 'b'})],
        '1.0.0',
        '2026-09-20T00:00:00.000Z',
      ),
      run(
        [result({id: 'a', ...FAILED}), result({id: 'b'})],
        '1.0.0',
        '2026-09-21T00:00:00.000Z',
      ),
      run(
        [result({id: 'a'}), result({id: 'b'})],
        '1.0.0',
        '2026-09-22T00:00:00.000Z',
      ),
    ]);
    const report = formatTrendReport(trend);

    expect(report).toContain('corpus trend · 3 run(s)');
    expect(report).toMatch(/\.X\.\s+a/);
    expect(report).toMatch(/\.\.\.\s+b/);
    expect(report).toContain('FLAKY');
    expect(report).toContain('a');
  });

  it('says so plainly when nothing has moved', () => {
    const trend = trendAcrossRuns([
      run([result({id: 'a'})], '1.0.0', '2026-09-20T00:00:00.000Z'),
      run([result({id: 'a'})], '1.0.0', '2026-09-21T00:00:00.000Z'),
    ]);
    expect(formatTrendReport(trend)).toContain(
      'every topic has been consistent',
    );
  });

  it('handles no stored runs', () => {
    expect(formatTrendReport(trendAcrossRuns([]))).toBe(
      'no stored corpus runs',
    );
  });
});

describe('formatCorpusReport', () => {
  it('leads with the comparison, which is the only part worth reading', () => {
    const previous = run([result({id: 'a'}), result({id: 'b'})]);
    const current = run([
      result({id: 'a'}),
      result({
        id: 'b',
        ok: false,
        attempts: 3,
        firstAttempt: false,
        reason: 'attempts-exhausted',
        detail: 'no stageable beat',
      }),
    ]);
    const report = formatCorpusReport(current, compareRuns(previous, current));

    expect(report).toContain('REGRESSIONS');
    expect(report).toMatch(/b \(pass -> fail\)/);
  });

  it('says so plainly when nothing changed', () => {
    const current = run([result({id: 'a'})]);
    expect(
      formatCorpusReport(current, compareRuns(current, current)),
    ).toContain('no topic changed state');
  });

  it('reports a code-solved topic distinctly from a model first attempt', () => {
    // Folding these together would credit the model with work the code did,
    // and the whole point of the distinction is that one of them cannot fail
    // on a rate limit and costs nothing.
    const current = run([
      result({
        id: 'solved',
        deterministic: true,
        attempts: 0,
        firstAttempt: false,
      }),
      result({id: 'modelled'}),
    ]);
    const report = formatCorpusReport(current);

    expect(report).toContain('CODE');
    expect(report).toMatch(/CODE\s+solved/);
    expect(report).toMatch(/FIRST\s+modelled/);
    expect(report).not.toMatch(/retry\s+solved/);
  });

  it('reports tokens in the report, since that is the measurable half of cost', () => {
    const current = run([
      result({id: 'a', usage: {promptTokens: 4000, completionTokens: 900}}),
    ]);
    const report = formatCorpusReport(current);
    expect(report).toContain('tokens: 4000 in + 900 out');
    // Deliberately says "across every attempt, including failures" so nobody
    // reads the number as a success-only cost.
    expect(report).toContain('including failures');
  });

  it('counts excluded runs so an outage cannot hide inside a success rate', () => {
    const current = run([result({id: 'a'}), result({id: 'b', ...OUTAGE})]);
    const report = formatCorpusReport(current);
    expect(report).toContain('1 of 2 got no provider answer and are excluded');
    expect(report).toContain('no provider answer');
  });

  it('formats attempt distribution, domain, and genre breakdowns', () => {
    const current = run([
      result({
        id: 'm1',
        domain: 'math',
        genre: 'step-by-step',
        deterministic: true,
        attempts: 0,
        firstAttempt: false,
      }),
      result({
        id: 'g1',
        domain: 'geography',
        genre: 'overview',
        attempts: 1,
        firstAttempt: true,
      }),
    ]);
    const report = formatCorpusReport(current);
    expect(report).toContain(
      'attempt distribution: 1 deterministic · 1 1st attempt · 0 2nd attempt · 0 3rd attempt · 0 failed',
    );
    expect(report).toContain(
      'by domain: geography: 1/1 (100%) · math: 1/1 (100%)',
    );
    expect(report).toContain(
      'by genre: overview: 1/1 (100%) · step-by-step: 1/1 (100%)',
    );
  });
});
