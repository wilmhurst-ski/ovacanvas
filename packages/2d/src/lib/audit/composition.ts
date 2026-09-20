import {BBox} from '@ovacanvas/core';
import type {AuditFinding, AuditItem} from './types';
import {isItemVisible} from './types';
import {isFiniteBBox, worldBBox} from './worldBBox';

/**
 * Composition: is the board well-composed, not merely collision-free.
 *
 * @remarks
 * Every other check in this module answers "is anything broken" - nothing
 * overlaps, nothing escapes the safe area, nothing is invisible. None of them
 * answer "does this read well", and a scene can satisfy all of them while
 * being genuinely bad: four labels crammed into one corner of a 1920x1080
 * board is geometrically flawless and visually useless. This is the layer that
 * notices.
 *
 * **Everything here is `advisory`, never `blocking`, and that is a deliberate
 * architectural choice rather than timidity.** The project's own operating
 * principle is that only checks which are mechanically certain may refuse a
 * beat; composition is a judgement, and a judgement encoded as a gate would
 * eventually reject a scene that is perfectly good. Advisory findings still
 * reach a caller - they are in the report, and a host is free to re-author on
 * them - they simply cannot be the reason a correct beat never reaches a
 * learner.
 *
 * **The thresholds are measured, not invented.** They were derived by
 * measuring a labelled corpus (well-composed and deliberately-bad scenes) and
 * reading the separation, the same method the implicit-containment threshold
 * in `collisions.ts` was calibrated by. `composition.test.ts` holds that
 * corpus, and it fails if the separation closes - so a change to the geometry
 * or the thresholds cannot silently invalidate the numbers below.
 */

export interface CompositionThresholds {
  /**
   * Fraction of the useful board the drawn content should cover.
   *
   * @remarks
   * Below the floor the board reads as empty and the content as incidental;
   * above the ceiling there is no breathing room left and the scene reads as
   * cramped. Measured on the corpus in `composition.test.ts`: the three
   * well-composed fixtures land at 0.125, 0.150 and 0.160; the crammed-corner
   * fixture at 0.034 and the board-filling one at 0.759. The floor sits just
   * above the crammed case and the ceiling well below the sprawling one,
   * leaving the whole good range comfortably inside.
   */
  readonly minOccupancy: number;
  readonly maxOccupancy: number;
  /**
   * Smallest gap, in pixels, between the content's bounding box and the edge
   * of the useful board. Corpus: the well-composed fixtures leave 80-90px;
   * the edge-pressed fixture leaves 9px.
   */
  readonly minBreathingRoom: number;
  /** How close two centres must be, in pixels, to count as sharing an axis. */
  readonly alignmentTolerance: number;
  /**
   * Fraction of items allowed to share no axis with any other item.
   *
   * @remarks
   * Only meaningful once there are enough items for a grid to exist at all -
   * with two or three items almost any layout looks "unaligned", so
   * {@link MIN_ITEMS_FOR_ALIGNMENT} suppresses the check below that.
   */
  readonly maxUnalignedFraction: number;
  /** The band at the top of the board reserved for a heading. */
  readonly titleZoneHeight: number;
}

/**
 * Below this many visible items there is no grid to align to, so the
 * alignment check stays silent rather than reporting noise.
 */
export const MIN_ITEMS_FOR_ALIGNMENT = 4;

export const DEFAULT_COMPOSITION_THRESHOLDS: CompositionThresholds = {
  minOccupancy: 0.04,
  maxOccupancy: 0.34,
  minBreathingRoom: 60,
  alignmentTolerance: 12,
  maxUnalignedFraction: 0.75,
  titleZoneHeight: 150,
};

/**
 * The part of the board content is actually composed into: the safe area
 * minus the band reserved for a heading.
 *
 * @remarks
 * This concept was undefined anywhere in the codebase, which is why
 * composition could not be measured at all. A heading sits across the top by
 * convention (the opener beat, the equation template and the hand-authored
 * e2e fixtures all place titles around y = -420 in scene space, i.e. ~120px
 * below the top of the canvas), and treating that band as usable board area
 * would score a correctly-titled scene as unbalanced.
 */
export function usefulBoardArea(
  safeArea: BBox | readonly BBox[],
  titleZoneHeight: number = DEFAULT_COMPOSITION_THRESHOLDS.titleZoneHeight,
): BBox {
  // A scene may declare several safe areas to bridge the canvas-space vs
  // logical-space inconsistency (see `safeArea.ts`); the first is the one a
  // composition judgement is made against.
  const board = (Array.isArray(safeArea) ? safeArea[0] : safeArea) as BBox;
  const top = board.top + titleZoneHeight;
  const height = Math.max(0, board.bottom - top);
  return new BBox(board.left, top, board.width, height);
}

export interface CompositionMeasurements {
  /** The area the measurements are relative to. */
  readonly useful: BBox;
  /** Union of every visible item's rendered box, or `null` if none. */
  readonly contentBox: BBox | null;
  /** Drawn area clipped to the useful board, over the useful board's area. */
  readonly occupancy: number;
  /** Smallest gap from the content box to the useful board's edges. */
  readonly breathingRoom: number;
  /** Fraction of items sharing no axis with any other item. */
  readonly unalignedFraction: number;
  readonly visibleItems: number;
}

/**
 * The boxes composition is judged on: visible, measurable, and *composed* -
 * a heading sitting entirely inside the title band is excluded.
 *
 * @remarks
 * Without this exclusion every correctly-titled scene fails: the heading
 * lives above the useful board by construction, so including it drags the
 * content bounding box up past the board's top edge and reports a negative
 * margin. A heading is not composed content; it is the band that content is
 * composed below. An item straddling the boundary is kept, because that is
 * content that happens to be tall, not a heading.
 */
