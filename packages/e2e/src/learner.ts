import {LearnerHost, flatten, rafLedger, wait} from './learnerHost';

const Stages = document.querySelector<HTMLElement>('#stages')!;
const Status = document.querySelector<HTMLElement>('#status')!;

function makeContainer(id: string) {
  const container = document.createElement('div');
  container.className = 'stage';
  container.dataset.runtime = id;
  Stages.append(container);
  return container;
}

const Hosts: Record<string, LearnerHost> = {
  a: new LearnerHost('A', makeContainer('A')),
  b: new LearnerHost('B', makeContainer('B')),
};

function host(id: string): LearnerHost {
  const found = Hosts[id.toLowerCase()];
  if (!found) throw new Error(`unknown runtime ${id}`);
  return found;
}

const Driver = {
  async ready() {
    const deadline = Date.now() + 30000;
    while ((!Hosts.a.ready || !Hosts.b.ready) && Date.now() < deadline) {
      await wait(5);
    }
    if (!Hosts.a.ready || !Hosts.b.ready) {
      throw new Error('runtimes never rendered');
    }
    Status.textContent = 'ready';
    return true;
  },

  snapshot: (id: string) => host(id).snapshot(),
  events: (id: string) => host(id).events,
  clearEvents: (id: string) => host(id).clearEvents(),
  clientPoint: (id: string, x: number, y: number) => host(id).clientPoint(x, y),
  rateHandlePoint: (id: string) => host(id).rateHandlePoint(),
  settled: (id: string, before: number) => host(id).settled(before),

  inspect(id: string, target: string) {
    const result = flatten(host(id).controller.inspect(target));
    return {
      ok: result.ok,
      reason: result.reason,
      data: result.value ? result.value.data : null,
    };
  },

  commit: (id: string) => host(id).commitOpen(),
  discard: (id: string) => host(id).discardOpen(),
  setPolicy: (id: string, name: string) => host(id).setPolicy(name),
  retire: (id: string) => host(id).retireGeneration(),
  resetScene: (id: string) => host(id).resetScene(),
  disposeRuntime: (id: string) => host(id).dispose(),
  stopPlayback: (id: string) => host(id).stopPlayback(),

  play: (id: string) => host(id).play(),
  resume: (id: string) => host(id).resumeAfterInteraction(),

  /** Attempt a commit for an exploration identity the caller names. */
  commitById(id: string, exploration: number) {
    const result = flatten(host(id).controller.commit(exploration));
    return {ok: result.ok, reason: result.reason};
  },

  hasActiveExploration: (id: string) =>
    host(id).controller.hasActiveExploration,

  /** The transition-quiescence seam, exercised from the driver. */
  resolveActive: (id: string) => host(id).controller.resolveActive('reset'),

  /**
   * Wait until pending coalesced render work has drained.
   *
   * @remarks
   * A render still queued from an earlier action is not idle scheduling, and
   * measuring across it would say nothing about whether anything loops.
   */
  async quiesce(limit = 2000) {
    const deadline = Date.now() + limit;
    let previous = -1;
    while (Date.now() < deadline) {
      const counts = Hosts.a.renderCount + Hosts.b.renderCount;
      if (counts === previous) return true;
      previous = counts;
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
      a: Hosts.a.renderCount,
      b: Hosts.b.renderCount,
    };
    await wait(ms);
    return {
      raf: rafLedger.requested - before.raf,
      a: Hosts.a.renderCount - before.a,
      b: Hosts.b.renderCount - before.b,
    };
  },
};

declare global {
  interface Window {
    ovcLearner: typeof Driver;
  }
}

window.ovcLearner = Driver;
