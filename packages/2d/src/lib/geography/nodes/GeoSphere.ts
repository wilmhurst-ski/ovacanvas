import {BBox, SignalValue, SimpleSignal, Vector2} from '@ovacanvas/core';
import {Shape, ShapeProps} from '../../components/Shape';
import {computed, initial, nodeName, signal} from '../../decorators';
import {renderToPath2D} from '../d3-adapter/pathSink';
import {
  createProjector,
  type PrivateProjector,
} from '../d3-adapter/projectionFactory';
import {fingerprintProjection} from '../public/fingerprint';
import type {GeoProjectionSpec} from '../public/types';
import type {GeoMap} from './GeoMap';

export interface GeoSphereProps extends ShapeProps {
  /** Optional override for projection spec; if omitted, inherits from parent GeoMap. */
  projection?: SignalValue<GeoProjectionSpec>;
}

@nodeName('GeoSphere')
export class GeoSphere extends Shape {
  @initial(undefined)
  @signal()
  public declare readonly projection: SimpleSignal<
    GeoProjectionSpec | undefined,
    this
  >;

  private cachedProjector: {key: string; projector: PrivateProjector} | null =
    null;

  public constructor(props: GeoSphereProps = {}) {
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

    return {kind: 'orthographic'};
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
    const projector = this.getProjector();
    return renderToPath2D(projector, {type: 'Sphere'});
  }

  @computed()
  protected override getCacheBBox(): BBox {
    try {
      const projector = this.getProjector();
      const bounds = projector.createPath(null).bounds({type: 'Sphere'});
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
}
