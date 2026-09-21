import type {
  PreparationContext,
  PresentationAdapter,
} from '@ovacanvas/core/lib/internal';
import {RuntimeAuthority, TransitionOwner} from '@ovacanvas/core/lib/internal';
import {describe, expect, it} from 'vitest';
import type {BeatManifest} from '../presentation/BeatManifest';
import type {ChunkRequest} from './ChunkRequest';
import {Lesson} from './Lesson';
import {initialLessonState, type LessonState} from './LessonState';
import {LessonStore} from './LessonStore';

interface FakePresentation {
  readonly id: string;
  disposeCount: number;
  capability?: MutationCapability<LessonState>;
}

function createFakeBeat(id: string, title?: string): BeatManifest {
  return {
    id,
    title: title ?? `Beat ${id}`,
    plan: {
      summary: `Summary of ${id}`,
      entities: [],
    },
    runner: function* () {} as unknown as BeatManifest['runner'],
    buildAuditSpec: () => ({
      items: [],
      requiredIds: [],
      safeArea: undefined as never,
    }),
  };
}

class ControllableFakeAdapter
  implements PresentationAdapter<LessonState, FakePresentation, ChunkRequest>
{
  public pendingResolvers = new Map<string, () => void>();
  public autoReady = true;

  public prepare(
    context: PreparationContext<LessonState>,
    req: ChunkRequest,
  ): Promise<FakePresentation> {
    const beatId = req.beat.id;
    return new Promise(resolve => {
      const finish = () => {
        if (!context.isCancelled()) {
          context.markReady();
        }
        resolve({
          id: beatId,
          disposeCount: 0,
          capability: context.capability,
        });
      };

      if (this.autoReady) {
        finish();
      } else {
        this.pendingResolvers.set(beatId, finish);
      }
    });
  }

  public release(presentation: FakePresentation): void {
    presentation.disposeCount++;
  }
}

