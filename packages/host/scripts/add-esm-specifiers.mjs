/**
 * Give the emitted JavaScript explicit `.js` extensions on its relative
 * imports.
 *
 * @remarks
 * This package is ESM (see `"type": "module"`), and Node's ESM loader requires
 * a real file path - `./compileBeatSource` is not resolvable, `./compileBeatSource.js`
 * is. TypeScript does not add those extensions under `module: "esnext"`, and
 * switching the whole package to `nodenext` would mean editing every source
 * file's imports to carry extensions, which is a much larger change for the
 * same outcome.
 *
 * A bundler does not care either way, so this only matters for a Node
 * consumer - which is exactly the consumer the authoring half of this package
 * is for: it needs the compiler and the filesystem, so it cannot run in a
 * browser at all.
 *
 * Only `.js` output is touched. The `.d.ts` files are left alone because
 * TypeScript resolves extensionless specifiers under the `node` module
 * resolution every consumer of this package already uses.
 */
import * as fs from 'fs';
import * as path from 'path';
import {fileURLToPath} from 'url';

const libDir = fileURLToPath(new URL('../lib', import.meta.url));

/** `from './x'`, `import('./x')`, `export * from './x'` - relative only. */
const RELATIVE_SPECIFIER = /(\bfrom\s*|\bimport\s*\(\s*)(['"])(\.\.?\/[^'"]+)\2/g;

function rewrite(file) {
  const original = fs.readFileSync(file, 'utf8');
  const rewritten = original.replace(
    RELATIVE_SPECIFIER,
    (match, prefix, quote, specifier) => {
      // Leave anything that already names a file or a directory index alone.
      if (/\.(js|json|mjs|cjs)$/.test(specifier)) return match;
      const target = path.resolve(path.dirname(file), specifier);
      const isDirectory = fs.existsSync(target) && fs.statSync(target).isDirectory();
      const resolved = isDirectory ? `${specifier}/index.js` : `${specifier}.js`;
      return `${prefix}${quote}${resolved}${quote}`;
    },
  );
  if (rewritten !== original) fs.writeFileSync(file, rewritten);
}

function walk(directory) {
  for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.js')) rewrite(full);
  }
}

if (fs.existsSync(libDir)) walk(libDir);
