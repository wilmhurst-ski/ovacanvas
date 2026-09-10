import {BBox, SignalValue, SimpleSignal, Vector2} from '@ovacanvas/core';
import {geoGraticule} from 'd3-geo';
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

export interface GeoGraticuleProps extends ShapeProps {
  /** Step in degrees [lonStep, latStep] for meridians and parallels. Defaults to [10, 10]. */
  step?: SignalValue<readonly [lonStep: number, latStep: number]>;

  /** Step in degrees [lonStep, latStep] for minor lines. */
  stepMinor?: SignalValue<readonly [lonStep: number, latStep: number]>;

  /** Bounding extent [[west, south], [east, north]] in degrees. */
  extent?: SignalValue<
    readonly [
      readonly [west: number, south: number],
      readonly [east: number, north: number],
    ]
  >;

  /** Resampling precision. */
  precision?: SignalValue<number>;

  /** Optional override for projection spec; if omitted, inherits from parent GeoMap. */
  projection?: SignalValue<GeoProjectionSpec>;
}

@nodeName('GeoGraticule')
export class GeoGraticule extends Shape {
  @initial([10, 10])
  @signal()
  public declare readonly step: SimpleSignal<
    readonly [lonStep: number, latStep: number],
    this
  >;

  @initial(undefined)
  @signal()
  public declare readonly stepMinor: SimpleSignal<
    readonly [lonStep: number, latStep: number] | undefined,
    this
  >;

  @initial(undefined)
  @signal()
  public declare readonly extent: SimpleSignal<
    | readonly [
        readonly [west: number, south: number],
        readonly [east: number, north: number],
      ]
    | undefined,
    this
  >;

  @initial(undefined)
  @signal()
  public declare readonly precision: SimpleSignal<number | undefined, this>;

  @initial(undefined)
  @signal()
  public declare readonly projection: SimpleSignal<
    GeoProjectionSpec | undefined,
    this
  >;

  private cachedProjector: {key: string; projector: PrivateProjector} | null =
    null;

  public constructor(props: GeoGraticuleProps = {}) {
    super({
      stroke: '#444444',
      lineWidth: 1,
      ...props,
    });
  }

  @computed()
  public getEffectiveProjection(): GeoProjectionSpec {
    const explicit = this.projection();
    if (explicit) return explicit;

    const map = this.findAncestor(node => 'isGeoMap' in node) as GeoMap | null;
    if (map && map.projection) {
      return map.projection();
    }

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
  protected getGraticuleData(): any {
    const generator = geoGraticule();
    const s = this.step();
    if (s) {
      generator.step([s[0], s[1]]);
    }
    const sm = this.stepMinor();
    if (sm) {
      generator.stepMinor([sm[0], sm[1]]);
    }
    const ext = this.extent();
    if (ext) {
      generator.extent([
        [ext[0][0], ext[0][1]],
        [ext[1][0], ext[1][1]],
      ]);
    }
    const prec = this.precision();
    if (prec !== undefined) {
      generator.precision(prec);
    }
    return generator();
  }

  @computed()
  protected override getPath(): Path2D {
    const projector = this.getProjector();
    const graticule = this.getGraticuleData();
    return renderToPath2D(projector, graticule);
  }

  @computed()
  protected override getCacheBBox(): BBox {
    try {
      const projector = this.getProjector();
      const bounds = projector.createPath(null).bounds(this.getGraticuleData());
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