describe('Lesson multi-beat background cooking', () => {
  it('activates beat 0 and automatically cooks beat 1 offstage in the background', async () => {
    const adapter = new ControllableFakeAdapter();
    const authority = new RuntimeAuthority<LessonState>(
      initialLessonState('test-lesson', 'Test Question'),
    );
    const owner = new TransitionOwner<
      LessonState,
      FakePresentation,
      ChunkRequest
    >({
      authority,
      adapter,
    });

    const beats = [
      createFakeBeat('b0'),
      createFakeBeat('b1'),
      createFakeBeat('b2'),
    ];
    const lesson = new Lesson({
      owner,
      beats,
    });

    expect(lesson.currentBeatIndex).toBe(-1);
    expect(lesson.currentBeat).toBeNull();

    // Start lesson -> beat 0 activates, beat 1 begins cooking offstage
    const startResult = await lesson.start();
    expect(startResult.ok).toBe(true);

    expect(lesson.currentBeatIndex).toBe(0);
    expect(lesson.currentBeat?.id).toBe('b0');
    expect(owner.current?.id).toBe('b0');

    // Candidate generation for beat 1 is populated and ready offstage while beat 0 is active!
    const status = lesson.status();
    expect(status.activeIndex).toBe(0);
    expect(status.activeBeatId).toBe('b0');
    expect(status.cookingIndex).toBe(1);
    expect(status.cookingBeatId).toBe('b1');
    expect(status.candidateGeneration).not.toBeNull();
    expect(status.candidateReady).toBe(true);
  });

  it('demonstrably cooks beat K+1 while beat K is active across all 3 beats', async () => {
    const adapter = new ControllableFakeAdapter();
    const store = new LessonStore('multi-beat', 'What is happening?');
    const owner = new TransitionOwner<
      LessonState,
      FakePresentation,
      ChunkRequest
    >({
      authority: store.authority,
      adapter,
    });

    const b0 = createFakeBeat('beat-0');
    const b1 = createFakeBeat('beat-1');
    const b2 = createFakeBeat('beat-2');

    const lesson = new Lesson({
      store,
      owner,
      beats: [b0, b1, b2],
    });

    // 1. Start: Beat 0 active, Beat 1 cooking offstage
    await lesson.start();
    expect(lesson.currentBeat?.id).toBe('beat-0');
    expect(lesson.candidateBeatIndex).toBe(1);
    expect(owner.status().candidateGeneration).not.toBeNull();

    // 2. Advance: Beat 1 activates, Beat 2 cooking offstage
    const advance1 = await lesson.advance();
    expect(advance1.ok).toBe(true);
    expect(lesson.currentBeatIndex).toBe(1);
    expect(lesson.currentBeat?.id).toBe('beat-1');
    expect(owner.current?.id).toBe('beat-1');

    // While beat 1 is active, beat 2 is cooking offstage!
    expect(lesson.candidateBeatIndex).toBe(2);
    expect(lesson.status().cookingBeatId).toBe('beat-2');
    expect(owner.status().candidateGeneration).not.toBeNull();
    expect(owner.status().candidateReady).toBe(true);

    // 3. Advance: Beat 2 activates
    const advance2 = await lesson.advance();
    expect(advance2.ok).toBe(true);
    expect(lesson.currentBeatIndex).toBe(2);
    expect(lesson.currentBeat?.id).toBe('beat-2');
    expect(owner.current?.id).toBe('beat-2');

    // No beat 3 exists, so cooking index is inactive (-1)
    expect(lesson.candidateBeatIndex).toBe(-1);
    expect(lesson.isCooking).toBe(false);
  });

  it('supports dynamic beat enqueueing to extend an in-progress lesson', async () => {
    const adapter = new ControllableFakeAdapter();
    const store = new LessonStore('dynamic-lesson', 'Dynamic Beats');
    const owner = new TransitionOwner<
      LessonState,
      FakePresentation,
      ChunkRequest
    >({
      authority: store.authority,
      adapter,
    });

    const lesson = new Lesson({
      store,
      owner,
      beats: [createFakeBeat('b0')],
    });

    await lesson.start();
    expect(lesson.currentBeatIndex).toBe(0);
    expect(lesson.candidateBeatIndex).toBe(-1);

    // Enqueue a new beat dynamically
    lesson.enqueueBeat(createFakeBeat('b1'));
    // Background cook triggers immediately for newly added beat
    expect(lesson.candidateBeatIndex).toBe(1);
    expect(lesson.status().cookingBeatId).toBe('b1');

    const adv = await lesson.advance();
    expect(adv.ok).toBe(true);
    expect(lesson.currentBeat?.id).toBe('b1');
  });

  it('proves in-flight asynchronous preparation while previous beat plays', async () => {
    const adapter = new ControllableFakeAdapter();
    adapter.autoReady = false; // manual control over resolution

    const authority = new RuntimeAuthority<LessonState>(
      initialLessonState('async-lesson', 'Async Test'),
    );
    const owner = new TransitionOwner<
      LessonState,
      FakePresentation,
      ChunkRequest
    >({
      authority,
      adapter,
    });

    const lesson = new Lesson({
      owner,
      beats: [createFakeBeat('b0'), createFakeBeat('b1')],
    });

    // Start lesson: resolve b0
    const startPromise = lesson.start();
    expect(adapter.pendingResolvers.has('b0')).toBe(true);
    adapter.pendingResolvers.get('b0')!();
    await startPromise;

    // b0 is active!
    expect(lesson.currentBeat?.id).toBe('b0');
    // b1 is currently in-flight preparing, NOT ready yet
    expect(adapter.pendingResolvers.has('b1')).toBe(true);
    expect(owner.status().candidateGeneration).not.toBeNull();
    expect(owner.status().candidateReady).toBe(false);

    // Now resolve b1 offstage
    adapter.pendingResolvers.get('b1')!();
    // Allow microtask to process
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(owner.status().candidateReady).toBe(true);
    expect(lesson.currentBeat?.id).toBe('b0'); // Still b0 on screen!

    // When advancing, instantaneous swap
    const adv = await lesson.advance();
    expect(adv.ok).toBe(true);
    expect(lesson.currentBeat?.id).toBe('b1');
  });
});

