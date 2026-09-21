import type {Scene2D, View2D} from '@ovacanvas/2d';
// A narrow, dependency-free subpath, not the full `@ovacanvas/2d` barrel -
// see the identical note in `repair.ts` for why.
import {theme} from '@ovacanvas/2d/lib/theme/theme';
import type {Project} from '@ovacanvas/core';
import {
  DependencyContext,
  LogLevel,
  Player,
  Stage,
  Vector2,
} from '@ovacanvas/core';
import type {BeatManifest} from './BeatManifest';
import {buildBeatProject} from './buildBeatProject';

import type {MutationCapability} from '@ovacanvas/core/lib/internal';
import type {LessonState} from '../lesson/LessonState';

export const BEAT_SIZE = new Vector2(1920, 1080);

function wait(ms: number): Promise<void> {
  return new Promise<void>(resolve => setTimeout(resolve, ms));
}

/**
 * One beat, built offstage: its own `Project`, `Player` and `Stage`, in a
 * detached container never attached to the document until the host decides
 * to show it.
 *
 * @remarks
 * Deliberately has no interaction layer yet (no `InteractionController`,
 * `PointerDispatcher`, `InteractionTargets`) - that lands with interruption
 * handling in a later milestone. A beat plays continuously once shown (see
 * {@link play}); it just cannot be interacted with.
 */
export class BeatPresentation {
  public readonly project: Project;
  public readonly stage: Stage;
  public readonly player: Player;
  public readonly container: HTMLElement;

  public capability: MutationCapability<LessonState> | null = null;
  public renderCount = 0;
  public ready = false;
  public disposeCount = 0;
  /**
   * The most recent error the scene threw while stepping, if any.
   *
   * @remarks
   * `Player.request()` wraps scene stepping in try/catch and routes anything
   * thrown to the project's `Logger` rather than rethrowing it, so a scene
   * that errors on its very first frame (a bad prop value, a constructor
   * called with the wrong shape) produces no rejection and no thrown
   * exception - `renderOnce()` would otherwise time out looking identical to
   * a scene that is genuinely just slow. Surfacing the logged error here is
   * what lets a caller report the real cause instead of "never rendered".
   */
  public lastError: string | null = null;

  private readonly disposers: Array<() => void> = [];
  private settle: (() => void) | null = null;
  private playing = false;

  public constructor(public readonly manifest: BeatManifest) {
    this.project = buildBeatProject(`ovc-beat-${manifest.id}`, manifest.runner);

    this.player = new Player(
      this.project,
      {size: BEAT_SIZE, resolutionScale: 1, fps: 30},
      {paused: true, loop: false, muted: true},
      0,
    );

    this.stage = new Stage();
    this.stage.configure({
      size: BEAT_SIZE,
      resolutionScale: 1,
      background: theme().paper,
    });

    const canvas = this.stage.finalBuffer;
    canvas.style.opacity = '0';

    this.container = document.createElement('div');
    this.container.className = 'ovc-beat';
    this.container.dataset.beat = manifest.id;
    this.container.append(canvas);

    this.disposers.push(
      this.project.logger.onLogged.subscribe(payload => {
        if (payload.level === LogLevel.Error) {
          this.lastError = [payload.message, payload.remarks, payload.stack]
            .filter(Boolean)
            .join('\n');
        }
      }),
    );

    this.disposers.push(
      this.player.onRender.subscribe(async () => {
        if (this.disposeCount > 0) return;
        await this.stage.render(
          this.player.playback.currentScene,
          this.player.playback.previousScene,
        );
        this.renderCount++;
        // Stop the loop only when the beat is not playing. `renderOnce` relies
        // on this to settle exactly one frame; playback needs the loop to keep
        // running, and sleeping after every frame is why nothing ever moved.
        if (!this.playing) this.player.sleep();
        const settle = this.settle;
        this.settle = null;
        settle?.();
      }),
    );
  }

  public get view(): View2D {
    return (this.player.playback.currentScene as Scene2D).getView();
  }

  public get canvas(): HTMLCanvasElement {
    return this.stage.finalBuffer;
  }

  public get opacity(): number {
    return Number(this.canvas.style.opacity || '1');
  }

