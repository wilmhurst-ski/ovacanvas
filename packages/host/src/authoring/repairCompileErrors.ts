import * as path from 'path';
// See the identical note in `compileBeatSource.ts`: a namespace import of this
// CommonJS package leaves `ts.sys` undefined under Node's ESM loader.
import ts from 'typescript';
import {compileBeatSource, type CompileResult} from './compileBeatSource';

/**
 * Bounds how many mechanical fix-and-recheck rounds one repair attempt gets.
 * Each round fixes exactly one diagnostic (see the loop's own remarks on
 * why one at a time, not batched) - a real beat rarely has more than a
 * handful of independently-fixable mistakes, so this is a safety valve
 * against a pathological file, not a limit real content ever approaches.
 */
const MAX_REPAIR_ROUNDS = 8;

/** {@inheritDoc attemptCompileRepairDetailed} */
export interface CompileRepairAttempt {
  /** Whether at least one real TypeScript code-fix was applied. */
  readonly appliedFixes: boolean;
  /** The repaired module, or `null` when repair did not end in a clean compile. */
  readonly result: CompileResult | null;
}

/**
 * Mechanically repair the class of compile error that has nothing to do
 * with content or intent: a real, existing export the model forgot to
 * import, a misspelled name that is an unambiguous typo of a real one, a
 * missing `await`, and the other fixes TypeScript's own language service
 * already knows how to make - using the SAME fixer VS Code's own "Quick
 * Fix" lightbulb calls, not a hand-rolled guess.
 *
 * @remarks
 * This is the direct answer to a real, repeated observation: a model that
 * writes `GeoPath({feature: WORLD_LAND, ...})` and simply forgets to import
 * `WORLD_LAND` from `@ovacanvas/2d` has made a purely mechanical mistake -
 * the name exists, the fix is unambiguous, and a full LLM round trip to add
 * one import line is real seconds spent on something a compiler already
 * knows how to do in milliseconds. Reserved for diagnostics with a real
 * TypeScript-provided fix; anything semantic (wrong triangle math, a
 * genuinely wrong argument value) has no fix action at all and falls
 * through to the normal re-authoring loop untouched.
 *
 * Never returns a "repaired" result that doesn't actually compile clean -
 * every fix is verified by a real, fresh compile before being trusted, the
 * same gate {@link compileBeatSource} itself is.
 */
export function attemptCompileRepair(
  source: string,
  projectRoot: string,
  virtualFileName = '__beat__.ts',
): CompileResult | null {
  return attemptCompileRepairDetailed(source, projectRoot, virtualFileName)
    .result;
}

/**
 * The same repair pass as {@link attemptCompileRepair}, plus the one fact its
 * bare `CompileResult | null` return cannot express: whether TypeScript had
 * any real fix to offer at all.
 *
 * @remarks
 * `null` from `attemptCompileRepair` means one of two genuinely different
 * things to an authoring caller - "this mistake has no mechanical fix, ask
 * the model to rewrite it" versus "a fix was applied and the file *still*
 * does not compile, so the model needs to see what the compiler says now".
 * Both want different retry feedback, and the difference is only observable
 * inside the loop. Kept as a separate export rather than a changed return
 * type so every existing caller of `attemptCompileRepair` keeps its exact
 * behaviour.
 */
export function attemptCompileRepairDetailed(
  source: string,
  projectRoot: string,
  virtualFileName = '__beat__.ts',
): CompileRepairAttempt {
  const initial = compileBeatSource(source, projectRoot, virtualFileName);
  if (initial.ok) return {appliedFixes: false, result: null}; // nothing to repair

  const options = resolveCompilerOptions(projectRoot);
  const virtualPath = path.resolve(projectRoot, virtualFileName);

  let current = source;
  let anyFixApplied = false;

  for (let round = 0; round < MAX_REPAIR_ROUNDS; round++) {
    const service = createLanguageService(
      virtualPath,
      () => current,
      options,
      projectRoot,
    );
    const diagnostics = service.getSemanticDiagnostics(virtualPath);
    if (diagnostics.length === 0) break;

    // One diagnostic per round, not every fixable one batched together:
    // applying a fix can shift or invalidate the text spans of every OTHER
    // diagnostic found in the same pass (an added import line moves every
    // line below it), so the only position data safe to trust is freshly
    // computed against the text it was computed from. Re-diagnosing after
    // each single edit costs milliseconds; trusting stale spans risks
    // silently corrupting the file.
    const fixed = applyFirstAvailableFix(
      service,
      virtualPath,
      diagnostics,
      current,
    );
    if (!fixed) break; // nothing left that TypeScript itself knows how to fix

    current = fixed;
    anyFixApplied = true;
  }

  if (!anyFixApplied) return {appliedFixes: false, result: null};

  const final = compileBeatSource(current, projectRoot, virtualFileName);
  return {appliedFixes: true, result: final.ok ? final : null};
}

