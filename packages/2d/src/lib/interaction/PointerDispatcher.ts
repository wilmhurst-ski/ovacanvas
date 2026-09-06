import {Vector2} from '@ovacanvas/core';
import type {MutationCapability} from '@ovacanvas/core/lib/internal';
import type {InteractionTargets} from './InteractionTargets';
import type {
  InteractionCommit,
  InteractionHandlers,
  InteractionProbe,
  PointerPhase,
  PointerSessionView,
  SessionCancelReason,
} from './types';

/**
 * Scene-space distance a pointer must travel before a press becomes a drag.
 */
const DefaultDragThreshold = 3;

/**
 * What the dispatcher needs from the scene realizing the current generation.
 *
 * @remarks
 * Structural, so the dispatcher never imports a scene implementation. The one
 * call resolves every coordinate a pointer event needs, inside the scene's
 * own execution context.
 *
 * @internal Not a public API.
 */
export interface InteractionProbeSource {
  probeInteraction(
    point: Vector2,
    targets: InteractionTargets,
    captured?: string | null,
  ): InteractionProbe | null;
}

/**
 * @internal Not a public API.
 */
export interface PointerDispatcherOptions<TState extends object> {
  /** The canvas the runtime presents on. Listeners are owned here and only here. */
  element: HTMLCanvasElement;
  /** The scene realizing this generation. */
  scene: InteractionProbeSource;
  /** Which nodes are eligible, and what semantic targets they realize. */
  targets: InteractionTargets;
  /**
   * The generation-scoped permission to mutate authoritative runtime state.
   *
   * @remarks
   * The dispatcher belongs to exactly one generation because this does. When
   * the generation retires, every session it started stops being able to
   * write, without the dispatcher having to be told.
   */
  capability: MutationCapability<TState>;
  handlers?: InteractionHandlers<TState>;
  /** Scene-space distance that turns a press into a drag. */
  dragThreshold?: number;
}

class SessionState implements PointerSessionView {
  public scene: Vector2;
  public local: Vector2;
  public moved = false;
  public phase: PointerPhase = 'pressed';

  public constructor(
    public readonly pointerId: number,
    public readonly target: string,
    public readonly generation: number,
    public readonly startScene: Vector2,
    public readonly startLocal: Vector2,
  ) {
    this.scene = startScene;
    this.local = startLocal;
  }

  public get delta(): Vector2 {
    return this.scene.sub(this.startScene);
  }
}

/**
 * Converts real pointer input into safe interaction with a retained scene.
 *
 * @remarks
 * The stages are kept apart on purpose: raw input, coordinate normalization,
 * hit test, target resolution, gesture session, and only then an authorized
 * mutation request. Nothing here writes runtime state; the last stage asks
 * the generation-scoped capability to, and that request fails closed once the
 * generation is no longer accepted.
 *
 * The dispatcher schedules nothing. It has no timer and no animation frame of
 * its own, so attaching it to an idle runtime leaves the runtime idle; waking
 * rendering after an accepted mutation remains the host's decision.
 *
 * It is also inert for export: a headless render pass reads playback and
 * draws, and never consults interaction. Interaction exists only where a
 * canvas sits in a document receiving pointer events.
 *
 * @internal Not a public API. Names, shape and granularity are not frozen.
 */
export class PointerDispatcher<TState extends object> {
  private readonly element: HTMLCanvasElement;
  private readonly scene: InteractionProbeSource;
  private readonly targets: InteractionTargets;
  private readonly capability: MutationCapability<TState>;
  private readonly handlers: InteractionHandlers<TState>;
  private readonly dragThreshold: number;
  private readonly sessions = new Map<number, SessionState>();
  private readonly previousTouchAction: string;
  private disposed = false;

