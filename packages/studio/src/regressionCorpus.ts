import {selectStrategy} from './authoring/strategies/registry';
import {authorWithRetry, type AuthorOptions} from './authoringPipeline';
import {sumUsage, type TokenUsage} from './providers';

/**
 * A standing regression corpus: a fixed topic set, run the same way every
 * time, with results persisted and compared against the previous run.
 *
 * @remarks
 * This exists because every reliability number this project produced came from
 * an ad hoc, one-off run. That is enough to make a claim once and nowhere near
 * enough to keep one true: without a fixed set you cannot tell a genuine
 * improvement from a lucky afternoon, and - more importantly - you cannot tell
 * that last week's working topic has quietly stopped working.
 *
 * Three properties make it a *regression* corpus rather than a benchmark:
 *
 * - **The topic set is versioned.** `topics.json` carries a version, and a
 *   stored result only means something against the same version - adding or
 *   rewording a topic changes what the numbers describe.
 * - **Runs are persisted, timestamped, as JSON.** Not terminal scrollback.
 * - **Runs are compared.** `compareRuns` reports the topics that changed
 *   state, which is the only part of a corpus run anyone needs to read.
 *
 * It measures the *authoring* half - topic to compiling, beat-shaped module -
 * because that is where model reliability lives and what a server can observe.
 * Whether the result then stages and passes the audit is covered by the e2e
 * suite against fixed fixtures, which is the right place for it: that half is
 * deterministic and does not need a corpus.
 */

export interface CorpusTopic {
  readonly id: string;
  readonly domain: string;
  readonly topic: string;
  /** What a good result looks like, for whoever reads the report. */
  readonly expects?: string;
}

export interface CorpusFile {
  readonly version: string;
  readonly note?: string;
  readonly topics: readonly CorpusTopic[];
}

export interface CorpusTopicResult {
  readonly id: string;
  readonly domain: string;
  readonly topic: string;
  readonly ok: boolean;
  readonly attempts: number;
  readonly firstAttempt: boolean;
  /**
   * Solved in code, with no provider.
   *
   * @remarks
   * Distinct from "succeeded on the first attempt", and reported separately:
   * a deterministic solve is a guaranteed answer that cost nothing, and
   * folding it into the first-attempt rate would credit the model with work
   * the code did.
   */
  readonly deterministic?: boolean;
  readonly repaired: boolean;
  readonly strategy: string;
  readonly provider: string;
  readonly model: string;
  readonly durationMs: number;
  /** Size of the model's reply - a real cost signal, and cheap to record. */
  readonly outputCharacters: number;
  /**
   * The scene source the model produced, on success.
   *
   * @remarks
   * Stored so a run is **replayable**. Without it the corpus records only
   * *that* a topic compiled, which makes the interesting half of the pipeline
   * - staging, the audit, repair, composition - untestable without asking the
   * provider again. That matters most exactly when the provider is
   * unavailable: an exhausted quota is when you most want to re-run the
   * deterministic half against real model output, and a corpus that has to
   * call the model to do that cannot help.
   *
   * It also makes a failure reproducible. "Topic X regressed" is actionable
   * when the output that regressed is in the file, and a research project
   * when it is not.
   */
  readonly source?: string;
  /**
   * Tokens billed for this topic, across every attempt.
   *
   * @remarks
   * Raw counts, not money. Turning these into cost needs per-model pricing
   * that changes without notice, and a hard-coded rate card would make every
   * figure this corpus produced quietly wrong. `null` when the provider did
   * not report usage.
   */
  readonly usage: TokenUsage | null;
  /** Why it failed, when it did. */
  readonly reason?: string;
  /** The failure's own words, which is what distinguishes an outage. */
  readonly detail?: string;
}

export interface DomainSummary {
  readonly measured: number;
  readonly succeeded: number;
  readonly firstAttempt: number;
}

