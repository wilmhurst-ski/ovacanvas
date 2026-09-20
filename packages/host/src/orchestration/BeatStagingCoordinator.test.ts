import type {
  PreparationContext,
  PresentationAdapter,
} from '@ovacanvas/core/lib/internal';
import {RuntimeAuthority, TransitionOwner} from '@ovacanvas/core/lib/internal';
import {describe, expect, it} from 'vitest';
import type {ChunkRequest} from '../lesson/ChunkRequest';
import {initialLessonState, type LessonState} from '../lesson/LessonState';
import type {BeatManifest} from '../presentation/BeatManifest';
import {BeatStagingCoordinator} from './BeatStagingCoordinator';

interface FakePresentation {
  readonly label: string;
  disposeCount: number;
}

function fakeBeat(id: string): BeatManifest {
  return {
    id,
    title: id,
    runner: function* () {} as unknown as BeatManifest['runner'],
    buildAuditSpec: () => ({
      items: [],
      requiredIds: [],
      safeArea: undefined as never,
    }),
  };
}

function request(id: string): ChunkRequest {
  return {beat: fakeBeat(id)};
}

/** A fake adapter whose `prepare` can be held open until the test releases it. */
class DeferredAdapter
  implements PresentationAdapter<LessonState, FakePresentation, ChunkRequest>
{
  public disposed: FakePresentation[] = [];
  private release: (() => void) | null = null;
  private pendingLabel: string | null = null;

  public prepare(
    context: PreparationContext<LessonState>,
    req: ChunkRequest,
  ): Promise<FakePresentation> {
    this.pendingLabel = req.beat.id;
    return new Promise((resolve, reject) => {
      // A real adapter must react to cancellation the same way: an
      // abort-unaware `prepare()` that never settles would hang the whole
      // staging pipeline, not just this candidate.
      const onAbort = () => reject(new Error('cancelled'));
      context.signal.addEventListener('abort', onAbort, {once: true});
      this.release = () => {
        context.signal.removeEventListener('abort', onAbort);
        if (!context.isCancelled()) context.markReady();
        resolve({label: req.beat.id, disposeCount: 0});
      };
    });
  }

  /** Let whichever `prepare` call is waiting finish. */
  public settle(): void {
    if (!this.pendingLabel || !this.release) {
      throw new Error('nothing pending to settle');
    }
    this.pendingLabel = null;
    const release = this.release;
    this.release = null;
    release();
  }

  public dispose(presentation: FakePresentation): void {
    presentation.disposeCount++;
    this.disposed.push(presentation);
  }
}

/** An adapter that resolves synchronously (on the microtask queue), for the non-racing tests. */
class ImmediateAdapter
  implements PresentationAdapter<LessonState, FakePresentation, ChunkRequest>
{
  public disposed: FakePresentation[] = [];

  public async prepare(
    context: PreparationContext<LessonState>,
    req: ChunkRequest,
  ): Promise<FakePresentation> {
    context.markReady();
    return {label: req.beat.id, disposeCount: 0};
  }

  public dispose(presentation: FakePresentation): void {
    presentation.disposeCount++;
    this.disposed.push(presentation);
  }
}

type ScriptedOutcome = 'ready' | 'not-ready' | 'throw';

/** An adapter whose next `prepare()` outcome is scripted per call, for exercising the retry budget. */
class ScriptedAdapter
  implements PresentationAdapter<LessonState, FakePresentation, ChunkRequest>
{
  public calls = 0;

  public constructor(private readonly outcomes: ScriptedOutcome[]) {}

  public async prepare(
    context: PreparationContext<LessonState>,
    req: ChunkRequest,
  ): Promise<FakePresentation> {
    this.calls++;
    const outcome = this.outcomes.shift() ?? 'ready';
    if (outcome === 'throw') throw new Error('scripted failure');
    if (outcome === 'ready') context.markReady();
    return {label: req.beat.id, disposeCount: 0};
  }

  public dispose(): void {}
}

function setup<
  TAdapter extends PresentationAdapter<
    LessonState,
    FakePresentation,
    ChunkRequest
  >,
