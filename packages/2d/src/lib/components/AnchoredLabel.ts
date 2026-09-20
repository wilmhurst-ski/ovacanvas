import {
  Origin,
  SignalValue,
  SimpleSignal,
  Vector2,
  originToOffset,
} from '@ovacanvas/core';
import {computed, initial, nodeName, signal} from '../decorators';
import type {Node} from './Node';
import {Txt, TxtProps} from './Txt';

export interface AnchoredLabelProps extends TxtProps {
  /** The node this label stays glued to. */
  anchor: SignalValue<Node>;
  /** Which side of the anchor the label sits on. Defaults to {@link Origin.Right}. */
  origin?: SignalValue<Origin>;
  /** Distance from the anchor, in pixels along each non-zero axis of `origin`. Defaults to 24. */
  distance?: SignalValue<number>;
}

/**
 * A text label whose position is permanently derived from another node's
 * position, never authored directly.
 *
 * @remarks
 * Ports `GeoMarker`'s computed-signal-ownership trick out of the geography
 * module into a general-purpose component: `this.position(() => ...)` is
 * called *after* `super(props)`, which makes a raw `position` prop
 * structurally dead at runtime - a caller can still pass one (`TxtProps`
 * inherits it, so the type system permits it), but it is immediately
 * overwritten by the live computed accessor below, exactly the way
 * `GeoMarker.coordinates` overrides any passed `position`.
 *
 * This is the composition-not-just-collision fix for the exact pattern
 * `derivatives.tsx`'s `pLabel`/`qLabel`/`intervalLabel` hand-author today:
 * "this label sits beside that point" stops being pixel arithmetic the
 * scene has to get right and keep in sync, and becomes a declared
 * relationship the engine maintains - if the anchor moves (an animated
 * point, a repositioned card), the label moves with it on the next frame
 * with no additional code. It does not, by itself, prevent the label from
 * overlapping some *other* unrelated node - that is what the audit gate and
 * `arrangeWithoutOverlap` are for.
 */
@nodeName('AnchoredLabel')
export class AnchoredLabel extends Txt {
  @signal()
  public declare readonly anchor: SimpleSignal<Node, this>;

  @initial(Origin.Right)
  @signal()
  public declare readonly origin: SimpleSignal<Origin, this>;

  @initial(24)
  @signal()
  public declare readonly distance: SimpleSignal<number, this>;

  public constructor(props: AnchoredLabelProps) {
    super(props);
    this.position(() => this.anchoredPosition());
  }

  @computed()
  protected anchoredPosition(): Vector2 {
    const anchor = this.anchor();
    const anchorWorld = Vector2.zero.transformAsPoint(anchor.localToWorld());
    const anchorLocal = anchorWorld.transformAsPoint(this.worldToParent());
    return anchorLocal.add(
      originToOffset(this.origin()).scale(this.distance()),
    );
  }
}