export interface CorpusSummary {
  readonly total: number;
  /**
   * Runs where the provider actually answered. A topic whose every attempt was
   * an outage says nothing about the pipeline and must not be scored as a
   * failure - that is how a quota wall turns into a fake regression.
   */
  readonly measured: number;
  readonly succeeded: number;
  readonly firstAttempt: number;
  readonly successRate: number;
  readonly firstAttemptRate: number;
  readonly meanAttempts: number;
  readonly latencyMs: {
    readonly p50: number;
    readonly p90: number;
    readonly max: number;
  };
  /** Tokens billed across the whole run, or `null` if none were reported. */
  readonly usage: TokenUsage | null;
  readonly byDomain: Readonly<Record<string, DomainSummary>>;
}

export interface CorpusRun {
  readonly startedAt: string;
  readonly corpusVersion: string;
  readonly provider: string;
  readonly model: string;
  readonly summary: CorpusSummary;
  readonly results: readonly CorpusTopicResult[];
}

/**
 * Whether a result is a provider outage rather than a result.
 *
 * @remarks
 * `attempts-exhausted` is ambiguous on its own: the budget can be spent either
 * on a module that would not compile (a real result, and a regression if it
 * used to pass) or on a provider that never answered (not a result at all).
 * Only the failure's own detail separates them, so the detail is carried on
 * the result rather than discarded. Getting this wrong in the lenient
 * direction hides real regressions; getting it wrong in the strict direction
 * turns every quota wall into a fake one.
 */
function isOutage(result: CorpusTopicResult): boolean {
  if (result.ok) return false;
  if (result.reason === 'unrecoverable-provider') return true;
  if (result.reason === 'no-provider-key') return true;
  return (
    result.reason === 'attempts-exhausted' &&
    /without ever returning an answer/i.test(result.detail ?? '')
  );
}

/**
 * Which results carry information.
 *
 * @remarks
 * Exported because it is the one judgement in this module that is easy to get
 * subtly wrong, and a caller writing a report should be able to ask the same
 * question the summary does.
 */
export function measurableResults(
  results: readonly CorpusTopicResult[],
): readonly CorpusTopicResult[] {
  return results.filter(result => !isOutage(result));
}

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(fraction * sorted.length) - 1),
  );
  return sorted[index];
}

export function summariseCorpus(
  results: readonly CorpusTopicResult[],
): CorpusSummary {
  const measured = measurableResults(results);
  const succeeded = measured.filter(result => result.ok);
  const firstAttempt = measured.filter(result => result.firstAttempt);
  const latencies = measured
    .map(result => result.durationMs)
    .sort((a, b) => a - b);

  const byDomain: Record<string, DomainSummary> = {};
  for (const result of measured) {
    const current = byDomain[result.domain] ?? {
      measured: 0,
      succeeded: 0,
      firstAttempt: 0,
    };
    byDomain[result.domain] = {
      measured: current.measured + 1,
      succeeded: current.succeeded + (result.ok ? 1 : 0),
      firstAttempt: current.firstAttempt + (result.firstAttempt ? 1 : 0),
    };
  }

  const attemptsTotal = measured.reduce(
    (sum, result) => sum + result.attempts,
    0,
  );

  // Summed over EVERY result, not just the measured ones: a topic that failed
  // after three attempts still billed for three attempts, and excluding it
  // would understate exactly the case that costs most.
  const usage = results.reduce<TokenUsage | null>(
    (total, result) => sumUsage(total, result.usage),
    null,
  );

  return {
    total: results.length,
    measured: measured.length,
    succeeded: succeeded.length,
    firstAttempt: firstAttempt.length,
    successRate: measured.length ? succeeded.length / measured.length : 0,
    firstAttemptRate: measured.length
      ? firstAttempt.length / measured.length
      : 0,
    meanAttempts: measured.length ? attemptsTotal / measured.length : 0,
    latencyMs: {
      p50: percentile(latencies, 0.5),
      p90: percentile(latencies, 0.9),
      max: latencies.at(-1) ?? 0,
    },
    usage,
    byDomain,
  };
}

export interface TopicChange {
  readonly id: string;
  readonly topic: string;
  readonly from: 'pass' | 'fail' | 'unmeasured';
  readonly to: 'pass' | 'fail' | 'unmeasured';
}

export interface CorpusComparison {
  /** Topics that used to pass and now do not. The reason to run a corpus. */
  readonly regressions: readonly TopicChange[];
  /** Topics that used to fail and now pass. */
  readonly improvements: readonly TopicChange[];
  /** Topics whose state changed for any other reason, including outages. */
  readonly other: readonly TopicChange[];
}

