import {describe, expect, test, vi} from 'vitest';
import {MutationCapability, RuntimeAuthority} from './RuntimeAuthority';
import {
  InteractionQuiescence,
  PreparationContext,
  StagingResult,
  TransitionOwner,
  TransitionResult,
} from './TransitionOwner';

interface ProbeState {
  width: number;
  label: string;
}

/**
 * A presentation reduced to what a transition actually coordinates: an
 * identity, the generation that owns it, its write path, and whether it is
 * still alive.
 */
class ProbePresentation {
  public disposed = 0;
  public shown = false;
  /** Semantic ids this presentation currently realizes, to node identities. */
  public readonly nodes = new Map<string, object>();

  public constructor(
    public readonly name: string,
    public readonly generation: number,
    public readonly capability: MutationCapability<ProbeState>,
  ) {
    // A fresh node object per presentation: identity across generations is
    // semantic, never object identity.
    for (const id of ['s1', 's2']) this.nodes.set(id, {id, of: name});
  }

  public write(width: number): number {
    return this.capability.write(draft => {
      draft.width = width;
    });
  }

  public exploration: InteractionQuiescence & {resolved: string[]} = {
    hasActiveExploration: false,
    resolved: [],
    resolveActive(reason: 'generation-retired') {
      if (!this.hasActiveExploration) return 0;
      this.resolved.push(reason);
      (this as {hasActiveExploration: boolean}).hasActiveExploration = false;
      return 1;
    },
  };
}

interface HarnessOptions {
  failPrepare?: boolean;
  skipReady?: boolean;
  failActivate?: boolean;
  prepareDelayMs?: number;
}

function harness(defaults: HarnessOptions = {}) {
  const authority = new RuntimeAuthority<ProbeState>({
    width: 100,
    label: 'accepted',
  });
  const built: ProbePresentation[] = [];
  const disposedOrder: string[] = [];
  let options: HarnessOptions = {...defaults};
  let nextName = 0;
  const contexts: PreparationContext<ProbeState>[] = [];

  const owner = new TransitionOwner<ProbeState, ProbePresentation>({
    authority,
    adapter: {
      async prepare(context) {
        contexts.push(context);
        if (options.prepareDelayMs) {
          await new Promise(resolve =>
            setTimeout(resolve, options.prepareDelayMs),
          );
        }
        if (options.failPrepare) throw new Error('probe-preparation-failure');
        const presentation = new ProbePresentation(
          `p${++nextName}`,
          context.generation,
          context.capability,
        );
        built.push(presentation);
        if (!options.skipReady) context.markReady();
        return presentation;
      },
      activate(incoming, outgoing) {
        if (options.failActivate) throw new Error('probe-activate-failure');
        incoming.shown = true;
        if (outgoing) outgoing.shown = true;
      },
      dispose(presentation) {
        presentation.disposed++;
        presentation.shown = false;
        disposedOrder.push(presentation.name);
      },
      quiescence: presentation => presentation.exploration,
    },
  });

  return {
    authority,
    owner,
    built,
    contexts,
    disposedOrder,
    configure(next: HarnessOptions) {
      options = {...options, ...next};
    },
  };
}

function staged(result: StagingResult) {
  if (!result.ok) {
    throw new Error(`expected staging, refused: ${result.reason}`);
  }
  return result;
}

function refusedStaging(result: StagingResult) {
  if (result.ok) throw new Error('expected a staging refusal');
  return result;
}

function transitioned(result: TransitionResult) {
  if (!result.ok) {
    throw new Error(`expected a transition, refused: ${result.reason}`);
  }
  return result;
}

function refusedTransition(result: TransitionResult) {
  if (result.ok) throw new Error('expected a transition refusal');
  return result;
}

/** Bring the owner to one active presentation. */
async function withActive(h: ReturnType<typeof harness>) {
  staged(await h.owner.stage());
  transitioned(h.owner.activate());
  return h.owner.current!;
}

// --- THE CANDIDATE RECORD CARRIES THE AUTHORITY'S STATE TYPE ---

describe('candidate typing', () => {
  test('the candidate generation is a number, not an erased any', async () => {
    const h = harness();
    staged(await h.owner.stage());

    // A shape pin on what the owner reports about its candidate. This does
    // not by itself discriminate the record's generic parameter: a generation
    // id is a number whatever state type the handle carries.
    const generation: number | null = h.owner.status().candidateGeneration;
    expect(typeof generation).toBe('number');

    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error - candidateGeneration is number | null.
    const wrongType: string | null = h.owner.status().candidateGeneration;
    expect(wrongType).toBe(generation);
  });

  test('a foreign authority cannot supply a candidate handle', () => {
    const mine = new RuntimeAuthority<ProbeState>({width: 1, label: 'mine'});
    const theirs = new RuntimeAuthority<{other: string}>({other: 'theirs'});
    const foreign = theirs.prepare();

    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error - a handle prepared against another state type.
    const rejected = mine.activate(foreign);
    // And refused at runtime too, on identity, which is where it always was.
    expect(rejected.ok).toBe(false);

    mine.dispose();
    theirs.dispose();
  });
});

// --- A / B / C. STAGE, INVISIBLE UNTIL ACTIVE, ACTIVATE ---

