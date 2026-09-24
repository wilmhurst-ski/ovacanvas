/**
 * `@ovacanvas/wire` - author OvaCanvas beats as typed scene documents.
 *
 * This entry is browser-safe: catalogue, document model, validator and code
 * generator only. The TypeScript backstop, file storage and preview renderer
 * need Node and live in `@ovacanvas/wire/node`.
 */
export * from './catalogue/index.js';
export {
  extractEmbeddedDocument,
  generateBeatSource,
  type GeneratedBeat,
  type SourceMap,
} from './codegen/generate.js';
export {
  constructionOrder,
  finalOpacities,
  initialOpacities,
  stepDuration,
  timelineDuration,
  walkSteps,
} from './document/analysis.js';
export * from './document/edit.js';
export * from './document/issues.js';
export * from './document/model.js';
export {
  KITS,
  prepareDocument,
  usesKits,
  validateDocument,
  type PreparedDocument,
} from './document/prepare.js';
export {
  validateCoreDocument,
  type ValidateOptions,
} from './document/validate.js';
export {
  checkValue,
  type ValueProblem,
  type ValueRef,
} from './document/values.js';
export type {Beat, KitNode, KitSpec} from './kits/types.js';
export {
  compileLesson,
  isLessonDocument,
  type CompiledLesson,
  type LessonDocument,
  type LessonPart,
  type LessonScene,
} from './lesson/compile.js';
export {
  CORE_COMPONENTS,
  coreComponentReference,
  documentReference,
  kitReference,
} from './reference.js';
