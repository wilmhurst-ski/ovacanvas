import type {BBox} from '@ovacanvas/core';
import {evaluateVisualAudit} from './report';
import type {
  AuditableNode,
  AuditFinding,
  AuditItem,
  AuditReport,
  RouteItem,
} from './types';

export interface StaticChecksAcrossFramesOptions {
  seek(frame: number): void | Promise<void>;
  render(): void | Promise<void>;
  frames: readonly number[];
  itemsAtFrame: (frame: number) => readonly AuditItem[];
  routes?: readonly RouteItem[];
  requiredIds: readonly string[];
  safeArea: BBox | readonly BBox[];
  root?: AuditableNode;
  /** Forwarded verbatim to every frame's audit - see `RunAuditOptions`. */
  allowPlainTextMath?: boolean;
}

/**
 * Run {@link evaluateVisualAudit} - the same static collision/coverage/
 * safe-area/unregistered-node check a beat's frame-0 readiness gate already
 * runs - at several more frames across the beat's own timeline, not just its
 * first.
 *
 * @remarks
 * A beat's readiness gate historically only ever audited the one frame it
 * happened to render for its own liveness check. A collision that only
 * exists mid-transition (two elements crossing paths, one animating past
 * another) was invisible to that check and would ship undetected - real
 * motion only became possible once `growThrough` existed, which is exactly
 * what makes this gap real rather than hypothetical.
 *
 * This owns the seek+render loop itself: there is no seek-less code path to
 * write, which is the exact bug class (a frame loop that samples without ever
 * calling seek) that shipped in lab 2.
 *
 * Deliberately reuses the plain `evaluateVisualAudit` check rather than
 * per-frame crossing authorization: a beat's own declared `mayTouch`
 * authorizations already apply for the whole beat, and requiring a beat to
 * additionally declare *which frames* a crossing is authorized for is real,
 * separate complexity - this function is the zero-authoring-effort baseline
 * every beat gets for free.
 *
 * (This used to cite `auditAcrossFrames` and `assertMotionFrame` as the
 * heavier alternative. Both were orphaned and have since been deleted, so the
 * references were pointing at nothing.)
 */
export async function auditStaticChecksAcrossFrames(
  options: StaticChecksAcrossFramesOptions,
): Promise<AuditReport> {
  const findings: AuditFinding[] = [];

  for (const frame of options.frames) {
    await options.seek(frame);
    await options.render();

    const report = evaluateVisualAudit({
      items: options.itemsAtFrame(frame),
      routes: options.routes ?? [],
      requiredIds: options.requiredIds,
      safeArea: options.safeArea,
      root: options.root,
      ...(options.allowPlainTextMath ? {allowPlainTextMath: true} : {}),
    });

    for (const finding of report.findings) {
      findings.push({
        ...finding,
        message: `[frame ${frame}] ${finding.message}`,
      });
    }
  }

  return {
    passed: findings.every(finding => finding.severity !== 'blocking'),
    findings,
  };
}
