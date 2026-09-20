import type {BeatManifest} from '../presentation/BeatManifest';
import {
  compileBeatModule,
  type AuthoringFailureStage,
} from './compileBeatModule';
import type {CompileDiagnostic} from './compileBeatSource';

/**
 * Turn already-compiled beat JS into a `BeatManifest`. Satisfied by
 * `resolveBeatSource` in this package's main entry.
 */
export type ResolveBeatModule = (
  id: string,
  title: string,
  code: string,
) => Promise<BeatManifest>;

export interface AuthorBeatOptions {
  readonly id: string;
  readonly title: string;
  /** The authored TypeScript module text, exactly as a model wrote it. */
  readonly source: string;
  /** The project whose installed `@ovacanvas/*` types the module compiles against. */
  readonly projectRoot: string;
  readonly virtualFileName?: string;
  /**
   * Defaults to this package's own `resolveBeatSource`. Override it to run
   * the chain somewhere that is not a browser (see the class-level remarks).
   */
  readonly resolve?: ResolveBeatModule;
}

export type AuthorBeatResult =
  | {
      readonly ok: true;
      readonly manifest: BeatManifest;
      readonly code: string;
      readonly repaired: boolean;
    }
  | {
      readonly ok: false;
      readonly stage: AuthoringFailureStage;
      readonly diagnostics: readonly CompileDiagnostic[];
      readonly message: string;
    };

/**
 * Chain authored source text into a stageable `BeatManifest`: compile, repair
 * mechanically if the compiler has a fix, then resolve the compiled module
 * into a beat.
 *
 * @remarks
 * **This chain spans two environments on purpose, and that is the shape the
 * product actually has.** Compiling needs `ts.sys`, the real filesystem and
 * the installed `@ovacanvas/*` declarations - it belongs on a server, which
 * is also the only place an API key should ever live. Resolving needs one
 * live `@ovacanvas/2d` module instance and a real DOM - it belongs in the
 * browser. The compiled `code` string is the whole interface between them.
 *
 * So a Node caller passes its own `resolve` (or lets it default and never
 * reaches that step), while the browser end calls `resolveBeatSource`
 * directly on the string the server produced. `resolve` exists as a parameter
 * rather than being hardwired so this function can be exercised on both sides
 * of that seam without either side pretending to be the other.
 *
 * Every failure is returned as a structured result rather than thrown: the
 * caller has to distinguish "ask the model to rewrite this" from "this is not
 * a beat module" to decide what to do next, and a bare throw cannot express
 * which.
 */
export async function authorBeat(
  options: AuthorBeatOptions,
): Promise<AuthorBeatResult> {
  const compiled = compileBeatModule(
    options.source,
    options.projectRoot,
    options.virtualFileName,
  );
  if (!compiled.ok) return compiled;

  const resolve = options.resolve ?? defaultResolve;
  try {
    const manifest = await resolve(options.id, options.title, compiled.code);
    return {
      ok: true,
      manifest,
      code: compiled.code,
      repaired: compiled.repaired,
    };
  } catch (error) {
    return {
      ok: false,
      stage: 'resolve',
      diagnostics: [],
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Loaded lazily so a Node-only caller of `authorBeat` never pulls the full
 * `@ovacanvas/2d` barrel (and its DOM dependencies) into its process just by
 * importing this module.
 */
async function defaultResolve(
  id: string,
  title: string,
  code: string,
): Promise<BeatManifest> {
  const {resolveBeatSource} = await import('../presentation/BeatSource');
  return resolveBeatSource(id, title, code);
}
