/**
 * Mirror each `packages/*` directory into `node_modules/@ovacanvas/*`.
 *
 * @remarks
 * **Why this exists.** npm workspaces normally install `node_modules/@ovacanvas/*`
 * as symlinks into `packages/*`. In this checkout they are plain directory
 * copies instead, because the tree was produced by a file-level copy that
 * followed symlinks and materialised their targets. Nothing in the toolchain
 * knows that, so the moment a package is rebuilt every consumer keeps reading
 * the stale copy - with no error, just old behaviour, which is a genuinely
 * nasty way to lose an hour.
 *
 * **Two ways to fix that, and why this one is the default.** Replacing the
 * copies with junctions is the "correct" npm shape, and it was tried here: it
 * makes TypeScript resolve `@ovacanvas/2d` through to `packages/2d`, and 2d's
 * emitted declarations contain a self-referencing
 * `import("@ovacanvas/2d/src/lib/components")`. That drags 2d's raw `.tsx`
 * sources into every consumer's compile, which then fails on `--jsx` and on
 * module declarations it never asked about. The copy layout is the one this
 * checkout builds cleanly under, so the copies are kept current instead.
 *
 * A checkout made with a normal `npm install` needs none of this - npm's
 * symlinks stay correct by themselves.
 *
 * Nested `node_modules` travel with each copy: npm does not hoist everything
 * (2d's `gl-matrix` is a real example), and a copy that drops them breaks
 * module resolution at runtime.
 *
 * Usage: `node tools/sync-workspace-packages.mjs`
 */
import * as fs from 'fs';
import * as path from 'path';
import {fileURLToPath} from 'url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const packagesDir = path.join(repoRoot, 'packages');
const linkRoot = path.join(repoRoot, 'node_modules', '@ovacanvas');

const names = fs
  .readdirSync(packagesDir, {withFileTypes: true})
  .filter(entry => entry.isDirectory())
  .map(entry => entry.name);

for (const name of names) {
  const source = path.join(packagesDir, name);
  const destination = path.join(linkRoot, name);

  // Only real workspace packages - skip scratch directories.
  if (!fs.existsSync(path.join(source, 'package.json'))) continue;

  if (fs.existsSync(destination)) {
    fs.rmSync(destination, {recursive: true, force: true});
  }
  fs.cpSync(source, destination, {recursive: true, dereference: true});
  console.log(`${name}: synced`);
}
