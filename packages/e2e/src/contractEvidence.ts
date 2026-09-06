import {
  ContractEvidenceRuntime,
  EvidenceMode,
  delay,
  rafLedger,
} from './contractEvidenceHost';

const Stages = document.querySelector<HTMLElement>('#stages')!;
const Status = document.querySelector<HTMLElement>('#status')!;
const Runtimes = {
  a: new ContractEvidenceRuntime('a', Stages),
  b: new ContractEvidenceRuntime('b', Stages),
};

const NodeTokens = new WeakMap<object, number>();
let NextNodeToken = 0;

function flat(result: {ok: boolean} & Record<string, unknown>) {
  return {
    ok: result.ok,
    reason: (result.reason as string) ?? null,
    generation: (result.generation as number) ?? null,
    activated: (result.activated as number) ?? null,
    retired: (result.retired as number) ?? null,
    preparedAtRevision: (result.preparedAtRevision as number) ?? null,
    currentRevision: (result.currentRevision as number) ?? null,
  };
}

function runtime(id: 'a' | 'b') {
  return Runtimes[id];
}

function totalRenders() {
  return Object.values(Runtimes).reduce((total, item) => {
    return total + (item.owner.current?.renderCount ?? 0);
  }, 0);
}

const Driver = {
  async ready() {
    await Promise.all([Runtimes.a.initialize(), Runtimes.b.initialize()]);
    Status.textContent = 'ready';
    return true;
  },

  snapshot: (id: 'a' | 'b') => runtime(id).snapshot(),

  async stage(id: 'a' | 'b', mode: EvidenceMode) {
    return flat(
      (await runtime(id).stage(mode)) as unknown as {
        ok: boolean;
      } & Record<string, unknown>,
    );
  },

  activate(id: 'a' | 'b') {
    return flat(
      runtime(id).activate() as unknown as {ok: boolean} & Record<
        string,
        unknown
      >,
    );
  },

  retireOutgoing: (id: 'a' | 'b') => runtime(id).owner.retireOutgoing(),
  clientPoint: (id: 'a' | 'b', kind: 'anchor-only' | 'overlap') =>
    runtime(id).clientPoint(kind),
  semanticProbe: (id: 'a' | 'b', kind: 'anchor-only' | 'overlap') =>
    runtime(id).semanticProbe(kind),
  reevaluate: (id: 'a' | 'b') => runtime(id).reevaluateCurrent(),

  nodeIdentity(id: 'a' | 'b', target: string) {
    const node = runtime(id).owner.current?.nodeFor(target);
    if (!node) return null;
    let token = NodeTokens.get(node);
    if (token === undefined) {
      token = ++NextNodeToken;
      NodeTokens.set(node, token);
    }
    return token;
  },

  settled: (id: 'a' | 'b', before: number) => runtime(id).settled(before),

  async idleWindow(milliseconds: number) {
    const before = {raf: rafLedger.requested, renders: totalRenders()};
    await delay(milliseconds);
    return {
      raf: rafLedger.requested - before.raf,
      renders: totalRenders() - before.renders,
    };
  },
};

declare global {
  interface Window {
    ovcContractEvidence: typeof Driver;
  }
}

window.ovcContractEvidence = Driver;