function stateOf(
  result: CorpusTopicResult | undefined,
): 'pass' | 'fail' | 'unmeasured' {
  if (!result) return 'unmeasured';
  if (isOutage(result)) return 'unmeasured';
  return result.ok ? 'pass' : 'fail';
}

/**
 * Compare two runs, topic by topic.
 *
 * @remarks
 * Deliberately compares against a stored run rather than against a threshold.
 * "82% success" is not actionable on its own; "these two topics stopped
 * working" is. Topics absent from either run, and topics that were merely
 * unmeasured in one of them, are reported separately rather than being folded
 * into regressions - an outage is not a regression, and treating one as a
 * regression is how a team learns to ignore the report.
 */
export function compareRuns(
  previous: CorpusRun,
  current: CorpusRun,
): CorpusComparison {
  const before = new Map(previous.results.map(result => [result.id, result]));
  const after = new Map(current.results.map(result => [result.id, result]));
  const ids = [...new Set([...before.keys(), ...after.keys()])].sort();

  const regressions: TopicChange[] = [];
  const improvements: TopicChange[] = [];
  const other: TopicChange[] = [];

  for (const id of ids) {
    const from = stateOf(before.get(id));
    const to = stateOf(after.get(id));
    if (from === to) continue;

    const topic = after.get(id)?.topic ?? before.get(id)?.topic ?? id;
    const change: TopicChange = {id, topic, from, to};
    if (from === 'pass' && to === 'fail') regressions.push(change);
    else if (from === 'fail' && to === 'pass') improvements.push(change);
    else other.push(change);
  }

  return {regressions, improvements, other};
}

/**
 * A topic's state across every stored run, oldest first.
 *
 * @remarks
 * `'unmeasured'` is a first-class state, not a gap to be filled in. A topic
 * whose provider never answered is not a topic that failed, and collapsing the
 * two would make a run of quota walls look like a run of regressions.
 */
export type TopicState = 'pass' | 'fail' | 'unmeasured';

export interface TopicTrend {
  readonly id: string;
  readonly topic: string;
  readonly history: readonly TopicState[];
  /**
   * How many of the most recent runs have not passed. `0` if the latest run
   * passed; `null` if it has never passed at all.
   */
  readonly runsSinceLastPass: number | null;
  /** True when it has both passed and failed - the most useful signal here. */
  readonly flaky: boolean;
}

export interface RunTrend {
  readonly runs: number;
  readonly firstStartedAt: string | null;
  readonly lastStartedAt: string | null;
  /** Aggregate success rate per run, oldest first. */
  readonly successRates: readonly number[];
  /** Tokens per run, oldest first; `null` where a run reported none. */
  readonly tokensPerRun: readonly (number | null)[];
  readonly topics: readonly TopicTrend[];
  /**
   * Topics that have both passed and failed.
   *
   * @remarks
   * The most actionable thing a corpus can tell you. A topic that never passes
   * is a known gap; a topic that passes *sometimes* is a bug that will reach a
   * learner on the wrong day, and a single-run report cannot see it at all.
   */
  readonly flaky: readonly string[];
  /** Topics that have never produced a beat in any measured run. */
  readonly neverPassed: readonly string[];
}

function stateFor(run: CorpusRun, id: string): TopicState {
  const result = run.results.find(entry => entry.id === id);
  if (!result) return 'unmeasured';
  if (isOutage(result)) return 'unmeasured';
  return result.ok ? 'pass' : 'fail';
}

/**
 * Summarise every stored run into one rolling view.
 *
 * @remarks
 * `compareRuns` answers "what changed since last time", which is what a
 * pre-merge check wants. This answers "how has this been behaving", which is
 * what a person wants when they are deciding whether a topic is trustworthy -
 * and it is the only view that can surface a topic that is flaky rather than
 * broken.
 *
 * Runs are sorted by `startedAt` rather than trusted to arrive in order,
 * because a directory listing is alphabetical and ISO timestamps only sort
 * chronologically when they are formatted consistently.
 */
