import type {View2D} from '@ovacanvas/2d';
import {makeScene2D} from '@ovacanvas/2d';
import type {
  FullSceneDescription,
  Project,
  ThreadGeneratorFactory,
  Versions,
} from '@ovacanvas/core';
import {MetaFile, bootstrap} from '@ovacanvas/core';

/**
 * `bootstrap` stores these on the project; nothing in this package reads them
 * back. They exist for the editor's version footer, which a beat presentation
 * never renders.
 */
const RuntimeVersions: Versions = {
  core: 'host-runtime',
  two: 'host-runtime',
  ui: null,
  vitePlugin: null,
};

/**
 * Build a runnable `Project` around a scene generator, with no Vite `?scene`
 * / `?project` transform and no backing source file.
 *
 * @remarks
 * Promoted from `packages/e2e/src/runtimeBuiltHost.ts`'s `buildRuntimeProject`
 * (there labelled a non-normative capability proof). It is exactly what that
 * transform would otherwise have generated: `name` is the scene's own label
 * (used for node keys and thread names, not semantic identity), `onReplaced`
 * is the hot-reload channel and is deliberately omitted, and the meta files
 * hold no backing source - metadata stays in memory and is never written
 * anywhere. This is what lets a beat be constructed straight from a
 * server-delivered module instead of a bundled project.
 */
export function buildBeatProject(
  name: string,
  runner: ThreadGeneratorFactory<View2D>,
): Project {
  // Asserted straight to the `unknown`-parameterized shape `bootstrap`
  // actually declares: `FullSceneDescription<T>`'s constructor field is
  // contravariant in `T`, so a concretely-typed description is not itself
  // assignable to `FullSceneDescription<unknown>` even though this exact
  // object is.
  const description = {
    ...makeScene2D(runner),
    name,
  } as unknown as FullSceneDescription<unknown>;

  return bootstrap(
    name,
    RuntimeVersions,
    [],
    {scenes: [description]},
    new MetaFile(`${name}.project`),
    new MetaFile(`${name}.settings`),
  );
}