  public set opacity(value: number) {
    this.canvas.style.opacity = String(value);
  }

  public get isVisible(): boolean {
    return this.canvas.isConnected;
  }

  /**
   * Force one real render and wait for it. Readiness is this having
   * happened at least once, not the constructor having returned.
   */
  public async renderOnce(timeout = 6000): Promise<boolean> {
    if (this.disposeCount > 0) return false;
    const before = this.renderCount;
    const settled = new Promise<void>(resolve => (this.settle = resolve));
    this.player.requestRender();
    this.player.wake();
    const deadline = Date.now() + timeout;
    while (this.renderCount <= before && Date.now() < deadline) {
      await Promise.race([settled, wait(4)]);
    }
    return this.renderCount > before;
  }

  /**
   * Whether the scene is genuinely stuck on async work that will never
   * resolve, as opposed to just being slow to compute - the caller's real
   * decision point for whether retrying with more time could ever help.
   */
  public hasPendingAsyncWork(): boolean {
    return DependencyContext.getPendingPromiseSummaries().length > 0;
  }

  /**
   * Why this presentation never rendered, as far as the engine can tell.
   *
   * @remarks
   * Called by the adapter after `renderOnce` times out with `lastError`
   * unset. Without this, the two real causes were indistinguishable from the
   * log: a scene that is genuinely too heavy to render in time, and a scene
   * whose signal evaluation is waiting on a promise that will never resolve
   * (a failed resource load, a computed that never settles). The first is a
   * content-size problem, the second is a hang - the retry feedback must say
   * which, or the model guesses and wastes attempts fixing the wrong thing.
   */
  public describeUnrenderedState(): string {
    const pending = DependencyContext.getPendingPromiseSummaries();
    if (pending.length > 0) {
      const sites = pending
        .slice(0, 3)
        .map(p => p.site)
        .join('; ');
      return (
        `the scene has ${pending.length} unsettled async dependenc${pending.length === 1 ? 'y' : 'ies'} ` +
        `(a resource or computed promise that never resolved - a failed image/font/network ` +
        `load, or a signal awaiting a value that never arrives). Created at: ${sites}`
      );
    }
    return (
      'no async work is pending - the scene is genuinely too heavy to render within the ' +
      'timeout (too many nodes, too many Latex/MathJax layouts, or a beat that is simply too long)'
    );
  }

  public get isPlaying(): boolean {
    return this.playing;
  }

  /**
   * Start the beat playing, on a loop.
   *
   * @remarks
   * This is the playback driver the milestone note above used to defer, and
   * without it every beat in this product was a single static frame: the
   * player was created paused, `renderOnce` rendered exactly one frame, and
   * nothing ever advanced the playhead. Every entrance, morph and pacing
   * decision the authoring layer makes was therefore inert - which is not a
   * cosmetic gap, because it silently invalidated the whole animation half of
   * what a beat is supposed to be.
   *
   * **Loops**, which is what a "continuously-playing visual explanation"
   * means and what the product's own vision asks for.
   *
   * @remarks
   * This started out looping, was switched to play-once to dodge a real
   * engine defect, and is back to looping now that the defect is fixed. The
   * history is worth keeping because the symptom was so misleading: a
   * regenerated `Latex` node rendered at **0x0** and stayed there, so the
   * equation vanished on the second cycle of every loop. The cause was not
   * looping at all - it was that a `Latex` node's document build could land
   * outside a scene context, throw, and have the failure cached by a memoized
   * computed. Looping merely triggered the generator re-execution that
   * exposed it. See `Latex`'s constructor.
   */
  public play(): void {
    if (this.disposeCount > 0 || this.playing) return;
    this.playing = true;
    this.player.toggleLoop(true);
    this.player.togglePlayback(true);
    this.player.wake();
  }

  /** Stop the playhead where it is. */
  public pause(): void {
    if (!this.playing) return;
    this.playing = false;
    this.player.togglePlayback(false);
    this.player.sleep();
  }

  public dispose(): void {
    this.playing = false;
    this.disposeCount++;
    if (this.disposeCount > 1) return;
    for (const dispose of this.disposers.splice(0)) dispose();
    this.player.dispose();
    this.stage.dispose();
    this.container.remove();
  }
}
