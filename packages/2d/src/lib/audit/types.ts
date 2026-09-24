import type {BBox, PossibleMatrix2D, Vector2} from '@ovacanvas/core';

/**
 * The minimal node surface the audit needs, satisfied structurally by
 * {@link Node}.
 *
 * @remarks
 * Kept narrow so audit geometry can be unit tested against stub nodes with no
 * scene, canvas or document, mirroring {@link PickableNode} in the
 * interaction layer.
 */
export interface AuditableNode {
  readonly key: string;
  cacheBBox(): BBox;
  /**
   * The region the node really covers, when that is tighter than its
   * render cache (text pads its cache by half an em each side for glyph
   * overhang). Local space, like {@link cacheBBox}.
   */
  auditBBox?(): BBox;
  localContentBBox(): BBox;
  localToWorld(): PossibleMatrix2D;
  absoluteOpacity(): number;
  children(): readonly AuditableNode[];
  parent(): AuditableNode | null;
  /**
   * Present only on plain-text-bearing nodes (`Txt` and its subclasses,
   * including `AnchoredLabel`) - real `Txt.text` already has exactly this
   * shape, so this is satisfied structurally with no change to `Node`.
   * Absent on `Latex` (whose content signal is `tex`, not `text`), which is
   * what lets {@link collectPlainTextMathNotation} tell the two apart.
   */
  text?(): string;
  /**
   * Present only on `Latex` and its subclasses (including `AnchoredLatex`) -
   * real `Latex.tex` already has exactly this shape. Lets a check that cares
   * about *either* text-bearing or math-bearing content (unlike
   * {@link collectPlainTextMathNotation}, which deliberately wants only one)
   * reach both without depending on either component's module.
   */
  tex?(): string | readonly string[];
  /**
   * Present on any node with a real fill signal (`Shape` and everything
   * built on it, including `Txt` and `Latex`) - real `Shape.fill` already
   * has exactly this shape. Untyped beyond "present or absent" so this
   * module never needs to import `Color`/`Gradient`/`Pattern` from
   * `partials`; a check that cares what kind of value it got performs its
   * own narrowing.
   */
  fill?(): unknown;
  /**
   * Present on text/math nodes (`Txt`, `Latex`, etc.) - real `Layout.fontSize`
   * is a signal returning the pixel font size.
   */
  fontSize?(): number;
  /**
   * Present only on `Circle` - real `Circle.startAngle`/`Circle.endAngle`
   * already have exactly this shape. A full circle (the default 0-360) has
   * this at `0`; lets a check that cares whether something is a genuine
   * full circle (as opposed to an arc/sector, or a non-circular shape) tell
   * the difference without importing `Circle` itself.
   */
  startAngle?(): number;
  /** {@inheritDoc AuditableNode.startAngle} */
  endAngle?(): number;
  /**
   * Present only on `Line` and its subclasses - real `Line.parsedPoints()`
   * already has exactly this shape (the same method {@link AuditableRoute}
   * already relies on for the separate route-crossing check). Lets a check
   * that cares whether something is a genuine thin polyline (as opposed to
   * a filled/stroked area shape, whose bounding box is a much closer match
   * for what it actually occupies) tell the difference without importing
   * `Line` itself.
   */
  parsedPoints?(): readonly Vector2[];
}

/**
 * The minimal route surface the audit needs, satisfied structurally by
 * {@link Line}.
 */
export interface AuditableRoute {
  localToWorld(): PossibleMatrix2D;
  parsedPoints(): readonly Vector2[];
}

export type CheckSeverity = 'blocking' | 'advisory';

/**
 * A registered contact authorization. Every entry carries a reason so a
 * blanket allow-list reads as suspicious in review rather than disappearing
 * into a bare id list. `'*'` authorizes contact against every other item
 * (the "board may touch anything" case), still with a reason attached.
 */
export type MayTouch = ReadonlyMap<string, string>;

export interface AuditItem {
  readonly id: string;
  readonly node: AuditableNode;
  readonly halo: number;
  readonly mayTouch?: MayTouch;
  /** Defaults to `node.absoluteOpacity() > threshold` when omitted. */
  readonly isVisible?: () => boolean;
  /**
   * The node's position is load-bearing - authored geometry (a figure's
   * vertex) or derived from other nodes (a connector bound to its
   * endpoints, a label anchored to its target) - so mechanical repair must
   * never move it. It still counts as an obstacle: repair moves whatever it
   * collides with instead.
   */
  readonly fixed?: boolean;
}

export interface RouteItem {
  readonly id: string;
  readonly route: AuditableRoute;
  readonly halo: number;
  readonly mayCross?: MayTouch;
}

export interface AuditFinding {
  readonly ruleId: string;
  readonly severity: CheckSeverity;
  readonly entities: readonly string[];
  readonly geometry?: BBox;
  readonly message: string;
}

export interface AuditReport {
  readonly passed: boolean;
  readonly findings: readonly AuditFinding[];
}

export const DEFAULT_VISIBLE_OPACITY_THRESHOLD = 0.01;

export function isItemVisible(
  item: Pick<AuditItem, 'node' | 'isVisible'>,
  threshold = DEFAULT_VISIBLE_OPACITY_THRESHOLD,
): boolean {
  return item.isVisible?.() ?? item.node.absoluteOpacity() > threshold;
}

/**
 * A registered domain readiness check.
 *
 * @remarks
 * Core geometry checks (collision, safe area, routes, coverage) register
 * with `domain: 'core'` and are always `blocking`. A domain-specific check
 * (map label placement, 3D framing) registers its own domain name; the
 * registry decides at run time whether that domain's checks stay blocking,
 * get downgraded to advisory, or are refused outright, based on the
 * domain's declared maturity. See `CheckerRegistry` in `@ovacanvas/host`.
 */
export interface ReadinessCheck<TInput = unknown> {
  readonly id: string;
  readonly domain: string;
  readonly severity: CheckSeverity;
  readonly appliesTo?: (input: TInput) => boolean;
  run(input: TInput): readonly AuditFinding[];
}
