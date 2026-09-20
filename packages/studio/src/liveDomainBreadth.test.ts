import * as fs from 'fs';
import {fileURLToPath} from 'url';
import {describe, expect, it} from 'vitest';
import {selectStrategy} from './authoring/strategies/registry.ts';
import {authorWithRetry, type AuthorOutcome} from './authoringPipeline.ts';
import {buildVerifiedApiSection} from './systemPrompt.ts';

/**
 * Phase 5's evidence: real non-STEM topics, through the real pipeline.
 *
 * @remarks
 * The go/no-go decision for geography is recorded in `registry.ts` and rests
 * on reading `placeMapLabels` itself. This test supplies the other half of the
 * DoD - real topics, actually run - and answers a question the primitive
 * analysis cannot: **does the general path cope with non-STEM content at all?**
 *
 * If it does not, the answer is not "add an intent compiler" - it is that the
 * general path needs work first, since it is the floor every domain without a
 * purpose-built primitive stands on.
 *
 * Opt-in (`OVACANVAS_LIVE=1`): needs a network and a key.
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

/** One per domain BUILD_PLAN names, so the sample is not one domain's shape. */
const TOPICS: ReadonlyArray<{domain: string; topic: string}> = [
  {
    domain: 'geography',
    topic: 'show where the Sahara desert is on a world map',
  },
  {domain: 'geography', topic: 'the path of the Nile from source to delta'},
  {
    domain: 'history',
    topic: 'a timeline of the main events of the Roman Republic',
  },
  {
    domain: 'physics',
    topic: 'the forces acting on a block sliding down a ramp',
  },
];

describe.skipIf(!LIVE)('non-STEM domain breadth', () => {
  const env = loadLocalEnv();
  const apiSection = buildVerifiedApiSection({resolveFrom: COMPILE_ROOT});

  it('runs non-STEM topics through the general path and reports how it fares', async () => {
    const rows: Array<{
      domain: string;
      topic: string;
      outcome: AuthorOutcome;
      strategy: string;
    }> = [];

    for (const {domain, topic} of TOPICS) {
      const selection = selectStrategy(topic);
      const outcome = await authorWithRetry({
        topic,
        strategy: selection.strategy,
        apiSection,
        projectRoot: COMPILE_ROOT,
        env,
      });
      rows.push({domain, topic, outcome, strategy: selection.strategy.id});
      // A retrying run can issue four calls for one topic, and the free tier
      // allows 20 a minute - pacing this low is what keeps a measurement from
      // turning into a quota test.
      await new Promise(resolve => setTimeout(resolve, 12000));
    }

    console.log('DOMAIN BREADTH');
    for (const row of rows) {
      const status = row.outcome.ok
        ? `ok in ${row.outcome.attempts} attempt(s)${row.outcome.repaired ? ' (repaired)' : ''}`
        : `FAILED (${row.outcome.reason}: ${row.outcome.detail.split('\n')[0].slice(0, 120)})`;
      console.log(
        `  ${row.domain.padEnd(10)} | ${row.strategy.padEnd(15)} | ${status} | ${row.topic}`,
      );
      if (!row.outcome.ok) {
        console.log(
          `             attempts: ${row.outcome.log.map(entry => entry.outcome).join(' -> ')}`,
        );
      }
    }

    // The routing claim: no non-STEM topic should be claimed by an
    // intent-compiler domain, because none of them has a primitive that fits.
    for (const row of rows) {
      expect(row.strategy, row.topic).toBe('full-code-gen');
    }

    const answered = rows.filter(row => {
      if (row.outcome.ok) return true;
      return row.outcome.log.some(entry => entry.outcome !== 'provider-failed');
    });
    // Reported before any gating, because a partial run is still evidence and
    // hiding it behind a quorum would waste what the quota did buy.
    const succeeded = answered.filter(row => row.outcome.ok).length;
    const byDomain = new Map<string, {ok: number; answered: number}>();
    for (const row of rows) {
      const entry = byDomain.get(row.domain) ?? {ok: 0, answered: 0};
      const answeredHere = answered.includes(row);
      entry.answered += answeredHere ? 1 : 0;
      entry.ok += row.outcome.ok ? 1 : 0;
      byDomain.set(row.domain, entry);
    }
    console.log(
      `DOMAIN BREADTH SUMMARY: ${succeeded}/${answered.length} measured non-STEM topics produced a ` +
        `compiling beat via the general path (${TOPICS.length - answered.length} run(s) got no ` +
        `provider answer at all).`,
    );
    for (const [domain, counts] of byDomain) {
      console.log(`  ${domain}: ${counts.ok}/${counts.answered} measured`);
    }

    // A run where the provider never answered says nothing about the general
    // path - it is an outage, not a result. Fewer than three answered runs is
    // not a measurement, so the assertion needs a quorum; failing here on a
    // quota wall would report an exhausted free tier as a verdict on non-STEM
    // support.
    if (answered.length < 3) {
      console.warn(
        `DOMAIN BREADTH: only ${answered.length} of ${TOPICS.length} runs got a provider answer. ` +
          'Re-run when quota allows - not enough to assert a rate.',
      );
      return;
    }
    // The general path is the floor for every domain without a purpose-built
    // primitive, so it has to work at all - a zero here would mean the
    // fallback is broken, not that these domains need intent compilers.
    expect(succeeded).toBeGreaterThan(0);
  }, 900000);
});
