import {BBox, Matrix2D, Vector2} from '@ovacanvas/core';
import {describe, expect, test} from 'vitest';
import {InteractionTargets} from './InteractionTargets';
import {localForNode, pickTarget} from './pick';
import type {PickableNode} from './types';

interface StubProps {
  x?: number;
  y?: number;
  rotation?: number;
  scale?: number;
  width?: number;
  height?: number;
  opacity?: number;
  children?: StubNode[];
}

/**
 * A presentation node reduced to the geometry picking actually reads.
 *
 * @remarks
 * Real nodes need a scene, a canvas and a document; the traversal needs six
 * matrix components and a box. Testing against the reduced surface keeps
 * these regressions about picking rather than about scene bring-up, and the
 * production typecheck still proves {@link Node} satisfies the same shape.
 */
class StubNode implements PickableNode {
  public parent: StubNode | null = null;
  private readonly matrix: Matrix2D;
  private readonly box: BBox;
  private readonly ownOpacity: number;
  private readonly kids: StubNode[];

  public constructor(props: StubProps = {}) {
    const {
      x = 0,
      y = 0,
      rotation = 0,
      scale = 1,
      width = 0,
      height = 0,
      opacity = 1,
      children = [],
    } = props;

    const radians = (rotation * Math.PI) / 180;
    const cos = Math.cos(radians) * scale;
    const sin = Math.sin(radians) * scale;
    this.matrix = new Matrix2D(cos, sin, -sin, cos, x, y);
    this.box = BBox.fromSizeCentered(new Vector2(width, height));
    this.ownOpacity = opacity;
    this.kids = children;
    for (const child of children) child.parent = this;
  }

  public absoluteOpacity(): number {
    return (this.parent?.absoluteOpacity() ?? 1) * this.ownOpacity;
  }

  public localToParent(): Matrix2D {
    return this.matrix;
  }

  public localToWorld(): Matrix2D {
    const parent = this.parent;
    return parent ? parent.localToWorld().mul(this.matrix) : this.matrix;
  }

  public worldToLocal(): Matrix2D {
    // A non-invertible transform yields NaN components, which is what
    // DOMMatrix.inverse() produces and what production nodes therefore return.
    return (
      this.localToWorld().inverse ?? new Matrix2D(NaN, NaN, NaN, NaN, NaN, NaN)
    );
  }

  public localContentBBox(): BBox {
    return this.box;
  }

  public cacheBBox(): BBox {
    const boxes = [this.box];
    for (const child of this.kids) {
      boxes.push(
        BBox.fromPoints(
          ...child.cacheBBox().transformCorners(child.localToParent()),
        ),
      );
    }
    return BBox.fromBBoxes(...boxes);
  }

  public drawOrderedChildren(): StubNode[] {
    return this.kids;
  }
}

/** A point in the world (canvas buffer) space of a node. */
function worldPoint(node: StubNode, local: Vector2): Vector2 {
  return local.transformAsPoint(node.localToWorld());
}

/**
 * Matrix2D stores its components in a Float32Array, so a transform round trip
 * is single precision. At canvas scale that is a small fraction of a pixel.
 */
function near(actual: Vector2, expected: Vector2, epsilon = 1e-4) {
  expect(Math.abs(actual.x - expected.x)).toBeLessThan(epsilon);
  expect(Math.abs(actual.y - expected.y)).toBeLessThan(epsilon);
}

