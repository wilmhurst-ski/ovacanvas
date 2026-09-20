import {compileBeatSource, type CompileDiagnostic} from './compileBeatSource';
import {attemptCompileRepairDetailed} from './repairCompileErrors';

/**
 * Where an authored module stopped on its way to being stageable.
 *
 * @remarks
 * - `compile`: it never typechecked, and TypeScript had no mechanical fix to
 *   offer - the content itself is wrong, so a re-authoring round trip is the
 *   only way forward.
 * - `repair`: a real code-fix *was* applied and the file still does not
 *   compile - the caller should retry with the compiler's current
 *   diagnostics, not the pre-repair ones.
 * - `resolve`: it compiled cleanly but is not a stageable beat module (no
 *   generator default export, or no `buildAuditSpec`).
 */
export type AuthoringFailureStage = 'compile' | 'repair' | 'resolve';

export interface CompiledBeatModule {
  readonly ok: true;
  readonly code: string;
  /** Whether a mechanical compile repair had to run to get here. */
  readonly repaired: boolean;
}

export interface BeatModuleFailure {
  readonly ok: false;
  readonly stage: AuthoringFailureStage;
  readonly diagnostics: readonly CompileDiagnostic[];
  readonly message: string;
}

export type BeatModuleResult = CompiledBeatModule | BeatModuleFailure;

/**
 * Turn authored TypeScript source into compiled CommonJS text the browser can
 * resolve into a `BeatManifest`, trying the cheap mechanical compile repair
 * before giving up on the candidate.
 *
 * @remarks
 * Node-only, by construction: `compileBeatSource` uses `ts.sys` and real
 * filesystem module resolution. That is not a limitation to work around - it
 * is the real boundary this pipeline is built on. Compiling belongs wherever
 * the API keys and the installed `@ovacanvas/*` type declarations are (a
 * server), and resolving belongs in the browser that already has one live
 * engine instance. The `code` string this returns is exactly what crosses
 * that boundary; see `authorBeat` for the composed chain.
 *
 * Mechanical repair is tried before reporting a failure because the class of
 * error it covers - a real export the model forgot to import, an unambiguous
 * typo - is one the compiler already knows how to fix in milliseconds, while
 * the alternative is a full model round trip measured in seconds.
 */
export function compileBeatModule(
  source: string,
  projectRoot: string,
  virtualFileName = '__beat__.ts',
): BeatModuleResult {
  const direct = compileBeatSource(source, projectRoot, virtualFileName);
  if (direct.ok) return {ok: true, code: direct.code, repaired: false};

  const repair = attemptCompileRepairDetailed(
    source,
    projectRoot,
    virtualFileName,
  );
  if (repair.result?.ok) {
    return {ok: true, code: repair.result.code, repaired: true};
  }

  // Repair either found nothing fixable, or applied fixes that still did not
  // compile. Only the first case has diagnostics worth reporting from the
  // original text - in the second, TypeScript's own fixes moved the code on
  // and the original diagnostics no longer describe what is wrong.
  return {
    ok: false,
    stage: repair.appliedFixes ? 'repair' : 'compile',
    diagnostics: direct.diagnostics,
    message: summariseDiagnostics(direct.diagnostics),
  };
}

export function summariseDiagnostics(
  diagnostics: readonly CompileDiagnostic[],
): string {
  if (diagnostics.length === 0) return 'The module did not compile.';
  return diagnostics
    .map(diagnostic => {
      const at =
        diagnostic.line === null
          ? ''
          : ` (line ${diagnostic.line}:${diagnostic.column})`;
      return `TS${at} ${diagnostic.message}`;
    })
    .join('\n');
}