describe('Lesson exploration-vs-commit interruption semantics', () => {
  it('stages and activates an exploration without bumping revision or altering committed track', async () => {
    const adapter = new ControllableFakeAdapter();
    const store = new LessonStore('explore-test', 'Main question');
    const owner = new TransitionOwner<
      LessonState,
      FakePresentation,
      ChunkRequest
    >({
      authority: store.authority,
      adapter,
    });

    const b0 = createFakeBeat('b0', 'Intro');
    const b1 = createFakeBeat('b1', 'Core Concept');
    const lesson = new Lesson({store, owner, beats: [b0, b1]});

    await lesson.start();
    expect(lesson.committedIndex).toBe(0);
    expect(lesson.committedBeat?.id).toBe('b0');
    expect(lesson.currentBeat?.id).toBe('b0');
    expect(store.authority.revision).toBe(0);

    // Learner asks a tangential follow-up question
    const expBeat = createFakeBeat('exp-tangent', 'Why is the sky blue?');
    const exploreResult = await lesson.explore(expBeat, {
      question: 'Why is the sky blue?',
    });

    expect(exploreResult.ok).toBe(true);
    expect(lesson.isExploring).toBe(true);
    expect(lesson.currentBeat?.id).toBe('exp-tangent');
    expect(owner.current?.id).toBe('exp-tangent');

    // Authoritative lesson state & committed index MUST remain undisturbed
    expect(lesson.committedIndex).toBe(0);
    expect(lesson.committedBeat?.id).toBe('b0');
    expect(store.authority.revision).toBe(0); // Zero revision bump!
    expect(store.read().beats).toHaveLength(0); // No projection mutation!
    expect(lesson.beats).toHaveLength(2); // Original track length untouched
  });

  it('cleanly abandons an exploration and restores the committed beat and background cook', async () => {
    const adapter = new ControllableFakeAdapter();
    const store = new LessonStore('abandon-test', 'Main question');
    const owner = new TransitionOwner<
      LessonState,
      FakePresentation,
      ChunkRequest
    >({
      authority: store.authority,
      adapter,
    });

    const b0 = createFakeBeat('b0', 'Intro');
    const b1 = createFakeBeat('b1', 'Next Topic');
    const lesson = new Lesson({store, owner, beats: [b0, b1]});

    await lesson.start();
    const expBeat = createFakeBeat('exp-side', 'Side discussion');
    await lesson.explore(expBeat);

    expect(lesson.isExploring).toBe(true);
    expect(lesson.currentBeat?.id).toBe('exp-side');

    // Learner decides to abandon the side track
    const abandonResult = await lesson.abandonExploration();
    expect(abandonResult.ok).toBe(true);
    expect(lesson.isExploring).toBe(false);
    expect(lesson.currentBeat?.id).toBe('b0');
    expect(owner.current?.id).toBe('b0');
    expect(lesson.committedIndex).toBe(0);
    expect(store.authority.revision).toBe(0);

    // Background cooking of b1 was resumed
    expect(lesson.candidateBeatIndex).toBe(1);
    expect(lesson.status().cookingBeatId).toBe('b1');

    // Learner can advance seamlessly along the original committed track
    const adv = await lesson.advance();
    expect(adv.ok).toBe(true);
    expect(lesson.currentBeat?.id).toBe('b1');
  });

  it('commits an exploration into authoritative state, advancing revision and sequence', async () => {
    const adapter = new ControllableFakeAdapter();
    const store = new LessonStore('commit-test', 'Original question');
    const owner = new TransitionOwner<
      LessonState,
      FakePresentation,
      ChunkRequest
    >({
      authority: store.authority,
      adapter,
    });

    const b0 = createFakeBeat('b0', 'Intro');
    const b1 = createFakeBeat('b1', 'Conclusion');
    const lesson = new Lesson({store, owner, beats: [b0, b1]});

    await lesson.start();
    const expBeat = createFakeBeat('exp-crucial', 'Deep dive into nuances');
    await lesson.explore(expBeat, {question: 'Can you go deeper?'});

    expect(store.authority.revision).toBe(0);

    // Learner commits the explanation
    const commitResult = await lesson.commitExploration({
      question: 'Deep dive accepted',
    });
    expect(commitResult.ok).toBe(true);
    if (!commitResult.ok) return;

    expect(commitResult.revision).toBe(1);
    expect(store.authority.revision).toBe(1);
    expect(lesson.isExploring).toBe(false);

    // The exploration beat is now the committed beat at index 1
    expect(lesson.committedIndex).toBe(1);
    expect(lesson.currentBeat?.id).toBe('exp-crucial');
    expect(lesson.beats).toHaveLength(3);
    expect(lesson.beats[1].id).toBe('exp-crucial');
    expect(lesson.beats[2].id).toBe('b1');

    // Store projection contains the committed beat
    const state = store.read();
    expect(state.question).toBe('Deep dive accepted');
    expect(state.beats).toHaveLength(1);
    expect(state.beats[0].id).toBe('exp-crucial');

    // Subsequent advance moves to b1
    const adv = await lesson.advance();
    expect(adv.ok).toBe(true);
    expect(lesson.currentBeat?.id).toBe('b1');
    expect(lesson.currentBeatIndex).toBe(2);
  });

  it('recovers gracefully from stale-revision rejection in advance()', async () => {
    const adapter = new ControllableFakeAdapter();
    const store = new LessonStore('stale-test', 'Stale revision test');
    const owner = new TransitionOwner<
      LessonState,
      FakePresentation,
      ChunkRequest
    >({
      authority: store.authority,
      adapter,
    });

    const b0 = createFakeBeat('b0');
    const b1 = createFakeBeat('b1');
    const lesson = new Lesson({store, owner, beats: [b0, b1]});

    await lesson.start();
    // b0 is active, b1 is prepared offstage at revision 0
    expect(owner.status().candidateReady).toBe(true);
    expect(owner.status().revision).toBe(0);

    // Out-of-band or exploration commit bumps revision
    const activePresentation = owner.current!;
    expect(activePresentation.capability).toBeDefined();
    activePresentation.capability!.write(draft => {
      draft.question = 'Mutated during background cook';
    });
    expect(store.authority.revision).toBe(1);

    // Candidate b1 now has preparedAtRevision: 0, which is STALE against revision 1!
    // Lesson.advance() should encounter stale-revision refusal, restage fresh, and activate cleanly
    const advanceResult = await lesson.advance();
    expect(advanceResult.ok).toBe(true);
    expect(lesson.currentBeatIndex).toBe(1);
    expect(lesson.currentBeat?.id).toBe('b1');
    expect(owner.current?.id).toBe('b1');
  });

  it('refuses advance while actively exploring', async () => {
    const adapter = new ControllableFakeAdapter();
    const store = new LessonStore('refuse-advance-test', 'Test');
    const owner = new TransitionOwner<
      LessonState,
      FakePresentation,
      ChunkRequest
    >({
      authority: store.authority,
      adapter,
    });

    const b0 = createFakeBeat('b0');
    const b1 = createFakeBeat('b1');
    const lesson = new Lesson({store, owner, beats: [b0, b1]});

    await lesson.start();
    await lesson.explore(createFakeBeat('exp'));

    const adv = await lesson.advance();
    expect(adv.ok).toBe(false);
    expect(adv.reason).toBe('exploring');
  });
});