function applyFirstAvailableFix(
  service: ts.LanguageService,
  virtualPath: string,
  diagnostics: readonly ts.Diagnostic[],
  source: string,
): string | null {
  for (const diagnostic of diagnostics) {
    if (diagnostic.start === undefined || diagnostic.length === undefined) {
      continue;
    }
    let fixes: readonly ts.CodeFixAction[];
    try {
      fixes = service.getCodeFixesAtPosition(
        virtualPath,
        diagnostic.start,
        diagnostic.start + diagnostic.length,
        [diagnostic.code],
        ts.getDefaultFormatCodeSettings(),
        {},
      );
    } catch {
      continue; // a fix provider throwing on this particular file is not fatal - just skip it
    }
    const [fix] = fixes;
    if (!fix) continue;

    const changes = fix.changes.flatMap(change => change.textChanges);
    if (changes.length === 0) continue;
    return applyTextChanges(source, changes);
  }
  return null;
}

/** Apply every change in one pass, from the end of the file backward, so an
 * earlier edit's inserted/removed length never invalidates a later change's
 * (still-untouched) span. */
function applyTextChanges(
  source: string,
  changes: readonly ts.TextChange[],
): string {
  const ordered = [...changes].sort((a, b) => b.span.start - a.span.start);
  let result = source;
  for (const change of ordered) {
    const before = result.slice(0, change.span.start);
    const after = result.slice(change.span.start + change.span.length);
    result = before + change.newText + after;
  }
  return result;
}

function resolveCompilerOptions(projectRoot: string): ts.CompilerOptions {
  const configPath = ts.findConfigFile(
    projectRoot,
    ts.sys.fileExists,
    'tsconfig.json',
  );
  const parsed = configPath
    ? ts.parseJsonConfigFileContent(
        ts.readConfigFile(configPath, ts.sys.readFile).config,
        ts.sys,
        path.dirname(configPath),
      )
    : {options: {} as ts.CompilerOptions};

  return {
    ...parsed.options,
    noEmit: false,
    declaration: false,
    declarationMap: false,
    sourceMap: false,
    inlineSourceMap: false,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
    skipLibCheck: true,
    isolatedModules: true,
    noEmitOnError: false,
  };
}

/**
 * A minimal `LanguageServiceHost` over one virtual, mutable file plus real
 * filesystem resolution for everything else (`@ovacanvas/2d`/`core`'s real,
 * installed type declarations) - the same real-project resolution
 * {@link compileBeatSource} already uses, so a fix only ever names an
 * import that genuinely resolves in this project, never a guess.
 */
function createLanguageService(
  virtualPath: string,
  getSource: () => string,
  options: ts.CompilerOptions,
  projectRoot: string,
): ts.LanguageService {
  const versions = new Map<string, number>();
  let lastSource: string | null = null;

  const host: ts.LanguageServiceHost = {
    getScriptFileNames: () => [virtualPath],
    getScriptVersion: fileName => {
      if (path.resolve(fileName) !== virtualPath) return '0';
      const source = getSource();
      if (source !== lastSource) {
        lastSource = source;
        versions.set(fileName, (versions.get(fileName) ?? 0) + 1);
      }
      return String(versions.get(fileName) ?? 0);
    },
    getScriptSnapshot: fileName => {
      if (path.resolve(fileName) === virtualPath) {
        return ts.ScriptSnapshot.fromString(getSource());
      }
      if (!ts.sys.fileExists(fileName)) return undefined;
      return ts.ScriptSnapshot.fromString(ts.sys.readFile(fileName) ?? '');
    },
    getCurrentDirectory: () => projectRoot,
    getCompilationSettings: () => options,
    getDefaultLibFileName: opts => ts.getDefaultLibFilePath(opts),
    fileExists: fileName =>
      path.resolve(fileName) === virtualPath || ts.sys.fileExists(fileName),
    readFile: fileName =>
      path.resolve(fileName) === virtualPath
        ? getSource()
        : ts.sys.readFile(fileName),
    readDirectory: (...args) => ts.sys.readDirectory(...args),
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
  };

  return ts.createLanguageService(host, ts.createDocumentRegistry());
}
