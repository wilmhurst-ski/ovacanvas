import {TransitionOwner} from '@ovacanvas/core/lib/internal';
import type {ChunkRequest} from '../lesson/ChunkRequest';
import {Lesson} from '../lesson/Lesson';
import type {LessonState} from '../lesson/LessonState';
import {LessonStore} from '../lesson/LessonStore';
import {BeatAdapter} from '../presentation/BeatAdapter';
import type {BeatManifest} from '../presentation/BeatManifest';
import type {BeatPresentation} from '../presentation/BeatPresentation';
import {createOpenerBeat} from '../presentation/openerBeat';
import type {BeatStagingResult} from './BeatStagingCoordinator';
import {BeatStagingCoordinator} from './BeatStagingCoordinator';

export interface LessonHostOptions {
  /** Visual crossfade transition duration in milliseconds. Defaults to 300ms. */
  readonly transitionDurationMs?: number;
}

/**
 * Owns one lesson's staging pipeline: a `LessonStore`, a `TransitionOwner`
 * wired to a gate-checked `BeatAdapter`, and the visible slot beats are
 * appended into once activated.
 *
 * @remarks
 * The restage/activate mechanics live in `BeatStagingCoordinator`, tested
 * separately against a fake presentation - this class is the real,
 * DOM-and-canvas-backed composition of it. It is deliberately not unit
 * tested under vitest/jsdom: `BeatAdapter` imports the full `@ovacanvas/2d`
 * barrel, which does not initialize under jsdom, and mocking a canvas away
 * from a canvas-rendering audit gate would defeat the point of the gate. Its
 * real coverage is the Playwright suite in `packages/e2e`
 * (`lessonPipeline.test.ts`), which drives a real browser and a real canvas.
 */
export class LessonHost {
  public readonly store: LessonStore;
  public readonly stageSlot: HTMLElement;
  private readonly adapter: BeatAdapter;
  private readonly coordinator: BeatStagingCoordinator<BeatPresentation>;

  public constructor(
    lessonId: string,
    question: string,
    container: HTMLElement,
    options: LessonHostOptions = {},
  ) {
    this.store = new LessonStore(lessonId, question);

    this.stageSlot = document.createElement('div');
    this.stageSlot.className = 'ovc-lesson-stage';
    container.append(this.stageSlot);

    this.adapter = new BeatAdapter(this.stageSlot, {
      transitionDurationMs: options.transitionDurationMs,
      onTransitionComplete: () => {
        this.coordinator.retireOutgoing();
      },
    });
    const owner = new TransitionOwner<
      LessonState,
      BeatPresentation,
      ChunkRequest
    >({
      authority: this.store.authority,
      adapter: this.adapter,
    });
    this.coordinator = new BeatStagingCoordinator(owner);
  }

  public get current(): BeatPresentation | null {
    return this.coordinator.current;
  }

  public get outgoing(): BeatPresentation | null {
    return this.coordinator.outgoing;
  }

  public status() {
    return this.coordinator.status();
  }

  public lastReportFor(generation: number) {
    return this.adapter.lastReport.get(generation) ?? null;
  }

  public stage(request: ChunkRequest) {
    return this.coordinator.stage(request);
  }

  public activate() {
    return this.coordinator.activate();
  }

  public retireOutgoing(): boolean {
    return this.coordinator.retireOutgoing();
  }

  public restage(request: ChunkRequest) {
    return this.coordinator.restage(request);
  }

  /** How many consecutive real failures this beat has accumulated so far. */
  public attemptsFor(beatId: string): number {
    return this.coordinator.attemptsFor(beatId);
  }

  /** {@inheritDoc BeatStagingCoordinator.forgetAttempts} */
  public forgetAttempts(beatId: string): void {
    this.coordinator.forgetAttempts(beatId);
  }

  /**
   * Stage and activate the host-authored opener beat as the lesson's very
   * first visible content, restating the question this lesson was started
   * with.
   *
   * @remarks
   * Call this once, immediately after construction, before staging the
   * LLM's real first beat. It is the latency fix from the speed pass: the
   * learner sees the opener (audited, real, ~1.2s) while the actual first
   * beat cooks behind it, instead of a blank stage during that beat's own
   * generate/typecheck/render/audit round trip.
   */
  public async start(): Promise<BeatStagingResult> {
    const opener = createOpenerBeat(this.store.read().question);
    const result = await this.stage({beat: opener});
    if (result.ok) this.activate();
    return result;
  }

  public createLesson(
    beats: readonly BeatManifest[],
  ): Lesson<BeatPresentation> {
    return new Lesson<BeatPresentation>({
      store: this.store,
      coordinator: this.coordinator,
      beats,
    });
  }

  public dispose(): void {
    this.adapter.disposeAdapter();
    this.coordinator.dispose();
    this.store.dispose();
    this.stageSlot.remove();
  }
}
