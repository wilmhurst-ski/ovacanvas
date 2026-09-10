import {SignalValue, SimpleSignal, Vector2} from '@ovacanvas/core';
import {Node, NodeProps} from '../../components/Node';
import {computed, initial, nodeName, signal} from '../../decorators';
import {
  createProjector,
  type PrivateProjector,
} from '../d3-adapter/projectionFactory';
import {fingerprintProjection} from '../public/fingerprint';
import type {GeoInspectionInfo, GeoProjectionSpec} from '../public/types';
import type {GeoMap} from './GeoMap';

export interface GeoMarkerProps extends NodeProps {
  /** Authoritative geographic coordinate [longitude, latitude] in degrees. */
  coordinates: SignalValue<readonly [longitude: number, latitude: number]>;

  /** Optional override for projection spec; if omitted, inherits from parent GeoMap. */
  projection?: SignalValue<GeoProjectionSpec>;
}

@nodeName('GeoMarker')
export class GeoMarker extends Node {
  @signal()
  public declare readonly coordinates: SimpleSignal<
    readonly [longitude: number, latitude: number],
    this
  >;

  @initial(undefined)
  @signal()
  public declare readonly projection: SimpleSignal<
    GeoProjectionSpec | undefined,
    this
  >;

  private cachedProjector: {key: string; projector: PrivateProjector} | null =
    null;

  public constructor(props: GeoMarkerProps) {
    super(props);
    this.position(() => this.projectedPosition() ?? Vector2.zero);
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
  public projectedPosition(): Vector2 | null {
    const coords = this.coordinates();
    if (!coords) return null;

    const projector = this.getProjector();
    const pt = projector.project(coords);
    if (!pt) return null;

    return new Vector2(pt[0], pt[1]);
  }

  @computed()
  public isVisibleOnPlate(): boolean {
    return this.projectedPosition() !== null;
  }

  @computed()
  public override absoluteOpacity(): number {
    if (!this.isVisibleOnPlate()) {
      return 0;
    }
    return super.absoluteOpacity();
  }

  public inspect(): GeoInspectionInfo {
    const coords = this.coordinates();
    const pos = this.projectedPosition() ?? Vector2.zero;

    return {
      id: this.key,
      kind: 'marker',
      projectedBounds: [pos.x - 4, pos.y - 4, pos.x + 4, pos.y + 4],
      centerProjected: [pos.x, pos.y],
      centerGeographic: [coords[0], coords[1]],
    };
  }
}