  public constructor(options: PointerDispatcherOptions<TState>) {
    this.element = options.element;
    this.scene = options.scene;
    this.targets = options.targets;
    this.capability = options.capability;
    this.handlers = options.handlers ?? {};
    this.dragThreshold = options.dragThreshold ?? DefaultDragThreshold;
    this.previousTouchAction = this.element.style.touchAction;

    this.element.addEventListener('pointerdown', this.handlePointerDown);
    this.element.addEventListener('pointermove', this.handlePointerMove);
    this.element.addEventListener('pointerup', this.handlePointerUp);
    this.element.addEventListener('pointercancel', this.handlePointerCancel);
    this.element.addEventListener('lostpointercapture', this.handleLostCapture);
    // Without this the browser claims touch drags for scrolling and delivers
    // a pointercancel mid-gesture.
    this.element.style.touchAction = 'none';
  }

  /** The generation this dispatcher belongs to. */
  public get generation(): number {
    return this.capability.generation;
  }

  /** How many pointer sessions are currently live. */
  public get activeSessions(): number {
    return this.sessions.size;
  }

  public get isDisposed(): boolean {
    return this.disposed;
  }

  /** Whether an interaction could currently reach authoritative state. */
  public isAuthorized(): boolean {
    return !this.disposed && this.capability.isValid();
  }

  /** The live session for a pointer, if any. */
  public sessionFor(pointerId: number): PointerSessionView | null {
    return this.sessions.get(pointerId) ?? null;
  }

  /**
   * End every live session.
   *
   * @returns How many sessions were ended.
   *
   * @remarks
   * The host calls this when it rebuilds presentation or retires this
   * generation deliberately. It is not the only protection: a session whose
   * generation retired without anyone calling this still cannot write, and
   * ends itself on the next event it sees.
   */
  public cancelAll(reason: SessionCancelReason = 'reset'): number {
    const live = [...this.sessions.values()];
    for (const session of live) {
      this.endSession(session, reason);
    }
    return live.length;
  }

  /**
   * Terminally detach this dispatcher.
   *
   * @remarks
   * Idempotent. Every listener CAP-01 added is removed, every capture is
   * released and every session is cancelled, so pointer events that arrive
   * afterwards do nothing at all.
   */
  public dispose(): void {
    if (this.disposed) return;
    this.cancelAll('disposed');
    this.disposed = true;

    this.element.removeEventListener('pointerdown', this.handlePointerDown);
    this.element.removeEventListener('pointermove', this.handlePointerMove);
    this.element.removeEventListener('pointerup', this.handlePointerUp);
    this.element.removeEventListener('pointercancel', this.handlePointerCancel);
    this.element.removeEventListener(
      'lostpointercapture',
      this.handleLostCapture,
    );
    this.element.style.touchAction = this.previousTouchAction;
  }

  private readonly commit: InteractionCommit<TState> = {
    isValid: () => this.isAuthorized(),
    commit: mutate => {
      if (this.disposed) {
        throw new Error(
          'Rejected an interaction mutation: the pointer dispatcher is disposed.',
        );
      }
      // The capability is the authority check, and it already fails closed
      // for a retired generation. Nothing here second-guesses it.
      return this.capability.write(mutate);
    },
  };

  private readonly handlePointerDown = (event: PointerEvent) => {
    if (this.disposed) return;
    // Primary button only. Secondary and auxiliary buttons belong to the
    // interaction policy layer, which does not exist yet.
    if (event.button !== 0) return;
    if (this.sessions.has(event.pointerId)) return;
    if (!this.capability.isValid()) {
      this.cancelAll('generation-retired');
      return;
    }

    const probe = this.probe(event, null);
    if (!probe?.hit) return;

    const session = new SessionState(
      event.pointerId,
      probe.hit.target,
      this.capability.generation,
      probe.scene,
      probe.hit.local,
    );
    this.sessions.set(event.pointerId, session);

    try {
      // Capture is what keeps a drag alive once the pointer leaves the target.
      this.element.setPointerCapture(event.pointerId);
    } catch {
      // Best effort: some pointers cannot be captured. The session still
      // tracks every event the element receives.
    }

    this.handlers.onPress?.(session, this.commit);
  };