describe('staging a candidate', () => {
  test('the current presentation survives preparation untouched', async () => {
    const h = harness();
    const a = await withActive(h);
    a.write(150);
    const revision = h.authority.revision;

    staged(await h.owner.stage());

    // A is still current, still writable, still the same object.
    expect(h.owner.current).toBe(a);
    expect(a.disposed).toBe(0);
    expect(a.capability.isValid()).toBe(true);
    expect(a.write(160)).toBe(revision + 1);
    expect(h.owner.status().phase).toBe('ready');
    expect(h.owner.status().activeGeneration).toBe(a.generation);
  });

  test('a candidate is not current and has no write authority before activation', async () => {
    const h = harness();
    const a = await withActive(h);
    const revision = h.authority.revision;

    staged(await h.owner.stage());
    const candidate = h.owner.pendingCandidate!;

    expect(candidate).not.toBe(h.owner.current);
    expect(h.owner.current).toBe(a);
    expect(candidate.shown).toBe(false);
    // Being under construction grants nothing.
    expect(candidate.capability.isValid()).toBe(false);
    expect(() => candidate.write(999)).toThrow();
    expect(h.authority.revision).toBe(revision);
    expect(h.authority.read().width).toBe(a === candidate ? 999 : 100);
  });

  test('a ready candidate becomes current and the previous one becomes outgoing', async () => {
    const h = harness();
    const a = await withActive(h);
    staged(await h.owner.stage());
    const b = h.owner.pendingCandidate!;

    const result = transitioned(h.owner.activate());

    expect(result.activated).toBe(b.generation);
    expect(result.retired).toBe(a.generation);
    expect(h.owner.current).toBe(b);
    expect(h.owner.outgoing).toBe(a);
    expect(h.owner.status().phase).toBe('overlapping');
    expect(b.shown).toBe(true);
    expect(a.disposed).toBe(0);
  });

  test('readiness is explicit: finishing preparation is not enough', async () => {
    const h = harness({skipReady: true});
    const refused = refusedStaging(await h.owner.stage());

    expect(refused.reason).toBe('not-ready');
    // The candidate that was built was released, not left to activate later.
    expect(h.built[0].disposed).toBe(1);
    expect(h.owner.status().candidateGeneration).toBeNull();
    expect(refusedTransition(h.owner.activate()).reason).toBe('no-candidate');
  });
});

// --- D. PREPARATION FAILURE ---

describe('preparation failure', () => {
  test('a failing candidate leaves the current presentation intact', async () => {
    const h = harness();
    const a = await withActive(h);
    a.write(150);
    const revision = h.authority.revision;
    const width = h.authority.read().width;

    h.configure({failPrepare: true});
    const refused = refusedStaging(await h.owner.stage());

    expect(refused.reason).toBe('preparation-failed');
    expect(refused.detail).toContain('probe-preparation-failure');

    // A is untouched: same object, never disposed, still writable, and the
    // accepted projection did not move.
    expect(h.owner.current).toBe(a);
    expect(a.disposed).toBe(0);
    expect(a.capability.isValid()).toBe(true);
    expect(h.authority.revision).toBe(revision);
    expect(h.authority.read().width).toBe(width);
    expect(h.owner.status().phase).toBe('active');
    expect(h.owner.status().candidateGeneration).toBeNull();

    // A still works afterwards, and a later candidate still can be staged.
    expect(a.write(170)).toBe(revision + 1);
    h.configure({failPrepare: false});
    staged(await h.owner.stage());
  });

  test('a failed candidate leaves no generation behind', async () => {
    const h = harness();
    await withActive(h);
    const tracked = h.authority.trackedGenerations;

    h.configure({failPrepare: true});
    refusedStaging(await h.owner.stage());

    expect(h.authority.trackedGenerations).toBe(tracked);
  });
});

// --- E. REVISION-CHECKED ACTIVATION ---

describe('freshness', () => {
  test('a candidate prepared against an older revision refuses to activate', async () => {
    const h = harness();
    const a = await withActive(h);
    staged(await h.owner.stage());
    const b = h.owner.pendingCandidate!;

    // Accepted runtime state moves on after B was prepared.
    const revision = a.write(200);

    const refused = refusedTransition(h.owner.activate());

    expect(refused.reason).toBe('stale-revision');
    expect(refused.preparedAtRevision).toBe(revision - 1);
    expect(refused.currentRevision).toBe(revision);

    // B is gone; A is untouched and still current and writable.
    expect(b.disposed).toBe(1);
    expect(h.owner.current).toBe(a);
    expect(h.owner.outgoing).toBeNull();
    expect(a.capability.isValid()).toBe(true);
    expect(h.authority.read().width).toBe(200);
    expect(h.owner.status().phase).toBe('active');

    // A fresh candidate prepared against the new revision activates.
    staged(await h.owner.stage());
    expect(transitioned(h.owner.activate()).retired).toBe(a.generation);
  });

  test('the candidate is not quietly re-based onto the newer revision', async () => {
    const h = harness();
    const a = await withActive(h);
    staged(await h.owner.stage());
    const prepared = h.owner.status().candidateGeneration;
    a.write(300);

    refusedTransition(h.owner.activate());

    // The refused generation never became active, then or later.
    expect(h.authority.activeGeneration).toBe(a.generation);
    expect(h.authority.activeGeneration).not.toBe(prepared);
  });
});

// --- G / H / I. MUTATION AUTHORITY ACROSS THE BOUNDARY ---

describe('mutation authority', () => {
  test('the incoming generation receives authority and the outgoing loses it', async () => {
    const h = harness();
    const a = await withActive(h);
    staged(await h.owner.stage());
    const b = h.owner.pendingCandidate!;

    expect(a.capability.isValid()).toBe(true);
    expect(b.capability.isValid()).toBe(false);

    transitioned(h.owner.activate());

    expect(b.capability.isValid()).toBe(true);
    expect(a.capability.isValid()).toBe(false);
    expect(b.write(400)).toBe(1);
    expect(h.authority.read().width).toBe(400);
  });

  test('a stale outgoing callback cannot write the incoming generation', async () => {
    const h = harness();
    const a = await withActive(h);
    staged(await h.owner.stage());
    transitioned(h.owner.activate());
    const revision = h.authority.revision;

    // A callback left over from A fires during the overlap.
    expect(() => a.write(999)).toThrow();
    expect(h.authority.revision).toBe(revision);
    expect(h.authority.read().width).toBe(100);
    // And B is unharmed by the attempt.
    expect(h.owner.current!.capability.isValid()).toBe(true);
  });

  test('the outgoing presentation is drawable but not authoritative', async () => {
    const h = harness();
    const a = await withActive(h);
    staged(await h.owner.stage());
    transitioned(h.owner.activate());

    // Still alive and still shown - visible is not the same as current.
    expect(h.owner.outgoing).toBe(a);
    expect(a.shown).toBe(true);
    expect(a.disposed).toBe(0);
    expect(a.capability.isValid()).toBe(false);
    expect(h.authority.activeGeneration).toBe(h.owner.current!.generation);
  });
});

// --- J / K. INTERACTION QUIESCENCE ---

