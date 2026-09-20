import * as fs from 'fs';
import * as path from 'path';
import {fileURLToPath} from 'url';
import {describe, expect, it} from 'vitest';
import {
  compareRuns,
  formatCorpusReport,
  formatTrendReport,
  runCorpus,
  trendAcrossRuns,
  type CorpusFile,
  type CorpusRun,
} from './regressionCorpus';
import {buildVerifiedApiSection} from './systemPrompt';

/**
 * Run the standing corpus against a live provider.
 *
 * @remarks
 * Opt-in (`OVACANVAS_LIVE=1`). Persists a timestamped JSON run and compares it
 * against the most recent stored one, because the comparison - not the raw
 * success rate - is what tells you whether a change broke something.
 *
 * A regression fails this test on purpose. A corpus that only reports is a
 * corpus people stop reading.
 */
const LIVE = process.env.OVACANVAS_LIVE === '1';
const HERE = fileURLToPath(new URL('.', import.meta.url));
const CORPUS_ROOT = path.resolve(HERE, '..');
const CORPUS_FILE = path.join(CORPUS_ROOT, 'corpus', 'topics.json');
const RESULTS_DIR = path.join(CORPUS_ROOT, 'corpus-results');

function loadLocalEnv(): NodeJS.ProcessEnv {
  const file = path.join(CORPUS_ROOT, '.env.local');
  if (!fs.existsSync(file)) return process.env;
  const env: NodeJS.ProcessEnv = {...process.env};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && match[2]) env[match[1]] = match[2];
  }
  return env;
}

/** Every stored run, oldest first. Unreadable files are skipped, not fatal. */
function storedRuns(): CorpusRun[] {
  if (!fs.existsSync(RESULTS_DIR)) return [];
  return fs
    .readdirSync(RESULTS_DIR)
    .filter(name => name.endsWith('.json'))
    .sort()
    .flatMap(name => {
      try {
        return [
          JSON.parse(
            fs.readFileSync(path.join(RESULTS_DIR, name), 'utf8'),
          ) as CorpusRun,
        ];
      } catch {
        // A half-written file from an interrupted run must not stop the next
        // one from being compared against everything that did complete.
        return [];
      }
    });
}

describe.skipIf(!LIVE)('standing regression corpus', () => {
  it('runs the corpus and reports any change since the last run', async () => {
    const env = loadLocalEnv();
    const corpus = JSON.parse(
      fs.readFileSync(CORPUS_FILE, 'utf8'),
    ) as CorpusFile;
    expect(corpus.topics.length).toBeGreaterThan(0);

    // Read the history BEFORE writing this run, so the trend is the stored
    // runs plus this one - not this one twice.
    const history = storedRuns();
    const before = history.at(-1) ?? null;
    const current = await runCorpus({
      corpus,
      authorOptions: {
        apiSection: buildVerifiedApiSection({
          resolveFrom: path.resolve(CORPUS_ROOT, '..', 'host'),
        }),
        projectRoot: path.resolve(CORPUS_ROOT, '..', 'host'),
        env,
      },
    });

    fs.mkdirSync(RESULTS_DIR, {recursive: true});
    const stamp = current.startedAt.replace(/[:.]/g, '-');
    fs.writeFileSync(
      path.join(RESULTS_DIR, `${stamp}.json`),
      JSON.stringify(current, null, 2),
    );

    const comparison = before ? compareRuns(before, current) : undefined;
    console.log(formatCorpusReport(current, comparison));

    // The rolling view, which is the only one that can surface a topic that is
    // flaky rather than broken. Printed every run so a slow drift is visible
    // without anyone having to go looking for it.
    const trend = trendAcrossRuns([...history, current]);
    console.log(formatTrendReport(trend));

    if (!comparison) {
      console.log('(first stored run - nothing to compare against yet)');
      return;
    }
    if (comparison.regressions.length === 0) return;

    throw new Error(
      `${comparison.regressions.length} topic(s) regressed since ${before!.startedAt}: ` +
        comparison.regressions.map(change => change.id).join(', '),
    );
  }, 1800000);
});
