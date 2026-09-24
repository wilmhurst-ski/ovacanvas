import type {AuditableNode, AuditFinding, AuditItem} from '@ovacanvas/2d';
// Narrow, dependency-free subpaths, not the full `@ovacanvas/2d` barrel:
// that barrel's component graph (notably `Code.ts`) fails to initialize
// under jsdom, which would otherwise break every host-side test that
// imports this file, not just ones that touch theming.
import {collectMayTouchReasonErrors} from '@ovacanvas/2d/lib/audit/collisions';
import {findUnregisteredVisibleNodes} from '@ovacanvas/2d/lib/audit/coverage';
import {
  arrangeWithoutOverlap,
  type PlacementItem,
} from '@ovacanvas/2d/lib/layout/placement/arrangeWithoutOverlap';
import {theme} from '@ovacanvas/2d/lib/theme/theme';
import {BBox, Vector2} from '@ovacanvas/core';

/** The minimal signal surface a repairable node needs: a settable position. */
export interface RepairableNode {
  position(): Vector2;
  position(value: Vector2): void;
}

/** The minimal signal surface a repairable node needs: a settable fill. */
export interface RepairableFillNode {
  fill(): unknown;
  fill(value: string): void;
}

export interface RepairResult {
  readonly attempted: boolean;
  readonly changedIds: readonly string[];
}

const NUDGE_MARGIN = 4;
// A full grid scene (a chessboard's 32 pieces, say) can genuinely produce
// more than a handful of real per-pair findings in one pass, now that the
// implicit-containment fix (see `collisions.ts`) already filters out the
// container/content pairs that used to dominate this count (a border
// against every piece on the board) - the findings that remain here are
// the smaller set of genuine peer-to-peer overlaps actually worth nudging.
const MAX_COLLISIONS_TO_REPAIR = 48;
const MAX_SAFE_AREA_VIOLATIONS_TO_REPAIR = 24;

/**
 * Mechanically resolve the findings that have one unambiguous, meaning-
 * preserving fix, instead of asking for a full re-authoring round trip.
 *
 * @remarks
 * **The line this stays on one side of**: every repair here only ever moves
 * something already agreed to exist, or falls a color back to the theme's
 * own safe default. None of them decide whether a node is *allowed* to be
 * visible, none of them touch what a label says, and none of them translate
 * one notation into another - those all require understanding what content
 * *means*, which is exactly what a mechanical pass cannot safely guess. An
 * unregistered visible node, a plain-text equation, and a genuinely wrong
 * diagram all stay outside this function on purpose; see `README`/project
 * notes on this exact line if that boundary ever looks temptingly close to
 * move.
 *
 * Three finding types are handled, each with its own unambiguous fix:
 * - `collision`: push both items apart along the line between their centers.
 * - `safe-area`: nudge the one offending item back inside the nearest
 *   satisfiable safe area.
 * - `color-discipline`: fall every implicated node's fill back to the
 *   theme's own `ink` - the same safe default `Txt`/`Latex` already use when
 *   no color is given at all, just applied after the fact instead of never
 *   having been overridden.
 *
 * A re-authoring round trip is a real LLM call (seconds to minutes); this is
 * local arithmetic plus one re-render (milliseconds). Most observed failures
 * of these three shapes were small drift, not structurally wrong scenes, so
 * trying the cheap fix first is worth it before giving up on a candidate.
 */
export function attemptMechanicalRepair(
  items: readonly AuditItem[],
  findings: readonly AuditFinding[],
  safeArea: BBox | readonly BBox[] = [],
): RepairResult {
  const byId = new Map(items.map(item => [item.id, item]));
  const changed = new Set<string>();

  repairCollisions(byId, findings, changed);
  repairSafeAreaViolations(byId, findings, safeArea, changed);
  repairColorOveruse(items, findings, changed);

  return {attempted: changed.size > 0, changedIds: [...changed]};
}