describe('interaction quiescence', () => {
  test('an active exploration is resolved through the existing seam', async () => {
    const h = harness();
    const a = await withActive(h);
    (a.exploration as {hasActiveExploration: boolean}).hasActiveExploration =
      true;
    staged(await h.owner.stage());

    const result = transitioned(h.owner.activate());

    expect(result.resolvedInteractions).toBe(1);
    expect(a.exploration.resolved).toEqual(['generation-retired']);
    expect(a.exploration.hasActiveExploration).toBe(false);
  });

  test('resolving for a transition does not accept what was held', async () => {
    const h = harness();
    const a = await withActive(h);
    (a.exploration as {hasActiveExploration: boolean}).hasActiveExploration =
      true;
    const revision = h.authority.revision;
    const width = h.authority.read().width;
    staged(await h.owner.stage());

    transitioned(h.owner.activate());

    // A transition is not consent: nothing the learner held was committed.
    expect(h.authority.revision).toBe(revision);
    expect(h.authority.read().width).toBe(width);
  });

  test('nothing is resolved when nothing was held', async () => {
    const h = harness();
    const a = await withActive(h);
    staged(await h.owner.stage());

    expect(transitioned(h.owner.activate()).resolvedInteractions).toBe(0);
    expect(a.exploration.resolved).toEqual([]);
  });
});

// --- L / M. IDENTITY AND OVERLAP ---

describe('overlap', () => {
  test('a semantic id rebinds to a different node instance', async () => {
    const h = harness();
    const a = await withActive(h);
    staged(await h.owner.stage());
    transitioned(h.owner.activate());
    const b = h.owner.current!;

    // The same semantic id exists in both, on different objects.
    expect(a.nodes.has('s1')).toBe(true);
    expect(b.nodes.has('s1')).toBe(true);
    expect(b.nodes.get('s1')).not.toBe(a.nodes.get('s1'));
    expect([...b.nodes.keys()].sort()).toEqual([...a.nodes.keys()].sort());
  });

  test('overlap is bounded to one outgoing presentation', async () => {
    const h = harness();
    const first = await withActive(h);
    staged(await h.owner.stage());
    transitioned(h.owner.activate());
    const second = h.owner.current!;
    expect(h.owner.outgoing).toBe(first);

    // A third transition without retiring: the oldest is retired for us.
    staged(await h.owner.stage());
    transitioned(h.owner.activate());

    expect(first.disposed).toBe(1);
    expect(h.owner.outgoing).toBe(second);
    expect(h.owner.current).not.toBe(second);
    expect(h.owner.current!.capability.isValid()).toBe(true);
  });
});

// --- P / Q. RETIREMENT ---

describe('retirement', () => {
  test('retiring the outgoing presentation leaves the current one alive', async () => {
    const h = harness();
    const a = await withActive(h);
    staged(await h.owner.stage());
    transitioned(h.owner.activate());
    const b = h.owner.current!;

    expect(h.owner.retireOutgoing()).toBe(true);

    expect(a.disposed).toBe(1);
    expect(h.owner.outgoing).toBeNull();
    expect(h.owner.status().phase).toBe('active');
    // B is untouched and still writable.
    expect(b.disposed).toBe(0);
    expect(b.capability.isValid()).toBe(true);
    expect(b.write(500)).toBe(1);
    // The retired generation is no longer tracked.
    expect(h.authority.generationState(a.generation)).toBeNull();
  });

  test('retirement is idempotent and does not double-dispose', async () => {
    const h = harness();
    const a = await withActive(h);
    staged(await h.owner.stage());
    transitioned(h.owner.activate());

    expect(h.owner.retireOutgoing()).toBe(true);
    expect(h.owner.retireOutgoing()).toBe(false);
    expect(h.owner.retireOutgoing()).toBe(false);
    expect(a.disposed).toBe(1);
  });

  test('a stale outgoing callback after retirement still cannot write', async () => {
    const h = harness();
    const a = await withActive(h);
    staged(await h.owner.stage());
    transitioned(h.owner.activate());
    h.owner.retireOutgoing();
    const revision = h.authority.revision;

    expect(() => a.write(777)).toThrow();
    expect(h.authority.revision).toBe(revision);
  });
});

// --- Q. FAILURE AFTER THE BOUNDARY ---

describe('failure after activation', () => {
  test('a presentation failure after the boundary is reported, not rolled back', async () => {
    const h = harness();
    const a = await withActive(h);
    staged(await h.owner.stage());
    const b = h.owner.pendingCandidate!;

    h.configure({failActivate: true});
    const result = transitioned(h.owner.activate());

    expect(result.presentationError).toContain('probe-activate-failure');
    // The boundary was crossed, so B is current and stays current.
    expect(h.owner.current).toBe(b);
    expect(h.authority.activeGeneration).toBe(b.generation);
    expect(b.capability.isValid()).toBe(true);
    expect(a.capability.isValid()).toBe(false);
  });
});

// --- R. CANDIDATE SUPERSESSION AND CANCELLATION ---

describe('candidate supersession', () => {
  test('a second candidate is refused and the first is left alone', async () => {
    const h = harness();
    await withActive(h);
    staged(await h.owner.stage());
    const first = h.owner.pendingCandidate!;

    const refused = refusedStaging(await h.owner.stage());

    expect(refused.reason).toBe('candidate-in-progress');
    expect(h.owner.pendingCandidate).toBe(first);
    expect(first.disposed).toBe(0);
    expect(h.owner.status().candidateReady).toBe(true);
  });

  test('a cancelled candidate is released and can never become visible', async () => {
    const h = harness();
    const a = await withActive(h);
    staged(await h.owner.stage());
    const candidate = h.owner.pendingCandidate!;

    expect(h.owner.cancelCandidate()).toBe(true);

    expect(candidate.disposed).toBe(1);
    expect(candidate.shown).toBe(false);
    expect(h.owner.pendingCandidate).toBeNull();
    expect(h.owner.current).toBe(a);
    expect(h.owner.status().phase).toBe('active');
    expect(refusedTransition(h.owner.activate()).reason).toBe('no-candidate');
    // Cancelling twice is harmless.
    expect(h.owner.cancelCandidate()).toBe(false);
    expect(candidate.disposed).toBe(1);
  });

  test('cancelling while preparation is still running leaks nothing', async () => {
    const h = harness({prepareDelayMs: 10});
    const a = await withActive(h);

    const pending = h.owner.stage();
    // Cancel before the adapter has returned.
    expect(h.owner.cancelCandidate()).toBe(true);
    const refused = refusedStaging(await pending);

    expect(refused.reason).toBe('cancelled');
    // What the adapter eventually produced was disposed, not kept.
    const built = h.built[h.built.length - 1];
    expect(built.disposed).toBe(1);
    expect(built.shown).toBe(false);
    expect(h.owner.pendingCandidate).toBeNull();
    expect(h.owner.current).toBe(a);
    expect(a.capability.isValid()).toBe(true);
  });
});