function composedBoxes(items: readonly AuditItem[], useful: BBox): BBox[] {
  const boxes: BBox[] = [];
  for (const item of items) {
    if (!isItemVisible(item)) continue;
    const box = worldBBox(item.node);
    if (!isFiniteBBox(box)) continue;
    if (box.width <= 0 || box.height <= 0) continue;
    if (box.bottom <= useful.top) continue; // entirely inside the title band
    boxes.push(box.expand(item.halo));
  }
  return boxes;
}

export function measureComposition(
  items: readonly AuditItem[],
  safeArea: BBox | readonly BBox[],
  thresholds: CompositionThresholds = DEFAULT_COMPOSITION_THRESHOLDS,
): CompositionMeasurements {
  const useful = usefulBoardArea(safeArea, thresholds.titleZoneHeight);
  const boxes = composedBoxes(items, useful);

  if (boxes.length === 0) {
    return {
      useful,
      contentBox: null,
      occupancy: 0,
      breathingRoom: 0,
      unalignedFraction: 0,
      visibleItems: 0,
    };
  }

  const contentBox = BBox.fromBBoxes(...boxes);

  // Drawn area, not the content bounding box: a scene with two items in
  // opposite corners has a large bounding box and almost no ink, and it is
  // the ink that decides whether the board reads as full or as empty.
  const drawnArea = boxes.reduce((total, box) => {
    const clipped = box.intersection(useful);
    return total + Math.max(0, clipped.width) * Math.max(0, clipped.height);
  }, 0);
  const usefulArea = useful.width * useful.height;

  const breathingRoom = Math.min(
    contentBox.left - useful.left,
    useful.right - contentBox.right,
    contentBox.top - useful.top,
    useful.bottom - contentBox.bottom,
  );

  const centres = boxes.map(box => box.center);
  let unaligned = 0;
  for (const [index, centre] of centres.entries()) {
    const sharesAxis = centres.some((other, otherIndex) => {
      if (otherIndex === index) return false;
      return (
        Math.abs(other.x - centre.x) <= thresholds.alignmentTolerance ||
        Math.abs(other.y - centre.y) <= thresholds.alignmentTolerance
      );
    });
    if (!sharesAxis) unaligned++;
  }

  return {
    useful,
    contentBox,
    occupancy: usefulArea > 0 ? drawnArea / usefulArea : 0,
    breathingRoom,
    unalignedFraction: unaligned / boxes.length,
    visibleItems: boxes.length,
  };
}

/**
 * Composition findings, all advisory.
 *
 * @remarks
 * Returns an empty list when nothing is visible: a blank board is not a
 * composition problem, it is the `invisible-required-item` problem, and
 * reporting it here as well would send a caller chasing the wrong fix.
 */
export function collectCompositionFindings(
  items: readonly AuditItem[],
  safeArea: BBox | readonly BBox[],
  thresholds: CompositionThresholds = DEFAULT_COMPOSITION_THRESHOLDS,
): AuditFinding[] {
  const measured = measureComposition(items, safeArea, thresholds);
  if (measured.contentBox === null) return [];

  const findings: AuditFinding[] = [];
  const {occupancy, breathingRoom, unalignedFraction, useful} = measured;

  if (occupancy < thresholds.minOccupancy) {
    findings.push({
      ruleId: 'composition-occupancy',
      severity: 'advisory',
      entities: [],
      geometry: measured.contentBox,
      message:
        `Content covers ${(occupancy * 100).toFixed(1)}% of the usable board ` +
        `(under ${(thresholds.minOccupancy * 100).toFixed(0)}%). The board reads as empty and ` +
        'the content as incidental - spread it out, or make it larger.',
    });
  } else if (occupancy > thresholds.maxOccupancy) {
    findings.push({
      ruleId: 'composition-occupancy',
      severity: 'advisory',
      entities: [],
      geometry: measured.contentBox,
      message:
        `Content covers ${(occupancy * 100).toFixed(1)}% of the usable board ` +
        `(over ${(thresholds.maxOccupancy * 100).toFixed(0)}%). There is no breathing room left - ` +
        'remove something, or give the pieces more space between them.',
    });
  }

  if (breathingRoom < thresholds.minBreathingRoom) {
    const sides: string[] = [];
    if (measured.contentBox.left - useful.left < thresholds.minBreathingRoom)
      {sides.push('left');}
    if (useful.right - measured.contentBox.right < thresholds.minBreathingRoom)
      {sides.push('right');}
    if (measured.contentBox.top - useful.top < thresholds.minBreathingRoom)
      {sides.push('top');}
    if (
      useful.bottom - measured.contentBox.bottom <
      thresholds.minBreathingRoom
    )
      {sides.push('bottom');}
    findings.push({
      ruleId: 'composition-breathing-room',
      severity: 'advisory',
      entities: [],
      geometry: measured.contentBox,
      message:
        `Content leaves ${Math.round(breathingRoom)}px of margin on the ${sides.join('/')} ` +
        `(want at least ${thresholds.minBreathingRoom}px). The layout is pressed against the edge of the board.`,
    });
  }

  if (
    measured.visibleItems >= MIN_ITEMS_FOR_ALIGNMENT &&
    unalignedFraction > thresholds.maxUnalignedFraction
  ) {
    findings.push({
      ruleId: 'composition-alignment',
      severity: 'advisory',
      entities: [],
      geometry: measured.contentBox,
      message:
        `${Math.round(unalignedFraction * 100)}% of items share no horizontal or vertical axis ` +
        'with any other item. Nothing lines up, which reads as scattered rather than composed.',
    });
  }

  return findings;
}
