/**
 * Cartographic realization mechanics and geographic scene graph capability.
 *
 * @remarks
 * This module provides comprehensive geographic mapping backed by `d3-geo` as a
 * renderer-private computational kernel.
 *
 * All D3 mutable projection objects, streams, accessors, and configuration details
 * remain encapsulated behind the OvaCanvas boundary.
 *
 * @packageDocumentation
 */

export * from './canonical';
export * from './labels/mapLabelPlacement';
export * from './nodes';
export * from './project';
export * from './projection';
export * from './public/fingerprint';
export * from './public/types';
export * from './route';
export * from './routes/rhumb';
export * from './routes/routeGenerator';
export * from './seams';

// Re-export legacy cartographic types without clashing with public/types or nodes
export type {
  ExtentRequest,
  GeoFeature,
  GeoPart,
  GeoRing,
  GeographyErrorCode,
  IdentifiedGeoPoint,
  PartVisibility,
  ProjectedMarker,
  ProjectedPart,
  ProjectedPlate,
  ProjectedPoint,
  ProjectedRing,
  ProjectionKind,
  ProjectionRequest,
  RingRole,
  RoutePathKind,
  UnsupportedPart,
  Viewport,
} from './types';

export {GeographyError, WebMercatorLatitudeLimit} from './types';
