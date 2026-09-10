import type {GeoPoint} from './types';

/**
 * A vertex being carried through seam work.
 *
 * @remarks
 * `u` is *unwrapped* longitude: it may leave `[-180, 180]` while a ring is
 * being cut, which is the whole point - a shape that straddles the seam is
 * only simple when longitude is allowed to run continuously.
 *
 * `source` is the index of the input vertex this came from, or `-1` for a
 * vertex introduced here. Downstream that becomes the correspondence an
 * evaluator uses to tell supplied geometry from geometry this module made up.
 *
 * @internal Not a public API.
 */
export interface SeamVertex {
  readonly u: number;
  readonly latitude: number;
  readonly source: number;
}

/** The seam itself. */
export const Antimeridian = 180;

/**
 * The shortest signed longitude step from one meridian to another.
 *
 * @remarks
 * Two consecutive vertices 359 degrees apart are one degree apart the other
 * way round, and the short way is what a boundary actually follows. Taking
 * the long way is exactly how a country acquires a stripe across the map.
 */
export function shortestLongitudeDelta(from: number, to: number): number {
  let delta = to - from;
  while (delta > 180) delta -= 360;
  while (delta < -180) delta += 360;
  return delta;
}

/**
 * Rewrite a sequence of positions into continuous longitude.
 *
 * @remarks
 * The first vertex keeps its longitude; every later one is placed by
 * following the shortest step from its predecessor. A ring crossing the seam
 * therefore comes out spanning, say, 170 to 190 rather than jumping from 170
 * to -170.
 */
export function unwrap(points: readonly GeoPoint[]): SeamVertex[] {
  const out: SeamVertex[] = [];
  let running = 0;
  points.forEach((point, index) => {
    if (index === 0) {
      running = point.longitude;
    } else {
      running += shortestLongitudeDelta(
        points[index - 1].longitude,
        point.longitude,
      );
    }
    out.push({u: running, latitude: point.latitude, source: index});
  });
  return out;
}

/**
 * Whether a closed ring winds around a pole.
 *
 * @remarks
 * Walking a closed ring returns to where it started, so the shortest-step
 * longitude deltas sum to zero - unless the ring goes all the way round, in
 * which case they sum to plus or minus a full turn. Antarctica is the usual
 * example.
 *
 * Such a ring cannot be cut at the seam alone: closing each piece also
 * requires walking the pole edge, and a partial implementation produces a
 * shape smeared across the whole plate. This module reports it instead.
 */
export function enclosesPole(points: readonly GeoPoint[]): boolean {
  if (points.length < 3) return false;
  let total = 0;
  for (let index = 0; index < points.length; index++) {
    const from = points[index];
    const to = points[(index + 1) % points.length];
    total += shortestLongitudeDelta(from.longitude, to.longitude);
  }
  return Math.abs(total) > 180;
}

/** Whether an unwrapped sequence leaves the base longitude interval. */
export function crossesSeam(vertices: readonly SeamVertex[]): boolean {
  return vertices.some(
    vertex => vertex.u > Antimeridian || vertex.u < -Antimeridian,
  );
}

/**
 * Split an open path wherever it crosses the seam.
 *
 * @remarks
 * A line is cut, not closed: each piece ends on the seam at the latitude the
 * crossing actually occurred, and the next piece resumes at the same latitude
 * on the far side. The introduced vertices carry `source: -1`.
 */
export function splitOpenAtSeam(
  vertices: readonly SeamVertex[],
): SeamVertex[][] {
  const pieces: SeamVertex[][] = [];
  let current: SeamVertex[] = [];

  const push = (vertex: SeamVertex) => current.push(vertex);

  for (let index = 0; index < vertices.length; index++) {
    const vertex = vertices[index];
    if (index === 0) {
      push(vertex);
      continue;
    }
    const previous = vertices[index - 1];
    // How many seam lines lie between the two, in unwrapped space.
    const crossings = seamCrossingsBetween(previous.u, vertex.u);
    if (crossings.length === 0) {
      push(vertex);
      continue;
    }
    for (const boundary of crossings) {
      const t = (boundary - previous.u) / (vertex.u - previous.u);
      const latitude =
        previous.latitude + t * (vertex.latitude - previous.latitude);
      push({u: boundary, latitude, source: -1});
      pieces.push(current);
      // Resume on the opposite side of the same seam.
      current = [
        {
          u: boundary - Math.sign(vertex.u - previous.u) * 360,
          latitude,
          source: -1,
        },
      ];
    }
    push(vertex);
  }
  if (current.length > 0) pieces.push(current);
  return pieces.filter(piece => piece.length >= 2);
}