// --- LIFECYCLE ---

describe('owner lifecycle', () => {
  test('disposal releases everything and activates nothing', async () => {
    const h = harness();
    const a = await withActive(h);
    staged(await h.owner.stage());
    transitioned(h.owner.activate());
    const b = h.owner.current!;
    staged(await h.owner.stage());
    const candidate = h.owner.pendingCandidate!;
    const activeGeneration = h.authority.activeGeneration;

    h.owner.dispose();

    expect(candidate.disposed).toBe(1);
    expect(a.disposed).toBe(1);
    expect(b.disposed).toBe(1);
    expect(h.owner.current).toBeNull();
    expect(h.owner.outgoing).toBeNull();
    // Disposal is not an activation: the candidate never became accepted.
    expect(h.authority.activeGeneration).toBe(activeGeneration);
    expect(h.owner.isDisposed).toBe(true);

    h.owner.dispose();
    expect(a.disposed).toBe(1);
    expect(b.disposed).toBe(1);
  });

  test('a disposed owner refuses staging and activation', async () => {
    const h = harness();
    await withActive(h);
    h.owner.dispose();

    expect(refusedStaging(await h.owner.stage()).reason).toBe('owner-disposed');
    expect(refusedTransition(h.owner.activate()).reason).toBe('owner-disposed');
  });

  test('a candidate sees the accepted projection and its own context', async () => {
    const h = harness();
    const a = await withActive(h);
    a.write(250);
    staged(await h.owner.stage());

    const context = h.contexts[h.contexts.length - 1];
    expect(context.read().width).toBe(250);
    expect(context.preparedAtRevision).toBe(h.authority.revision);
    expect(context.generation).toBe(h.owner.pendingCandidate!.generation);
    expect(context.isCancelled()).toBe(false);
  });
});

// --- S. SCHEDULING ---

describe('scheduling', () => {
  test('the owner schedules nothing of its own', async () => {
    const interval = vi.spyOn(globalThis, 'setInterval');
    const raf = vi.fn();
    const previous = (globalThis as any).requestAnimationFrame;
    (globalThis as any).requestAnimationFrame = raf;

    try {
      const h = harness();
      await withActive(h);
      staged(await h.owner.stage());
      transitioned(h.owner.activate());
      h.owner.retireOutgoing();
      h.owner.dispose();

      expect(interval).not.toHaveBeenCalled();
      expect(raf).not.toHaveBeenCalled();
    } finally {
      interval.mockRestore();
      (globalThis as any).requestAnimationFrame = previous;
    }
  });
});

// --- T. IMMUTABLE PER-STAGE REQUEST CAPTURE ---

/** What a host asks for. Opaque to the owner; only the test reads it. */
interface ProbeRequest {
  readonly label: string;
}

/** A promise the test releases by hand, so nothing depends on wall-clock time. */
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(res => {
    resolve = res;
  });
  return {promise, resolve};
}

/** Rejects when the candidate signal aborts, for abort-aware preparation. */
function untilAborted(signal: AbortSignal): Promise<never> {
  return new Promise<never>((_, reject) => {
    if (signal.aborted) {
      reject(new Error('probe-aborted'));
      return;
    }
    signal.addEventListener('abort', () => reject(new Error('probe-aborted')));
  });
}

interface RequestHarnessOptions {
  /** Hold preparation until the test releases that request's gate. */
  gate?: boolean;
  /** Race the gate against the abort signal, so cancelling rejects at once. */
  abortAware?: boolean;
  /** Throw once the gate is released, after any cancellation has happened. */
  throwAfterGate?: boolean;
  /** Throw immediately, before any cancellation can happen. */
  throwImmediately?: boolean;
  /** Never declare readiness during the normal path. */
  skipReady?: boolean;
  /** Declare readiness after the gate, which may be after cancellation. */
  readyAfterGate?: boolean;
  /** Throw immediately, but only for this one request label. */
  failFor?: string;
  /** Never declare readiness, but only for this one request label. */
  noReadyFor?: string;
}

/** An observation of one `prepare` call, recorded when it started. */
interface PrepareObservation {
  readonly request: ProbeRequest;
  readonly generation: number;
  readonly signal: AbortSignal;
}

function requestHarness(options: RequestHarnessOptions = {}) {
  const authority = new RuntimeAuthority<ProbeState>({
    width: 100,
    label: 'accepted',
  });
  const prepared: PrepareObservation[] = [];
  /**
   * Request labels as seen *after* preparation resumed from its await.
   *
   * @remarks
   * This is where the hazard lives. A candidate that suspends and resumes
   * after a newer one has been staged must still be preparing its own
   * request; anything read from shared host state at this point would already
   * have been overwritten.
   */
  const resumed: string[] = [];
  const built: ProbePresentation[] = [];
  /** Request labels whose candidate signal aborted, in order. */
  const aborted: string[] = [];
  const gates = new Map<string, ReturnType<typeof deferred>>();
  let nextName = 0;

  const gateFor = (label: string) => {
    let gate = gates.get(label);
    if (!gate) {
      gate = deferred();
      gates.set(label, gate);
    }
    return gate;
  };

  const owner = new TransitionOwner<
    ProbeState,
    ProbePresentation,
    ProbeRequest
  >({
    authority,
    adapter: {
      async prepare(context, request) {
        prepared.push({
          request,
          generation: context.generation,
          signal: context.signal,
        });
        context.signal.addEventListener('abort', () =>
          aborted.push(request.label),
        );

        if (options.throwImmediately || options.failFor === request.label) {
          throw new Error(`probe-immediate-${request.label}`);
        }
        if (options.gate || options.abortAware) {
          const gate = gateFor(request.label).promise;
          await (options.abortAware
            ? Promise.race([gate, untilAborted(context.signal)])
            : gate);
        }
        // Read the request again now that preparation has resumed.
        resumed.push(request.label);

        if (options.throwAfterGate) {
          throw new Error(`probe-late-${request.label}`);
        }

        const presentation = new ProbePresentation(
          `p${++nextName}`,
          context.generation,
          context.capability,
        );
        built.push(presentation);
        const withholdReady =
          (options.skipReady && !options.readyAfterGate) ||
          options.noReadyFor === request.label;
        if (!withholdReady) context.markReady();
        return presentation;
      },
      activate(incoming, outgoing) {
        incoming.shown = true;
        if (outgoing) outgoing.shown = true;
      },
      dispose(presentation) {
        presentation.disposed++;
        presentation.shown = false;
      },
    },
  });

  return {
    authority,
    owner,
    prepared,
    resumed,
    built,
    aborted,
    /** Let one request's preparation continue. */
    release(label: string) {
      gateFor(label).resolve();
    },
  };
}

