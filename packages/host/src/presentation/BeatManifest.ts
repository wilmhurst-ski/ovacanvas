import type {AuditFinding, AuditItem, RouteItem, View2D} from '@ovacanvas/2d';
import type {BBox, ThreadGeneratorFactory} from '@ovacanvas/core';

/**
 * What a beat's own scene code hands the readiness gate once it has
 * rendered: the same things `evaluateVisualAudit` needs, sourced from the
 * beat's real nodes rather than hand-authored.
 */
export interface BeatAuditSpec {
  readonly items: readonly AuditItem[];
  /**
   * Any connector/arrow a beat draws as a route rather than a plain item, so
   * it gets real segment-vs-box collision checking instead of the check
   * silently running against nothing.
   *
   * @remarks
   * Optional: a beat with no arrows simply omits it. When present, the host
   * threads it into every `evaluateVisualAudit` call - including the
   * cross-frame re-check - so a route that only collides mid-animation is
   * caught the same way a static item's would be.
   */
  readonly routes?: readonly RouteItem[];
  readonly requiredIds: readonly string[];
  readonly safeArea: BBox | readonly BBox[];
  /**
   * Set when this beat displays text the author did not write.
   *
   * @remarks
   * Only the beats that echo the learner's own question need this - see
   * `RunAuditOptions.allowPlainTextMath` for why echoing is not authorship.
   * Everything generated leaves it unset, so the rule keeps catching the
   * mistake it was written for.
   */
  readonly allowPlainTextMath?: boolean;
}

/**
 * One beat: a scene generator plus the audit spec for its own content.
 *
 * @remarks
 * `buildAuditSpec` is called after the beat's view has rendered at least one
 * real frame (see `BeatAdapter.prepare`), so the nodes it references have
 * resolved layout and fonts. Keeping this on the beat rather than inferred by
 * the host is deliberate: only the beat's own code knows which of its nodes
 * are semantically the same drawn thing and therefore allowed to touch.
 */
export interface BeatManifest {
  readonly id: string;
  readonly title: string;
  readonly runner: ThreadGeneratorFactory<View2D>;
  buildAuditSpec(view: View2D): BeatAuditSpec;

  /**
   * An optional, non-blocking review of the beat's actual rendered frame -
   * the hook point for "genuine aesthetic judgment," e.g. handing the frame
   * to a vision-capable LLM to ask whether the layout actually reads well.
   *
   * @remarks
   * Deliberately not implemented anywhere in this package: which vision
   * provider to call, with what prompt and what credentials, is an
   * application decision, not something a shipped engine package should
   * hardcode or hold API keys for. This is the seam a host application
   * wires its own implementation into.
   *
   * `BeatAdapter` never awaits this before `markReady()` and never lets its
   * findings affect readiness, regardless of what severity they claim to
   * be - see its own remarks. A slow or failing vision call must never add
   * latency to, or block, a beat the geometry gate already accepted.
   */
  advisoryCheck?(frame: HTMLCanvasElement): Promise<readonly AuditFinding[]>;
}
