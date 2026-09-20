/**
 * Compile the package, then post-process the emitted JavaScript.
 *
 * @remarks
 * A wrapper rather than `tsc && node scripts/add-esm-specifiers.mjs` for one
 * concrete reason: `tsc` exits non-zero on a pre-existing, unrelated type
 * error in a dependency's source, and `&&` would then skip the post-process
 * step - leaving a `lib` that Node cannot import, with no visible sign of why.
 * The two steps are independent, so they run independently and the original
 * exit code is still reported.
 */
import {spawnSync} from 'child_process';
import * as path from 'path';
import {fileURLToPath} from 'url';

const packageDir = fileURLToPath(new URL('..', import.meta.url));

const tsc = spawnSync(
  process.execPath,
  [path.join(packageDir, '../../node_modules/typescript/bin/tsc'), '-p', 'tsconfig.build.json'],
  {cwd: packageDir, stdio: 'inherit'},
);

const specifiers = spawnSync(
  process.execPath,
  [path.join(packageDir, 'scripts/add-esm-specifiers.mjs')],
  {cwd: packageDir, stdio: 'inherit'},
);

if (specifiers.status !== 0) process.exit(specifiers.status ?? 1);
process.exit(tsc.status ?? 1);
