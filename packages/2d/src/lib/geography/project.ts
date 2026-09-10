import {canonicalizeRequest} from './canonical';
import {admittedLatitudeSpan, projectToPlane} from './projection';
import {routePositions} from './route';
import type {SeamVertex} from './seams';
import {
  enclosesPole,
  rewrap,
  splitClosedAtSeam,
  splitOpenAtSeam,
  unwrap,
} from './seams';
import type {
  GeoBounds,
  GeoPoint,
  PartVisibility,
  ProjectedMarker,
  ProjectedPart,
  ProjectedPlate,
  ProjectedPoint,
  ProjectedRing,
  ProjectionRequest,
  UnsupportedPart,
  Viewport,
} from './types';
import {GeographyError} from './types';

/**
 * How much a zero-width fit is opened up, in degrees.
 *
 * @remarks
 * Fitting a single city gives an interval with no extent, and no scale can
 * be derived from it. Opening it symmetrically is a viewport decision, which
 * is this module's to make; it changes nothing about where the city is.
 */
const MinimumFitSpanDegrees = 1;

/**
 * Project one map plate.
 *
 * @remarks
 * The whole plate is projected once. Nothing here animates, schedules,
 * re-fits per frame or consults a clock: a caller that wants motion animates
 * the transform of the group it builds from this result, against geometry
 * that does not move underneath it.
 *
 * @internal Not a public API. Shape is deliberately not frozen.
 */
export function projectPlate(request: unknown): ProjectedPlate {
  const input = canonicalizeRequest(request);
  const extent = resolveExtent(input);
  const centre = extentCentre(extent);
  const fit = buildFit(input, extent);

  const unsupported: UnsupportedPart[] = [];
  const features: ProjectedPart[] = [];

  for (const feature of input.features) {
    for (const part of feature.parts) {
      const exterior = part.rings[0];
      if (part.closed && enclosesPole(exterior.points)) {
        unsupported.push({
          sourceId: feature.id,
          partIndex: part.index,
          reason: 'POLAR_RING_UNSUPPORTED',
        });
        continue;
      }
      features.push(
        ...projectPart(
          feature.id,
          part.index,
          part.rings,
          part.closed,
          input,
          centre,
          fit,
        ),
      );
    }
  }

  const routes: ProjectedPart[] = [];
  for (const route of input.routes) {
    const positions = routePositions(route, input.routeSamples);
    routes.push(
      ...projectPart(
        route.id,
        0,
        [{role: 'exterior', points: positions}],
        false,
        input,
        centre,
        fit,
      ),
    );
  }

  const markers: ProjectedMarker[] = input.points.map(point => {
    const position = fit(projectToPlane(point, input.projection));
    return {
      id: point.id,
      source: {longitude: point.longitude, latitude: point.latitude},
      position,
      inside: isInside(position, input.viewport),
    };
  });

  return {
    projection: input.projection,
    extent,
    viewport: input.viewport,
    features,
    routes,
    markers,
    unsupported,
  };
}

/** Project one part, splitting it at the plate's own seam if it crosses. */
function projectPart(
  sourceId: string,
  partIndex: number,
  rings: readonly {
    readonly role: 'exterior' | 'hole';
    readonly points: readonly GeoPoint[];
  }[],
  closed: boolean,
  input: ProjectionRequest,
  centre: number,
  fit: (plane: {readonly u: number; readonly v: number}) => ProjectedPoint,
): ProjectedPart[] {
  // A plate centred on `centre` is cut at the meridian opposite it. For a
  // world map that is the antimeridian; for a Pacific-centred plate it is
  // Greenwich. Working relative to the centre makes both the same problem.
  const slicesPerRing = rings.map(ring => {
    const shifted = shiftToCentre(unwrap(ring.points), centre);
    const pieces = closed
      ? splitClosedAtSeam(shifted)
      : splitOpenAtSeam(shifted);
    return {role: ring.role, pieces};
  });

  // The exterior decides how many slices the part has; holes are attached to
  // the slice they fall in, which for a seam-split polygon is whichever piece
  // shares its side of the cut.
  const exterior = slicesPerRing[0];
  const holes = slicesPerRing.slice(1);

  return exterior.pieces.map((piece, sliceIndex) => {
    const projectedRings: ProjectedRing[] = [
      toProjectedRing(piece, 'exterior', closed, centre, input, fit),
    ];
    for (const hole of holes) {
      for (const holePiece of hole.pieces) {
        if (sharesSide(holePiece, piece)) {
          projectedRings.push(
            toProjectedRing(holePiece, 'hole', closed, centre, input, fit),
          );
        }
      }
    }
    return {
      sourceId,
      partIndex,
      sliceIndex,
      visibility: classify(projectedRings, closed, input.viewport),
      rings: projectedRings,
    };
  });
}

