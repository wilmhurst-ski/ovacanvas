import type {BBox, PossibleMatrix2D, Vector2} from '@ovacanvas/core';

/**
 * The geometry CAP-01 needs from a presentation node.
 *
 * @remarks
 * Structural on purpose. {@link Node} satisfies it, but picking never imports
 * a component: hit testing is pure coordinate mathematics over bounding boxes
 * and affine matrices, so it stays testable without a scene, a canvas or a
 * DOM.
 *
 * @internal Not a public API. Shape is deliberately not frozen.
 */
export interface PickableNode {
  /**
   * Effective opacity including ancestors.
   *
   * @remarks
   * The renderer skips a node whose absolute opacity is `<= 0`, and picking
   * must agree with it: a fully transparent node is not there to be hit even
   * though `ctx.isPointInPath` would still report a containment.
   */
  absoluteOpacity(): number;

  /** This node's local space to its parent's space. */
  localToParent(): PossibleMatrix2D;

  /** World (canvas buffer) space to this node's local space. */
  worldToLocal(): PossibleMatrix2D;

  /**
   * Local-space bounds covering this node *and* its whole subtree.
   *
   * @remarks
   * Used only as a conservative cull. A point outside it cannot hit anything
   * below this node.
   */
  cacheBBox(): BBox;

  /** Local-space bounds of this node's own contents, excluding children. */
  localContentBBox(): BBox;

  /** Children in draw order. The last one is drawn on top. */
  drawOrderedChildren(): PickableNode[];
}

/**
 * A resolved interaction target.
 *
 * @remarks
 * Deliberately carries the *semantic* target id and no node reference.
 * Presentation instances are rebuilt by reset, seek and hot reload; a target
 * that outlived one of those must still name the same thing, so node identity
 * never leaves target resolution.
 *
 * @internal Not a public API.
 */
export interface PickResult {
  /** The stable semantic target id this node currently realizes. */
  readonly target: string;
  /** The pointer position in that target's local space. */
  readonly local: Vector2;
}

/**
 * One coordinate resolution for one pointer event.
 *
 * @internal Not a public API.
 */
export interface InteractionProbe {
  /** The pointer position in scene space (view-local, origin centred). */
  readonly scene: Vector2;
  /** The topmost eligible target under the pointer, or `null` for a miss. */
  readonly hit: PickResult | null;
  /**
   * The pointer position in the local space of the target a session already
   * captured, or `null` when there is no such session or its node is gone.
   *
   * @remarks
   * Resolved separately from {@link hit} because a drag continues while the
   * pointer is outside the target it started on.
   */
  readonly captured: Vector2 | null;
}

/**
 * Where a pointer session sits in its lifecycle.
 *
 * @internal Not a public API.
 */
export type PointerPhase = 'pressed' | 'dragging' | 'ended' | 'cancelled';

/**
 * Why a pointer session ended without a release.
 *
 * @internal Not a public API.
 */
export type SessionCancelReason =
  /** The browser took the pointer away. */
  | 'pointercancel'
  /** Pointer capture was lost, typically because the canvas left the DOM. */
  | 'lost-capture'
  /** The generation this session belonged to is no longer accepted. */
  | 'generation-retired'
  /** The node realizing the target is gone, typically a scene reset. */
  | 'target-detached'
  /** The host ended the session, typically a reset or a transition. */
  | 'reset'
  /** The dispatcher was terminally disposed. */
  | 'disposed';

/**
 * What an interaction handler is allowed to see about a pointer session.
 *
 * @remarks
 * No node, no capability and no store. A handler holding this holds no
 * authority: mutation goes through {@link InteractionCommit}, which is bound
 * to one generation.
 *
 * @internal Not a public API.
 */
export interface PointerSessionView {
  readonly pointerId: number;
  /** The semantic target this session began on. */
  readonly target: string;
  /** The presentation generation that owns this session. */
  readonly generation: number;
  /** Where the press landed, in scene space. */
  readonly startScene: Vector2;
  /** Where the press landed, in the target's local space. */
  readonly startLocal: Vector2;
  /** The current pointer position in scene space. */
  readonly scene: Vector2;
  /** The current pointer position in the target's local space. */
  readonly local: Vector2;
  /** Movement since the press, in scene space. */
  readonly delta: Vector2;
  /**
   * Whether this session ever exceeded the drag threshold.
   *
   * @remarks
   * This is what separates a held or moved interaction from an ordinary
   * press and release; the release handler reads it rather than guessing
   * from coordinates.
   */
  readonly moved: boolean;
  readonly phase: PointerPhase;
}

/**
 * The only way an interaction may change authoritative runtime state.
 *
 * @remarks
 * Wraps the generation-scoped {@link MutationCapability} the dispatcher was
 * built with. It is not a second authority and holds no state of its own.
 *
 * @internal Not a public API.
 */
export interface InteractionCommit<TState extends object> {
  /** Whether a mutation would currently be accepted. */
  isValid(): boolean;
  /**
   * Request an authoritative mutation.
   *
   * @returns The accepted revision after the write.
   *
   * @remarks
   * Throws if the owning generation is no longer accepted or the dispatcher
   * is disposed. Failing closed is deliberate: an interaction that arrives
   * after its generation retired must not look like it succeeded.
   */
  commit(mutate: (draft: TState) => void): number;
}

/**
 * Host callbacks for pointer sessions.
 *
 * @remarks
 * Deliberately four calls, not a gesture framework. Multi-pointer gestures -
 * pinch, rotate, two-finger pan - are a later extension built on top of these
 * sessions, not part of this capability.
 *
 * @internal Not a public API.
 */
export interface InteractionHandlers<TState extends object> {
  /** A pointer went down on an eligible target. */
  onPress?(
    session: PointerSessionView,
    commit: InteractionCommit<TState>,
  ): void;
  /** The pointer moved while a session was active. */
  onMove?(session: PointerSessionView, commit: InteractionCommit<TState>): void;
  /** The pointer was released. {@link PointerSessionView.moved} says how. */
  onRelease?(
    session: PointerSessionView,
    commit: InteractionCommit<TState>,
  ): void;
  /** The session ended without a release. No mutation context is offered. */
  onCancel?(session: PointerSessionView, reason: SessionCancelReason): void;
}
