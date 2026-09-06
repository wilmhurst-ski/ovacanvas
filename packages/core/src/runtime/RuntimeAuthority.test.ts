import {describe, expect, test, vi} from 'vitest';
import {GenerationState, RuntimeAuthority} from './RuntimeAuthority';

interface ProbeState {
  width: number;
  label: string;
}

interface NestedState {
  width: number;
  nested: {depth: number; deeper: {value: string}};
  list: number[];
}

function activeNestedAuthority() {
  const authority = new RuntimeAuthority<NestedState>({
    width: 120,
    nested: {depth: 1, deeper: {value: 'original'}},
    list: [1, 2, 3],
  });
  const first = authority.prepare();
  first.markReady();
  expect(authority.activate(first).ok).toBe(true);
  return {authority, generation: first};
}

function activeAuthority() {
  const authority = new RuntimeAuthority<ProbeState>({
    width: 120,
    label: 'a',
  });
  const first = authority.prepare();
  first.markReady();
  const result = authority.activate(first);
  expect(result.ok).toBe(true);
  return {authority, generation: first};
}

describe('RuntimeAuthority', () => {
  test('holding state is not permission to mutate it', () => {
    const {authority} = activeAuthority();
    const projection = authority.read();

    expect(projection.width).toBe(120);
    expect(Object.isFrozen(projection)).toBe(true);
    expect(() => {
      (projection as ProbeState).width = 999;
    }).toThrow();
    expect(authority.read().width).toBe(120);
    expect(authority.revision).toBe(0);
  });

  test('a capability from a retired generation fails closed', () => {
    const {authority, generation} = activeAuthority();
    const stale = generation.capability;

    const replacement = authority.prepare();
    replacement.markReady();
    const commit = authority.activate(replacement);

    expect(commit).toMatchObject({ok: true, retired: generation.id});
    expect(authority.generationState(generation.id)).toBe(
      GenerationState.Retired,
    );
    expect(stale.isValid()).toBe(false);
    expect(() => stale.write(draft => (draft.width = 777))).toThrow(
      /Rejected a mutation from generation/,
    );
    expect(authority.read().width).toBe(120);
    expect(authority.revision).toBe(0);

    // The generation that actually won can still write.
    expect(replacement.capability.write(draft => (draft.width = 200))).toBe(1);
    expect(authority.read().width).toBe(200);
  });

  test('a generation that is only preparing cannot mutate accepted state', () => {
    const {authority} = activeAuthority();
    const pending = authority.prepare();

    expect(pending.capability.isValid()).toBe(false);
    expect(() =>
      pending.capability.write(draft => (draft.width = 5)),
    ).toThrow();
    expect(authority.revision).toBe(0);
    expect(authority.read().width).toBe(120);
  });

  test('beginning preparation does not disturb the accepted generation', () => {
    const {authority, generation} = activeAuthority();
    const before = authority.read();

    authority.prepare();
    authority.prepare();

    expect(authority.activeGeneration).toBe(generation.id);
    expect(authority.read()).toBe(before);
    expect(authority.revision).toBe(0);
    expect(generation.capability.isValid()).toBe(true);
  });

  test('failed preparation leaves the accepted generation usable', () => {
    const {authority, generation} = activeAuthority();
    const attempt = authority.prepare();

    // Preparation throws before ever reporting readiness.
    try {
      throw new Error('probe-preparation-failure');
    } catch {
      attempt.discard();
    }

    expect(attempt.state).toBe(GenerationState.Discarded);
    expect(authority.activeGeneration).toBe(generation.id);
    expect(generation.capability.isValid()).toBe(true);
    expect(generation.capability.write(draft => (draft.label = 'b'))).toBe(1);
    expect(authority.read().label).toBe('b');
  });

  test('activation is refused when the work never became ready', () => {
    const {authority, generation} = activeAuthority();
    const attempt = authority.prepare();

    const result = authority.activate(attempt);

    expect(result).toMatchObject({ok: false, reason: 'not-ready'});
    expect(attempt.state).toBe(GenerationState.Discarded);
    expect(authority.activeGeneration).toBe(generation.id);
  });

  test('activation is refused when the accepted revision moved on', () => {
    const {authority, generation} = activeAuthority();

    const staged = authority.prepare();
    expect(staged.preparedAtRevision).toBe(0);
    staged.markReady();

    // The accepted projection advances while the replacement was preparing.
    generation.capability.write(draft => (draft.width = 300));
    expect(authority.revision).toBe(1);

    const result = authority.activate(staged);

    expect(result).toEqual({
      ok: false,
      reason: 'stale-revision',
      preparedAtRevision: 0,
      currentRevision: 1,
    });
    expect(staged.state).toBe(GenerationState.Discarded);
    expect(authority.activeGeneration).toBe(generation.id);
    expect(authority.read().width).toBe(300);
    expect(generation.capability.isValid()).toBe(true);
  });

  test('a refused generation cannot be activated on a later attempt', () => {
    const {authority, generation} = activeAuthority();
    const staged = authority.prepare();
    staged.markReady();
    generation.capability.write(draft => (draft.width = 1));

    expect(authority.activate(staged)).toMatchObject({ok: false});
    expect(authority.activate(staged)).toMatchObject({
      ok: false,
      reason: 'not-pending',
    });
    expect(authority.activeGeneration).toBe(generation.id);
  });

  test('work prepared against the current revision commits', () => {
    const {authority, generation} = activeAuthority();
    const staged = authority.prepare();
    staged.markReady();

    const result = authority.activate(staged);

    expect(result).toEqual({
      ok: true,
      activated: staged.id,
      retired: generation.id,
    });
    expect(staged.state).toBe(GenerationState.Active);
    expect(authority.activeGeneration).toBe(staged.id);
  });

  test('a retired generation survives activation so a transition can finish', () => {
    const {authority, generation} = activeAuthority();
    const staged = authority.prepare();
    staged.markReady();
    authority.activate(staged);

    // Outgoing work is still tracked, so the host may keep rendering it.
    expect(authority.generationState(generation.id)).toBe(
      GenerationState.Retired,
    );
    expect(authority.trackedGenerations).toBe(2);

    expect(authority.release(generation.id)).toBe(true);
    expect(authority.trackedGenerations).toBe(1);
    expect(authority.generationState(generation.id)).toBeNull();

    // Retiring the outgoing generation does not corrupt the incoming one.
    expect(authority.activeGeneration).toBe(staged.id);
    expect(staged.capability.write(draft => (draft.width = 42))).toBe(1);
    expect(authority.read().width).toBe(42);
  });

  test('the accepted generation cannot be released', () => {
    const {authority, generation} = activeAuthority();
    expect(authority.release(generation.id)).toBe(false);
    expect(authority.activeGeneration).toBe(generation.id);
  });

  test('a throwing mutator commits nothing', () => {
    const {authority, generation} = activeAuthority();

    expect(() =>
      generation.capability.write(draft => {
        draft.width = 999;
        throw new Error('mutator-failure');
      }),
    ).toThrow('mutator-failure');

    expect(authority.read().width).toBe(120);
    expect(authority.revision).toBe(0);
  });

  test('revision changes are observable exactly once per commit', () => {
    const {authority, generation} = activeAuthority();
    const seen: number[] = [];
    const unsubscribe = authority.onRevisionChanged.subscribe(revision =>
      seen.push(revision),
    );

    generation.capability.write(draft => (draft.width = 1));
    generation.capability.write(draft => (draft.width = 2));
    unsubscribe();
    generation.capability.write(draft => (draft.width = 3));

    // The first entry is the dispatcher's current value on subscribe.
    expect(seen).toEqual([0, 1, 2]);
    expect(authority.revision).toBe(3);
  });

  test('disposal is terminal and idempotent and revokes every capability', () => {
    const {authority, generation} = activeAuthority();
    const pending = authority.prepare();

    authority.dispose();
    authority.dispose();

    expect(authority.isDisposed).toBe(true);
    expect(authority.activeGeneration).toBeNull();
    expect(generation.capability.isValid()).toBe(false);
    expect(() =>
      generation.capability.write(draft => (draft.width = 1)),
    ).toThrow();
    expect(() => authority.prepare()).toThrow(/disposed RuntimeAuthority/);
    expect(authority.activate(pending)).toMatchObject({
      ok: false,
      reason: 'authority-disposed',
    });
  });

  // --- Reattack fix 1: the read-only projection must be read-only at depth ---

  test('nested state cannot be mutated through the read-only projection', () => {
    const {authority} = activeNestedAuthority();
    const projection = authority.read();

    for (const attempt of [
      () => ((projection as NestedState).nested.depth = 99),
      () => ((projection as NestedState).nested.deeper.value = 'hacked'),
      () => (projection as NestedState).list.push(4),
      () => ((projection as NestedState).list[0] = 99),
    ]) {
      expect(attempt).toThrow();
    }

    expect(authority.read().nested.depth).toBe(1);
    expect(authority.read().nested.deeper.value).toBe('original');
    expect(authority.read().list).toEqual([1, 2, 3]);
    expect(authority.revision).toBe(0);
  });

  test('every nested level of the projection is frozen', () => {
    const {authority} = activeNestedAuthority();
    const projection = authority.read();

    expect(Object.isFrozen(projection)).toBe(true);
    expect(Object.isFrozen(projection.nested)).toBe(true);
    expect(Object.isFrozen(projection.nested.deeper)).toBe(true);
    expect(Object.isFrozen(projection.list)).toBe(true);
  });

  test('the object handed to the constructor is not a back door', () => {
    const initial = {
      width: 120,
      nested: {depth: 1, deeper: {value: 'original'}},
      list: [1, 2, 3],
    };
    const authority = new RuntimeAuthority<NestedState>(initial);

    initial.nested.deeper.value = 'hacked';
    initial.list.push(4);
    initial.width = 999;

    expect(authority.read().nested.deeper.value).toBe('original');
    expect(authority.read().list).toEqual([1, 2, 3]);
    expect(authority.read().width).toBe(120);
    expect(authority.revision).toBe(0);
  });

  test('generation-scoped nested mutation still works normally', () => {
    const {authority, generation} = activeNestedAuthority();

    expect(
      generation.capability.write(draft => {
        draft.nested.deeper.value = 'updated';
        draft.list.push(4);
      }),
    ).toBe(1);

    expect(authority.read().nested.deeper.value).toBe('updated');
    expect(authority.read().list).toEqual([1, 2, 3, 4]);
    expect(Object.isFrozen(authority.read().nested.deeper)).toBe(true);
  });

  test('a committed nested write does not corrupt the previous snapshot', () => {
    const {authority, generation} = activeNestedAuthority();
    const before = authority.read();

    generation.capability.write(draft => (draft.nested.depth = 42));

    expect(before.nested.depth).toBe(1);
    expect(authority.read().nested.depth).toBe(42);
    expect(authority.read()).not.toBe(before);
  });

  test('a throwing nested mutator commits nothing', () => {
    const {authority, generation} = activeNestedAuthority();

    expect(() =>
      generation.capability.write(draft => {
        draft.nested.deeper.value = 'partial';
        throw new Error('mutator-failure');
      }),
    ).toThrow('mutator-failure');

    expect(authority.read().nested.deeper.value).toBe('original');
    expect(authority.revision).toBe(0);
  });

  test('state a freeze could not protect is refused', () => {
    expect(() => new RuntimeAuthority({items: new Map([['a', 1]])})).toThrow(
      /may not contain a Map/,
    );
    expect(() => new RuntimeAuthority({items: new Set([1])})).toThrow(
      /may not contain a Set/,
    );
  });

  // --- Reattack fix 2: handles belong to the authority that issued them ---

  test('a handle is refused by an authority that did not issue it', () => {
    const a = new RuntimeAuthority<ProbeState>({width: 1, label: 'a'});
    const b = new RuntimeAuthority<ProbeState>({width: 2, label: 'b'});

    const fromA = a.prepare();
    const fromB = b.prepare();

    // The ids collide by construction: both are per-authority counters.
    expect(fromA.id).toBe(fromB.id);
    expect(fromA.preparedAtRevision).toBe(fromB.preparedAtRevision);
    fromA.markReady();
    fromB.markReady();

    const result = b.activate(fromA);

    expect(result).toEqual({
      ok: false,
      reason: 'unknown-generation',
      preparedAtRevision: 0,
      currentRevision: 0,
    });

    // B is untouched: nothing accepted, its own pending work still pending.
    expect(b.activeGeneration).toBeNull();
    expect(b.generationState(fromB.id)).toBe(GenerationState.Ready);
    expect(b.read().label).toBe('b');
    expect(b.revision).toBe(0);

    // A is untouched: its handle was not discarded by the foreign attempt.
    expect(fromA.state).toBe(GenerationState.Ready);
    expect(a.activeGeneration).toBeNull();
    expect(a.read().label).toBe('a');
    expect(a.revision).toBe(0);

    // Both authorities still activate their own work normally.
    expect(a.activate(fromA)).toMatchObject({ok: true, activated: fromA.id});
    expect(b.activate(fromB)).toMatchObject({ok: true, activated: fromB.id});
    expect(a.activeGeneration).toBe(fromA.id);
    expect(b.activeGeneration).toBe(fromB.id);
  });

  test('a foreign handle is refused even when every visible field matches', () => {
    const a = new RuntimeAuthority<ProbeState>({width: 1, label: 'a'});
    const b = new RuntimeAuthority<ProbeState>({width: 1, label: 'a'});

    const bootA = a.prepare();
    bootA.markReady();
    a.activate(bootA);
    const bootB = b.prepare();
    bootB.markReady();
    b.activate(bootB);

    const stagedA = a.prepare();
    const stagedB = b.prepare();
    stagedA.markReady();
    stagedB.markReady();

    expect(stagedA.id).toBe(stagedB.id);
    expect(stagedA.preparedAtRevision).toBe(stagedB.preparedAtRevision);
    expect(a.revision).toBe(b.revision);

    expect(b.activate(stagedA)).toMatchObject({
      ok: false,
      reason: 'unknown-generation',
    });

    expect(b.activeGeneration).toBe(bootB.id);
    expect(b.generationState(stagedB.id)).toBe(GenerationState.Ready);
    expect(stagedA.state).toBe(GenerationState.Ready);
    expect(a.activeGeneration).toBe(bootA.id);
  });

  test('a disposed authority refuses a foreign handle without touching it', () => {
    const a = new RuntimeAuthority<ProbeState>({width: 1, label: 'a'});
    const b = new RuntimeAuthority<ProbeState>({width: 2, label: 'b'});
    const fromA = a.prepare();
    fromA.markReady();

    b.dispose();

    expect(b.activate(fromA)).toMatchObject({
      ok: false,
      reason: 'authority-disposed',
    });
    expect(fromA.state).toBe(GenerationState.Ready);
    expect(a.activate(fromA)).toMatchObject({ok: true});
  });

  test('the authority schedules nothing of its own', () => {
    const raf = vi.fn();
    const previous = globalThis.requestAnimationFrame;
    (globalThis as {requestAnimationFrame?: unknown}).requestAnimationFrame =
      raf;
    try {
      const {authority, generation} = activeAuthority();
      const staged = authority.prepare();
      staged.markReady();
      authority.activate(staged);
      staged.capability.write(draft => (draft.width = 7));
      authority.release(generation.id);
    } finally {
      (globalThis as {requestAnimationFrame?: unknown}).requestAnimationFrame =
        previous;
    }

    expect(raf).not.toHaveBeenCalled();
  });
});
