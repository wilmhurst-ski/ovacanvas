import {compileBeatModule} from '@ovacanvas/host/authoring';
import * as fs from 'fs';
import * as path from 'path';
import {afterAll, beforeAll, describe, expect, test} from 'vitest';
import {unexpectedConsoleErrors} from './consoleErrors';
import type {FoundationApp} from './foundationApp';
import {startFoundation} from './foundationApp';

/**
 * Replay a stored corpus run through the real gate, without a provider.
 *
 * @remarks
 * The corpus measures the authoring half - topic to compiling module - and
 * until its results carried the source, that was all it could ever measure:
 * the staging half could only be exercised by asking the model again. This
 * closes that, and the value is highest exactly when the provider is
 * unavailable, which is when you most want to re-run the deterministic half
 * against real model output rather than against a hand-written fixture.
 *
 * Fixtures prove the gate works on scenes someone wrote to pass it. This
 * proves it works on scenes a model actually produced.
 *
 * Skips cleanly when no stored run carries sources: `corpus-results/` is
 * gitignored, so a fresh checkout has none, and a test that fails for that
 * reason would be a test people learn to ignore.
 */
const PROJECT_ROOT = path.resolve(__dirname, '..', '..', 'host');
const RESULTS_DIR = path.resolve(
  __dirname,
  '..',
  '..',
  'studio',
  'corpus-results',
);

interface StoredResult {
  id: string;
  topic: string;
  ok: boolean;
  source?: string;
}

interface StoredRun {
  startedAt: string;
  results: StoredResult[];
}

/** The most recent stored run that actually carries sources. */
function latestReplayableRun(): StoredRun | null {
  if (!fs.existsSync(RESULTS_DIR)) return null;
  const files = fs
    .readdirSync(RESULTS_DIR)
    .filter(name => name.endsWith('.json'))
    .sort()
    .reverse();

  for (const name of files) {
    try {
      const run = JSON.parse(
        fs.readFileSync(path.join(RESULTS_DIR, name), 'utf8'),
      ) as StoredRun;
      if (run.results?.some(result => typeof result.source === 'string')) {
        return run;
      }
    } catch {
      // A half-written file from an interrupted run; try the one before it.
    }
  }
  return null;
}

const RUN = latestReplayableRun();

describe.skipIf(RUN === null)('replaying a stored corpus run', () => {
  let app: FoundationApp;

  beforeAll(async () => {
    app = await startFoundation('/lessonPipeline.html');
    await app.page.waitForFunction(
      () => (window as any).ovcLesson !== undefined,
      undefined,
      {polling: 100},
    );
    await app.page.evaluate(() => (window as any).ovcLesson.boot('replay'));
  }, 120000);

  afterAll(async () => {
    await app?.stop();
  }, 60000);

  test('every stored beat still compiles, stages and passes its audit', async () => {
    const stored = RUN!;
    const replayable = stored.results.filter(
      result => result.ok && typeof result.source === 'string',
    );
    expect(replayable.length).toBeGreaterThan(0);

    const failures: string[] = [];
    const summary: string[] = [];

    for (const result of replayable) {
      const compiled = compileBeatModule(
        result.source!,
        PROJECT_ROOT,
        `__${result.id}__.ts`,
      );
      if (!compiled.ok) {
        failures.push(`${result.id}: no longer compiles`);
        continue;
      }

      const staged = await app.page.evaluate(
        payload =>
          (window as any).ovcLesson.stageSource(
            payload.id,
            payload.title,
            payload.code,
          ),
        {id: result.id, title: result.topic, code: compiled.code},
      );

      const ok = staged?.result?.ok === true;
      summary.push(`${ok ? 'ok  ' : 'FAIL'} ${result.id}`);
      if (!ok) {
        // Distinguish "the manifest could not be resolved" from "the gate
        // refused it": they point at different halves of the pipeline, and a
        // bare "unknown" hides which one broke.
        const why =
          staged?.resolved === false
            ? `could not resolve a manifest (${staged.error})`
            : `gate refused it (${staged?.result?.reason}${
                staged?.result?.detail ? `: ${staged.result.detail}` : ''
              })`;
        failures.push(`${result.id}: ${why}`);
      }
    }

    console.log(`CORPUS REPLAY (run ${stored.startedAt})`);
    for (const line of summary) console.log(`  ${line}`);

    // Nothing in a stored run should stop working while the engine stays put.
    // A failure here means the gate changed under output that used to pass,
    // which is precisely the regression a corpus exists to catch - and this
    // finds it without spending a token.
    expect(failures).toEqual([]);
  }, 900000);

  test('the replay logged nothing unexpected', () => {
    expect(unexpectedConsoleErrors(app.consoleErrors)).toEqual([]);
    expect(app.pageErrors).toEqual([]);
  });
});