/** Registered items with a real default halo (no `mayTouch`), so a later
 * re-evaluation still checks them for real - see
 * {@link autoRegisterUnregisteredNodes}'s own remarks on why this is not
 * the same thing as authorizing them to overlap anything. */
const AUTO_REGISTERED_HALO = 8;
// A real grid/table (an 8x8 chessboard alone is 64 squares) legitimately
// has far more unregistered nodes than the earlier limit of 16 allowed -
// that cap left most of a chessboard's squares still unregistered after
// one pass, so the very next re-evaluation failed on the exact same check
// it was supposed to fix. This is a safety valve against a genuinely
// pathological scene (a real bug generating thousands of nodes), not a
// limit on ordinary legitimate content.
const MAX_AUTO_REGISTERED_NODES = 256;

export interface AutoRegisterResult {
  readonly items: readonly AuditItem[];
  readonly addedIds: readonly string[];
}

/**
 * Complete the registry bookkeeping a scene forgot, not its content: every
 * node this finds is ALREADY visible and ALREADY rendering, exactly as the
 * scene's own code decided by adding it to `view` - the "should this exist"
 * call was already made by the LLM, not by this function. The only thing
 * missing is an audit item pointing at it, so an ordinary evaluation has
 * something to check it against.
 *
 * @remarks
 * This does NOT authorize the node to touch anything: it gets the same
 * default halo real hand-registered items get and no `mayTouch`, so a real
 * unauthorized overlap still fails the very next `evaluateVisualAudit` call,
 * exactly as it would have if the scene had remembered to register it
 * itself. That re-check is the caller's job, not this function's - this
 * only ever returns a bigger item list, never a verdict. `unregistered-node`
 * was observed as one of the most common reasons a real LLM-authored beat
 * needed a full re-authoring round trip (a stray label forgotten from a
 * second array, most often) for a mistake this function can close for free.
 */
export function autoRegisterUnregisteredNodes(
  root: AuditableNode,
  items: readonly AuditItem[],
): AutoRegisterResult | null {
  const offenders = findUnregisteredVisibleNodes(root, items).slice(
    0,
    MAX_AUTO_REGISTERED_NODES,
  );
  if (offenders.length === 0) return null;

  const addedIds = offenders.map(node => node.key);
  const newItems: AuditItem[] = offenders.map(node => ({
    id: node.key,
    node,
    halo: AUTO_REGISTERED_HALO,
  }));
  return {items: [...items, ...newItems], addedIds};
}

export interface MayTouchCleanupResult {
  readonly items: readonly AuditItem[];
  readonly changedIds: readonly string[];
}

/**
 * Drop every `mayTouch` entry whose stated reason is empty, instead of
 * failing the whole beat over a missing string.
 *
 * @remarks
 * `collectMayTouchReasonErrors` exists to catch a real, different problem: a
 * blanket allow-list broad enough to hide a genuine collision, with no
 * reason attached to make that suspicious on review. But the entries this
 * finds are, by definition, not doing their job as authorizations either -
 * an authorization the audit itself refuses to trust is not actually
 * authorizing anything. The safe response is exactly what would have
 * happened had the entry never been written: check that pair normally.
 * This can only ever ADD a check back, never remove one - a beat that was
 * genuinely relying on an empty-reason entry to hide a real overlap is
 * still caught, now by the real collision check instead of a technicality
 * about a missing string that told the model nothing about what to fix.
 */
