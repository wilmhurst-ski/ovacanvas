import type {Force} from 'd3-force';
import {forceRectCollide, type RectNodeDatum} from './rectCollide';

export interface PlacementItem {
  readonly id: string;
  /** Desired position - where the scene would put this if nothing else competed for the space. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /**
   * Pinned at its desired position: it pushes other items away but never
   * moves itself.
   */
  readonly fixed?: boolean;
}

export interface PlacementResult {
  readonly id: string;
  readonly x: number;
  readonly y: number;
}

export interface ArrangeOptions {
  /** How strongly overlapping rects push apart per iteration. Default 1. */
  readonly collideStrength?: number;
  /**
   * How strongly each rect is pulled back toward its own desired position -
   * this is what keeps the result "the same layout, nudged apart" rather
   * than everything drifting toward a shared centroid. Default 0.1.
   */
  readonly anchorStrength?: number;
  /** Synchronous iteration count. Default 300, matching d3-force's own default settle time. */
  readonly iterations?: number;
}

interface ArrangeNode extends RectNodeDatum {
  readonly id: string;
  readonly anchorX: number;
  readonly anchorY: number;
  readonly fixed: boolean;
}

/**
 * Arrange rectangles so none overlap, starting from - and staying close to -
 * each one's own declared desired position.
 *
 * @remarks
 * The root-cause fix for collision, not just its detection: an agent
 * authoring a scene declares where things *want* to be (a label beside its
 * point, a card in its slot), and this computes where they actually go once
 * mutual overlap is resolved, instead of the agent hand-picking pixel
 * coordinates that may or may not clear each other - the exact failure mode
 * `packages/2d/src/lib/audit` catches after the fact. Use this before the
 * audit gate, not instead of it: this resolves collisions among the items
 * you pass it, the audit still needs to catch anything unregistered.
 *
 * Built on `forceRectCollide` plus a per-node pull back toward its own
 * anchor (a hand-rolled equivalent of d3-force's `forceX`/`forceY`, since
 * this deliberately never constructs a real `d3-force` `Simulation` - see
 * `graph/force.ts`'s own remark on why: a `Simulation` spins up a real timer
 * on construction, which has no place in a synchronous layout call). Iterates
 * a fixed, synchronous number of times with the same alpha-decay velocity
 * integration `layoutForceGraph` already uses, so behavior is deterministic
 * and this never becomes an idle timer somewhere.
 */
export function arrangeWithoutOverlap(
  items: readonly PlacementItem[],
  options: ArrangeOptions = {},
): PlacementResult[] {
  if (items.length === 0) return [];

  const collideStrength = options.collideStrength ?? 1;
  const anchorStrength = options.anchorStrength ?? 0.1;
  const iterations = options.iterations ?? 300;
  const velocityDecay = 0.6;
  const alphaDecay = 1 - Math.pow(0.001, 1 / 300);

  const nodes: ArrangeNode[] = items.map(item => ({
    id: item.id,
    x: item.x,
    y: item.y,
    vx: 0,
    vy: 0,
    width: item.width,
    height: item.height,
    anchorX: item.x,
    anchorY: item.y,
    fixed: item.fixed === true,
  }));

  const collide = forceRectCollide<ArrangeNode>(collideStrength);
  collide.initialize?.(nodes, Math.random);
  const forces: Force<ArrangeNode>[] = [collide, anchorForce(anchorStrength)];

  let alpha = 1;
  for (let iteration = 0; iteration < iterations; iteration++) {
    alpha += (0 - alpha) * alphaDecay;
    for (const force of forces) force(alpha);
    for (const node of nodes) {
      if (node.fixed) {
        // A pinned rect only ever pushes: the collide force's share of the
        // separation it would have taken is discarded, so the free rect
        // keeps being pushed until the pair is clear.
        node.x = node.anchorX;
        node.y = node.anchorY;
        node.vx = 0;
        node.vy = 0;
        continue;
      }
      node.x! += node.vx! *= velocityDecay;
      node.y! += node.vy! *= velocityDecay;
    }
  }

  return nodes.map(node => ({id: node.id, x: node.x!, y: node.y!}));
}

function anchorForce(strength: number): Force<ArrangeNode> {
  let nodes: ArrangeNode[] = [];
  const force = (alpha: number): void => {
    for (const node of nodes) {
      node.vx! += (node.anchorX - node.x!) * strength * alpha;
      node.vy! += (node.anchorY - node.y!) * strength * alpha;
    }
  };
  force.initialize = (initializedNodes: ArrangeNode[]) => {
    nodes = initializedNodes;
  };
  return force;
}
