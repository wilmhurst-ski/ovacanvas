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
