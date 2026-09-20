import type {AuditableNode, AuditFinding, AuditItem} from './types';
import {DEFAULT_VISIBLE_OPACITY_THRESHOLD} from './types';

export function collectCoverageGaps(
  items: readonly AuditItem[],
  requiredIds: readonly string[],
): AuditFinding[] {
  const registered = new Set(items.map(item => item.id));
  const missing = requiredIds.filter(id => !registered.has(id));
  if (missing.length === 0) return [];
  return [
    {
      ruleId: 'coverage',
      severity: 'blocking',
      entities: missing,
      message: `Visual collision registry is incomplete: ${missing.join(', ')}`,
    },
  ];
}

export function assertVisualRegistryCoverage(
  items: readonly AuditItem[],
  requiredIds: readonly string[],
): void {
  const [finding] = collectCoverageGaps(items, requiredIds);
  if (finding) throw new Error(finding.message);
}

function isRegisteredOrDescendantOfRegistered(
  node: AuditableNode,
  registeredRoots: readonly AuditableNode[],
): boolean {
  let current: AuditableNode | null = node;
  while (current) {
    if (registeredRoots.includes(current)) return true;
    current = current.parent();
  }
  return false;
}

/**
 * Every visible node not already covered by some registered audit item -
 * the real nodes behind {@link collectUnregisteredVisibleNodes}'s finding,
 * for a caller (mechanical repair) that needs to actually DO something with
 * them, not just report their keys.
 *
 * @remarks
 * Closed-world walk: every node that actually draws something visible must
 * sit under some registered audit item, not merely every declared id must
 * exist somewhere. Every prior implementation (both skill helpers and the
 * `derivatives.tsx` reimplementation) only checked declared items, so an
 * unplanned node with no `opacity` control could render for the whole scene
 * without any check ever looking at it — exactly the "Difference Quotient &
 * Derivative" heading that shipped in the lab 2 failure.
 */
export function findUnregisteredVisibleNodes(
  root: AuditableNode,
  items: readonly AuditItem[],
  opacityThreshold = DEFAULT_VISIBLE_OPACITY_THRESHOLD,
): AuditableNode[] {
  const registeredRoots = items.map(item => item.node);
  const offenders: AuditableNode[] = [];

  const visit = (node: AuditableNode): void => {
    // Opacity is multiplicative down the tree, so a node at or below the
    // threshold makes every descendant at or below it too: safe to prune.
    if (node.absoluteOpacity() <= opacityThreshold) return;

    const own = node.localContentBBox();
    if (
      own.width > 0 &&
      own.height > 0 &&
      !isRegisteredOrDescendantOfRegistered(node, registeredRoots)
    ) {
      offenders.push(node);
    }
    for (const child of node.children()) visit(child);
  };
  // The root itself is structurally exempt: a scene's `View2D` is a `Rect`
  // subclass, so `getCacheBBox()` reports a non-zero box for its own defined
  // size regardless of fill - every real scene would otherwise trip this
  // check on its own root, which can't "touch" its own descendants in any
  // meaningful sense. Only descendants compete for space, so only they are
  // walked.
  for (const child of root.children()) visit(child);

  return offenders;
}

export function collectUnregisteredVisibleNodes(
  root: AuditableNode,
  items: readonly AuditItem[],
  opacityThreshold = DEFAULT_VISIBLE_OPACITY_THRESHOLD,
): AuditFinding[] {
  const offenders = findUnregisteredVisibleNodes(root, items, opacityThreshold);
  if (offenders.length === 0) return [];
  const keys = offenders.map(node => node.key);
  return [
    {
      ruleId: 'unregistered-node',
      severity: 'blocking',
      entities: keys,
      message: `Visible nodes are drawing without audit registration: ${keys.join(', ')}`,
    },
  ];
}

export function assertNoUnregisteredVisibleNodes(
  root: AuditableNode,
  items: readonly AuditItem[],
  opacityThreshold?: number,
): void {
  const [finding] = collectUnregisteredVisibleNodes(
    root,
    items,
    opacityThreshold,
  );
  if (finding) throw new Error(finding.message);
}