/** Whether two pieces lie on the same side of the cut. */
function sharesSide(
  hole: readonly SeamVertex[],
  exterior: readonly SeamVertex[],
): boolean {
  const holeMean = hole.reduce((sum, v) => sum + v.u, 0) / hole.length;
  const exteriorMean =
    exterior.reduce((sum, v) => sum + v.u, 0) / exterior.length;
  // Both are in the cut-relative space, so proximity is unambiguous.
  return Math.abs(holeMean - exteriorMean) <= 180;
}

function toProjectedRing(
  piece: readonly SeamVertex[],
  role: 'exterior' | 'hole',
  closed: boolean,
  centre: number,
  input: ProjectionRequest,
  fit: (plane: {readonly u: number; readonly v: number}) => ProjectedPoint,
): ProjectedRing {
  const points: ProjectedPoint[] = [];
  const sourceIndices: number[] = [];
  for (const vertex of piece) {
    const geographic = rewrap({
      u: vertex.u + centre,
      latitude: vertex.latitude,
      source: vertex.source,
    });
    points.push(fit(projectToPlane(geographic, input.projection)));
    sourceIndices.push(vertex.source);
  }
  return {role, closed, points, sourceIndices};
}

/** Move a whole sequence into the interval the cut is centred on. */
function shiftToCentre(
  vertices: readonly SeamVertex[],
  centre: number,
): SeamVertex[] {
  if (vertices.length === 0) return [];
  let shift = -centre;
  // Place the first vertex inside [-180, 180] relative to the centre; the
  // rest follow rigidly, because unwrapping already made them continuous.
  let first = vertices[0].u + shift;
  while (first > 180) {
    shift -= 360;
    first = vertices[0].u + shift;
  }
  while (first < -180) {
    shift += 360;
    first = vertices[0].u + shift;
  }
  return vertices.map(vertex => ({
    u: vertex.u + shift,
    latitude: vertex.latitude,
    source: vertex.source,
  }));
}

function classify(
  rings: readonly ProjectedRing[],
  closed: boolean,
  viewport: Viewport,
): PartVisibility {
  const exterior = rings[0];
  const minimum = closed ? 3 : 2;
  if (!exterior || exterior.points.length < minimum) return 'DEGENERATE';

  let anyInside = false;
  let allInside = true;
  for (const point of exterior.points) {
    if (isInside(point, viewport)) anyInside = true;
    else allInside = false;
  }
  if (allInside) return 'VISIBLE';
  return anyInside ? 'CLIPPED' : 'OUTSIDE';
}

/**
 * Whether a projected position falls in the drawable area.
 *
 * @remarks
 * Reported rather than enforced by cutting. A part that leaves the viewport
 * keeps every vertex it was given and is labelled `CLIPPED`, so the renderer
 * clips it - which it can do exactly - instead of this module inventing
 * boundary vertices that no coordinate corresponds to.
 */
function isInside(point: ProjectedPoint, viewport: Viewport): boolean {
  const {padding} = viewport;
  return (
    point.x >= padding &&
    point.x <= viewport.width - padding &&
    point.y >= padding &&
    point.y <= viewport.height - padding
  );
}

/** The geographic interval the plate actually shows. */
function resolveExtent(input: ProjectionRequest): GeoBounds {
  const admitted = admittedLatitudeSpan(input.projection);
  if (input.extent.kind === 'WHOLE_WORLD') {
    return {
      west: -180,
      east: 180,
      south: admitted.south,
      north: admitted.north,
      crossesAntimeridian: false,
    };
  }
  if (input.extent.kind === 'BOUNDS') return input.extent.bounds;

  const longitudes: number[] = [];
  const latitudes: number[] = [];
  const wanted = new Set(input.extent.featureIds);
  for (const feature of input.features) {
    if (!wanted.has(feature.id)) continue;
    for (const part of feature.parts) {
      for (const ring of part.rings) {
        for (const point of ring.points) {
          longitudes.push(point.longitude);
          latitudes.push(point.latitude);
        }
      }
    }
  }
  for (const point of input.extent.points) {
    longitudes.push(point.longitude);
    latitudes.push(point.latitude);
  }
  if (longitudes.length === 0) {
    throw new GeographyError(
      'EMPTY_FIT_TARGET',
      'the fit target resolved to no positions.',
    );
  }

  const {west, east, crossesAntimeridian} = fitLongitudes(longitudes);
  let south = Math.min(...latitudes);
  let north = Math.max(...latitudes);
  if (north - south < MinimumFitSpanDegrees) {
    const centre = (north + south) / 2;
    south = centre - MinimumFitSpanDegrees / 2;
    north = centre + MinimumFitSpanDegrees / 2;
  }
  return {
    west,
    east,
    south: Math.max(admitted.south, south),
    north: Math.min(admitted.north, north),
    crossesAntimeridian,
  };
}

