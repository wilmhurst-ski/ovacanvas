import type {PointerSessionView, SessionCancelReason} from '@ovacanvas/2d';
import {InteractionTargets, PointerDispatcher, Scene2D} from '@ovacanvas/2d';
import {
  PlaybackState,
  Player,
  Stage,
  Vector2,
  createEffect,
} from '@ovacanvas/core';
import project from '../interaction/project?project';
import type {
  InteractionCapability,
  InteractionGeneration,
  InteractionState,
} from '../interaction/runtimeState';
import {
  HandleOrigin,
  InteractionBinding,
  InteractionStore,
  registerBinding,
} from '../interaction/runtimeState';

export const Size = 400;

/**
 * Counts every animation frame the runtime asks for, so an interaction
 * subsystem that is attached but unused can be proven to schedule nothing.
 */
export const rafLedger = {requested: 0, fired: 0};

const NativeRaf = window.requestAnimationFrame.bind(window);
window.requestAnimationFrame = (callback: FrameRequestCallback) => {
  rafLedger.requested++;
  return NativeRaf((time: number) => {
    rafLedger.fired++;
    callback(time);
  });
};

/** One recorded interaction callback, for assertions about session shape. */
export interface InteractionEvent {
  kind: 'press' | 'move' | 'release' | 'cancel';
  target: string;
  generation: number;
  pointerId: number;
  moved: boolean;
  phase: string;
  scene: {x: number; y: number};
  local: {x: number; y: number};
  delta: {x: number; y: number};
  reason: SessionCancelReason | null;
  /** Whether the mutation this callback attempted was accepted. */
  mutated: boolean;
  /** The message of a refused mutation, if one was refused. */
  refusal: string | null;
}