/** Bring a request-typed owner to one active presentation. */
async function withActiveRequest(h: ReturnType<typeof requestHarness>) {
  const pending = h.owner.stage({label: 'initial'});
  h.release('initial');
  staged(await pending);
  transitioned(h.owner.activate());
  return h.owner.current!;
}

describe('per-stage request capture', () => {
  test('preparation receives exactly the request that staged it', async () => {
    const h = requestHarness();
    const request = {label: 'first'};

    staged(await h.owner.stage(request));

    expect(h.prepared).toHaveLength(1);
    // Identity, not a copy: the owner does not clone or normalize requests.
    expect(h.prepared[0].request).toBe(request);
  });

  test('a late cancelled preparation still sees its own request', async () => {
    const h = requestHarness({gate: true});
    await withActiveRequest(h);

    // B starts and is cancelled while still gated.
    const pendingB = h.owner.stage({label: 'B'});
    expect(h.owner.cancelCandidate()).toBe(true);

    // C is staged with a different request before B has settled.
    const pendingC = h.owner.stage({label: 'C'});

    // Now let both finish, oldest first.
    h.release('B');
    h.release('C');
    expect(refusedStaging(await pendingB).reason).toBe('cancelled');
    staged(await pendingC);

    // Each preparation saw its own request, and B never observed C's.
    expect(h.prepared.map(observation => observation.request.label)).toEqual([
      'initial',
      'B',
      'C',
    ]);
    // And still saw its own after resuming, which is the point: B resumed
    // only once C had already been staged with a different request.
    expect(h.resumed).toEqual(['initial', 'B', 'C']);
  });

  test('the same request object staged twice yields two generations', async () => {
    const h = requestHarness();
    const request = {label: 'reused'};

    const first = staged(await h.owner.stage(request));
    transitioned(h.owner.activate());
    const second = staged(await h.owner.stage(request));

    expect(second.generation).not.toBe(first.generation);
    expect(h.prepared[0].request).toBe(h.prepared[1].request);
    expect(h.prepared[0].generation).not.toBe(h.prepared[1].generation);
  });

  test('structurally equal requests are still separate candidates', async () => {
    const h = requestHarness();

    const first = staged(await h.owner.stage({label: 'same'}));
    transitioned(h.owner.activate());
    const second = staged(await h.owner.stage({label: 'same'}));

    expect(h.prepared[0].request).toEqual(h.prepared[1].request);
    expect(h.prepared[0].request).not.toBe(h.prepared[1].request);
    expect(second.generation).not.toBe(first.generation);
  });

  test('a request grants no authority of its own', async () => {
    const h = requestHarness();
    const a = await withActiveRequest(h);
    const revision = h.authority.revision;

    staged(await h.owner.stage({label: 'candidate'}));
    const candidate = h.owner.pendingCandidate!;

    // Carrying a request does not make a candidate writable or current.
    expect(candidate.capability.isValid()).toBe(false);
    expect(() => candidate.write(1)).toThrow();
    expect(h.owner.current).toBe(a);
    expect(h.authority.revision).toBe(revision);
  });
});

// --- U. CANDIDATE-SCOPED CANCELLATION SIGNAL ---

