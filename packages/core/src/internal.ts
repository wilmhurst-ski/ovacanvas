/**
 * OvaCanvas internal implementation surface.
 *
 * @remarks
 * **This is not a public API and it is not the Ovareel ↔ OvaCanvas contract.**
 *
 * Everything reachable from here is OvaCanvas implementation machinery: the
 * runtime realization authority, the generation lifecycle it hands out, and
 * the presentation-generation coordination built on top of them. Their names,
 * shapes and granularity are deliberately **not frozen**, they carry no
 * compatibility promise, and they may change without a major version.
 *
 * It exists because other OvaCanvas workspaces and the private end-to-end
 * fixtures genuinely need these types, and the alternative - re-exporting them
 * from the package root - made implementation machinery indistinguishable from
 * public API. Reaching for this entry point should feel like a deliberate act,
 * because it is one.
 *
 * If you are designing a protocol, a compiler output format, or anything that
 * another system has to keep working against, do not build it on these names.
 *
 * @packageDocumentation
 */

export * from './runtime';