export function dropEmptyMayTouchReasons(
  items: readonly AuditItem[],
): MayTouchCleanupResult | null {
  const reasonErrors = collectMayTouchReasonErrors(items);
  if (reasonErrors.length === 0) return null;

  const toDropByItemId = new Map<string, Set<string>>();
  for (const finding of reasonErrors) {
    const [itemId, targetId] = finding.entities;
    const targets = toDropByItemId.get(itemId) ?? new Set<string>();
    targets.add(targetId);
    toDropByItemId.set(itemId, targets);
  }

  const changedIds: string[] = [];
  const newItems = items.map(item => {
    const toDrop = toDropByItemId.get(item.id);
    if (!toDrop || !item.mayTouch) return item;

    const newMayTouch = new Map(item.mayTouch);
    let changed = false;
    for (const targetId of toDrop) {
      if (newMayTouch.delete(targetId)) changed = true;
    }
    if (!changed) return item;

    changedIds.push(item.id);
    return {...item, mayTouch: newMayTouch.size > 0 ? newMayTouch : undefined};
  });

  return {items: newItems, changedIds};
}

/**
 * Resolve every reported collision in one coherent pass, not one pair at a
 * time.
 *
 * @remarks
 * `arrangeWithoutOverlap` already exists in this engine for exactly this
 * geometry problem (an authoring-time placement primitive, built on
 * `forceRectCollide`) - reusing it here instead of hand-rolling a second,
 * separate overlap-resolution algorithm is the same principle as importing
 * `d3-force` in the first place rather than writing a physics simulation
 * from scratch: a well-tested solution to "arrange rects so none overlap,
 * staying close to each one's own desired position" already lived one
 * folder over.
 *
 * This also fixes a real structural gap the previous pairwise version had:
 * nudging finding 1's two items apart could push one of them into a THIRD
 * item involved in finding 2, silently undoing (or worsening) a fix that
 * hadn't even been attempted yet, since each pair was resolved in isolation
 * with no knowledge of the others. Solving every involved item's position
 * together, in one physics relaxation, is what makes N simultaneous
 * collisions - a densely-populated grid, say - converge to something
 * mutually consistent instead of a moving target.
 *
 * The size-vs-size behavior from the prior version (a small item colliding
 * with a much bigger one should be the one that moves) isn't reimplemented
 * here - `forceRectCollide`'s own collision response already splits each
 * correction by inverse area (`shareA = areaB / (areaA + areaB)`), the
 * identical formula the old pairwise code duplicated by hand.
 */
/**
 * Whether repair must leave this item where it is: declared `fixed`, or a
 * point-defined line. A line's `position()` only offsets its points, so
 * "nudging" a connector bound to two nodes detaches it from both - it moves
 * off its endpoints and collides with everything along its new path.
 */
function isPinned(item: AuditItem): boolean {
  if (item.fixed) return true;
  return (
    typeof (item.node as {parsedPoints?: unknown}).parsedPoints === 'function'
  );
}

function repairCollisions(
  byId: ReadonlyMap<string, AuditItem>,
  findings: readonly AuditFinding[],
  changed: Set<string>,
): void {
  const collisions = findings.filter(
    finding => finding.ruleId === 'collision' && finding.geometry,
  );
  if (collisions.length === 0) return;

  const involvedIds = new Set<string>();
  for (const finding of collisions.slice(0, MAX_COLLISIONS_TO_REPAIR)) {
    for (const id of finding.entities) involvedIds.add(id);
  }

  const repairableNodes = new Map<string, RepairableNode>();
  const placementItems: PlacementItem[] = [];
  for (const id of involvedIds) {
    const item = byId.get(id);
    if (!item) continue;
    const node = item.node as unknown as RepairableNode;
    if (typeof node.position !== 'function') continue;

    const pos = node.position();
    // `cacheBBox()` (local, transform-free) rather than a world-space box:
    // this only needs a relative size estimate for the collision response,
    // not exact screen bounds - skipping the transform pipeline keeps this
    // working for any real `AuditableNode` regardless of what it takes to
    // resolve one to world space.
    const box = item.node.cacheBBox();
    const pinned = isPinned(item);
    placementItems.push({
      id,
      x: pos.x,
      y: pos.y,
      width: box.width,
      height: box.height,
      fixed: pinned,
    });
    if (!pinned) repairableNodes.set(id, node);
  }

  // Nothing free to move means nothing mechanical can help.
  if (placementItems.length < 2 || repairableNodes.size === 0) return;

  const resolved = arrangeWithoutOverlap(placementItems);
  for (const placement of resolved) {
    const node = repairableNodes.get(placement.id);
    if (!node) continue;
    node.position(new Vector2(placement.x, placement.y));
    changed.add(placement.id);
  }
}

