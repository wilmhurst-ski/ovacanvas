import type {BBox} from '@ovacanvas/core';
import {collectCollisions, collectMayTouchReasonErrors} from './collisions';
import {collectColorOveruse} from './colorDiscipline';
import {collectCompositionFindings} from './composition';
import {collectCoverageGaps, collectUnregisteredVisibleNodes} from './coverage';
import {collectRouteCollisions} from './routes';
import {collectEmptyBounds, collectSafeAreaViolations} from './safeArea';
import {collectPlainTextMathNotation} from './textNotation';
import type {AuditItem, AuditReport, AuditableNode, RouteItem} from './types';
import {collectInvisibleRequiredItems} from './visibility';

export interface RunAuditOptions {
  readonly items: readonly AuditItem[];
  readonly routes?: readonly RouteItem[];
  readonly safeArea: BBox | readonly BBox[];
  readonly requiredIds: readonly string[];
  /**
   * The scene's root node. When provided, the audit also refuses visible
   * nodes that draw content but were never registered as an item — the
   * closed-world check that catches an unplanned entity a scene forgot to
   * gate on opacity. Omit only when auditing a fragment where a root isn't
   * meaningful (most unit tests); a readiness gate over a real scene should
   * always pass one.
   */
  readonly root?: AuditableNode;
  /**
   * Refuse a required item that is registered but draws nothing.
   *
   * @remarks
   * Off by default, and deliberately so: mid-timeline a required item may
   * legitimately be invisible while it fades in, and turning this on for a
   * cross-frame sample would fail every entrance-animated scene. Turn it on
   * for the frame a beat is actually presented on, where invisible required
   * content is unambiguously a blank canvas. See
   * {@link collectInvisibleRequiredItems}.
   */
  readonly requireVisibleIds?: boolean;
  /**
   * Allow plain-text mathematical notation in the scene's own text.
   *
   * @remarks
   * Off by default, because {@link collectPlainTextMathNotation} exists to
   * catch an *author* writing `x^2` in a `Txt` where a `Latex` node belongs -
   * and that is a real mistake this project has made.
   *
   * On, for a scene whose text the author did not write. The opener and the
   * fallback beat both restate the learner's question verbatim, so a learner
   * who types "solve x^2 - 5x + 6 = 0" - the way most people write it - was
   * having their *own* question used to refuse the beat that shows it to them,
   * and got an error instead of an explanation. The rule is about authored
   * content; echoing a question back is not authorship.
   */
  readonly allowPlainTextMath?: boolean;
  /**
   * Include the advisory composition checks.
   *
   * @remarks
   * Off by default because composition is a property of the *scene*, not of a
   * frame: running it inside a cross-frame sample would repeat the same
   * finding once per sampled frame. Turn it on for the readiness gate, which
   * is the one evaluation that describes the scene as a whole. These findings
   * are always `advisory` and so can never be the reason a beat is refused -
   * see `composition.ts`.
   */
  readonly includeComposition?: boolean;
}

/**
 * Runs every static geometry check and returns a structured report rather
 * than throwing on the first failure.
 *
 * @remarks
 * This is the primary API for a readiness gate: it needs to see every
 * finding to decide whether to repair, retry, or fall back, not stop at the
 * first thrown `Error`. {@link runVisualAudit} remains as a thin
 * throw-on-first-blocking-finding wrapper for direct test/script use.
 */
export function evaluateVisualAudit(options: RunAuditOptions): AuditReport {
  const findings = [
    ...collectCoverageGaps(options.items, options.requiredIds),
    ...(options.requireVisibleIds
      ? collectInvisibleRequiredItems(options.items, options.requiredIds)
      : []),
    ...collectMayTouchReasonErrors(options.items),
    ...collectEmptyBounds(options.items),
    ...collectCollisions(options.items),
    ...collectSafeAreaViolations(options.items, options.safeArea),
    ...collectRouteCollisions(options.routes ?? [], options.items),
    ...(options.root
      ? collectUnregisteredVisibleNodes(options.root, options.items)
      : []),
    ...(options.root && !options.allowPlainTextMath
      ? collectPlainTextMathNotation(options.root)
      : []),
    ...(options.root ? collectColorOveruse(options.root) : []),
    ...(options.includeComposition
      ? collectCompositionFindings(options.items, options.safeArea)
      : []),
  ];
  return {
    passed: findings.every(finding => finding.severity !== 'blocking'),
    findings,
  };
}

export function runVisualAudit(options: RunAuditOptions): void {
  const report = evaluateVisualAudit(options);
  const blocking = report.findings.find(
    finding => finding.severity === 'blocking',
  );
  if (blocking) throw new Error(blocking.message);
}