function hashCanvas(stage: Stage) {
  const {data} = stage.context.getImageData(0, 0, Size, Size);
  let hash = 2166136261;
  for (let i = 0; i < data.length; i += 4) {
    hash ^=
      data[i] | (data[i + 1] << 8) | (data[i + 2] << 16) | (data[i + 3] << 24);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

type HostMode = 'boot' | 'idle' | 'dirty' | 'seek' | 'disposed';

/**
 * The smallest runtime host that can exercise CAP-01 end to end.
 *
 * @remarks
 * It owns the store, the stage, the player and one pointer dispatcher bound
 * to this generation's capability. The dispatcher is the only thing that
 * turns pointer input into a mutation request, and the capability is the only
 * thing that can accept one.
 */
export class InteractionHost {
  public readonly store: InteractionStore;
  public readonly stage = new Stage();
  public readonly player: Player;
  public readonly targets = new InteractionTargets();
  public readonly dispatcher: PointerDispatcher<InteractionState>;
  public readonly generation: InteractionGeneration;
  public readonly binding: InteractionBinding;

  public mode: HostMode = 'boot';
  public renderCount = 0;
  public ready = false;
  public events: InteractionEvent[] = [];
  public disposeCalls = 0;
  public disposeExecutions = 0;

  /** Pointer listeners added to and removed from this runtime's canvas. */
  public readonly listenerLedger = {added: 0, removed: 0};

  private readonly capability: InteractionCapability;
  private dirtyPending = false;
  private settle: (() => void) | null = null;
  private readonly disposers: Array<() => void> = [];

  public constructor(
    public readonly id: string,
    container: HTMLElement,
  ) {
    this.store = new InteractionStore(id);
    const {prepared, binding} = this.store.prepareGeneration(this.targets);
    this.generation = prepared;
    this.binding = binding;
    this.capability = prepared.capability;

    this.stage.configure({
      size: new Vector2(Size, Size),
      resolutionScale: 1,
      background: '#101216',
    });
    const canvas = this.stage.finalBuffer;
    container.append(canvas);

    // Count what CAP-01 attaches, so terminal disposal can be shown to leave
    // the canvas exactly as it found it.
    const nativeAdd = canvas.addEventListener.bind(canvas);
    const nativeRemove = canvas.removeEventListener.bind(canvas);
    canvas.addEventListener = (type: string, ...rest: any[]) => {
      if (type.startsWith('pointer') || type.endsWith('pointercapture')) {
        this.listenerLedger.added++;
      }
      return (nativeAdd as any)(type, ...rest);
    };
    canvas.removeEventListener = (type: string, ...rest: any[]) => {
      if (type.startsWith('pointer') || type.endsWith('pointercapture')) {
        this.listenerLedger.removed++;
      }
      return (nativeRemove as any)(type, ...rest);
    };

    this.player = new Player(
      project,
      {size: new Vector2(Size, Size), resolutionScale: 1, fps: 30},
      {paused: true, loop: false, muted: true},
      0,
    );

    const scene = this.player.playback.currentScene;
    registerBinding(scene, this.binding);

    this.disposers.push(
      scene.onReset.subscribe(() => {
        this.binding.beginReconstruction();
        // Presentation is being rebuilt, so nothing may still be dragging one
        // of the nodes it is about to replace.
        this.dispatcher?.cancelAll('reset');
      }),
    );

    this.disposers.push(
      this.player.onRender.subscribe(async () => {
        if (this.mode === 'disposed') return;
        await this.stage.render(
          this.player.playback.currentScene,
          this.player.playback.previousScene,
        );
        this.renderCount++;
        this.player.sleep();
        this.mode = 'idle';
        if (!this.ready) {
          this.ready = true;
          this.generation.markReady();
          this.store.authority.activate(this.generation);
        }
        const settle = this.settle;
        this.settle = null;
        settle?.();
      }),
    );

    // An accepted mutation changes the projection, which wakes rendering.
    // The host decides that, not the dispatcher.
    this.disposers.push(
      createEffect(() => {
        this.binding.handleX();
        this.binding.handleY();
        if (this.ready && this.mode !== 'disposed') this.markDirty();
      }),
    );

    this.dispatcher = new PointerDispatcher<InteractionState>({
      element: canvas,
      scene: scene as Scene2D,
      targets: this.targets,
      capability: this.capability,
      handlers: {
        onPress: (session, commit) =>
          this.record('press', session, null, () =>
            commit.commit(draft => {
              draft.presses++;
            }),
          ),
        onMove: (session, commit) =>
          this.record('move', session, null, () => {
            if (session.target !== 'target.handle' || !session.moved) return;
            commit.commit(draft => {
              draft.handle = {
                x: HandleOrigin.x + session.delta.x,
                y: HandleOrigin.y + session.delta.y,
              };
            });
          }),
        onRelease: (session, commit) =>
          this.record('release', session, null, () => {
            void commit;
          }),
        onCancel: (session, reason) =>
          this.record('cancel', session, reason, null),
      },
    });
  }

  private record(
    kind: InteractionEvent['kind'],
    session: PointerSessionView,
    reason: SessionCancelReason | null,
    mutate: (() => void) | null,
  ) {
    let mutated = false;
    let refusal: string | null = null;
    if (mutate) {
      try {
        mutate();
        mutated = true;
      } catch (error: any) {
        refusal = String(error?.message ?? error);
      }
    }
    this.events.push({
      kind,
      target: session.target,
      generation: session.generation,
      pointerId: session.pointerId,
      moved: session.moved,
      phase: session.phase,
      scene: {x: session.scene.x, y: session.scene.y},
      local: {x: session.local.x, y: session.local.y},
      delta: {x: session.delta.x, y: session.delta.y},
      reason,
      mutated,
      refusal,
    });
  }

  private markDirty() {
    if (this.dirtyPending || this.mode !== 'idle') return;
    this.dirtyPending = true;
    queueMicrotask(() => {
      this.dirtyPending = false;
      if (this.mode !== 'idle') return;
      this.mode = 'dirty';
      this.player.requestRender();
      this.player.wake();
    });
  }

  /** Wait until the runtime has drawn at least one more frame. */
  public async settled(before = this.renderCount, timeout = 4000) {
    const deadline = Date.now() + timeout;
    while (this.renderCount <= before && Date.now() < deadline) await wait(4);
    return this.renderCount > before;
  }

  /**
   * The host's own write path, used to return the fixture to a known state
   * between probes. Presentation cannot reach this.
   */
  public resetHandle(): number {
    return this.capability.write(draft => {
      draft.handle = {...HandleOrigin};
      draft.presses = 0;
    });
  }

  public clearEvents() {
    this.events = [];
  }

  /**
   * Client coordinates for a point in scene space.
   *
   * @remarks
   * The inverse of what the dispatcher does, computed independently from the
   * canvas geometry so the regression drives real pointer input at a place it
   * chose rather than at a place the dispatcher reported.
   */
  public clientPoint(sceneX: number, sceneY: number) {
    const rect = this.stage.finalBuffer.getBoundingClientRect();
    const width = this.stage.finalBuffer.clientWidth || rect.width;
    const height = this.stage.finalBuffer.clientHeight || rect.height;
    return {
      x: rect.left + ((sceneX + Size / 2) * width) / Size,
      y: rect.top + ((sceneY + Size / 2) * height) / Size,
    };
  }

  /**
   * Retire this generation by accepting a successor on the same authority.
   *
   * @remarks
   * Deliberately does not touch the dispatcher: the point is that a session
   * started under the outgoing generation stops being able to write because
   * its capability stopped being valid, not because anyone remembered to tell
   * the dispatcher.
   */
  public retireGeneration() {
    const successor = this.store.authority.prepare();
    successor.markReady();
    const result = this.store.authority.activate(successor);
    return {
      ok: result.ok,
      successor: successor.id,
      capability: successor.capability,
    };
  }

  /** Whether this host's own generation still holds accepted authority. */
  public isAccepted(): boolean {
    return this.capability.isValid();
  }

  public canvasHash(): number | null {
    return this.mode === 'disposed' ? null : hashCanvas(this.stage);
  }

  /**
   * A headless render pass, which must not consult interaction at all.
   */
  public async exportPass(frames: number[]) {
    const previous = this.mode;
    this.mode = 'seek';
    this.player.playback.state = PlaybackState.Rendering;
    await this.player.playback.recalculate();
    await this.player.playback.reset();
    const hashes: number[] = [];
    for (const frame of frames) {
      await this.player.playback.seek(frame);
      await this.stage.render(
        this.player.playback.currentScene,
        this.player.playback.previousScene,
      );
      hashes.push(hashCanvas(this.stage));
    }
    await this.player.playback.seek(0);
    await this.stage.render(
      this.player.playback.currentScene,
      this.player.playback.previousScene,
    );
    this.player.playback.state = PlaybackState.Paused;
    this.mode = previous === 'disposed' ? 'disposed' : 'idle';
    return hashes;
  }

  public snapshot() {
    const state = this.store.read();
    return {
      id: this.id,
      mode: this.mode,
      revision: this.store.revision,
      handle: {...state.handle},
      presses: state.presses,
      generation: this.binding.generation,
      accepted: this.isAccepted(),
      acceptedGeneration: this.store.authority.activeGeneration,
      reconstructions: this.binding.reconstructions,
      boundTargets: this.targets.targets.sort(),
      activeSessions: this.dispatcher.activeSessions,
      dispatcherDisposed: this.dispatcher.isDisposed,
      authorized: this.dispatcher.isAuthorized(),
      renderCount: this.renderCount,
      canvasHash: this.canvasHash(),
      listeners: {...this.listenerLedger},
      events: this.events.length,
    };
  }

  /** Detach CAP-01 only, leaving the rest of the runtime alive. */
  public disposeInteraction() {
    this.dispatcher.dispose();
  }

  public dispose() {
    this.disposeCalls++;
    if (this.mode === 'disposed') return;
    this.disposeExecutions++;
    this.mode = 'disposed';
    this.dispatcher.dispose();
    for (const dispose of this.disposers.splice(0)) dispose();
    this.player.dispose();
    this.stage.dispose();
    this.generation.discard();
    this.store.dispose();
  }
}

export const wait = (ms: number) =>
  new Promise<void>(resolve => setTimeout(resolve, ms));