export function trendAcrossRuns(runs: readonly CorpusRun[]): RunTrend {
  const ordered = [...runs].sort((a, b) =>
    a.startedAt.localeCompare(b.startedAt),
  );
  if (ordered.length === 0) {
    return {
      runs: 0,
      firstStartedAt: null,
      lastStartedAt: null,
      successRates: [],
      tokensPerRun: [],
      topics: [],
      flaky: [],
      neverPassed: [],
    };
  }

  const ids = [
    ...new Set(ordered.flatMap(run => run.results.map(result => result.id))),
  ].sort();

  const topics: TopicTrend[] = ids.map(id => {
    const history = ordered.map(run => stateFor(run, id));
    const topic =
      ordered.flatMap(run => run.results).find(result => result.id === id)
        ?.topic ?? id;

    const lastPass = history.lastIndexOf('pass');
    const runsSinceLastPass =
      lastPass === -1 ? null : history.length - 1 - lastPass;

    return {
      id,
      topic,
      history,
      runsSinceLastPass,
      flaky: history.includes('pass') && history.includes('fail'),
    };
  });

  return {
    runs: ordered.length,
    firstStartedAt: ordered[0].startedAt,
    lastStartedAt: ordered[ordered.length - 1].startedAt,
    successRates: ordered.map(run => run.summary.successRate),
    tokensPerRun: ordered.map(run =>
      run.summary.usage
        ? run.summary.usage.promptTokens + run.summary.usage.completionTokens
        : null,
    ),
    topics,
    flaky: topics.filter(topic => topic.flaky).map(topic => topic.id),
    neverPassed: topics
      .filter(
        topic =>
          !topic.history.includes('pass') && topic.history.includes('fail'),
      )
      .map(topic => topic.id),
  };
}

/** A compact trend report. The flaky list is the part worth reading. */
export function formatTrendReport(trend: RunTrend): string {
  if (trend.runs === 0) return 'no stored corpus runs';

  const lines: string[] = [];
  const symbol: Record<TopicState, string> = {
    pass: '.',
    fail: 'X',
    unmeasured: '-',
  };

  lines.push(
    `corpus trend · ${trend.runs} run(s) · ${trend.firstStartedAt} -> ${trend.lastStartedAt}`,
  );
  lines.push(
    `  success rate per run: ${trend.successRates
      .map(rate => `${Math.round(rate * 100)}%`)
      .join(' -> ')}`,
  );
  const tokens = trend.tokensPerRun.map(value =>
    value === null ? '-' : String(value),
  );
  if (tokens.some(value => value !== '-')) {
    lines.push(`  tokens per run: ${tokens.join(' -> ')}`);
  }
  lines.push('  (oldest first: "." passed, "X" failed, "-" not measured)');
  for (const topic of trend.topics) {
    const history = topic.history.map(state => symbol[state]).join('');
    lines.push(`  ${history}  ${topic.id}`);
  }

  if (trend.flaky.length > 0) {
    lines.push(
      `FLAKY (passed sometimes and failed sometimes): ${trend.flaky.join(', ')}`,
    );
  }
  if (trend.neverPassed.length > 0) {
    lines.push(`NEVER PASSED: ${trend.neverPassed.join(', ')}`);
  }
  if (trend.flaky.length === 0 && trend.neverPassed.length === 0) {
    lines.push('every topic has been consistent across the stored runs');
  }

  return lines.join('\n');
}

export interface RunCorpusOptions {
  readonly corpus: CorpusFile;
  readonly authorOptions: Omit<AuthorOptions, 'topic' | 'strategy'> & {
    readonly strategy?: AuthorOptions['strategy'];
  };
  /** Delay between topics, to stay under a provider's per-minute limit. */
  readonly paceMs?: number;
  /** Injected so the runner can be exercised without a network. */
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => number;
  readonly clock?: () => Date;
}

const defaultSleep = (ms: number) =>
  new Promise<void>(resolve => setTimeout(resolve, ms));

