import {describe, expect, it} from 'vitest';
import {DependencyContext} from './DependencyContext';

describe('DependencyContext.getPendingPromiseSummaries', () => {
  it('is empty when no async work is in flight', async () => {
    await DependencyContext.consumePromises();
    expect(DependencyContext.getPendingPromiseSummaries()).toEqual([]);
  });

  it('reports a pending promise with a creation site, then clears it once settled', async () => {
    let resolve!: (value: number) => void;
    const promise = new Promise<number>(res => (resolve = res));
    DependencyContext.collectPromise(promise);

    const pending = DependencyContext.getPendingPromiseSummaries();
    expect(pending).toHaveLength(1);
    expect(pending[0].index).toBe(0);
    expect(typeof pending[0].site).toBe('string');
    // The silent-hang case this API diagnoses: while the promise is
    // unresolved it stays reported - a never-resolving one simply never
    // leaves the list, which is exactly what the host needs to observe.
    expect(DependencyContext.hasPromises()).toBe(true);

    resolve(1);
    await DependencyContext.consumePromises();
    expect(DependencyContext.getPendingPromiseSummaries()).toEqual([]);
  });
});