  private readonly handlePointerMove = (event: PointerEvent) => {
    if (this.disposed) return;
    // V1 tracks no hover: without a live session there is nothing to update.
    const session = this.sessions.get(event.pointerId);
    if (!session) return;

    if (!this.capability.isValid()) {
      this.endSession(session, 'generation-retired');
      return;
    }

    const probe = this.probe(event, session.target);
    if (!probe || probe.captured === null) {
      this.endSession(session, 'target-detached');
      return;
    }

    session.scene = probe.scene;
    session.local = probe.captured;
    if (!session.moved && session.delta.magnitude > this.dragThreshold) {
      session.moved = true;
      session.phase = 'dragging';
    }

    this.handlers.onMove?.(session, this.commit);
  };

  private readonly handlePointerUp = (event: PointerEvent) => {
    if (this.disposed) return;
    const session = this.sessions.get(event.pointerId);
    if (!session) return;

    this.sessions.delete(event.pointerId);
    this.releaseCapture(event.pointerId);

    if (!this.capability.isValid()) {
      session.phase = 'cancelled';
      this.handlers.onCancel?.(session, 'generation-retired');
      return;
    }

    const probe = this.probe(event, session.target);
    if (probe && probe.captured !== null) {
      session.scene = probe.scene;
      session.local = probe.captured;
    }
    session.phase = 'ended';
    this.handlers.onRelease?.(session, this.commit);
  };

  private readonly handlePointerCancel = (event: PointerEvent) => {
    this.cancelPointer(event.pointerId, 'pointercancel');
  };

  private readonly handleLostCapture = (event: PointerEvent) => {
    // A release already removed its session, so the capture loss it causes is
    // a no-op here. What reaches this is an involuntary loss, such as the
    // canvas leaving the document mid-drag.
    this.cancelPointer(event.pointerId, 'lost-capture');
  };

  private cancelPointer(pointerId: number, reason: SessionCancelReason) {
    const session = this.sessions.get(pointerId);
    if (!session) return;
    this.endSession(session, reason);
  }

  private endSession(session: SessionState, reason: SessionCancelReason) {
    this.sessions.delete(session.pointerId);
    this.releaseCapture(session.pointerId);
    session.phase = 'cancelled';
    this.handlers.onCancel?.(session, reason);
  }

  private releaseCapture(pointerId: number) {
    try {
      if (this.element.hasPointerCapture(pointerId)) {
        this.element.releasePointerCapture(pointerId);
      }
    } catch {
      // The pointer is already gone; there is nothing left to release.
    }
  }

  private probe(
    event: PointerEvent,
    captured: string | null,
  ): InteractionProbe | null {
    return this.scene.probeInteraction(
      this.bufferPoint(event),
      this.targets,
      captured,
    );
  }

  /**
   * Client coordinates to canvas buffer coordinates.
   *
   * @remarks
   * One step covers both CSS scaling and the resolution scale, because the
   * ratio between the backing store and the laid-out content box is exactly
   * their product. Borders are subtracted; padding on a canvas is assumed to
   * be zero, as it is for every canvas this runtime creates.
   *
   * The result may fall outside the canvas, and must: a captured drag keeps
   * reporting positions after the pointer leaves.
   */
  private bufferPoint(event: PointerEvent): Vector2 {
    const canvas = this.element;
    const rect = canvas.getBoundingClientRect();
    const contentWidth = canvas.clientWidth || rect.width;
    const contentHeight = canvas.clientHeight || rect.height;

    return new Vector2(
      contentWidth === 0
        ? 0
        : ((event.clientX - rect.left - canvas.clientLeft) * canvas.width) /
          contentWidth,
      contentHeight === 0
        ? 0
        : ((event.clientY - rect.top - canvas.clientTop) * canvas.height) /
          contentHeight,
    );
  }
}
