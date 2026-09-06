import type {InteractionCapability} from '../interaction/runtimeState';
import {InteractionHost, rafLedger, wait} from './interactionHost';

const Stages = document.querySelector<HTMLElement>('#stages')!;
const Status = document.querySelector<HTMLElement>('#status')!;

function makeContainer(id: string) {
  const container = document.createElement('div');
  container.className = 'stage';
  container.dataset.runtime = id;
  Stages.append(container);
  return container;
}

const Hosts: Record<string, InteractionHost> = {
  a: new InteractionHost('A', makeContainer('A')),
  b: new InteractionHost('B', makeContainer('B')),
};

function host(id: string): InteractionHost {
  const found = Hosts[id.toLowerCase()];
  if (!found) throw new Error(`unknown runtime ${id}`);
  return found;
}

/** The capability of a generation accepted after a host's own retired. */
let SuccessorCapability: InteractionCapability | null = null;

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

  snapshot(id: string) {
    return host(id).snapshot();
  },

  events(id: string) {
    return host(id).events;
  },

  clearEvents(id: string) {
    host(id).clearEvents();
  },

  clientPoint(id: string, x: number, y: number) {
    return host(id).clientPoint(x, y);
  },

  renderCount(id: string) {
    return host(id).renderCount;
  },

  async settled(id: string, before: number) {
    return host(id).settled(before);
  },

  /** Return the fixture to a known projection without touching interaction. */
  async reset(id: string) {
    const target = host(id);
    const before = target.renderCount;
    target.clearEvents();
    target.resetHandle();
    await target.settled(before);
    return target.snapshot();
  },

  /** Host-initiated cancellation, the reset and transition path. */
  cancelAll(id: string) {
    return host(id).dispatcher.cancelAll('reset');
  },

  /** Rebuild presentation in place, which must also end live sessions. */
  async resetScene(id: string) {
    const target = host(id);
    const before = target.renderCount;
    target.player.requestReset();
    target.player.wake();
    await target.settled(before);
    return target.snapshot();
  },

  /** Accept a successor generation, retiring the host's own. */
  retire(id: string) {
    const result = host(id).retireGeneration();
    SuccessorCapability = result.capability;
    return {ok: result.ok, successor: result.successor};
  },

  /**
   * Prove the authority is still writable by its accepted generation, so a
   * refused stale write is a refusal and not a dead runtime.
   */
  successorWrite(x: number) {
    if (!SuccessorCapability) throw new Error('no successor generation');
    return SuccessorCapability.write(draft => {
      draft.handle = {...draft.handle, x};
    });
  },

  disposeInteraction(id: string) {
    host(id).disposeInteraction();
    return host(id).snapshot();
  },

  /**
   * Measure a quiet window from inside the page.
   *
   * @remarks
   * Deliberately not driven from a Playwright poll: `waitForFunction` runs on
   * animation frames and would supply the very frames this is counting.
   */
  async idleWindow(ms: number) {
    const before = {
      raf: rafLedger.requested,
      a: Hosts.a.renderCount,
      b: Hosts.b.renderCount,
      sessionsA: Hosts.a.dispatcher.activeSessions,
    };
    await wait(ms);
    return {
      raf: rafLedger.requested - before.raf,
      a: Hosts.a.renderCount - before.a,
      b: Hosts.b.renderCount - before.b,
      sessionsA: before.sessionsA,
    };
  },

  async exportPass(id: string, frames: number[]) {
    return host(id).exportPass(frames);
  },

  /** Dispatch an untrusted pointer event, to show a detached canvas is inert. */
  syntheticPointer(id: string, type: string, x: number, y: number) {
    const target = host(id);
    const point = target.clientPoint(x, y);
    target.stage.finalBuffer.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: 99,
        pointerType: 'mouse',
        button: 0,
        buttons: 1,
        clientX: point.x,
        clientY: point.y,
      }),
    );
  },
};

declare global {
  interface Window {
    ovcInteraction: typeof Driver;
  }
}

window.ovcInteraction = Driver;
