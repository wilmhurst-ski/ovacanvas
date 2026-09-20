import * as path from 'path';
// Default import, not `import * as ts`: TypeScript ships as CommonJS, and
// Node's ESM interop puts the whole module on `.default`, leaving every named
// export (including `ts.sys`) undefined on the namespace. A default import
// works under Node's loader and under a bundler's interop alike, which is what
// lets this module run outside a bundler at all.
import ts from 'typescript';

export interface CompileDiagnostic {
  readonly message: string;
  readonly line: number | null;
  readonly column: number | null;
}

export interface CompileSuccess {
  readonly ok: true;
  readonly code: string;
}

export interface CompileFailure {
  readonly ok: false;
  readonly diagnostics: readonly CompileDiagnostic[];
}

export type CompileResult = CompileSuccess | CompileFailure;

/**
 * Typecheck and transpile one beat's source text as if it were a real file
 * inside `projectRoot`, resolving `@ovacanvas/*` imports against that
 * project's own installed type declarations.
 *
 * @remarks
 * Node-only (uses `ts.sys` and real filesystem module resolution) -
 * deliberately kept out of `src/index.ts` so a browser bundle importing
 * `@ovacanvas/host` never pulls in the TypeScript compiler. Call this from
 * wherever a beat's source text first exists (an authoring server, a local
 * eval harness), before ever constructing a `Player` for it.
 *
 * This is the gate that would have caught `new Node()` with no arguments or
 * `Line({start, end, strokeWidth})` before a single frame was rendered - both
 * are already `tsc` errors today, but nothing in the generation path ever
 * ran `tsc` against generated output, so they only ever surfaced as a
 * silent render hang. A diagnostic here replaces an LLM regeneration round
 * trip (seconds) with an in-process check (milliseconds).
 *
 * Emits CommonJS, not ESM: the browser side (`resolveBeatSource` in
 * `@ovacanvas/host`'s main entry) runs the emitted code through a `require`
 * shim that hands back the *same* already-loaded `@ovacanvas/2d`/`core`
 * module instances the host page itself uses, rather than a native
 * `import()` resolving the bare specifiers itself. A beat loaded through its
 * own bare-specifier resolution would get a second copy of the engine, and
 * `instanceof Node` / signal identity checks across that boundary would
 * silently break - the shim is what keeps every beat on the one real engine
 * instance the rest of the host already runs.
 */
export function compileBeatSource(
  source: string,
  projectRoot: string,
  virtualFileName = '__beat__.ts',
): CompileResult {
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
    : {options: {} as ts.CompilerOptions, fileNames: [] as string[]};

  const options: ts.CompilerOptions = {
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

  const virtualPath = path.resolve(projectRoot, virtualFileName);
  const virtualSourceFile = ts.createSourceFile(
    virtualPath,
    source,
    options.target ?? ts.ScriptTarget.ES2020,
    true,
    ts.ScriptKind.TS,
  );

  const baseHost = ts.createCompilerHost(options, true);
  const host: ts.CompilerHost = {
    ...baseHost,
    getSourceFile: (
      fileName,
      languageVersion,
      onError,
      shouldCreateNewSourceFile,
    ) =>
      path.resolve(fileName) === virtualPath
        ? virtualSourceFile
        : baseHost.getSourceFile(
            fileName,
            languageVersion,
            onError,
            shouldCreateNewSourceFile,
          ),
    fileExists: fileName =>
      path.resolve(fileName) === virtualPath || baseHost.fileExists(fileName),
    readFile: fileName =>
      path.resolve(fileName) === virtualPath
        ? source
        : baseHost.readFile(fileName),
  };

  const program = ts.createProgram([virtualPath], options, host);
  const diagnostics = [
    ...program.getSyntacticDiagnostics(virtualSourceFile),
    ...program.getSemanticDiagnostics(virtualSourceFile),
  ];

  if (diagnostics.length > 0) {
    return {ok: false, diagnostics: diagnostics.map(toDiagnostic)};
  }

  let output = '';
  program.emit(virtualSourceFile, (_fileName, text) => {
    output = text;
  });

  return {ok: true, code: output};
}

function toDiagnostic(diagnostic: ts.Diagnostic): CompileDiagnostic {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
  if (diagnostic.file && diagnostic.start !== undefined) {
    const {line, character} = diagnostic.file.getLineAndCharacterOfPosition(
      diagnostic.start,
    );
    return {message, line: line + 1, column: character + 1};
  }
  return {message, line: null, column: null};
}
