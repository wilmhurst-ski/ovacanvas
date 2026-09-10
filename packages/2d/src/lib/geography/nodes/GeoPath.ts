import {BBox, SignalValue, SimpleSignal, Vector2} from '@ovacanvas/core';
import {Shape, ShapeProps} from '../../components/Shape';
import {computed, initial, nodeName, signal} from '../../decorators';
import {renderToPath2D} from '../d3-adapter/pathSink';
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
import type {GeoMap} from './GeoMap';

export interface GeoPathProps extends ShapeProps {
  /** Geographic feature source containing standard GeoJSON and stable ID. */
  feature: SignalValue<GeoFeatureSource>;

  /** Optional override for projection spec; if omitted, inherits from parent GeoMap. */
  projection?: SignalValue<GeoProjectionSpec>;
}

@nodeName('GeoPath')
export class GeoPath extends Shape {
  @signal()
  public declare readonly feature: SimpleSignal<GeoFeatureSource, this>;

  @initial(undefined)
  @signal()
  public declare readonly projection: SimpleSignal<
    GeoProjectionSpec | undefined,
    this
  >;

  private cachedProjector: {key: string; projector: PrivateProjector} | null =
    null;

  public constructor(props: GeoPathProps) {
    super(props);
  }

  @computed()
  public getEffectiveProjection(): GeoProjectionSpec {
    const explicit = this.projection();
    if (explicit) return explicit;

    const map = this.findAncestor(node => 'isGeoMap' in node) as GeoMap | null;
    if (map && map.projection) {
      return map.projection();
    }

    // Default fallback projection
    return {kind: 'equirectangular'};
  }

  @computed()
  protected getProjector(): PrivateProjector {
    const spec = this.getEffectiveProjection();
    const key = fingerprintProjection(spec);
    if (!this.cachedProjector || this.cachedProjector.key !== key) {
      this.cachedProjector = {
        key,
        projector: createProjector(spec),
      };
    }
    return this.cachedProjector.projector;
  }

  @computed()
  protected override getPath(): Path2D {
    const feature = this.feature();
    if (!feature || !feature.geometry) {
      return new Path2D();
    }
    const projector = this.getProjector();
    return renderToPath2D(projector, feature.geometry);
  }

  @computed()
  protected override getCacheBBox(): BBox {
    const feature = this.feature();
    if (!feature || !feature.geometry) {
      return new BBox();
    }

    try {
      const projector = this.getProjector();
      const pathGen = projector.createPath(null);
      const bounds = pathGen.bounds(feature.geometry);
      if (
        bounds &&
        Number.isFinite(bounds[0][0]) &&
        Number.isFinite(bounds[0][1]) &&
        Number.isFinite(bounds[1][0]) &&
        Number.isFinite(bounds[1][1])
      ) {
        const box = BBox.fromPoints(
          new Vector2(bounds[0][0], bounds[0][1]),
          new Vector2(bounds[1][0], bounds[1][1]),
        );
        return box.expand(this.lineWidth() / 2);
      }
    } catch {
      // Degenerate bounds fallback
    }

    return new BBox();
  }

  public inspect(): GeoInspectionInfo {
    const feature = this.feature();
    const cache = this.getCacheBBox();
    const center = cache.center;

    return {
      id: feature.id,
      kind: 'feature',
      projectedBounds: [cache.left, cache.top, cache.right, cache.bottom],
      centerProjected: [center.x, center.y],
    };
  }
}