/**
 * The tightest longitude interval containing every supplied meridian.
 *
 * @remarks
 * Longitude is circular, so the tightest interval is the complement of the
 * widest empty gap between neighbouring meridians. Taking `min` and `max`
 * instead would frame the entire world whenever two cities sit either side of
 * the seam.
 */
export function fitLongitudes(longitudes: readonly number[]): {
  readonly west: number;
  readonly east: number;
  readonly crossesAntimeridian: boolean;
} {
  const sorted = [...new Set(longitudes)].sort((a, b) => a - b);
  if (sorted.length === 1) {
    const only = sorted[0];
    const half = MinimumFitSpanDegrees / 2;
    return {
      west: only - half,
      east: only + half,
      crossesAntimeridian: false,
    };
  }

  let widestGap = -1;
  let gapStart = 0;
  for (let index = 0; index < sorted.length; index++) {
    const from = sorted[index];
    const to = sorted[(index + 1) % sorted.length];
    const gap = index === sorted.length - 1 ? to + 360 - from : to - from;
    if (gap > widestGap) {
      widestGap = gap;
      gapStart = index;
    }
  }
  // The interval runs from the meridian after the gap round to the one before.
  const west = sorted[(gapStart + 1) % sorted.length];
  const east = sorted[gapStart];
  const crossesAntimeridian = west > east;

  if (!crossesAntimeridian && east - west < MinimumFitSpanDegrees) {
    const centre = (east + west) / 2;
    return {
      west: centre - MinimumFitSpanDegrees / 2,
      east: centre + MinimumFitSpanDegrees / 2,
      crossesAntimeridian: false,
    };
  }
  return {west, east, crossesAntimeridian};
}

/** The meridian a plate is centred on. */
function extentCentre(extent: GeoBounds): number {
  if (!extent.crossesAntimeridian) return (extent.west + extent.east) / 2;
  const centre = (extent.west + extent.east + 360) / 2;
  return centre > 180 ? centre - 360 : centre;
}

/**
 * Build the plane-to-canvas mapping.
 *
 * @remarks
 * One uniform scale for both axes, so a projection's own distortion is the
 * only distortion in the result. Squeezing a plate to fill a viewport would
 * silently add a second projection nobody declared.
 */
function buildFit(
  input: ProjectionRequest,
  extent: GeoBounds,
): (plane: {readonly u: number; readonly v: number}) => ProjectedPoint {
  const uSpan = extent.crossesAntimeridian
    ? extent.east + 360 - extent.west
    : extent.east - extent.west;
  const vMin = projectToPlane(
    {longitude: extent.west, latitude: extent.south},
    input.projection,
  ).v;
  const vMax = projectToPlane(
    {longitude: extent.west, latitude: extent.north},
    input.projection,
  ).v;
  const vSpan = vMax - vMin;

  const {width, height, padding} = input.viewport;
  const innerWidth = width - padding * 2;
  const innerHeight = height - padding * 2;
  const scale = Math.min(innerWidth / uSpan, innerHeight / vSpan);
  const drawnWidth = uSpan * scale;
  const drawnHeight = vSpan * scale;
  const offsetX = padding + (innerWidth - drawnWidth) / 2;
  const offsetY = padding + (innerHeight - drawnHeight) / 2;
  const centre = extentCentre(extent);

  return plane => {
    // Express the meridian relative to the plate centre so a Pacific-centred
    // plate places its own edges, rather than Greenwich, at the boundary.
    let offset = plane.u - centre;
    while (offset > 180) offset -= 360;
    while (offset < -180) offset += 360;
    const u = centre + offset;
    const fromWest = extent.crossesAntimeridian
      ? wrapForward(u - extent.west)
      : u - extent.west;
    return {
      x: offsetX + fromWest * scale,
      y: offsetY + (vMax - plane.v) * scale,
    };
  };
}

function wrapForward(delta: number): number {
  let value = delta;
  while (value < 0) value += 360;
  while (value >= 360) value -= 360;
  return value;
}
