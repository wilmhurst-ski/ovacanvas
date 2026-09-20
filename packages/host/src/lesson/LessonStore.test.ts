import {describe, expect, it} from 'vitest';
import {LessonStore} from './LessonStore';

describe('LessonStore', () => {
  it('starts with the given question and no beats', () => {
    const store = new LessonStore(
      'lesson-1',
      'why does the derivative measure slope?',
    );
    expect(store.read().question).toBe(
      'why does the derivative measure slope?',
    );
    expect(store.read().beats).toHaveLength(0);
    expect(store.revision).toBe(0);
  });

  it('accepts a beat only through an activated generation, and bumps the revision', () => {
    const store = new LessonStore('lesson-1', 'q');
    const handle = store.prepare();
    handle.markReady();
    const activation = store.authority.activate(handle);
    expect(activation.ok).toBe(true);

    const revision = store.acceptBeat(handle.capability, {
      id: 'beat-1',
      title: 'orient the curve',
      attempt: 0,
    });

    expect(revision).toBe(1);
    expect(store.revision).toBe(1);
    expect(store.read().beats).toEqual([
      {id: 'beat-1', title: 'orient the curve', attempt: 0},
    ]);
  });

  it('refuses a write through a capability whose generation was never activated', () => {
    const store = new LessonStore('lesson-1', 'q');
    const handle = store.prepare();
    handle.markReady();
    // Never activated.
    expect(() =>
      store.acceptBeat(handle.capability, {id: 'x', title: 'x', attempt: 0}),
    ).toThrow();
  });

  it('does not let a superseded generation write after a newer one is accepted', () => {
    const store = new LessonStore('lesson-1', 'q');

    const first = store.prepare();
    first.markReady();
    store.authority.activate(first);

    const second = store.prepare();
    second.markReady();
    store.authority.activate(second);

    expect(() =>
      store.acceptBeat(first.capability, {id: 'stale', title: 'x', attempt: 0}),
    ).toThrow();
  });

  it('rejects a projection containing a Map, Set or Date at write time', () => {
    const store = new LessonStore('lesson-1', 'q');
    const handle = store.prepare();
    handle.markReady();
    store.authority.activate(handle);

    expect(() =>
      handle.capability.write(draft => {
        (draft as unknown as {tags: Set<string>}).tags = new Set(['x']);
      }),
    ).toThrow();
  });
});
