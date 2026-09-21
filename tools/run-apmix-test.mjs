import {spawnSync} from 'child_process';
import * as path from 'path';
import {fileURLToPath} from 'url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const studio = path.join(repoRoot, 'packages', 'studio');
const pattern = process.argv[2] ?? '';

const args = [
  path.join(repoRoot, 'node_modules', 'vitest', 'vitest.mjs'),
  'run',
  'src/liveApmixMultiDomain.test.ts',
];

if (pattern) {
  args.push('-t', pattern);
}

const result = spawnSync(
  process.execPath,
  args,
  {
    cwd: studio,
    stdio: 'inherit',
    env: {
      ...process.env,
      OVACANVAS_LIVE: '1',
      OVACANVAS_PROVIDER: 'apmix',
    },
  },
);

process.exit(result.status ?? 1);
