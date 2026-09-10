import {Bounds3} from '../math/bounds3';
import type {CanonicalGeometry} from './canonicalize';

export function computeGeometryBounds(geom: CanonicalGeometry): Bounds3 {
  return Bounds3.fromPoints(geom.positions);
}
