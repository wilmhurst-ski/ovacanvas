export interface OrbitPlacement {
  readonly x: number;
  readonly y: number;
  /** Degrees, 0 = along +x, increasing clockwise (screen-space convention). */
  readonly angleDegrees: number;
}

export interface DistributeOrbitingOptions {
  readonly center?: {readonly x: number; readonly y: number};
  readonly radius?: number;
  /** Where the first item sits. Default -90 (straight up). */
  readonly startAngleDegrees?: number;
}

/**
 * Evenly space `count` positions around a focal center.
 *
 * @remarks
 * "OrbitingEvidence" from the composition-not-just-collision pass: a scene
 * declares "these N examples surround that concept" and gets real
 * coordinates back, instead of hand-placing each one and hoping the
 * spacing reads as even. A one-shot computation, not a persistent node -
 * the same choice `arrangeWithoutOverlap` and `layoutForceGraph` already
 * made in this module, since re-deriving N positions from a center that
 * moved is exactly one function call away, with no reactive machinery
 * needed until an actual scene wants the center to be live. Compose with
 * `arrangeWithoutOverlap` afterward if the orbiting items themselves are
 * wide enough to overlap their neighbors at the chosen radius/count.
 */
export function distributeOrbiting(
  count: number,
  options: DistributeOrbitingOptions = {},
): OrbitPlacement[] {
  if (count <= 0) return [];

  const {
    center = {x: 0, y: 0},
    radius = 160,
    startAngleDegrees = -90,
  } = options;
  const step = 360 / count;

  return Array.from({length: count}, (_, index) => {
    const angleDegrees = startAngleDegrees + index * step;
    const radians = (angleDegrees * Math.PI) / 180;
    return {
      x: center.x + radius * Math.cos(radians),
      y: center.y + radius * Math.sin(radians),
      angleDegrees,
    };
  });
}
