/**
 * Scene readiness auditing: geometric collision/coverage/safe-area/route
 * checks, temporal frame auditing, and semantic choreography-contract
 * validation.
 *
 * @remarks
 * Promoted from three divergent copies (two skill-package helper files and
 * an independent reimplementation inside `packages/template`) into one
 * tested module, so a scene can no longer opt out of the checks by omitting
 * an import, faking a call, or hand-rolling a looser version. See
 * `evaluateVisualAudit` for the primary entry point a readiness gate should
 * call, and `auditStaticChecksAcrossFrames` for the temporal equivalent.
 */

export * from './choreography';
export * from './collisions';
export * from './colorDiscipline';
export * from './composition';
export * from './coverage';
export * from './motion';
export * from './multiFrame';
export * from './report';
export * from './routes';
export * from './safeArea';
export * from './textNotation';
export * from './types';
export * from './visibility';
export * from './worldBBox';