describe('cancellation signal', () => {
  test('the signal is live while preparing and aborts on cancellation', async () => {
    const h = requestHarness({gate: true});
    const pending = h.owner.stage({label: 'B'});

    expect(h.prepared[0].signal.aborted).toBe(false);
    expect(h.aborted).toEqual([]);

    h.owner.cancelCandidate();

    expect(h.prepared[0].signal.aborted).toBe(true);
    expect(h.aborted).toEqual(['B']);

    h.release('B');
    expect(refusedStaging(await pending).reason).toBe('cancelled');
  });

  test('abort-aware preparation unwinds at once and reports cancelled', async () => {
    const h = requestHarness({abortAware: true});
    const a = await withActiveRequest(h);

    const pending = h.owner.stage({label: 'B'});
    h.owner.cancelCandidate();

    // The gate is never released: the abort alone ends the preparation.
    const refused = refusedStaging(await pending);
    expect(refused.reason).toBe('cancelled');
    // A rejection caused by the abort must not look like a failure.
    expect(refused.detail).toBeNull();
    expect(h.owner.current).toBe(a);
    expect(a.capability.isValid()).toBe(true);
  });

  test('cancelling before any work builds no presentation at all', async () => {
    const h = requestHarness({gate: true});
    const pending = h.owner.stage({label: 'B'});
    const observation = h.prepared[0];

    h.owner.cancelCandidate();

    expect(observation.signal.aborted).toBe(true);
    h.release('B');
    expect(refusedStaging(await pending).reason).toBe('cancelled');
    // The gate was released after cancelling, so a presentation was built and
    // immediately disposed rather than kept.
    expect(h.built).toHaveLength(1);
    expect(h.built[0].disposed).toBe(1);
  });

  test('abort-unaware work that returns late is disposed, not kept', async () => {
    const h = requestHarness({gate: true});
    const a = await withActiveRequest(h);

    const pending = h.owner.stage({label: 'B'});
    h.owner.cancelCandidate();
    h.release('B');

    expect(refusedStaging(await pending).reason).toBe('cancelled');
    const late = h.built[h.built.length - 1];
    expect(late.disposed).toBe(1);
    expect(late.shown).toBe(false);
    expect(h.owner.pendingCandidate).toBeNull();
    expect(h.owner.current).toBe(a);
  });

  test('disposing the owner during preparation aborts the candidate', async () => {
    const h = requestHarness({gate: true});
    const pending = h.owner.stage({label: 'B'});

    h.owner.dispose();

    expect(h.prepared[0].signal.aborted).toBe(true);
    h.release('B');
    expect(refusedStaging(await pending).reason).toBe('cancelled');
  });

  test('an exception before cancellation is a preparation failure', async () => {
    const h = requestHarness({throwImmediately: true});

    const refused = refusedStaging(await h.owner.stage({label: 'B'}));

    expect(refused.reason).toBe('preparation-failed');
    expect(refused.detail).toContain('probe-immediate-B');
  });

  test('an exception after cancellation reports cancelled', async () => {
    const h = requestHarness({gate: true, throwAfterGate: true});
    const pending = h.owner.stage({label: 'B'});

    h.owner.cancelCandidate();
    h.release('B');

    const refused = refusedStaging(await pending);
    expect(refused.reason).toBe('cancelled');
    expect(refused.detail).toBeNull();
  });

  test('readiness declared after cancellation does not make it activatable', async () => {
    const h = requestHarness({
      gate: true,
      skipReady: true,
      readyAfterGate: true,
    });
    const a = await withActiveRequest(h);

    const pending = h.owner.stage({label: 'B'});
    h.owner.cancelCandidate();
    h.release('B');

    expect(refusedStaging(await pending).reason).toBe('cancelled');
    expect(h.owner.status().candidateReady).toBe(false);
    expect(refusedTransition(h.owner.activate()).reason).toBe('no-candidate');
    expect(h.owner.current).toBe(a);
  });

  test('cancelling a candidate does not disturb the visible generations', async () => {
    const h = requestHarness({gate: true});
    // A active, then B activated so that A becomes outgoing.
    await withActiveRequest(h);
    const pendingB = h.owner.stage({label: 'B'});
    h.release('B');
    staged(await pendingB);
    transitioned(h.owner.activate());
    const outgoing = h.owner.outgoing!;
    const current = h.owner.current!;
    const revision = h.authority.revision;

    // A third candidate is staged and cancelled mid-preparation.
    const pendingC = h.owner.stage({label: 'C'});
    h.owner.cancelCandidate();
    h.release('C');
    expect(refusedStaging(await pendingC).reason).toBe('cancelled');

    // Only the candidate was aborted.
    expect(h.aborted).toEqual(['C']);
    // Neither visible presentation was retired or mutated.
    expect(h.owner.outgoing).toBe(outgoing);
    expect(h.owner.current).toBe(current);
    expect(outgoing.disposed).toBe(0);
    expect(current.disposed).toBe(0);
    expect(current.capability.isValid()).toBe(true);
    expect(outgoing.capability.isValid()).toBe(false);
    expect(h.authority.revision).toBe(revision);
    expect(h.owner.status().phase).toBe('overlapping');
  });
});

// --- V. CANCELLATION AND RESTAGING RACE ---

describe('cancellation and restaging race', () => {
  test('a late cancelled candidate cannot corrupt its replacement', async () => {
    const h = requestHarness({gate: true});
    const a = await withActiveRequest(h);
    const revision = h.authority.revision;

    // B starts a gated preparation.
    const pendingB = h.owner.stage({label: 'B'});
    const generationB = h.owner.status().candidateGeneration;

    // The host cancels B; its signal aborts immediately.
    expect(h.owner.cancelCandidate()).toBe(true);
    expect(h.prepared[1].signal.aborted).toBe(true);

    // C is staged before B's promise has settled.
    const pendingC = h.owner.stage({label: 'C'});
    const generationC = h.owner.status().candidateGeneration;
    expect(generationC).not.toBe(generationB);

    // B settles late and is disposed exactly once.
    h.release('B');
    expect(refusedStaging(await pendingB).reason).toBe('cancelled');
    const lateB = h.built[h.built.length - 1];
    expect(lateB.disposed).toBe(1);

    // C's record survived B's completion untouched.
    expect(h.owner.status().candidateGeneration).toBe(generationC);

    // C becomes ready, and A was current the whole time until C activated.
    h.release('C');
    staged(await pendingC);
    const candidateC = h.owner.pendingCandidate!;
    expect(h.owner.current).toBe(a);
    transitioned(h.owner.activate());
    expect(h.owner.current).toBe(candidateC);
    expect(h.owner.outgoing).toBe(a);

    // Nothing leaked: B's generation is gone and only the two visible
    // generations remain tracked.
    expect(h.authority.generationState(generationB!)).toBeNull();
    expect(h.authority.trackedGenerations).toBe(2);
    expect(a.capability.isValid()).toBe(false);
    expect(candidateC.capability.isValid()).toBe(true);
    expect(h.authority.revision).toBe(revision);
    expect(h.aborted).toEqual(['B']);
  });

  test('repeated cancellation and retirement calls stay idempotent', async () => {
    const h = requestHarness();
    const a = await withActiveRequest(h);
    staged(await h.owner.stage({label: 'B'}));
    transitioned(h.owner.activate());
    const b = h.owner.current!;

    expect(h.owner.cancelCandidate()).toBe(false);
    expect(h.owner.cancelCandidate()).toBe(false);
    expect(h.owner.retireOutgoing()).toBe(true);
    expect(h.owner.retireOutgoing()).toBe(false);
    expect(h.owner.retireOutgoing()).toBe(false);

    expect(a.disposed).toBe(1);
    expect(b.disposed).toBe(0);
    expect(h.owner.current).toBe(b);
  });
});

// --- W. OUTGOING OVERLAP CONTRACT ---

