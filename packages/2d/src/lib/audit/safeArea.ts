import type {BBox} from '@ovacanvas/core';
import type {AuditFinding, AuditItem} from './types';
import {isItemVisible} from './types';
import {isFiniteBBox, worldBBox} from './worldBBox';

function isInside(box: BBox, safeArea: BBox): boolean {
  return (
    box.left >= safeArea.left &&
    box.top >= safeArea.top &&
    box.right <= safeArea.right &&
    box.bottom <= safeArea.bottom
  );
}

/**
 * One safe area is the normal case. A scene may pass more than one only to
 * bridge a real engine inconsistency: shape nodes report world bounds in
 * canvas space, while some text/layout nodes positioned via flex-style
 * `left`/`top`/`right`/`bottom` props report theirs in logical scene space
 * (see `derivatives.tsx`'s `SAFE_CANVAS`/`SAFE_LOGICAL`). An item passes if
 * it fits inside *any* declared area. This is a documented workaround for
 * that coordinate-space bug, not a way to relax the check generally - fixing
 * the underlying inconsistency in `Layout`/`TxtLeaf` bounds reporting is
 * separate follow-up work, out of scope here because of its blast radius
 * across the renderer.
 */
export function collectSafeAreaViolations(
  items: readonly AuditItem[],
  safeArea: BBox | readonly BBox[],
): AuditFinding[] {
  const areas = Array.isArray(safeArea) ? safeArea : [safeArea as BBox];
  const findings: AuditFinding[] = [];
  for (const item of items) {
    if (!isItemVisible(item)) continue;
    const box = worldBBox(item.node);
    if (!isFiniteBBox(box)) {
      // A non-finite box is not a position problem - it means the node's
      // geometry never resolved to real numbers at all (a NaN or Infinity in
      // its position or size, typically from a division by zero or an
      // undefined value in a coordinate expression). Reporting it as a
      // safe-area violation would tell the caller to *move* a node whose
      // bounds do not exist, which is unfixable feedback; this finding names
      // the actual defect.
      findings.push({
        ruleId: 'non-finite-bounds',
        severity: 'blocking',
        entities: [item.id],
        message:
          `Non-finite bounds: ${item.id} has no real position or size ` +
          `(got ${box.toString()}). A coordinate or size in this node ` +
          `evaluated to NaN or Infinity - check for a division by zero or ` +
          `an undefined value in its position/size expression.`,
      });
      continue;
    }
    const expanded = box.expand(item.halo);
    if (!areas.some(area => isInside(expanded, area))) {
      findings.push({
        ruleId: 'safe-area',
        severity: 'blocking',
        entities: [item.id],
        geometry: expanded,
        message: `Safe-area violation: ${item.id} at ${expanded.toString()}`,
      });
    }
  }
  return findings;
}

export function assertInsideSafeArea(
  items: readonly AuditItem[],
  safeArea: BBox | readonly BBox[],
): void {
  const [finding] = collectSafeAreaViolations(items, safeArea);
  if (finding) throw new Error(finding.message);
}

export function collectEmptyBounds(
  items: readonly AuditItem[],
): AuditFinding[] {
  const findings: AuditFinding[] = [];
  for (const item of items) {
    if (!isItemVisible(item)) continue;
    // Checked against the node's own local box, not `worldBBox()`: its
    // `.pixelPerfect` snapping does `Math.ceil(size + 1)`, so a
    // world-space box can never actually measure zero even when the node
    // has no content. `derivatives.tsx`'s original empty-bound check made
    // this same mistake and could never fire either.
    const local = item.node.cacheBBox();
    if (local.width === 0 || local.height === 0) {
      findings.push({
        ruleId: 'empty-bounds',
        severity: 'blocking',
        entities: [item.id],
        geometry: worldBBox(item.node),
        message: `Registered item has an empty bound: ${item.id}`,
      });
    }
  }
  return findings;
}

export function assertNoEmptyBounds(items: readonly AuditItem[]): void {
  const [finding] = collectEmptyBounds(items);
  if (finding) throw new Error(finding.message);
}
