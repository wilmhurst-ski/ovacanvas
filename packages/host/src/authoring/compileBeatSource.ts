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

interface CompilerCacheEntry {
  options: ts.CompilerOptions;
  baseHost: ts.CompilerHost;
  program?: ts.Program;
  fileCache: Map<string, ts.SourceFile>;
}

/**
 * Long-lived compiler program and AST cache keyed by projectRoot.
 *
 * @remarks
 * Tests the specific speed hypothesis from RESEARCH_FINDINGS.md §6:
 * By keeping a long-lived TypeScript program and AST cache across compile requests,
 * static declaration files and node_modules are parsed once on cold start,
 * collapsing subsequent compile times by over 10x.
 */
const COMPILER_CACHE = new Map<string, CompilerCacheEntry>();

export function clearCompilerCache(): void {
  COMPILER_CACHE.clear();
}

export function getCompilerCacheStats(): {
  readonly cachedRoots: number;
  readonly cachedFilesCount: number;
} {
  let totalFiles = 0;
  for (const entry of COMPILER_CACHE.values()) {
    totalFiles += entry.fileCache.size;
  }
  return {
    cachedRoots: COMPILER_CACHE.size,
    cachedFilesCount: totalFiles,
  };
}

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
 * Emits CommonJS, not ESM: the browser side (`resolveBeatSource` in
 * `@ovacanvas/host`'s main entry) runs the emitted code through a `require`
 * shim that hands back the same already-loaded `@ovacanvas/2d`/`core`
 * module instances the host page itself uses.
 */
export function compileBeatSource(
  source: string,
  projectRoot: string,
  virtualFileName = '__beat__.ts',
): CompileResult {
  let entry = compilerCache.get(projectRoot);
  if (!entry) {
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

    const baseHost = ts.createCompilerHost(options, true);
    entry = {options, baseHost, fileCache: new Map()};
    COMPILER_CACHE.set(projectRoot, entry);
  }

  const virtualPath = path.resolve(projectRoot, virtualFileName);
  const virtualSourceFile = ts.createSourceFile(
    virtualPath,
    source,
    entry.options.target ?? ts.ScriptTarget.ES2020,
    true,
    ts.ScriptKind.TS,
  );

  const host: ts.CompilerHost = {
    ...entry.baseHost,
    getSourceFile: (
      fileName,
      languageVersion,
      onError,
      shouldCreateNewSourceFile,
    ) => {
      const resolved = path.resolve(fileName);
      if (resolved === virtualPath) {
        return virtualSourceFile;
      }
      if (entry.fileCache.has(resolved)) {
        return entry.fileCache.get(resolved)!;
      }
      const sf = entry.baseHost.getSourceFile(
        fileName,
        languageVersion,
        onError,
        shouldCreateNewSourceFile,
      );
      if (sf) {
        entry.fileCache.set(resolved, sf);
      }
      return sf;
    },
    fileExists: fileName =>
      path.resolve(fileName) === virtualPath ||
      entry.baseHost.fileExists(fileName),
    readFile: fileName =>
      path.resolve(fileName) === virtualPath
        ? source
        : entry.baseHost.readFile(fileName),
  };

  const program = ts.createProgram(
    [virtualPath],
    entry.options,
    host,
    entry.program,
  );
  entry.program = program;

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
