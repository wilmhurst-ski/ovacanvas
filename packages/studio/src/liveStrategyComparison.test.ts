import * as fs from 'fs';
import {fileURLToPath} from 'url';
import {describe, expect, it} from 'vitest';
import {equationIntent} from './authoring/strategies/equationIntent/strategy.ts';
import {fullCodeGen} from './authoring/strategies/fullCodeGen.ts';
import type {AuthoringStrategy} from './authoring/strategies/types.ts';
import {authorWithRetry, type AuthorOutcome} from './authoringPipeline.ts';
import {buildVerifiedApiSection} from './systemPrompt.ts';

/**
 * Phase 4's actual deliverable: a measurement, not a claim.
 *
 * @remarks
 * Both strategies are given the same problems, the same provider, the same
 * model and the same attempt budget, and the difference reported is
 * **first-attempt success** - how often the very first reply was usable. That
 * is the number that matters to a learner waiting for a beat, and it is the
 * number prior work on this project found the intent compiler winning
 * decisively on.
 *
 * Opt-in (`OVACANVAS_LIVE=1`): it needs a network and a key. Running it is the
 * point - the assertion below is deliberately weak (at least as good, plus a
 * perfect record for the intent compiler) because a strong assertion on a
 * five-problem sample would be a flaky test pretending to be a benchmark. The
 * printed table is the real output.
 */
const LIVE = process.env.OVACANVAS_LIVE === '1';
const COMPILE_ROOT = fileURLToPath(new URL('../../host', import.meta.url));

function loadLocalEnv(): NodeJS.ProcessEnv {
  const file = fileURLToPath(new URL('../.env.local', import.meta.url));
  if (!fs.existsSync(file)) return process.env;
  const env: NodeJS.ProcessEnv = {...process.env};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && match[2]) env[match[1]] = match[2];
  }
  return env;
}

/** A representative spread of solve-for-x problems, not one easy shape. */
const PROBLEMS = [
  'solve 2x + 3 = 7',
  'solve for x: 5(x - 2) = 3x + 4',
  'solve the quadratic equation x^2 - 5x + 6 = 0',
  'solve 3/(x - 1) = 2',
  'solve for y: 4y - 7 = 2y + 9',
];

const STRATEGIES: AuthoringStrategy[] = [fullCodeGen, equationIntent];

interface Row {
  readonly problem: string;
  readonly strategy: string;
  readonly ok: boolean;
  readonly attempts: number;
  readonly firstAttempt: boolean;
  readonly detail: string;
}

describe.skipIf(!LIVE)('strategy comparison on equation solving', () => {
  const env = loadLocalEnv();
  const apiSection = buildVerifiedApiSection({resolveFrom: COMPILE_ROOT});

  it('measures first-attempt success for both strategies on the same problems', async () => {
    const rows: Row[] = [];
    const measurable: Row[] = [];

    for (const problem of PROBLEMS) {
      for (const strategy of STRATEGIES) {
        const outcome: AuthorOutcome = await authorWithRetry({
          topic: problem,
          strategy,
          apiSection,
          projectRoot: COMPILE_ROOT,
          env,
        });
        const row: Row = {
          problem,
          strategy: strategy.id,
          ok: outcome.ok,
          attempts: outcome.ok ? outcome.attempts : 0,
          firstAttempt: outcome.ok && outcome.attempts === 1,
          detail: outcome.ok
            ? outcome.log.map(entry => entry.outcome).join(' -> ')
            : `${outcome.reason}: ${outcome.detail}`,
        };
        rows.push(row);

        // A run where the provider never answered says nothing about the
        // strategy - it is an outage, not a result. Counting it as a failure
        // for one strategy and not the other would make the measurement
        // meaningless, so those runs are reported but excluded from the rates.
        const providerAnswered = outcome.ok
          ? true
          : outcome.log.some(entry => entry.outcome !== 'provider-failed');
        if (providerAnswered) measurable.push(row);

        // Free-tier keys are rate limited per minute; pacing keeps the
        // measurement from turning into a quota test.
        await new Promise(resolve => setTimeout(resolve, 4000));
      }
    }

    const summarise = (strategy: string) => {
      const subset = measurable.filter(row => row.strategy === strategy);
      const succeeded = subset.filter(row => row.ok).length;
      const first = subset.filter(row => row.firstAttempt).length;
      const meanAttempts = subset.length
        ? subset.reduce((sum, row) => sum + row.attempts, 0) / subset.length
        : 0;
      return {
        strategy,
        measured: subset.length,
        succeeded,
        firstAttempt: first,
        firstAttemptRate: subset.length
          ? `${Math.round((first / subset.length) * 100)}%`
          : 'n/a',
        meanAttempts: meanAttempts.toFixed(2),
      };
    };

    console.log('COMPARISON TABLE');
    for (const row of rows) {
      console.log(
        `  ${row.firstAttempt ? 'FIRST' : row.ok ? 'retry' : 'FAIL '} | ${row.strategy.padEnd(
          15,
        )} | ${row.problem}\n           ${row.detail.split('\n')[0]}`,
      );
    }
    console.log(
      'COMPARISON SUMMARY',
      JSON.stringify(
        STRATEGIES.map(s => summarise(s.id)),
        null,
        2,
      ),
    );

    const intent = summarise(equationIntent.id);
    const code = summarise(fullCodeGen.id);

    if (intent.measured < 3 || code.measured < 3) {
      // Not enough provider answers to compare anything. Failing here would
      // report an outage as a strategy result, which is the one thing this
      // test exists not to do.
      console.warn(
        `MEASUREMENT INCOMPLETE: only ${intent.measured} intent and ${code.measured} code runs ` +
          'got a provider answer. Re-run when the quota has reset.',
      );
      return;
    }

    // The deterministic template's whole reason to exist: the model is never
    // asked a question it could get geometrically wrong, so it should not need
    // retries at all.
    expect(intent.succeeded).toBe(intent.measured);
    // And it must not be worse than the general path on the same problems.
    expect(intent.firstAttempt).toBeGreaterThanOrEqual(code.firstAttempt);
  }, 900000);
});
