import {BBox, SignalValue, SimpleSignal} from '@ovacanvas/core';
import {Curve, CurveProps} from '../../components/Curve';
import {CurveProfile} from '../../curves/CurveProfile';
import {getPathProfile} from '../../curves/getPathProfile';
import {computed, initial, nodeName, signal} from '../../decorators';
import {renderToSvgPathString} from '../d3-adapter/pathSink';
import {
  createProjector,
  type PrivateProjector,
} from '../d3-adapter/projectionFactory';
import {fingerprintProjection} from '../public/fingerprint';
import type {
  GeoInspectionInfo,
  GeoMeasurementResult,
  GeoProjectionSpec,
  GeoRouteSpec,
} from '../public/types';
import {generateRoutePoints, measureRoute} from '../routes/routeGenerator';
import type {GeoMap} from './GeoMap';

export interface GeoRouteProps extends CurveProps {
  /** Specification of the geographic route (id, kind, waypoints, samples). */
  route: SignalValue<GeoRouteSpec>;

  /** Optional override for projection spec; if omitted, inherits from parent GeoMap. */
  projection?: SignalValue<GeoProjectionSpec>;
}

@nodeName('GeoRoute')
export class GeoRoute extends Curve {
  @signal()
  public declare readonly route: SimpleSignal<GeoRouteSpec, this>;

  @initial(undefined)
  @signal()
  public declare readonly projection: SimpleSignal<
    GeoProjectionSpec | undefined,
    this
  >;

  private cachedProjector: {key: string; projector: PrivateProjector} | null =
    null;

  public constructor(props: GeoRouteProps) {
    super({
      stroke: '#ffcc00',
      lineWidth: 3,
      ...props,
    });
    this.canHaveSubpath = true;
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

  /**
   * Measure the authoritative spherical distance and bearing of the route.
   */
  public measure(): GeoMeasurementResult | null {
    const r = this.route();
    if (!r || r.waypoints.length < 2) return null;
    return measureRoute(
      r.waypoints[0],
      r.waypoints[r.waypoints.length - 1],
      r.kind,
    );
  }

  @computed()
  public override profile(): CurveProfile {
    const r = this.route();
    if (!r || r.waypoints.length < 2) {
      return {arcLength: 0, segments: [], minSin: 1};
    }

    const points = generateRoutePoints(r);
    const geoJson: any = {
      type: 'LineString',
      coordinates: points,
    };

    const projector = this.getProjector();
    const svgData = renderToSvgPathString(projector, geoJson);
    if (!svgData) {
      return {arcLength: 0, segments: [], minSin: 1};
    }

    return getPathProfile(svgData);
  }

  protected override childrenBBox(): BBox {
    const points = this.profile().segments.flatMap(segment => segment.points);
    if (points.length === 0) return new BBox();
    return BBox.fromPoints(...points);
  }

  public inspect(): GeoInspectionInfo {
    const r = this.route();
    const box = this.childrenBBox();
    const center = box.center;

    return {
      id: r.id,
      kind: 'route',
      projectedBounds: [box.left, box.top, box.right, box.bottom],
      centerProjected: [center.x, center.y],
    };
  }
}
