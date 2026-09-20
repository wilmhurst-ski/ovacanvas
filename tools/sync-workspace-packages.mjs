/**
 * Ensure each `packages/*` package is linked into `node_modules/@ovacanvas/*`
 * via directory junctions (Windows) or symlinks (POSIX).
 *
 * @remarks
 * Eliminates physical copies so rebuilt packages are immediately visible
 * across the workspace without stale-read bugs.
 *
 * Usage: `node tools/sync-workspace-packages.mjs`
 */
import * as fs from 'fs';
import * as path from 'path';
import {fileURLToPath} from 'url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const packagesDir = path.join(repoRoot, 'packages');
const linkRoot = path.join(repoRoot, 'node_modules', '@ovacanvas');

if (!fs.existsSync(linkRoot)) {
  fs.mkdirSync(linkRoot, {recursive: true});
}

const names = fs
  .readdirSync(packagesDir, {withFileTypes: true})
  .filter(entry => entry.isDirectory())
  .map(entry => entry.name);

for (const name of names) {
  const source = path.join(packagesDir, name);
  const destination = path.join(linkRoot, name);

  // Only real workspace packages - skip scratch directories.
  if (!fs.existsSync(path.join(source, 'package.json'))) continue;

  const stat = fs.lstatSync(destination, {throwIfNoEntry: false});
  if (stat) {
    if (stat.isSymbolicLink()) {
      try {
        const target = fs.readlinkSync(destination);
        if (path.resolve(linkRoot, target) === path.resolve(source)) {
          console.log(`${name}: already linked`);
          continue;
        }
      } catch {
        // Fall through to recreate link
      }
    }
    fs.rmSync(destination, {recursive: true, force: true});
  }

  const linkType = process.platform === 'win32' ? 'junction' : 'dir';
  fs.symlinkSync(source, destination, linkType);
  console.log(`${name}: linked (${linkType})`);
}
