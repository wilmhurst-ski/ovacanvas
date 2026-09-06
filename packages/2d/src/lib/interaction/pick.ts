import {Matrix2D, Vector2} from '@ovacanvas/core';
import type {InteractionTargets} from './InteractionTargets';
import type {PickResult, PickableNode} from './types';

/**
 * Resolve the topmost eligible interaction target under a point.
 *
 * @param root - The view the pointer landed on.
 * @param point - The point in `root`'s parent space, which for a view is the
 *                canvas buffer space.
 * @param targets - Which nodes are eligible, and what they realize.
 *
 * @remarks
 * Linear reverse traversal with hierarchical bounding-box culling, which is
 * the measured V1 direction: rebuilding a spatial index every frame costs
 * more than the traversal it replaces, because an animated scene invalidates
 * every bounding box on every frame. No spatial index is built, kept or
 * abstracted for later.
 *
 * Children are visited in reverse draw order, so the first containment found
 * is the one drawn on top. Ordering comes from the same z-index sort the
 * renderer draws with, not from child insertion order, so picking and
 * painting cannot disagree.
 *
 * @internal Not a public API.
 */
export function pickTarget(
  root: PickableNode,
  point: Vector2,
  targets: InteractionTargets,
): PickResult | null {
  if (targets.size === 0) return null;
  return descend(root, point, targets);
}

/**
 * Project a point into a node's local space.
 *
 * @returns `null` when the node's transform is not invertible, which happens
 *          when it collapses to zero scale and is therefore not visible.
 *
 * @internal Not a public API.
 */
export function localForNode(
  point: Vector2,
  node: PickableNode,
): Vector2 | null {
  const local = point.transformAsPoint(node.worldToLocal());
  return Number.isFinite(local.x) && Number.isFinite(local.y) ? local : null;
}

function descend(
  node: PickableNode,
  parentPoint: Vector2,
  targets: InteractionTargets,
): PickResult | null {
  // Agree with the renderer, which skips a subtree at this exact test.
  if (node.absoluteOpacity() <= 0) return null;

  const parentToLocal = new Matrix2D(node.localToParent()).inverse;
  // A singular transform means zero scale: nothing was painted, so nothing
  // can be hit.
  if (!parentToLocal) return null;
  const local = parentPoint.transformAsPoint(parentToLocal);

  // Hierarchical cull: this box covers the node and its whole subtree.
  if (!node.cacheBBox().includes(local)) return null;

  const children = node.drawOrderedChildren();
  for (let i = children.length - 1; i >= 0; i--) {
    const hit = descend(children[i], local, targets);
    if (hit) return hit;
  }

  // The node's own contents only. An eligible container is reachable through
  // its children rather than through the union box they inflate.
  const target = targets.targetFor(node);
  if (target !== null && node.localContentBBox().includes(local)) {
    return {target, local};
  }

  return null;
}