describe('outgoing overlap contract', () => {
  test('the outgoing presentation stays drawable until it is retired', async () => {
    const h = requestHarness();
    const a = await withActiveRequest(h);
    staged(await h.owner.stage({label: 'B'}));
    transitioned(h.owner.activate());
    const b = h.owner.current!;

    // Both are alive and on screen; only authority moved.
    expect(h.owner.outgoing).toBe(a);
    expect(a.disposed).toBe(0);
    expect(a.shown).toBe(true);
    expect(b.shown).toBe(true);
    expect(a).not.toBe(b);
    expect(a.capability.isValid()).toBe(false);
    expect(b.capability.isValid()).toBe(true);
    expect(h.owner.status().phase).toBe('overlapping');

    h.owner.retireOutgoing();
    expect(a.disposed).toBe(1);
    expect(a.shown).toBe(false);
    expect(b.disposed).toBe(0);
  });

  test('a stale outgoing callback cannot mutate the incoming generation', async () => {
    const h = requestHarness();
    const a = await withActiveRequest(h);
    staged(await h.owner.stage({label: 'B'}));
    transitioned(h.owner.activate());
    const b = h.owner.current!;
    const revision = h.authority.revision;

    // While still visible, the outgoing presentation writes nothing.
    expect(() => a.write(999)).toThrow();
    expect(h.authority.revision).toBe(revision);
    expect(h.authority.read().width).not.toBe(999);
    // The incoming generation is unaffected and still the writer.
    expect(b.write(42)).toBe(revision + 1);
    expect(h.authority.read().width).toBe(42);
    expect(h.authority.activeGeneration).toBe(b.generation);
  });
});

// --- X. SEAMLESS PREPARATION ---

describe('seamless preparation', () => {
  /**
   * The whole use case in one sequence: the learner keeps the presentation
   * they have while the next one is built, asked for by an immutable request,
   * and every way the next one can fail leaves the current one alone.
   */
  test('the current presentation survives every way a candidate can fail', async () => {
    const h = requestHarness({gate: true});
    const a = await withActiveRequest(h);
    const revision = h.authority.revision;

    // --- a slow candidate is prepared offstage ---
    const pendingB = h.owner.stage({label: 'B'});

    // A is reachable, undisposed, on screen and still the only writer.
    expect(h.owner.current).toBe(a);
    expect(a.disposed).toBe(0);
    expect(a.shown).toBe(true);
    expect(a.capability.isValid()).toBe(true);
    expect(a.write(101)).toBe(revision + 1);
    // B is neither current nor outgoing while it prepares.
    expect(h.owner.pendingCandidate).toBeNull();
    expect(h.owner.outgoing).toBeNull();
    expect(h.owner.status().phase).toBe('preparing');

    // --- cancelling it leaves A untouched ---
    h.owner.cancelCandidate();
    h.release('B');
    expect(refusedStaging(await pendingB).reason).toBe('cancelled');
    expect(h.owner.current).toBe(a);
    expect(a.disposed).toBe(0);
    expect(a.capability.isValid()).toBe(true);

    // --- a candidate that throws leaves A untouched ---
    const thrower = requestHarness({failFor: 'boom'});
    const throwerActive = await withActiveRequest(thrower);
    const failed = refusedStaging(await thrower.owner.stage({label: 'boom'}));
    expect(failed.reason).toBe('preparation-failed');
    expect(thrower.owner.current).toBe(throwerActive);
    expect(throwerActive.disposed).toBe(0);
    expect(throwerActive.capability.isValid()).toBe(true);

    // --- a candidate that never declares readiness leaves A untouched ---
    const silent = requestHarness({noReadyFor: 'quiet'});
    const silentActive = await withActiveRequest(silent);
    const unready = refusedStaging(await silent.owner.stage({label: 'quiet'}));
    expect(unready.reason).toBe('not-ready');
    expect(silent.owner.current).toBe(silentActive);
    expect(silent.owner.pendingCandidate).toBeNull();
    expect(silentActive.capability.isValid()).toBe(true);

    // --- a ready candidate that went stale is refused at activation ---
    const pendingStale = h.owner.stage({label: 'stale'});
    h.release('stale');
    const stale = staged(await pendingStale);
    // The learner commits through the presentation they are still using.
    expect(a.write(202)).toBe(revision + 2);
    const refused = refusedTransition(h.owner.activate());
    expect(refused.reason).toBe('stale-revision');
    expect(refused.preparedAtRevision).toBe(stale.preparedAtRevision);
    expect(refused.currentRevision).toBe(revision + 2);
    // A is still current, still writable, and its commit was not rolled back.
    expect(h.owner.current).toBe(a);
    expect(a.capability.isValid()).toBe(true);
    expect(h.authority.read().width).toBe(202);

    // --- and a fresh candidate still activates ---
    const pendingC = h.owner.stage({label: 'C'});
    h.release('C');
    staged(await pendingC);
    const c = h.owner.pendingCandidate!;
    transitioned(h.owner.activate());

    expect(h.owner.current).toBe(c);
    expect(h.owner.outgoing).toBe(a);
    expect(c.capability.isValid()).toBe(true);
    expect(a.capability.isValid()).toBe(false);
    // Every request reached its own preparation, in order.
    expect(h.prepared.map(observation => observation.request.label)).toEqual([
      'initial',
      'B',
      'stale',
      'C',
    ]);
  });
});

// --- Y. ABANDONED GENERATIONS ARE RELEASED, NOT MERELY DISCARDED ---

