import type {Force, ForceNodeDatum} from 'd3-force';

export interface RectNodeDatum extends ForceNodeDatum {
  width: number;
  height: number;
}

/**
 * A d3-force-compatible force that separates overlapping axis-aligned
 * rectangles, rather than d3-force's own `forceCollide` (circle-vs-circle
 * only).
 *
 * @remarks
 * d3-force ships `forceCollide`, the exactly-right "keep things apart"
 * primitive, but only for circles: it compares node-to-node distance against
 * a scalar radius, which is a poor fit for the wide, short boxes real
 * labels, equations and cards actually are (approximating a wide rect by its
 * bounding circle wastes far more space than the rect needs, or under a
 * smaller radius, still lets its corners overlap).
 *
 * This computes the true axis-aligned overlap between each pair of rects and
 * pushes them apart along whichever axis has the smaller overlap (the
 * standard minimum-translation-vector resolution for AABBs), split
 * proportionally by area so a small label yields more than a large card.
 * Conforms to the same `Force<Node>` contract (`initialize`, then
 * `force(alpha)` called against `.vx`/`.vy`) that `layoutForceGraph` already
 * uses, so it composes with the existing pure-primitive tick loop -
 * deliberately never a real `d3-force` `Simulation`, which spins up its own
 * timer, does not fit; see `force.ts`'s own remark on this.
 */
export function forceRectCollide<TNode extends RectNodeDatum>(
  strength = 1,
): Force<TNode> & {strength(value: number): Force<TNode>} {
  let nodes: TNode[] = [];
  let currentStrength = strength;

  function force(alpha: number): void {
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        const dx = b.x! - a.x!;
        const dy = b.y! - a.y!;
        const overlapX = (a.width + b.width) / 2 - Math.abs(dx);
        const overlapY = (a.height + b.height) / 2 - Math.abs(dy);
        if (overlapX <= 0 || overlapY <= 0) continue;

        const areaA = a.width * a.height;
        const areaB = b.width * b.height;
        const shareA = areaB / (areaA + areaB);
        const shareB = 1 - shareA;
        const push = alpha * currentStrength;

        // Resolve along the axis of least overlap - the standard AABB
        // minimum-translation-vector choice - so a push never overshoots
        // into a different, still-overlapping configuration on the other axis.
        if (overlapX < overlapY) {
          const sign = dx === 0 ? (i < j ? -1 : 1) : Math.sign(dx);
          a.vx! -= sign * overlapX * shareA * push;
          b.vx! += sign * overlapX * shareB * push;
        } else {
          const sign = dy === 0 ? (i < j ? -1 : 1) : Math.sign(dy);
          a.vy! -= sign * overlapY * shareA * push;
          b.vy! += sign * overlapY * shareB * push;
        }
      }
    }
  }

  force.initialize = (initializedNodes: TNode[]) => {
    nodes = initializedNodes;
  };

  force.strength = (value: number) => {
    currentStrength = value;
    return force;
  };

  return force;
}