export async function runCorpus(options: RunCorpusOptions): Promise<CorpusRun> {
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? (() => Date.now());
  const clock = options.clock ?? (() => new Date());
  const paceMs = options.paceMs ?? 12000;

  const results: CorpusTopicResult[] = [];
  let provider = 'unknown';
  let model = 'unknown';

  for (const [index, entry] of options.corpus.topics.entries()) {
    const started = now();
    const strategy =
      options.authorOptions.strategy ?? selectStrategy(entry.topic).strategy;
    const outcome = await authorWithRetry({
      ...options.authorOptions,
      topic: entry.topic,
      strategy,
    });
    const durationMs = now() - started;

    provider = outcome.provider;
    model = outcome.model;

    results.push({
      id: entry.id,
      domain: entry.domain,
      topic: entry.topic,
      ok: outcome.ok,
      attempts: outcome.ok ? outcome.attempts : 0,
      firstAttempt: outcome.ok && outcome.attempts === 1,
      ...(outcome.ok && outcome.deterministic ? {deterministic: true} : {}),
      repaired: outcome.ok ? outcome.repaired : false,
      strategy: outcome.strategy,
      provider: outcome.provider,
      model: outcome.model,
      durationMs,
      outputCharacters: outcome.ok ? outcome.source.length : 0,
      ...(outcome.ok ? {source: outcome.source} : {}),
      usage: outcome.usage,
      ...(outcome.ok ? {} : {reason: outcome.reason, detail: outcome.detail}),
    });

    if (index < options.corpus.topics.length - 1) await sleep(paceMs);
  }

  return {
    startedAt: clock().toISOString(),
    corpusVersion: options.corpus.version,
    provider,
    model,
    summary: summariseCorpus(results),
    results,
  };
}

/** A human-readable report. The comparison is the part worth reading. */
export function formatCorpusReport(
  run: CorpusRun,
  comparison?: CorpusComparison,
): string {
  const lines: string[] = [];
  const {summary} = run;
  lines.push(
    `corpus ${run.corpusVersion} · ${run.provider}/${run.model} · ${run.startedAt}`,
  );
  lines.push(
    `  ${summary.succeeded}/${summary.measured} measured topics produced a beat ` +
      `(${Math.round(summary.successRate * 100)}%); ${summary.firstAttempt} on the first attempt ` +
      `(${Math.round(summary.firstAttemptRate * 100)}%); mean ${summary.meanAttempts.toFixed(2)} attempts`,
  );
  lines.push(
    `  latency p50 ${summary.latencyMs.p50}ms · p90 ${summary.latencyMs.p90}ms · max ${summary.latencyMs.max}ms`,
  );
  if (summary.usage) {
    lines.push(
      `  tokens: ${summary.usage.promptTokens} in + ${summary.usage.completionTokens} out ` +
        `(across every attempt, including failures)`,
    );
  }
  if (summary.measured < summary.total) {
    lines.push(
      `  ${summary.total - summary.measured} of ${summary.total} got no provider answer and are excluded`,
    );
  }

  for (const result of run.results) {
    const mark = result.ok
      ? result.deterministic
        ? 'CODE '
        : result.firstAttempt
          ? 'FIRST'
          : 'retry'
      : 'FAIL ';
    const detail = result.ok
      ? `${result.strategy}${result.repaired ? ' (repaired)' : ''}`
      : isOutage(result)
        ? `no provider answer (${result.reason})`
        : `failed (${result.reason}: ${(result.detail ?? '').split('\n')[0].slice(0, 80)})`;
    lines.push(`  ${mark} ${result.id.padEnd(20)} ${detail}`);
  }

  if (comparison) {
    const describe = (change: TopicChange) =>
      `  ${change.id} (${change.from} -> ${change.to}): ${change.topic}`;
    if (comparison.regressions.length > 0) {
      lines.push('REGRESSIONS');
      lines.push(...comparison.regressions.map(describe));
    }
    if (comparison.improvements.length > 0) {
      lines.push('IMPROVEMENTS');
      lines.push(...comparison.improvements.map(describe));
    }
    if (comparison.other.length > 0) {
      lines.push('OTHER CHANGES');
      lines.push(...comparison.other.map(describe));
    }
    if (
      comparison.regressions.length === 0 &&
      comparison.improvements.length === 0 &&
      comparison.other.length === 0
    ) {
      lines.push('no topic changed state since the previous run');
    }
  }

  return lines.join('\n');
}
