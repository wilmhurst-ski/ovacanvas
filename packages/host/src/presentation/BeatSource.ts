import type {View2D} from '@ovacanvas/2d';
import * as ovacanvas2d from '@ovacanvas/2d';
import type {ThreadGeneratorFactory} from '@ovacanvas/core';
import * as ovacanvasCore from '@ovacanvas/core';
import type {BeatAuditSpec, BeatManifest} from './BeatManifest';

/** The shape a compiled beat module must export. */
interface CompiledBeatModule {
  default?: unknown;
  buildAuditSpec?: (view: View2D) => BeatAuditSpec;
}

/**
 * The only modules a beat's compiled `require(...)` calls may resolve to -
 * the same module instances this page itself already loaded, not fresh
 * copies. See `compileBeatSource`'s doc comment for why a second copy would
 * silently break `instanceof`/signal identity across the boundary.
 */
const KNOWN_MODULES = new Map<string, unknown>([
  ['@ovacanvas/2d', ovacanvas2d],
  ['@ovacanvas/core', ovacanvasCore],
]);

function beatRequire(specifier: string): unknown {
  const found = KNOWN_MODULES.get(specifier);
  if (!found) {
    throw new Error(
      `beat source imports unsupported module "${specifier}" - only ` +
        `${Array.from(KNOWN_MODULES.keys()).join(', ')} are available`,
    );
  }
  return found;
}

/**
 * Turn already-compiled beat JS (see `@ovacanvas/host/authoring`'s
 * `compileBeatSource`) into a `BeatManifest`.
 *
 * @remarks
 * Runs the CommonJS output through a `require` shim rather than a native
 * `import()` of a blob URL. A blob URL has no base for bare-specifier
 * resolution, so a real browser fails outright on `import '@ovacanvas/2d'`
 * from one; the shim also sidesteps that by construction, since it hands
 * back this page's own already-loaded module instances instead of asking
 * the browser to resolve anything.
 *
 * The compiled module must export a default that is either a bare
 * generator function or a `makeScene2D(...)` description, plus a named
 * `buildAuditSpec(view)` - the same convention `BeatManifest` already
 * requires, just sourced from the module instead of hand-written.
 */
export async function resolveBeatSource(
  id: string,
  title: string,
  code: string,
): Promise<BeatManifest> {
  const module: {exports: CompiledBeatModule} = {exports: {}};
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const factory = new Function('exports', 'require', 'module', code) as (
    exports: CompiledBeatModule,
    require: (specifier: string) => unknown,
    module: {exports: CompiledBeatModule},
  ) => void;
  factory(module.exports, beatRequire, module);

  const exported = module.exports.default;
  const runner = (
    typeof exported === 'function'
      ? exported
      : (exported as {config?: unknown} | undefined)?.config
  ) as ThreadGeneratorFactory<View2D> | undefined;

  if (typeof runner !== 'function') {
    throw new Error(
      `beat ${id}'s default export is neither a generator function nor a makeScene2D(...) description`,
    );
  }
  if (typeof module.exports.buildAuditSpec !== 'function') {
    throw new Error(`beat ${id} does not export buildAuditSpec(view)`);
  }

  return {id, title, runner, buildAuditSpec: module.exports.buildAuditSpec};
}
