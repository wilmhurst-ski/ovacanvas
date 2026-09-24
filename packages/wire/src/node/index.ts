/**
 * Node-only half of `@ovacanvas/wire`: the TypeScript backstop and document
 * files. Kept out of the main entry so a browser bundle never pulls in the
 * TypeScript compiler or `fs`.
 */
export {
  DEFAULT_COMPILE_ROOT,
  compileDocument,
  locateDiagnostic,
  type CompiledDocument,
} from './compile.js';
export {
  PreviewRenderer,
  findAdjustments,
  type Adjustment,
  type AuditFindingJson,
  type NodeLayout,
  type PreviewOutcome,
  type RenderedFrame,
} from './preview.js';
