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
}

function createFakeBeat(id: string): BeatManifest {
  return {
    id,
    title: `Beat ${id}`,
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
        resolve({id: beatId, disposeCount: 0});
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

    // No beat 3, so cookingIndex is -1 and candidateGeneration is null
    expect(lesson.candidateBeatIndex).toBe(-1);
    expect(owner.status().candidateGeneration).toBeNull();

    // 4. Advance past end returns no-next-beat
    const advance3 = await lesson.advance();
    expect(advance3.ok).toBe(false);
    expect((advance3 as any).reason).toBe('no-next-beat');
  });

  it('allows dynamic beat enqueuing during lesson playback', async () => {
    const adapter = new ControllableFakeAdapter();
    const authority = new RuntimeAuthority<LessonState>(
      initialLessonState('dynamic-lesson', 'Dynamic Beats'),
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
      beats: [createFakeBeat('b0')],
    });

    await lesson.start();
    expect(lesson.currentBeatIndex).toBe(0);
    expect(lesson.candidateBeatIndex).toBe(-1);

    // Enqueue a new beat dynamically
    lesson.enqueueBeat(createFakeBeat('b1-dynamic'));
    // Background cook triggers immediately for newly added beat
    expect(lesson.candidateBeatIndex).toBe(1);
    expect(lesson.status().cookingBeatId).toBe('b1-dynamic');

    const adv = await lesson.advance();
    expect(adv.ok).toBe(true);
    expect(lesson.currentBeat?.id).toBe('b1-dynamic');
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
