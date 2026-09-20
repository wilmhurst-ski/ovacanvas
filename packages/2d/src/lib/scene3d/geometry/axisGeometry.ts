import {Scene3DError} from '../public/errors';
import type {LineGeometry3D} from '../public/types';

export type Axis3D = 'x' | 'y' | 'z';

export interface AxisTick {
  readonly value: number;
  readonly position: readonly [number, number, number];
}

export interface AxisSpec {
  readonly axis: Axis3D;
  readonly range: readonly [number, number];
  readonly tickStep: number;
}

export interface AxisGeometryResult {
  readonly geometry: LineGeometry3D;
  /** Where each axis's ticks landed, keyed by axis - for placing an
   * `Anchored3DLabel` at each one without re-deriving the positions. */
  readonly ticks: Readonly<Record<Axis3D, readonly AxisTick[]>>;
}

const TICK_LENGTH = 0.15;

function axisVector(axis: Axis3D, value: number): [number, number, number] {
  if (axis === 'x') return [value, 0, 0];
  if (axis === 'y') return [0, value, 0];
  return [0, 0, value];
}

/** A consistent perpendicular offset to draw a short tick mark across an axis. */
function tickOffset(axis: Axis3D): [number, number, number] {
  return axis === 'y' ? [TICK_LENGTH, 0, 0] : [0, TICK_LENGTH, 0];
}

/**
 * Build labeled-axis line geometry - three lines with evenly spaced tick
 * marks - the "give a 3D plot a frame of reference" primitive scene3d's
 * real, tested camera/projection machinery had nothing to draw with.
 *
 * @remarks
 * Every reference chart of quadric surfaces, and any other 3D "plot of an
 * equation," draws its subject against labeled x/y/z axes; nothing in this
 * module built one. Returns the tick positions alongside the drawable
 * geometry, not just the geometry itself, so a caller can place an
 * `Anchored3DLabel` at each tick without re-deriving where it landed - the
 * same "one shared source of truth" shape as `iterateInscribedRings`'s
 * `ratio`.
 *
 * @param specs - One entry per axis to draw; an axis with no entry is not drawn.
 */
export function buildAxisGeometry3D(
  specs: readonly AxisSpec[],
): AxisGeometryResult {
  const positions: number[] = [];
  const ticks: Record<Axis3D, AxisTick[]> = {x: [], y: [], z: []};

  for (const spec of specs) {
    const [min, max] = spec.range;
    if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) {
      throw new Scene3DError(
        'INVALID_DOMAIN_RANGE',
        `${spec.axis} axis range must be two increasing finite numbers, received ${JSON.stringify(spec.range)}.`,
      );
    }
    if (!Number.isFinite(spec.tickStep) || spec.tickStep <= 0) {
      throw new Scene3DError(
        'INVALID_DOMAIN_RANGE',
        `${spec.axis} axis tickStep must be a positive finite number, received ${spec.tickStep}.`,
      );
    }

    positions.push(
      ...axisVector(spec.axis, min),
      ...axisVector(spec.axis, max),
    );

    const offset = tickOffset(spec.axis);
    const startIndex = Math.ceil(min / spec.tickStep);
    const endIndex = Math.floor(max / spec.tickStep);
    for (let k = startIndex; k <= endIndex; k++) {
      const value = k * spec.tickStep;
      const base = axisVector(spec.axis, value);
      positions.push(
        base[0] - offset[0] / 2,
        base[1] - offset[1] / 2,
        base[2] - offset[2] / 2,
        base[0] + offset[0] / 2,
        base[1] + offset[1] / 2,
        base[2] + offset[2] / 2,
      );
      ticks[spec.axis].push({value, position: base});
    }
  }

  return {
    geometry: {kind: 'lines', topology: 'segments', positions},
    ticks,
  };
}
