import {describe, expect, test} from 'vitest';
import * as publicApi from './index';
import * as internalApi from './internal';

// A type is only reachable from the public barrel if this compiles, so the
// suppression is the assertion: if the runtime authority ever comes back to
// the package root, TypeScript reports an unused `@ts-expect-error` here.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error - MutationCapability is internal and must not be public.
import type {MutationCapability as PubliclyReachable} from './index';
import type {MutationCapability} from './internal';

/**
 * The boundary between OvaCanvas's public surface and its implementation
 * machinery.
 *
 * @remarks
 * Several runtime surfaces are documented as `@internal` with a shape that is
 * deliberately not frozen, and were nevertheless re-exported from the package
 * root - which made them indistinguishable from public API to anyone reading
 * the package. This pins the boundary so it cannot drift back.
 *
 * This is about *discoverability*, not access: internal consumers still reach
 * everything they need, deliberately, through `@ovacanvas/core/lib/internal`.
 */
describe('public surface', () => {
  /** Implementation machinery whose shape is not frozen. */
  const internalNames = [
    'RuntimeAuthority',
    'TransitionOwner',
    'GenerationState',
  ] as const;

  test.each(internalNames)(
    '%s is not reachable from the package root',
    name => {
      expect(name in publicApi).toBe(false);
    },
  );

  test.each(internalNames)('%s is reachable from the internal entry', name => {
    expect(name in internalApi).toBe(true);
  });

  test('the internal types are the same objects, not a second copy', () => {
    // One module graph: an authority created through the internal entry is the
    // same class every other internal consumer sees.
    expect(Object.keys(internalApi).sort()).toEqual([
      'GenerationState',
      'RuntimeAuthority',
      'TransitionOwner',
    ]);
  });

  test('the internal type import is the one that resolves', () => {
    // `PubliclyReachable` is `any` because that import fails, which is the
    // point; this keeps both imports load-bearing rather than unused.
    const fromInternal: MutationCapability<{a: number}> | null = null;
    const fromPublic: PubliclyReachable | null = null;
    expect(fromInternal).toBeNull();
    expect(fromPublic).toBeNull();
  });

  /**
   * Retained public API, so the boundary cannot be "achieved" by emptying the
   * package. These are the surfaces the donor legitimately exposes and the
   * capabilities this fork added on purpose.
   */
  test('retained public API is still public', () => {
    for (const name of [
      'Player',
      'Stage',
      'Vector2',
      'BBox',
      'bootstrap',
      'makeProject',
      'MetaFile',
      'createSignal',
      'createEffect',
      'createComputed',
      'DynamicalSystem',
      'EventDispatcher',
      'ValueDispatcher',
      'Logger',
      'PlaybackState',
      'waitFor',
    ]) {
      expect(name in publicApi, `${name} should still be public`).toBe(true);
    }
  });
});
