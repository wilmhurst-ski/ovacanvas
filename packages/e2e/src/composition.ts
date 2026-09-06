import {CompositionRuntime, rafLedger, wait} from './compositionHost';

const Stages = document.querySelector<HTMLElement>('#stages')!;
const Status = document.querySelector<HTMLElement>('#status')!;

const Runtimes: Record<string, CompositionRuntime> = {
  a: new CompositionRuntime('A', Stages),
  b: new CompositionRuntime('B', Stages),
};

function runtime(id: string): CompositionRuntime {
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
    preparedAtRevision: (result.preparedAtRevision as number) ?? null,
    currentRevision: (result.currentRevision as number) ?? null,
  };
}

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

const Driver = {
  async ready() {
    for (const id of ['a', 'b']) {
      const target = runtime(id);
      await target.owner.stage();
      target.owner.activate();
    }
    Status.textContent = 'ready';
    return true;
  },

  snapshot: (id: string) => runtime(id).snapshot(),

  async stage(id: string) {
    return flat(
      (await runtime(id).owner.stage()) as unknown as {ok: boolean} & Record<
        string,
        unknown
      >,
    );
  },

  activate: (id: string) =>
    flat(
      runtime(id).owner.activate() as unknown as {ok: boolean} & Record<
        string,
        unknown
      >,
    ),

  retireOutgoing: (id: string) => runtime(id).owner.retireOutgoing(),
  advanceOverlap: (id: string, steps: number) =>
    runtime(id).advanceOverlap(steps),
  raiseOutgoing: (id: string, raised: boolean) =>
    runtime(id).raiseOutgoing(raised),

  clientPoint: (id: string, x: number, y: number) =>
    runtime(id).clientPoint(x, y),
  rateHandlePoint: (id: string) => runtime(id).rateHandlePoint(),

  commit: (id: string) => runtime(id).owner.current?.commitOpen() ?? null,
  discard: (id: string) => runtime(id).owner.current?.discardOpen() ?? null,
  inspect: (id: string, target: string) =>
    runtime(id).owner.current?.inspect(target) ?? null,

  play: (id: string) => runtime(id).owner.current?.play(),
  stop: (id: string) => {
    runtime(id).owner.current?.stop();
    runtime(id).owner.outgoing?.stop();
  },

  /** Attempt an accepted write from a named presentation. */
  writeFrom(id: string, which: 'current' | 'outgoing', rate: number) {
    const owner = runtime(id).owner;
    const presentation = which === 'current' ? owner.current : owner.outgoing;
    if (!presentation) return null;
    try {
      return presentation.capability.write(draft => {
        draft.rate = rate;
      });
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

  /** Whether an old presentation still holds an exploration identity. */
  staleExploration(id: string) {
    const outgoing = runtime(id).owner.outgoing;
    return outgoing ? outgoing.openExploration : null;
  },

  async settled(id: string, before: number) {
    const current = runtime(id).owner.current;
    if (!current) return false;
    const deadline = Date.now() + 4000;
    while (current.renderCount <= before && Date.now() < deadline) {
      await wait(4);
    }
    return current.renderCount > before;
  },

  /** Wait until pending coalesced render work has drained. */
  async quiesce(limit = 2000) {
    const deadline = Date.now() + limit;
    let previous = -1;
    while (Date.now() < deadline) {
      const total = renderTotal('a') + renderTotal('b');
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

declare global {
  interface Window {
    ovcComposition: typeof Driver;
  }
}

window.ovcComposition = Driver;