>(adapter: TAdapter, maxAttempts?: number) {
  const authority = new RuntimeAuthority<LessonState>(
    initialLessonState('l1', 'q'),
  );
  const owner = new TransitionOwner<
    LessonState,
    FakePresentation,
    ChunkRequest
  >({
    authority,
    adapter,
  });
  return {
    authority,
    owner,
    coordinator: new BeatStagingCoordinator(owner, maxAttempts),
  };
}

describe('BeatStagingCoordinator', () => {
  it('stages and activates a beat with a plain stage()/activate() pair', async () => {
    const {coordinator} = setup(new ImmediateAdapter());
    const staged = await coordinator.stage(request('beat-1'));
    expect(staged.ok).toBe(true);

    const activated = coordinator.activate();
    expect(activated.ok).toBe(true);
    expect(coordinator.current?.label).toBe('beat-1');
  });

  it('restage cancels an in-flight candidate and never reports candidate-in-progress', async () => {
    const adapter = new DeferredAdapter();
    const {coordinator} = setup(adapter);

    const firstStaging = coordinator.stage(request('beat-1'));
    // beat-1's prepare() is now suspended, waiting on adapter.settle().

    const secondStaging = coordinator.restage(request('beat-2'));
    adapter.settle(); // resolves beat-2's prepare(), the only one now pending

    const [first, second] = await Promise.all([firstStaging, secondStaging]);

    expect(first.ok).toBe(false);
    if (!first.ok) expect(first.reason).toBe('cancelled');
    expect(second.ok).toBe(true);

    const activated = coordinator.activate();
    expect(activated.ok).toBe(true);
    expect(coordinator.current?.label).toBe('beat-2');
  });

  it('a stale restage result is reported as superseded once a newer restage has started', async () => {
    const adapter = new DeferredAdapter();
    const {coordinator} = setup(adapter);

    const staleRestage = coordinator.restage(request('beat-1'));
    const freshRestage = coordinator.restage(request('beat-2'));
    adapter.settle();

    const [stale, fresh] = await Promise.all([staleRestage, freshRestage]);

    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.detail).toMatch(/superseded/);
    expect(fresh.ok).toBe(true);
  });

  it('disposes the presentation of a candidate that was cancelled after it finished preparing', async () => {
    const adapter = new ImmediateAdapter();
    const {coordinator, owner} = setup(adapter);

    // Prime with an active beat so cancelling the *candidate* is meaningful.
    await coordinator.stage(request('beat-1'));
    coordinator.activate();

    // Stage a second candidate, then cancel it before activating.
    await coordinator.stage(request('beat-2'));
    expect(owner.pendingCandidate).not.toBeNull();
    owner.cancelCandidate();

    expect(
      adapter.disposed.some(presentation => presentation.label === 'beat-2'),
    ).toBe(true);
    // The active beat is untouched.
    expect(coordinator.current?.label).toBe('beat-1');
  });

  it('activates candidate immediately even if an advisory check is slow or throws', async () => {
    let advisoryErrorCaught = false;

    const advisoryAdapter: PresentationAdapter<
      LessonState,
      FakePresentation,
      ChunkRequest
    > = {
      async prepare(context, req) {
        context.markReady(); // Ready immediately
        // Non-blocking background advisory check (same unawaited fire-and-forget pattern as BeatAdapter)
        void (async () => {
          try {
            await new Promise((_, reject) =>
              setTimeout(() => reject(new Error('vision timeout')), 50),
            );
          } catch {
            advisoryErrorCaught = true;
          }
        })();
        return {label: req.beat.id, disposeCount: 0};
      },
      dispose() {},
    };

    const {coordinator} = setup(advisoryAdapter, 1);
    const stageResult = await coordinator.stage(request('beat-1'));
    expect(stageResult.ok).toBe(true);
    const activateResult = await coordinator.activate();
    expect(activateResult.ok).toBe(true);
    expect(coordinator.current?.label).toBe('beat-1');
    await new Promise(resolve => setTimeout(resolve, 60));
    expect(advisoryErrorCaught).toBe(true);
  });

  describe('retry budget', () => {
    it('charges an attempt for a real preparation failure and clears it on success', async () => {
      const adapter = new ScriptedAdapter(['throw', 'ready']);
      const {coordinator} = setup(adapter, 3);

      const first = await coordinator.stage(request('beat-1'));
      expect(first.ok).toBe(false);
      if (!first.ok) expect(first.reason).toBe('preparation-failed');
      expect(coordinator.attemptsFor('beat-1')).toBe(1);

      const second = await coordinator.stage(request('beat-1'));
      expect(second.ok).toBe(true);
      // Fixed, not "one failure less broken" - success clears the count outright.
      expect(coordinator.attemptsFor('beat-1')).toBe(0);
    });

    it('charges an attempt for a finish-without-ready, the same as a thrown failure', async () => {
      const adapter = new ScriptedAdapter(['not-ready']);
      const {coordinator} = setup(adapter, 3);

      const result = await coordinator.stage(request('beat-1'));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('not-ready');
      expect(coordinator.attemptsFor('beat-1')).toBe(1);
    });

    it('stops calling the adapter once a beat has failed maxAttempts times in a row', async () => {
      const adapter = new ScriptedAdapter(['throw', 'throw']);
      const {coordinator} = setup(adapter, 2);

      await coordinator.stage(request('beat-1'));
      await coordinator.stage(request('beat-1'));
      expect(coordinator.attemptsFor('beat-1')).toBe(2);
      expect(adapter.calls).toBe(2);

      const third = await coordinator.stage(request('beat-1'));
      expect(third.ok).toBe(false);
      if (!third.ok) expect(third.reason).toBe('attempts-exhausted');
      if (!third.ok && third.reason === 'attempts-exhausted') {
        expect(third.attempts).toBe(2);
      }
      // The budget check refused before ever calling the adapter a third time.
      expect(adapter.calls).toBe(2);
    });

    it('does not charge a beat for being refused as busy (candidate-in-progress)', async () => {
      const adapter = new DeferredAdapter();
      const {coordinator} = setup(adapter, 3);

      const held = coordinator.stage(request('beat-1'));
      const busy = await coordinator.stage(request('beat-2'));
      expect(busy.ok).toBe(false);
      if (!busy.ok) expect(busy.reason).toBe('candidate-in-progress');
      expect(coordinator.attemptsFor('beat-2')).toBe(0);

      adapter.settle();
      await held;
    });

    it('does not charge a beat for being superseded by a later restage', async () => {
      const adapter = new DeferredAdapter();
      const {coordinator} = setup(adapter, 3);

      const stale = coordinator.restage(request('beat-1'));
      const fresh = coordinator.restage(request('beat-2'));
      adapter.settle();
      await Promise.all([stale, fresh]);

      expect(coordinator.attemptsFor('beat-1')).toBe(0);
    });

    it('a beat with an exhausted budget refuses restage without touching an unrelated in-flight candidate', async () => {
      const adapter = new ScriptedAdapter(['throw', 'throw']);
      const {coordinator, owner} = setup(adapter, 2);

      await coordinator.stage(request('beat-1'));
      await coordinator.stage(request('beat-1'));
      expect(coordinator.attemptsFor('beat-1')).toBe(2);

      // A different beat is healthily in flight when the exhausted one is retried.
      const deferredAdapter = new DeferredAdapter();
      const {coordinator: otherCoordinator} = setup(deferredAdapter, 2);
      const healthy = otherCoordinator.stage(request('beat-2'));

      const refused = await coordinator.restage(request('beat-1'));
      expect(refused.ok).toBe(false);
      if (!refused.ok) expect(refused.reason).toBe('attempts-exhausted');
      // The other coordinator's candidate was never touched by this refusal.
      expect(otherCoordinator.status().phase).toBe('preparing');

      deferredAdapter.settle();
      await healthy;
      void owner;
    });

    it('forgetAttempts gives a replacement request a clean budget', async () => {
      const adapter = new ScriptedAdapter(['throw', 'ready']);
      const {coordinator} = setup(adapter, 1);

      const first = await coordinator.stage(request('beat-1'));
      expect(first.ok).toBe(false);
      expect(coordinator.attemptsFor('beat-1')).toBe(1);

      // Without forgetting, the budget (1) is already spent.
      const stillExhausted = await coordinator.stage(request('beat-1'));
      expect(stillExhausted.ok).toBe(false);
      if (!stillExhausted.ok) {
        expect(stillExhausted.reason).toBe('attempts-exhausted');
      }

      coordinator.forgetAttempts('beat-1');
      const afterForgetting = await coordinator.stage(request('beat-1'));
      expect(afterForgetting.ok).toBe(true);
    });
  });
});