/** The seam meridians strictly between two unwrapped longitudes, in order. */
function seamCrossingsBetween(from: number, to: number): number[] {
  const found: number[] = [];
  if (from === to) return found;
  const step = to > from ? 360 : -360;
  // Seams sit at odd multiples of 180: ..., -180, 180, 540, ...
  let boundary =
    to > from
      ? Math.ceil((from - Antimeridian) / 360) * 360 + Antimeridian
      : Math.floor((from + Antimeridian) / 360) * 360 - Antimeridian;
  while (to > from ? boundary < to : boundary > to) {
    if (to > from ? boundary > from : boundary < from) found.push(boundary);
    boundary += step;
  }
  return found;
}

/**
 * Cut a closed ring at the seam and close each piece along it.
 *
 * @remarks
 * Clipping against one half-plane at a time, which for a single boundary
 * keeps a simple ring simple. The piece beyond the seam is then translated a
 * full turn back into the base interval, so the two pieces meet at longitude
 * 180 and -180 respectively - adjacent on the globe, opposite edges on the
 * plate, which is exactly how a seam-crossing country should be drawn.
 *
 * Callers must reject pole-enclosing rings before calling this; see
 * {@link enclosesPole}.
 */
export function splitClosedAtSeam(
  vertices: readonly SeamVertex[],
): SeamVertex[][] {
  if (!crossesSeam(vertices)) return [[...vertices]];

  const pieces: SeamVertex[][] = [];
  // A ring that does not enclose a pole spans less than a full turn, so it
  // meets at most one seam. Both sides of that seam are taken.
  const spanMin = Math.min(...vertices.map(vertex => vertex.u));
  const spanMax = Math.max(...vertices.map(vertex => vertex.u));
  const boundary = spanMax > Antimeridian ? Antimeridian : -Antimeridian;
  const shift = boundary > 0 ? -360 : 360;
  void spanMin;

  const near = clipHalfPlane(
    vertices,
    boundary,
    boundary > 0 ? 'below' : 'above',
  );
  const far = clipHalfPlane(
    vertices,
    boundary,
    boundary > 0 ? 'above' : 'below',
  );

  if (near.length >= 3) pieces.push(near);
  if (far.length >= 3) {
    pieces.push(
      far.map(vertex => ({
        u: vertex.u + shift,
        latitude: vertex.latitude,
        source: vertex.source,
      })),
    );
  }
  return pieces;
}

/**
 * Keep the part of a closed ring on one side of a meridian.
 *
 * @remarks
 * Sutherland-Hodgman against a single boundary. Restricting it to one
 * boundary per call is deliberate: the spurious connecting edges that method
 * is known for arise when a concave ring is clipped against several
 * boundaries at once, and a seam is only ever one.
 */
export function clipHalfPlane(
  vertices: readonly SeamVertex[],
  boundary: number,
  keep: 'below' | 'above',
): SeamVertex[] {
  const inside = (u: number) =>
    keep === 'below' ? u <= boundary : u >= boundary;
  const out: SeamVertex[] = [];

  for (let index = 0; index < vertices.length; index++) {
    const current = vertices[index];
    const previous = vertices[(index + vertices.length - 1) % vertices.length];
    const currentIn = inside(current.u);
    const previousIn = inside(previous.u);

    if (currentIn !== previousIn) {
      const t = (boundary - previous.u) / (current.u - previous.u);
      out.push({
        u: boundary,
        latitude:
          previous.latitude + t * (current.latitude - previous.latitude),
        source: -1,
      });
    }
    if (currentIn) out.push(current);
  }
  return out;
}

/**
 * Return a vertex to the base longitude interval.
 *
 * @remarks
 * Applied only on the way out. Doing it earlier would undo the unwrapping
 * that made the ring simple in the first place.
 */
export function rewrap(vertex: SeamVertex): GeoPoint {
  let longitude = vertex.u;
  while (longitude > 180) longitude -= 360;
  while (longitude < -180) longitude += 360;
  return {
    longitude: longitude === 0 ? 0 : longitude,
    latitude: vertex.latitude,
  };
}
