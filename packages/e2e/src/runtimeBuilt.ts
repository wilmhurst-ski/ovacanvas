import type {CandidateKind} from './runtimeBuiltHost';
import {RuntimeBuiltRuntime, rafLedger, wait} from './runtimeBuiltHost';

const Stages = document.querySelector<HTMLElement>('#stages')!;
const Status = document.querySelector<HTMLElement>('#status')!;

const Runtime = new RuntimeBuiltRuntime('a', Stages);

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

const NodeTokens = new WeakMap<object, number>();
let NextToken = 0;

function renderTotal(): number {
  const owner = Runtime.owner;
  return (
    (owner.current?.renderCount ?? 0) +
    (owner.outgoing?.renderCount ?? 0) +
    (owner.pendingCandidate?.renderCount ?? 0)
  );
}

const Driver = {
  async ready() {
    Runtime.nextKind = 'compiled';
    await Runtime.owner.stage();
    Runtime.owner.activate();
    Status.textContent = 'ready';
    return true;
  },

  snapshot: () => Runtime.snapshot(),

  async stage(kind: CandidateKind) {
    Runtime.nextKind = kind;
    return flat(
      (await Runtime.owner.stage()) as unknown as {ok: boolean} & Record<
        string,
        unknown
      >,
    );
  },

  activate: () =>
    flat(
      Runtime.owner.activate() as unknown as {ok: boolean} & Record<
        string,
        unknown
      >,
    ),

  retireOutgoing: () => Runtime.owner.retireOutgoing(),
  advanceOverlap: (steps: number) => Runtime.advanceOverlap(steps),
  raiseOutgoing: (raised: boolean) => Runtime.raiseOutgoing(raised),

  clientPoint: (x: number, y: number) => Runtime.clientPoint(x, y),
  rateHandlePoint: () => Runtime.rateHandlePoint(),

  commit: () => Runtime.owner.current?.commitOpen() ?? null,
  discard: () => Runtime.owner.current?.discardOpen() ?? null,
  inspect: (target: string) => Runtime.owner.current?.inspect(target) ?? null,

  /** Attempt an accepted write from a named presentation. */
  writeFrom(which: 'current' | 'outgoing', rate: number) {
    const owner = Runtime.owner;
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
  nodeIdentity(which: 'current' | 'outgoing', target: string) {
    const owner = Runtime.owner;
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

  async settled(before: number) {
    const current = Runtime.owner.current;
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
      const total = renderTotal();
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
    const before = {raf: rafLedger.requested, renders: renderTotal()};
    await wait(ms);
    return {
      raf: rafLedger.requested - before.raf,
      renders: renderTotal() - before.renders,
    };
  },
};

declare global {
  interface Window {
    ovcRuntimeBuilt: typeof Driver;
  }
}

window.ovcRuntimeBuilt = Driver;
