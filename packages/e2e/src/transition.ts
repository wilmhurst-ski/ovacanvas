import type {CandidateOptions} from './transitionHost';
import {TransitionRuntime, rafLedger, wait} from './transitionHost';

const Stages = document.querySelector<HTMLElement>('#stages')!;
const Status = document.querySelector<HTMLElement>('#status')!;

const Runtimes: Record<string, TransitionRuntime> = {
  a: new TransitionRuntime('A', Stages),
  b: new TransitionRuntime('B', Stages),
};

function runtime(id: string): TransitionRuntime {
  const found = Runtimes[id.toLowerCase()];
  if (!found) throw new Error(`unknown runtime ${id}`);
  return found;
}

/** Flatten an owner result: this workspace inherits a non-strict tsconfig. */
function flat(result: {ok: boolean} & Record<string, unknown>) {
  return {
    ok: result.ok,
    reason: (result.reason as string) ?? null,
    detail: (result.detail as string) ?? null,
    generation: (result.generation as number) ?? null,
    activated: (result.activated as number) ?? null,
    retired: (result.retired as number) ?? null,
    resolvedInteractions: (result.resolvedInteractions as number) ?? null,
    presentationError: (result.presentationError as string) ?? null,
    preparedAtRevision: (result.preparedAtRevision as number) ?? null,
    currentRevision: (result.currentRevision as number) ?? null,
  };
}

const Driver = {
  async ready() {
    // Bring both runtimes to one active presentation each.
    for (const id of ['a', 'b']) {
      const target = runtime(id);
      await target.stage();
      target.activate();
    }
    Status.textContent = 'ready';
    return true;
  },

  snapshot: (id: string) => runtime(id).snapshot(),

  async stage(id: string, options: CandidateOptions = {}) {
    return flat(
      (await runtime(id).stage(options)) as unknown as {ok: boolean} & Record<
        string,
        unknown
      >,
    );
  },

  /** Begin staging without awaiting it, so cancellation can race it. */
  stageDetached(id: string, options: CandidateOptions = {}) {
    Pending[id.toLowerCase()] = runtime(id).stage(options);
    return true;
  },

  async awaitPending(id: string) {
    const pending = Pending[id.toLowerCase()];
    if (!pending) throw new Error('nothing pending');
    const result = flat(
      (await pending) as unknown as {ok: boolean} & Record<string, unknown>,
    );
    Pending[id.toLowerCase()] = null;
    return result;
  },

  activate: (id: string) =>
    flat(
      runtime(id).activate() as unknown as {ok: boolean} & Record<
        string,
        unknown
      >,
    ),

  cancelCandidate: (id: string) => runtime(id).owner.cancelCandidate(),
  retireOutgoing: (id: string) => runtime(id).retireOutgoing(),
  advanceOverlap: (id: string, steps: number) =>
    runtime(id).advanceOverlap(steps),
  writeAccepted: (id: string, rate: number) => runtime(id).writeAccepted(rate),
  beginExploration: (id: string) => runtime(id).beginExploration(),
  disposeRuntime: (id: string) => runtime(id).dispose(),

  /** Whether the outgoing presentation can still write. */
  outgoingCanWrite(id: string) {
    const outgoing = runtime(id).owner.outgoing;
    if (!outgoing) return null;
    try {
      outgoing.capability.write(draft => {
        draft.rate = 99;
      });
      return true;
    } catch {
      return false;
    }
  },

  /** Whether the candidate can write before activation. */
  candidateCanWrite(id: string) {
    const candidate = runtime(id).owner.pendingCandidate;
    if (!candidate) return null;
    try {
      candidate.capability.write(draft => {
        draft.rate = 98;
      });
      return true;
    } catch {
      return false;
    }
  },

  /** Node object identity for a semantic target, compared across generations. */
  nodeIdentity(id: string, which: 'current' | 'outgoing', target: string) {
    const owner = runtime(id).owner;
    const presentation = which === 'current' ? owner.current : owner.outgoing;
    if (!presentation) return null;
    const node = presentation.nodeFor(target);
    if (!node) return null;
    let token = NodeTokens.get(node);
    if (token === undefined) {
      token = ++NextToken;
      NodeTokens.set(node, token);
    }
    return token;
  },

  /** Wait until pending coalesced render work has drained. */
  async quiesce(limit = 2000) {
    const deadline = Date.now() + limit;
    let previous = -1;
    while (Date.now() < deadline) {
      const total = ['a', 'b'].reduce((sum, id) => {
        const owner = Runtimes[id].owner;
        return (
          sum +
          (owner.current?.renderCount ?? 0) +
          (owner.outgoing?.renderCount ?? 0) +
          (owner.pendingCandidate?.renderCount ?? 0)
        );
      }, 0);
      if (total === previous) return true;
      previous = total;
      await wait(80);
    }
    return false;
  },

  /**
   * Measure a quiet window from inside the page.
   *
   * @remarks
   * Not driven from a Playwright poll: `waitForFunction` runs on animation
   * frames and would supply the very frames this counts.
   */
  async idleWindow(ms: number) {
    const before = {
      raf: rafLedger.requested,
      a: renderTotal('a'),
      b: renderTotal('b'),
    };
    await wait(ms);
    return {
      raf: rafLedger.requested - before.raf,
      a: renderTotal('a') - before.a,
      b: renderTotal('b') - before.b,
    };
  },
};

const Pending: Record<string, Promise<unknown> | null> = {a: null, b: null};
const NodeTokens = new WeakMap<object, number>();
let NextToken = 0;

function renderTotal(id: string): number {
  const owner = Runtimes[id].owner;
  return (
    (owner.current?.renderCount ?? 0) +
    (owner.outgoing?.renderCount ?? 0) +
    (owner.pendingCandidate?.renderCount ?? 0)
  );
}

declare global {
  interface Window {
    ovcTransition: typeof Driver;
  }
}

window.ovcTransition = Driver;
