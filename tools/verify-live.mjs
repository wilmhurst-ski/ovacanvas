/**
 * Run every verification that needs a live provider, in one command.
 *
 * @remarks
 * Usage: `npm run studio:dev` in one terminal, then `npm run verify:live`.
 *
 * These checks were being run by hand, one at a time, in an order that lived
 * only in someone's head - and the order matters, because the corpus run
 * produces the stored run that the replay consumes. Collecting them here is
 * not tidiness: it is the difference between a verification that happens and
 * one that is remembered to happen.
 *
 * Deliberately requires the dev server rather than starting one. A script that
 * spawns and reaps a server is a script that leaves one running when it is
 * interrupted, and the failure mode of that is a confusing port conflict on
 * the next run rather than a clear message.
 *
 * The two checks that need no provider are not here: they are ordinary tests
 * that run in the normal suite, and adding them to a live-only command would
 * suggest they need quota.
 */
import {spawnSync} from 'child_process';
import * as path from 'path';
import {fileURLToPath} from 'url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const vitest = path.join(repoRoot, 'node_modules', 'vitest', 'vitest.mjs');
const url = process.env.MVP_URL ?? 'http://127.0.0.1:5273';

/** The non-math question the MVP bar's first bullet is about. */
const NON_MATH_QUESTION =
  process.argv[2] ?? 'a timeline of the main events of the Roman Republic';

function run(label, command, args, options = {}) {
  console.log(`\n${'='.repeat(70)}\n${label}\n${'='.repeat(70)}`);
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    cwd: options.cwd ?? repoRoot,
    env: {...process.env, ...options.env},
  });
  return result.status === 0;
}

async function serverIsUp() {
  try {
    const response = await fetch(`${url}/api/health`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

const health = await serverIsUp();
if (!health) {
  console.error(
    `No dev server at ${url}.\n` +
      'Start it first:  npm run studio:dev\n' +
      '(or set MVP_URL to wherever it is running)',
  );
  process.exit(1);
}
console.log(
  `Provider: ${health.provider}/${health.model} · key ${health.hasKey ? 'present' : 'MISSING'}`,
);
if (!health.hasKey) {
  console.error('No provider key is configured, so nothing below can author a beat.');
  process.exit(1);
}

const results = [];

// 1. The corpus. This also writes the stored run that step 2 replays, which is
//    why the order is fixed rather than a set of independent checks.
results.push([
  'corpus (authoring reliability, and a stored run for the replay)',
  run('CORPUS', process.execPath, [path.join(repoRoot, 'tools', 'run-corpus.mjs')]),
]);

// 2. Replay the run that step 1 just stored, through the real gate, with no
//    provider. This is the half that used to be untestable without re-asking
//    the model.
results.push([
  'corpus replay (stored beats through the real gate, offline)',
  run(
    'CORPUS REPLAY',
    process.execPath,
    [vitest, 'run', 'src/corpusReplay.test.ts'],
    {cwd: path.join(repoRoot, 'packages', 'e2e')},
  ),
]);

// 3. A non-math question, end to end, in a real browser. The MVP bar's first
//    bullet: a learner can ask something outside maths and see it explained.
results.push([
  `live beat (non-math: "${NON_MATH_QUESTION}")`,
  run(
    'LIVE BEAT',
    process.execPath,
    [
      path.join(repoRoot, 'packages', 'studio', 'scripts', 'verify-live-mvp.mjs'),
      NON_MATH_QUESTION,
      path.join(repoRoot, '..', 'mvp-live.png'),
    ],
    {env: {MVP_URL: url}},
  ),
]);

// 4. The promise that holds when the provider does not answer at all.
results.push([
  'fallback (provider unavailable, learner still gets a beat)',
  run(
    'FALLBACK',
    process.execPath,
    [
      path.join(repoRoot, 'packages', 'studio', 'scripts', 'verify-fallback-mvp.mjs'),
      'explain why the sky is blue',
      path.join(repoRoot, '..', 'mvp-fallback.png'),
    ],
    {env: {MVP_URL: url}},
  ),
]);

console.log(`\n${'='.repeat(70)}\nSUMMARY\n${'='.repeat(70)}`);
for (const [label, ok] of results) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
}
const failed = results.filter(([, ok]) => !ok).length;
console.log(
  failed === 0
    ? '\nAll live checks passed.'
    : `\n${failed} live check(s) failed - see the output above.`,
);
process.exit(failed === 0 ? 0 : 1);
