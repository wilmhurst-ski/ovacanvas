/**
 * Run the standing regression corpus.
 *
 * @remarks
 * A wrapper rather than a bare `vitest` invocation because the corpus is
 * opt-in and needs `OVACANVAS_LIVE=1` - and setting that inline
 * (`OVACANVAS_LIVE=1 vitest ...`) is shell syntax that does not work on
 * Windows. Doing it here keeps one command that works everywhere.
 *
 * Usage: `npm run corpus`
 */
import {spawnSync} from 'child_process';
import * as path from 'path';
import {fileURLToPath} from 'url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const studio = path.join(repoRoot, 'packages', 'studio');

const result = spawnSync(
  process.execPath,
  [
    path.join(repoRoot, 'node_modules', 'vitest', 'vitest.mjs'),
    'run',
    'src/liveCorpus.test.ts',
  ],
  {
    cwd: studio,
    stdio: 'inherit',
    env: {...process.env, OVACANVAS_LIVE: '1'},
  },
);

process.exit(result.status ?? 1);
