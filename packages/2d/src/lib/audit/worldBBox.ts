import {BBox} from '@ovacanvas/core';
import type {AuditableNode} from './types';

/**
 * A node's content-and-children bounding box in world space, snapped to
 * whole pixels.
 *
 * @remarks
 * This was duplicated three times before promotion (the two skill helper
 * files and `packages/template/src/scenes/derivatives.tsx`), byte-identical
 * in every copy. One implementation now backs every audit check.
 */
export function worldBBox(node: AuditableNode): BBox {
  return BBox.fromPoints(
    ...node.cacheBBox().transformCorners(node.localToWorld()),
  ).pixelPerfect;
}

/**
 * Whether a box is a real, measurable region.
 *
 * @remarks
 * `BBox.fromPoints` over an empty (or NaN-cornered) point set yields
 * `Infinity`/`NaN` fields rather than throwing, so a node whose geometry
 * never resolved - a coordinate computed from an undefined value or a
 * division by zero - flows into the audit as a garbage box. Checks that
 * compare positions must test this before drawing conclusions from one.
 */
export function isFiniteBBox(box: BBox): boolean {
  return (
    Number.isFinite(box.x) &&
    Number.isFinite(box.y) &&
    Number.isFinite(box.width) &&
    Number.isFinite(box.height)
  );
}
