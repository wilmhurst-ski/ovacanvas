/**
 * Ask each configured provider one trivial question and report what happened.
 *
 * @remarks
 * Usage:
 *   npm run check:provider                    # every provider with a key
 *   npm run check:provider -- tokenharbor     # just one
 *
 * A wrapper rather than a bare vitest call for the same reason as the corpus
 * runner: the check is opt-in and needs `OVACANVAS_LIVE=1`, and setting that
 * inline is shell syntax that does not work on Windows.
 */
import {spawnSync} from 'child_process';
import * as path from 'path';
import {fileURLToPath} from 'url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const studio = path.join(repoRoot, 'packages', 'studio');
const only = process.argv[2];

const result = spawnSync(
  process.execPath,
  [
    path.join(repoRoot, 'node_modules', 'vitest', 'vitest.mjs'),
    'run',
    'src/liveProviderCheck.test.ts',
  ],
  {
    cwd: studio,
    stdio: 'inherit',
    env: {
      ...process.env,
      OVACANVAS_LIVE: '1',
      ...(only ? {OVACANVAS_PROVIDER: only} : {}),
    },
  },
);

process.exit(result.status ?? 1);
