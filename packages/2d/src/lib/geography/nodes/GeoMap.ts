import {SignalValue, SimpleSignal, Vector2} from '@ovacanvas/core';
import {Node, NodeProps} from '../../components/Node';
import {computed, initial, nodeName, signal} from '../../decorators';
import {
  createProjector,
  type PrivateProjector,
} from '../d3-adapter/projectionFactory';
import {fingerprintProjection} from '../public/fingerprint';
import type {
  GeoFeatureSource,
  GeoInspectionInfo,
  GeoProjectionSpec,
} from '../public/types';

export interface GeoMapProps extends NodeProps {
  /** The reactive projection specification governing this map view. */
  projection: SignalValue<GeoProjectionSpec>;

  /** Width of the map viewport in canvas units. */
  width?: SignalValue<number>;

  /** Height of the map viewport in canvas units. */
  height?: SignalValue<number>;

  /** Viewport padding in canvas units. */
  padding?: SignalValue<number>;
}

@nodeName('GeoMap')
export class GeoMap extends Node {
  public readonly isGeoMap = true;

  @signal()
  public declare readonly projection: SimpleSignal<GeoProjectionSpec, this>;

  @initial(1920)
  @signal()
  public declare readonly width: SimpleSignal<number, this>;

  @initial(1080)
  @signal()
  public declare readonly height: SimpleSignal<number, this>;

  @initial(20)
  @signal()
  public declare readonly padding: SimpleSignal<number, this>;

  private cachedProjector: {key: string; projector: PrivateProjector} | null =
    null;

  public constructor(props: GeoMapProps) {
    super(props);
  }

  @computed()
  public projector(): PrivateProjector {
    const spec = this.projection();
    const key = fingerprintProjection(spec);
    if (!this.cachedProjector || this.cachedProjector.key !== key) {
      this.cachedProjector = {
        key,
        projector: createProjector(spec),
      };
    }
    return this.cachedProjector.projector;
  }

  /**
   * Project a geographic coordinate [longitude, latitude] into canvas coordinates.
   */
  public project(
    coordinates: readonly [longitude: number, latitude: number],
  ): Vector2 | null {
    const p = this.projector().project(coordinates);
    if (!p) return null;
    return new Vector2(p[0], p[1]);
  }

  /**
   * Invert a canvas screen coordinate into geographic [longitude, latitude] if invertible.
   */
  public invert(
    screenPoint: Vector2,
  ): [longitude: number, latitude: number] | null {
    const inv = this.projector().invert([screenPoint.x, screenPoint.y]);
    if (!inv) return null;
    return [inv[0], inv[1]];
  }

  /**
   * Fit the projection to encompass the specified geographic features within the viewport.
   */
  public fitFeatures(
    features: GeoFeatureSource | readonly GeoFeatureSource[],
    padding?: number,
  ): void {
    const pad = padding ?? this.padding();
    const w = this.width();
    const h = this.height();
    const current = this.projection();

    this.projection({
      ...current,
      fit: {
        target: features,
        extent: [
          [pad, pad],
          [w - pad, h - pad],
        ],
      },
    });
  }

  public inspect(): GeoInspectionInfo {
    const w = this.width();
    const h = this.height();
    return {
      id: this.key,
      kind: 'graticule',
      projectedBounds: [0, 0, w, h],
      centerProjected: [w / 2, h / 2],
    };
  }
}
