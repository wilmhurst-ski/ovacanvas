import {SignalValue, SimpleSignal} from '@ovacanvas/core';
import {Txt, TxtProps} from '../../components/Txt';
import {computed, nodeName, signal} from '../../decorators';
import type {ProjectedAnchor3D, Vec3Like} from '../public/types';
import type {Scene3D} from './Scene3D';

export interface Anchored3DLabelProps extends TxtProps {
  /** The `Scene3D` this label's point is projected through. This label
   * must be added as a child of that same `Scene3D` node, so its computed
   * position lands in the coordinate space `projectAnchor` reports in. */
  scene: SignalValue<Scene3D>;
  /** The 3D point (in the scene's world space) this label tracks. */
  point: SignalValue<Vec3Like>;
}

/**
 * A 2D text label whose position is permanently derived from a 3D point's
 * current projection through a `Scene3D`'s camera, never authored directly.
 *
 * @remarks
 * The 3D analog of `AnchoredLabel`: `this.position(() => ...)` is called
 * after `super(props)`, the same computed-signal-ownership trick ported
 * from `GeoMarker` - a raw `position` prop is still accepted by `TxtProps`
 * but immediately overwritten by the live computed accessor below. Because
 * `Scene3D.camera` is itself a signal, this label's position updates
 * automatically if the camera moves, with no additional code - exactly the
 * "declare the relationship, not the pixels" property `AnchoredLabel`
 * already established, now for anything with 3D coordinates: an axis
 * tick, a mesh vertex, a data point, any point in the scene's world space.
 *
 * Hides itself (`absoluteOpacity() === 0`) when its point is behind the
 * camera or outside the viewport, rather than drawing a 2D label at a
 * screen position that no longer corresponds to anything visible.
 */
@nodeName('Anchored3DLabel')
export class Anchored3DLabel extends Txt {
  @signal()
  public declare readonly scene: SimpleSignal<Scene3D, this>;

  @signal()
  public declare readonly point: SimpleSignal<Vec3Like, this>;

  public constructor(props: Anchored3DLabelProps) {
    super(props);
    this.position(() => this.anchorProjection().position);
  }

  @computed()
  protected anchorProjection(): ProjectedAnchor3D {
    return this.scene().projectAnchor(this.point());
  }

  @computed()
  public override absoluteOpacity(): number {
    const projection = this.anchorProjection();
    if (!projection.inFront || !projection.insideViewport) return 0;
    return super.absoluteOpacity();
  }
}