describe('pickTarget', () => {
  test('resolves the topmost of two overlapping eligible targets', () => {
    const under = new StubNode({x: -20, width: 100, height: 100});
    const over = new StubNode({x: 20, width: 100, height: 100});
    const root = new StubNode({
      width: 400,
      height: 400,
      children: [under, over],
    });

    const targets = new InteractionTargets();
    targets.bind('under', under);
    targets.bind('over', over);

    // Inside both boxes. The later child is painted last, so it is on top.
    expect(pickTarget(root, new Vector2(0, 0), targets)?.target).toBe('over');
    // Only the lower one reaches this far left.
    expect(pickTarget(root, new Vector2(-60, 0), targets)?.target).toBe(
      'under',
    );
    // Only the upper one reaches this far right.
    expect(pickTarget(root, new Vector2(60, 0), targets)?.target).toBe('over');
  });

  test('a fully transparent target does not occlude what is under it', () => {
    const under = new StubNode({width: 100, height: 100});
    const ghost = new StubNode({width: 100, height: 100, opacity: 0});
    const root = new StubNode({
      width: 400,
      height: 400,
      children: [under, ghost],
    });

    const targets = new InteractionTargets();
    targets.bind('under', under);
    targets.bind('ghost', ghost);

    // The renderer skips the ghost at exactly this test, and so must picking:
    // a canvas containment query would have reported it as a hit.
    expect(pickTarget(root, new Vector2(0, 0), targets)?.target).toBe('under');
  });

  test('an ancestor with zero opacity hides its whole subtree', () => {
    const child = new StubNode({width: 100, height: 100});
    const group = new StubNode({opacity: 0, children: [child]});
    const root = new StubNode({width: 400, height: 400, children: [group]});

    const targets = new InteractionTargets();
    targets.bind('child', child);

    expect(pickTarget(root, new Vector2(0, 0), targets)).toBeNull();
  });

  test('resolves a target and its local point through nested transforms', () => {
    const inner = new StubNode({x: 20, y: 0, width: 60, height: 40});
    const group = new StubNode({
      x: 100,
      y: 60,
      rotation: 30,
      scale: 1.5,
      children: [inner],
    });
    const root = new StubNode({width: 800, height: 800, children: [group]});

    const targets = new InteractionTargets();
    targets.bind('inner', inner);

    // A point 10 right and 8 down of the target's own origin, pushed out to
    // world space through the rotation and the scale.
    const local = new Vector2(10, 8);
    const world = worldPoint(inner, local);
    expect(world.exactlyEquals(local)).toBe(false);

    const hit = pickTarget(root, world, targets);
    expect(hit?.target).toBe('inner');
    near(hit!.local, local);

    // Just outside the rotated box, so the axis-aligned world bounds still
    // contain it but the target does not.
    const outside = worldPoint(inner, new Vector2(40, 0));
    expect(pickTarget(root, outside, targets)).toBeNull();
  });

  test('a point outside every eligible target resolves to nothing', () => {
    const box = new StubNode({width: 100, height: 100});
    const root = new StubNode({width: 400, height: 400, children: [box]});
    const targets = new InteractionTargets();
    targets.bind('box', box);

    expect(pickTarget(root, new Vector2(80, 0), targets)).toBeNull();
    expect(pickTarget(root, new Vector2(0, 80), targets)).toBeNull();
    expect(pickTarget(root, new Vector2(500, 500), targets)).toBeNull();
  });

  test('ineligible nodes are transparent to picking, not occluders', () => {
    const eligible = new StubNode({width: 100, height: 100});
    const decoration = new StubNode({width: 200, height: 200});
    const root = new StubNode({
      width: 400,
      height: 400,
      children: [eligible, decoration],
    });

    const targets = new InteractionTargets();
    targets.bind('eligible', eligible);

    // The decoration is painted on top and contains the point, but nothing
    // bound it, so it neither wins nor blocks.
    expect(pickTarget(root, new Vector2(0, 0), targets)?.target).toBe(
      'eligible',
    );
    // Over the decoration only: still a miss.
    expect(pickTarget(root, new Vector2(80, 0), targets)).toBeNull();
  });

  test('an eligible container is reached through its children', () => {
    const child = new StubNode({x: 200, width: 40, height: 40});
    const container = new StubNode({
      width: 40,
      height: 40,
      children: [child],
    });
    const root = new StubNode({
      width: 800,
      height: 800,
      children: [container],
    });

    const targets = new InteractionTargets();
    targets.bind('container', container);

    // The subtree cull must not lose the child, which sits far outside the
    // container's own box.
    expect(pickTarget(root, new Vector2(200, 0), targets)).toBeNull();
    // The container's own contents still hit.
    expect(pickTarget(root, new Vector2(0, 0), targets)?.target).toBe(
      'container',
    );
  });

  test('unbinding a target makes it unpickable', () => {
    const box = new StubNode({width: 100, height: 100});
    const root = new StubNode({width: 400, height: 400, children: [box]});
    const targets = new InteractionTargets();
    const unbind = targets.bind('box', box);

    expect(pickTarget(root, new Vector2(0, 0), targets)?.target).toBe('box');
    unbind();
    expect(targets.size).toBe(0);
    expect(pickTarget(root, new Vector2(0, 0), targets)).toBeNull();
  });

  test('a collapsed node is skipped instead of dividing by zero', () => {
    const box = new StubNode({scale: 0, width: 100, height: 100});
    const root = new StubNode({width: 400, height: 400, children: [box]});
    const targets = new InteractionTargets();
    targets.bind('box', box);

    expect(pickTarget(root, new Vector2(0, 0), targets)).toBeNull();
  });

  test('no eligible target means no traversal result at all', () => {
    const box = new StubNode({width: 100, height: 100});
    const root = new StubNode({width: 400, height: 400, children: [box]});

    expect(pickTarget(root, new Vector2(0, 0), new InteractionTargets())).toBe(
      null,
    );
  });
});

describe('InteractionTargets', () => {
  test('rebinding a target to a new node releases the old one', () => {
    const first = new StubNode({width: 10, height: 10});
    const second = new StubNode({width: 10, height: 10});
    const targets = new InteractionTargets();

    const unbindFirst = targets.bind('t', first);
    targets.bind('t', second);

    expect(targets.size).toBe(1);
    expect(targets.targetFor(first)).toBeNull();
    expect(targets.targetFor(second)).toBe('t');
    expect(targets.nodeFor('t')).toBe(second);

    // A stale generation tearing down must not unbind the live binding.
    unbindFirst();
    expect(targets.nodeFor('t')).toBe(second);
  });

  test('clear releases every binding', () => {
    const node = new StubNode({width: 10, height: 10});
    const targets = new InteractionTargets();
    targets.bind('a', node);

    expect(targets.targets).toEqual(['a']);
    targets.clear();

    expect(targets.size).toBe(0);
    expect(targets.targetFor(node)).toBeNull();
    expect(targets.nodeFor('a')).toBeNull();
  });
});

describe('localForNode', () => {
  test('projects a world point into a transformed node', () => {
    const inner = new StubNode({x: 30, y: -10, rotation: -20, scale: 2});
    const group = new StubNode({x: 5, y: 7, rotation: 45, children: [inner]});
    new StubNode({children: [group]});

    const local = new Vector2(-14, 22);
    near(localForNode(worldPoint(inner, local), inner)!, local);
  });

  test('a collapsed node yields no usable local point', () => {
    const node = new StubNode({scale: 0});
    expect(localForNode(new Vector2(1, 1), node)).toBeNull();
  });
});
