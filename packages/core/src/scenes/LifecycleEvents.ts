import {EventDispatcher} from '../events';
import {Scene, SceneRenderEvent} from './Scene';

/**
 * Lifecycle events for {@link Scene} that are cleared on every reset.
 */
export class LifecycleEvents {
  private disposed = false;
  private readonly disposers: Array<() => void> = [];

  public get onBeforeRender() {
    return this.beforeRender.subscribable;
  }
  protected readonly beforeRender =
    new EventDispatcher<CanvasRenderingContext2D>();

  public get onBeginRender() {
    return this.beginRender.subscribable;
  }
  protected readonly beginRender =
    new EventDispatcher<CanvasRenderingContext2D>();

  public get onFinishRender() {
    return this.finishRender.subscribable;
  }
  protected readonly finishRender =
    new EventDispatcher<CanvasRenderingContext2D>();

  public get onAfterRender() {
    return this.afterRender.subscribable;
  }
  protected readonly afterRender =
    new EventDispatcher<CanvasRenderingContext2D>();

  public constructor(private readonly scene: Scene) {
    this.disposers.push(
      this.scene.onRenderLifecycle.subscribe(([event, ctx]) => {
        switch (event) {
          case SceneRenderEvent.BeforeRender:
            return this.beforeRender.dispatch(ctx);
          case SceneRenderEvent.BeginRender:
            return this.beginRender.dispatch(ctx);
          case SceneRenderEvent.FinishRender:
            return this.finishRender.dispatch(ctx);
          case SceneRenderEvent.AfterRender:
            return this.afterRender.dispatch(ctx);
        }
      }),
      this.scene.onReset.subscribe(() => {
        this.clearRenderEvents();
      }),
    );
  }

  /**
   * Release every subscription owned by this object.
   *
   * @remarks
   * Terminal and idempotent, unlike the reset handler above which only clears
   * the render dispatchers.
   *
   * @internal
   */
  public dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const dispose of this.disposers.splice(0)) dispose();
    this.clearRenderEvents();
  }

  private clearRenderEvents() {
    this.beforeRender.clear();
    this.beginRender.clear();
    this.finishRender.clear();
    this.afterRender.clear();
  }
}
