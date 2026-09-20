import {SignalValue, SimpleSignal, Vector2} from '@ovacanvas/core';
import {Node, NodeProps} from '../../components/Node';
import {computed, initial, nodeName, signal} from '../../decorators';
import {
  createProjector,
  type PrivateProjector,
} from '../d3-adapter/projectionFactory';
import {fingerprintProjection} from '../public/projectionKey';
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

  /**
   * The projection spec actually used to project this map's content.
   *
   * @remarks
   * `createProjector` builds a d3 projection strictly from the spec it is
   * given - it has no idea this map declared a `width`/`height`/`padding`.
   * Without an explicit `scale`/`translate`/`fit`, every d3 projection kind
   * falls back to its own classic default (built for a top-left-origin
   * SVG viewport, e.g. orthographic's translate ~[480, 250]), which has no
   * relationship to this node's own centered-origin local space or its
   * declared box. This is the actual, real fix (found by rendering a
   * bare Sphere+Graticule map and seeing a stray, off-center grid
   * fragment, not by reading the API and guessing): fit the whole globe
   * into this map's own declared box, centered on this node's own origin,
   * whenever the author hasn't already taken over scale/translate/fit
   * themselves (e.g. via `fitFeatures()`).
   */
  @computed()
  public effectiveProjection(): GeoProjectionSpec {
    const spec = this.projection();
    if (spec.fit || spec.scale !== undefined || spec.translate !== undefined) {
      return spec;
    }

    const w = this.width();
    const h = this.height();
    const pad = this.padding();
    return {
      ...spec,
      fit: {
        target: {
          id: 'ovacanvas-geo-map-auto-fit-sphere',
          geometry: {type: 'Sphere'},
        },
        extent: [
          [-w / 2 + pad, -h / 2 + pad],
          [w / 2 - pad, h / 2 - pad],
        ],
      },
    };
  }

  @computed()
  public projector(): PrivateProjector {
    const spec = this.effectiveProjection();
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