/**
 * The smallest displacement that brings `box` inside one of `areas`, or
 * `null` if it already fits (nothing to do) or no area was supplied.
 *
 * @remarks
 * A box may satisfy any one of several declared safe areas (see
 * `collectSafeAreaViolations`'s own remarks on why more than one can be
 * declared); the repair picks whichever area asks for the least movement,
 * so a box straddling two candidate areas doesn't get shoved further than
 * it needs to.
 */
function smallestSafeAreaNudge(
  box: BBox,
  areas: readonly BBox[],
): Vector2 | null {
  let best: Vector2 | null = null;
  for (const area of areas) {
    let dx = 0;
    let dy = 0;
    if (box.left < area.left) dx = area.left - box.left + NUDGE_MARGIN;
    else if (box.right > area.right) dx = area.right - box.right - NUDGE_MARGIN;
    if (box.top < area.top) dy = area.top - box.top + NUDGE_MARGIN;
    else if (box.bottom > area.bottom) {
      dy = area.bottom - box.bottom - NUDGE_MARGIN;
    }

    if (dx === 0 && dy === 0) continue;
    const candidate = new Vector2(dx, dy);
    if (!best || candidate.magnitude < best.magnitude) best = candidate;
  }
  return best;
}

function repairSafeAreaViolations(
  byId: ReadonlyMap<string, AuditItem>,
  findings: readonly AuditFinding[],
  safeArea: BBox | readonly BBox[],
  changed: Set<string>,
): void {
  const areas = Array.isArray(safeArea) ? safeArea : [safeArea];
  if (areas.length === 0) return;

  const violations = findings.filter(
    finding => finding.ruleId === 'safe-area' && finding.geometry,
  );

  for (const finding of violations.slice(
    0,
    MAX_SAFE_AREA_VIOLATIONS_TO_REPAIR,
  )) {
    const [id] = finding.entities;
    const item = byId.get(id);
    if (!item || isPinned(item)) continue;

    const node = item.node as unknown as RepairableNode;
    if (typeof node.position !== 'function') continue;

    const nudge = smallestSafeAreaNudge(finding.geometry!, areas);
    if (!nudge) continue;

    node.position(node.position().add(nudge));
    changed.add(item.id);
  }
}

function repairColorOveruse(
  items: readonly AuditItem[],
  findings: readonly AuditFinding[],
  changed: Set<string>,
): void {
  const finding = findings.find(f => f.ruleId === 'color-discipline');
  if (!finding) return;

  // `collectColorOveruse` is a closed-world check like
  // `collectPlainTextMathNotation`: it walks every node reachable from the
  // scene root, not just registered items, so its `entities` are real node
  // keys (`node.key`), not registered item ids - unlike collision/safe-area
  // findings, which name the item id a scene registered. A `Txt`'s internal
  // `TxtLeaf` child can appear here too (it independently satisfies
  // `text?()`), but it isn't a registered item and doesn't need its own
  // fix: `Txt.getDefaultFill` makes it inherit its parent's fill, so
  // correcting the registered parent corrects the leaf on the next render.
  const byKey = new Map(items.map(item => [item.node.key, item]));
  const ink = theme().ink;

  for (const key of finding.entities) {
    const item = byKey.get(key);
    if (!item) continue;

    const node = item.node as unknown as RepairableFillNode;
    if (typeof node.fill !== 'function') continue;

    node.fill(ink);
    changed.add(item.id);
  }
}