describe('abandoned generation accounting', () => {
  test('an in-flight cancelled candidate is released before it settles', async () => {
    const h = requestHarness({gate: true});
    const a = await withActiveRequest(h);
    const withActiveOnly = h.authority.trackedGenerations;

    // B begins a gated, abort-unaware preparation.
    const pendingB = h.owner.stage({label: 'B'});
    const generationB = h.owner.status().candidateGeneration!;
    expect(h.authority.trackedGenerations).toBe(withActiveOnly + 1);

    expect(h.owner.cancelCandidate()).toBe(true);

    // Asserted *before* B's gate is released. An adapter that ignores the
    // abort may never settle, so waiting for it would prove nothing.
    expect(h.prepared[1].signal.aborted).toBe(true);
    expect(h.authority.generationState(generationB)).toBeNull();
    expect(h.authority.trackedGenerations).toBe(withActiveOnly);
    // The presentation on screen is untouched by any of it.
    expect(h.owner.current).toBe(a);
    expect(a.disposed).toBe(0);
    expect(a.capability.isValid()).toBe(true);

    // C takes the candidate slot while B is still unsettled.
    const pendingC = h.owner.stage({label: 'C'});
    const generationC = h.owner.status().candidateGeneration!;
    expect(generationC).not.toBe(generationB);
    expect(h.authority.generationState(generationC)).not.toBeNull();

    // B settles late: disposed once, and C is left exactly as it was.
    h.release('B');
    expect(refusedStaging(await pendingB).reason).toBe('cancelled');
    expect(h.built[h.built.length - 1].disposed).toBe(1);
    expect(h.owner.status().candidateGeneration).toBe(generationC);
    expect(h.authority.generationState(generationB)).toBeNull();

    // And C still completes normally.
    h.release('C');
    staged(await pendingC);
    const c = h.owner.pendingCandidate!;
    transitioned(h.owner.activate());
    expect(h.owner.current).toBe(c);
    expect(h.owner.outgoing).toBe(a);
    // Exactly the two visible generations remain.
    expect(h.authority.trackedGenerations).toBe(2);
  });

  test('a refused activation releases the generation it discarded', async () => {
    const h = requestHarness();
    const a = await withActiveRequest(h);
    const withActiveOnly = h.authority.trackedGenerations;

    const candidate = staged(await h.owner.stage({label: 'B'}));
    const generationB = candidate.generation;
    const b = h.owner.pendingCandidate!;
    expect(h.authority.trackedGenerations).toBe(withActiveOnly + 1);

    // The learner commits through the presentation they are still using, so
    // the ready candidate no longer describes current accepted state.
    const revision = a.write(500);

    const refused = refusedTransition(h.owner.activate());

    // The refusal evidence is unchanged by the release.
    expect(refused.reason).toBe('stale-revision');
    expect(refused.preparedAtRevision).toBe(candidate.preparedAtRevision);
    expect(refused.currentRevision).toBe(revision);

    // Both the presentation and the generation are gone.
    expect(b.disposed).toBe(1);
    expect(h.authority.generationState(generationB)).toBeNull();
    expect(h.authority.trackedGenerations).toBe(withActiveOnly);
    expect(h.owner.pendingCandidate).toBeNull();

    // A is untouched, still authoritative, and its commit stands.
    expect(h.owner.current).toBe(a);
    expect(a.disposed).toBe(0);
    expect(a.capability.isValid()).toBe(true);
    expect(h.authority.revision).toBe(revision);
    expect(h.authority.read().width).toBe(500);

    // A fresh candidate activates, and B never reappears in the accounting.
    staged(await h.owner.stage({label: 'C'}));
    transitioned(h.owner.activate());
    expect(h.authority.generationState(generationB)).toBeNull();
    expect(h.authority.trackedGenerations).toBe(2);
  });

  test('repeated activation after a refusal changes nothing', async () => {
    const h = requestHarness();
    const a = await withActiveRequest(h);
    const withActiveOnly = h.authority.trackedGenerations;

    staged(await h.owner.stage({label: 'B'}));
    a.write(600);
    expect(refusedTransition(h.owner.activate()).reason).toBe('stale-revision');

    // Nothing is left to activate, and asking again reports that plainly.
    expect(refusedTransition(h.owner.activate()).reason).toBe('no-candidate');
    expect(refusedTransition(h.owner.activate()).reason).toBe('no-candidate');
    expect(h.authority.trackedGenerations).toBe(withActiveOnly);
    expect(h.owner.current).toBe(a);
    expect(a.capability.isValid()).toBe(true);
  });

  test('owner disposal releases an unresolved candidate immediately', async () => {
    const h = requestHarness({gate: true});
    await withActiveRequest(h);

    const pending = h.owner.stage({label: 'B'});
    const generationB = h.owner.status().candidateGeneration!;

    h.owner.dispose();

    // Again before the gate is released.
    expect(h.prepared[1].signal.aborted).toBe(true);
    expect(h.authority.generationState(generationB)).toBeNull();

    h.release('B');
    expect(refusedStaging(await pending).reason).toBe('cancelled');
    expect(h.authority.generationState(generationB)).toBeNull();
  });

  test('cancelling repeatedly while in flight is harmless', async () => {
    const h = requestHarness({gate: true});
    const a = await withActiveRequest(h);
    const withActiveOnly = h.authority.trackedGenerations;

    const pending = h.owner.stage({label: 'B'});
    expect(h.owner.cancelCandidate()).toBe(true);
    // The record is already gone, so further calls have nothing to cancel.
    expect(h.owner.cancelCandidate()).toBe(false);
    expect(h.owner.cancelCandidate()).toBe(false);

    expect(h.authority.trackedGenerations).toBe(withActiveOnly);
    expect(h.aborted).toEqual(['B']);

    h.release('B');
    expect(refusedStaging(await pending).reason).toBe('cancelled');
    // Disposed exactly once despite three cancellations and a late return.
    expect(h.built[h.built.length - 1].disposed).toBe(1);
    expect(h.owner.current).toBe(a);
  });

  test('candidate cancellation never releases a visible generation', async () => {
    const h = requestHarness({gate: true});
    // A active, then B activated so A is outgoing and both are visible.
    const a = await withActiveRequest(h);
    const pendingB = h.owner.stage({label: 'B'});
    h.release('B');
    staged(await pendingB);
    transitioned(h.owner.activate());
    const b = h.owner.current!;
    const bothVisible = h.authority.trackedGenerations;
    expect(bothVisible).toBe(2);

    // A third candidate is staged and cancelled while preparing.
    const pendingC = h.owner.stage({label: 'C'});
    expect(h.authority.trackedGenerations).toBe(bothVisible + 1);
    h.owner.cancelCandidate();

    // Only the candidate's generation went.
    expect(h.authority.trackedGenerations).toBe(bothVisible);
    expect(h.authority.generationState(a.generation)).not.toBeNull();
    expect(h.authority.generationState(b.generation)).not.toBeNull();
    expect(h.owner.outgoing).toBe(a);
    expect(h.owner.current).toBe(b);
    expect(a.disposed).toBe(0);
    expect(b.disposed).toBe(0);

    h.release('C');
    expect(refusedStaging(await pendingC).reason).toBe('cancelled');
    expect(h.authority.trackedGenerations).toBe(bothVisible);
  });
});
