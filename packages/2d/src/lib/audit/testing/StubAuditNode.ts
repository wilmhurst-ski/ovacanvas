import {BBox, Color, Matrix2D, Vector2} from '@ovacanvas/core';
import type {AuditableNode, AuditableRoute} from '../types';

export interface StubAuditNodeProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  opacity?: number;
  children?: StubAuditNode[];
  /** When provided, this stub satisfies `AuditableNode.text`, modeling a `Txt`-like node. */
  text?: string;
  /** When provided, this stub satisfies `AuditableNode.tex`, modeling a `Latex`-like node. */
  tex?: string;
  /**
   * When provided, this stub satisfies `AuditableNode.fill`, returning a
   * real `Color` (the same `chroma-js`-backed type `Shape.fill` returns) so
   * a check that duck-types on `.hex()` exercises the real interface.
   */
  fill?: string;
  /** When provided, this stub satisfies `AuditableNode.fontSize`, modeling `Layout.fontSize`. */
  fontSize?: number;
  /**
   * When true, this stub satisfies `AuditableNode.startAngle`/`.endAngle`
   * as a full (0-360) circle, modeling a real `Circle` for the collision
   * check's circle-aware geometry. `width` must equal `height` for this to
   * take effect (a real `Circle` under non-uniform scale becomes an
   * ellipse, which that check deliberately falls back on, not approximates).
   */
  circle?: boolean;
  /**
   * When provided, this stub satisfies `AuditableNode.parsedPoints`,
   * modeling a real `Line` for the collision check's segment-aware
   * geometry - the points are in this node's own LOCAL space, the same as
   * a real `Line.parsedPoints()`. `width`/`height`/`x`/`y` are ignored in
   * favor of a bounding box computed from these points, matching how a
   * real `Line`'s own cache box is derived from its points, not a
   * separately-specified size.
   */
  points?: Vector2[];
}

/**
 * A node reduced to the geometry the audit actually reads, mirroring
 * `StubNode` in `interaction/pick.test.ts`. Real nodes need a scene, a
 * canvas and a document; the audit needs a box, an opacity and a tree. The
 * production typecheck (`AuditableNode` is satisfied by `Node`) proves this
 * stub isn't testing something `Node` couldn't actually do.
 */
export class StubAuditNode implements AuditableNode {
  private parentNode: StubAuditNode | null = null;
  private x: number;
  private y: number;
  private readonly box: BBox;
  private readonly ownOpacity: number;
  private readonly kids: StubAuditNode[];
  public readonly text?: () => string;
  public readonly tex?: () => string;
  public readonly fill?: () => Color;
  public readonly fontSize?: () => number;
  public readonly startAngle?: () => number;
  public readonly endAngle?: () => number;
  public readonly parsedPoints?: () => readonly Vector2[];

  public constructor(
    public readonly key: string,
    props: StubAuditNodeProps = {},
  ) {
    const {
      x = 0,
      y = 0,
      width = 0,
      height = 0,
      opacity = 1,
      children = [],
    } = props;
    if (props.circle) {
      this.startAngle = () => 0;
      this.endAngle = () => 360;
    }
    if (props.points) {
      const points = props.points;
      this.parsedPoints = () => points;
    }
    this.x = x;
    this.y = y;
    this.box = props.points
      ? BBox.fromPoints(...props.points)
      : BBox.fromSizeCentered(new Vector2(width, height));
    this.ownOpacity = opacity;
    this.kids = children;
    for (const child of children) child.parentNode = this;
    if (props.text !== undefined) {
      const content = props.text;
      this.text = () => content;
    }
    if (props.tex !== undefined) {
      const content = props.tex;
      this.tex = () => content;
    }
    if (props.fill !== undefined) {
      const color = new Color(props.fill);
      this.fill = () => color;
    }
    if (props.fontSize !== undefined) {
      const size = props.fontSize;
      this.fontSize = () => size;
    }
  }

  private localToParent(): Matrix2D {
    return new Matrix2D(1, 0, 0, 1, this.x, this.y);
  }

  public absoluteOpacity(): number {
    return (this.parentNode?.absoluteOpacity() ?? 1) * this.ownOpacity;
  }

  public localToWorld(): Matrix2D {
    const local = this.localToParent();
    return this.parentNode ? this.parentNode.localToWorld().mul(local) : local;
  }

  public localContentBBox(): BBox {
    return this.box;
  }

  public cacheBBox(): BBox {
    if (this.kids.length === 0) return this.box;
    const boxes = [
      this.box,
      ...this.kids.map(child =>
        BBox.fromPoints(
          ...child.cacheBBox().transformCorners(child.localToParent()),
        ),
      ),
    ];
    return BBox.fromBBoxes(...boxes);
  }

  public children(): readonly StubAuditNode[] {
    return this.kids;
  }

  public parent(): StubAuditNode | null {
    return this.parentNode;
  }

  /** Move this node in its parent's space, for frame-by-frame motion tests. */
  public moveTo(x: number, y: number): void {
    this.x = x;
    this.y = y;
  }
}

/** A straight-line stub satisfying {@link AuditableRoute}. */
export class StubAuditRoute implements AuditableRoute {
  public constructor(private readonly points: Vector2[]) {}

  public localToWorld(): Matrix2D {
    return new Matrix2D(1, 0, 0, 1, 0, 0);
  }

  public parsedPoints(): readonly Vector2[] {
    return this.points;
  }
}
