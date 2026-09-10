/**
 * Map-aware collision-free label placement.
 *
 * @remarks
 * Places labels relative to projected feature centroids, markers, or route positions,
 * testing 8-point offset candidates and optional leader lines against map obstacles.
 */

export interface LabelCandidate {
  readonly id: string;
  readonly anchor: readonly [x: number, y: number];
  readonly text: string;
  readonly size: readonly [width: number, height: number];
  readonly priority?: number;
  readonly required?: boolean;
}

export interface PlacedLabel {
  readonly id: string;
  readonly text: string;
  readonly position: readonly [x: number, y: number];
  readonly bounds: readonly [x0: number, y0: number, x1: number, y1: number];
  readonly leader?: {
    readonly start: readonly [x: number, y: number];
    readonly end: readonly [x: number, y: number];
  };
}

export interface UnplacedLabel {
  readonly id: string;
  readonly reason: 'collision' | 'out_of_viewport';
}

export interface LabelPlacementResult {
  readonly placed: readonly PlacedLabel[];
  readonly unplaced: readonly UnplacedLabel[];
}

export interface RectBBox {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

function intersects(a: RectBBox, b: RectBBox): boolean {
  return !(a.x1 <= b.x0 || a.x0 >= b.x1 || a.y1 <= b.y0 || a.y0 >= b.y1);
}

function withinViewport(
  box: RectBBox,
  viewport: readonly [width: number, height: number],
): boolean {
  return (
    box.x0 >= 0 && box.y0 >= 0 && box.x1 <= viewport[0] && box.y1 <= viewport[1]
  );
}

/**
 * 8 compass direction candidate offsets with distance multipliers.
 */
const CANDIDATE_DIRECTIONS: readonly [dx: number, dy: number][] = [
  [1, 0], // E
  [1, -1], // NE
  [0, -1], // N
  [-1, -1], // NW
  [-1, 0], // W
  [-1, 1], // SW
  [0, 1], // S
  [1, 1], // SE
];

export function placeMapLabels(
  labels: readonly LabelCandidate[],
  viewport: readonly [width: number, height: number],
  initialObstacles: readonly RectBBox[] = [],
): LabelPlacementResult {
  // Sort descending by priority (higher priority first)
  const sorted = [...labels].sort(
    (a, b) => (b.priority ?? 0) - (a.priority ?? 0),
  );

  const placedBoxes: RectBBox[] = [...initialObstacles];
  const placed: PlacedLabel[] = [];
  const unplaced: UnplacedLabel[] = [];

  const defaultGap = 6;
  const leaderLengths = [defaultGap, 16, 28];

  for (const label of sorted) {
    const [w, h] = label.size;
    const [ax, ay] = label.anchor;
    let successfullyPlaced = false;

    for (const dist of leaderLengths) {
      for (const [dirX, dirY] of CANDIDATE_DIRECTIONS) {
        // Label anchor point
        const lx = dirX >= 0 ? ax + dirX * dist : ax + dirX * dist - w;
        const ly = dirY >= 0 ? ay + dirY * dist : ay + dirY * dist - h;

        const candidateBox: RectBBox = {
          x0: lx,
          y0: ly,
          x1: lx + w,
          y1: ly + h,
        };

        if (!withinViewport(candidateBox, viewport)) {
          continue;
        }

        const hasOverlap = placedBoxes.some(obs =>
          intersects(candidateBox, obs),
        );
        if (!hasOverlap) {
          successfullyPlaced = true;
          placedBoxes.push(candidateBox);

          const isDisplaced = dist > defaultGap;
          const leader = isDisplaced
            ? {
                start: [ax, ay] as const,
                end: [
                  lx + (dirX < 0 ? w : 0),
                  ly + (dirY < 0 ? h : 0),
                ] as const,
              }
            : undefined;

          placed.push({
            id: label.id,
            text: label.text,
            position: [lx, ly],
            bounds: [
              candidateBox.x0,
              candidateBox.y0,
              candidateBox.x1,
              candidateBox.y1,
            ],
            leader,
          });
          break;
        }
      }
      if (successfullyPlaced) break;
    }

    if (!successfullyPlaced) {
      unplaced.push({
        id: label.id,
        reason: 'collision',
      });
    }
  }

  return {placed, unplaced};
}
