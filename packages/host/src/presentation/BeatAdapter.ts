import {
  auditStaticChecksAcrossFrames,
  evaluateVisualAudit,
  transitionSampleFrames,
  validateChoreographyPlan,
  type AuditFinding,
  type AuditItem,
  type AuditReport,
} from '@ovacanvas/2d/lib/audit';
import {loadEngineFonts} from '@ovacanvas/2d/lib/theme/fonts';
import type {
  PreparationContext,
  PresentationAdapter,
} from '@ovacanvas/core/lib/internal';
import type {ChunkRequest} from '../lesson/ChunkRequest';
import type {LessonState} from '../lesson/LessonState';
import type {BeatAuditSpec} from './BeatManifest';
import {BeatPresentation} from './BeatPresentation';
import {
  attemptMechanicalRepair,
  autoRegisterUnregisteredNodes,
  dropEmptyMayTouchReasons,
} from './repair';

import {TransitionDriver} from './TransitionDriver';

export interface BeatAdapterOptions {
  /** Visual crossfade transition duration in milliseconds. Defaults to 300ms. */
  readonly transitionDurationMs?: number;
  readonly onTransitionComplete?: (
    incoming: BeatPresentation,
    outgoing: BeatPresentation | null,
  ) => void;
  readonly transitionDriver?: TransitionDriver;
}

/**
 * Bounds `recalculate()`/render cost per attempt and keeps enough slack in
 * a beat's own playtime for the *next* beat to finish cooking behind it.
 */
const MAX_BEAT_SECONDS = 6;

/**
 * The one-time second chance for a beat that timed out with no error and no
 * stuck async work - genuinely heavy content, not a broken scene. Well
 * above `BeatPresentation.renderOnce`'s own 6s default, so this only fires
 * for a scene meaningfully past the ordinary budget, not one a few
 * milliseconds short of it.
 */
const EXTENDED_RENDER_TIMEOUT_MS = 15000;

/**
 * How many times the geometry guard may re-apply a mechanical repair to one
 * beat before giving up on it converging - a loop breaker, not a budget real
 * content ever approaches (one re-application is the observed norm).
 */
const MAX_GEOMETRY_REAPPLICATIONS = 8;

/**
 * Builds a beat offstage and gates its readiness on a real audit of its own
 * rendered output.
 *
 * @remarks
 * This is where the failure this whole package exists to fix gets closed:
 * `context.markReady()` is called only after `evaluateVisualAudit` reports a
 * pass over the beat's actual post-render geometry. A beat's own scene code
 * never calls `markReady` itself and never sees the capability before
 * activation, so it cannot fake or skip this - the same way a lab 2-style
 * scene that games its own collision checks could still ship, but a scene
 * that fails *this* gate simply never reaches `TransitionOwner.activate()`.
 * `TransitionOwner.stage` refuses with `'not-ready'` and disposes the
 * candidate on its own; the currently active beat is never touched.
 */
export class BeatAdapter
  implements PresentationAdapter<LessonState, BeatPresentation, ChunkRequest>
{
  /** The most recent audit report per generation, for callers to inspect a refusal. */
  public readonly lastReport = new Map<number, AuditReport>();
  /**
   * Each generation's first audit, before any mechanical repair ran. When a
   * beat is refused this is what explains it: the final report describes
   * the scene after repair has already moved things.
   */
  public readonly initialReport = new Map<number, AuditReport>();

  public readonly transitionDriver: TransitionDriver;
  private readonly onTransitionComplete?: (
    incoming: BeatPresentation,
    outgoing: BeatPresentation | null,
  ) => void;

  /**
   * The live geometry guard for each prepared beat, plus the disposer that
   * removes it. See {@link guardGeometry}.
   */
  private readonly guards = new Map<BeatPresentation, () => void>();

  public constructor(
    private readonly stageSlot: HTMLElement,
    options: BeatAdapterOptions = {},
  ) {
    this.transitionDriver =
      options.transitionDriver ??
      new TransitionDriver({durationMs: options.transitionDurationMs ?? 300});
    this.onTransitionComplete = options.onTransitionComplete;
  }

  public async prepare(
    context: PreparationContext<LessonState>,
    request: ChunkRequest,
  ): Promise<BeatPresentation> {
    let presentation: BeatPresentation | null = null;
    try {
      if (request.beat.choreographyPlan) {
        validateChoreographyPlan(request.beat.choreographyPlan);
      }

      // Text lays out against the engine's own font, on every machine -
      // so it must be able to draw before the scene is built.
      await loadEngineFonts();
      presentation = new BeatPresentation(request.beat);
      presentation.capability = context.capability;

      // Readiness is a real rendered frame, not a returned constructor.
      let rendered = await presentation.renderOnce();
      if (
        !rendered &&
        !presentation.lastError &&
        !presentation.hasPendingAsyncWork()
      ) {
        // No logged error and nothing genuinely stuck - the scene is doing
        // real work (many nodes, many Latex/MathJax layouts) that just
        // didn't finish inside the default budget. A stuck scene (real
        // pending async work) would never be helped by more time and isn't
        // worth spending it on; this case might be, so it gets exactly one
        // real second chance before this becomes a re-authoring round trip -
        // local wall-clock time is far cheaper than a whole LLM call.
        rendered = await presentation.renderOnce(EXTENDED_RENDER_TIMEOUT_MS);
      }
      if (!rendered) {
        // A logged error is the scene's own fault and is already actionable.
        // The harder case is the silent timeout: name the engine's prime
        // suspect (a hang on unsettled async work vs. a genuinely oversized
        // scene) so the retry feedback can point at the real defect.
        const cause = presentation.lastError
          ? `: ${presentation.lastError}`
          : ` (no error was logged - ${presentation.describeUnrenderedState()})`;
        throw new Error(`Beat ${request.beat.id} never rendered${cause}`);
      }
      if (context.isCancelled()) return presentation;

      const activePresentation = presentation;
      const spec = assertAuditSpec(
        request.beat.buildAuditSpec(activePresentation.view),
        request.beat.id,
      );

      // `buildAuditSpec()` is authored to read live module-scope closures
      // (e.g. `squares.map(...)`), not to return a frozen snapshot - so
      // calling it again after the view changes naturally picks up
      // whatever the scene's own bookkeeping currently says, including
      // after a seek forces the scene's generator to re-run and replace
      // every node it built with fresh instances (a `Player` seek backward
      // past its current position re-executes the generator from scratch -
      // confirmed by direct observation - which invalidates any item list
      // that was captured once and reused, since the old items still point
      // at the now-detached previous generation's nodes). Re-deriving items
      // fresh from the CURRENT `presentation.view` on every single
      // evaluation, rather than computing them once and reusing that
      // snapshot, is what makes registration keep matching reality across
      // those regenerations. `autoRegisterUnregisteredNodes` and
      // `dropEmptyMayTouchReasons` are folded in here too, so every caller
      // gets all three fixes for free and never touches a stale items array.
      const buildFreshItems = (): readonly AuditItem[] => {
        const fresh = request.beat.buildAuditSpec(
          activePresentation.view,
        ).items;
        const registered = autoRegisterUnregisteredNodes(
          activePresentation.view,
          fresh,
        );
        const cleaned = dropEmptyMayTouchReasons(
          registered ? registered.items : fresh,
        );
        return cleaned ? cleaned.items : registered ? registered.items : fresh;
      };

      let items: readonly AuditItem[] = buildFreshItems();
      let report = evaluateVisualAudit({
        items,
        routes: spec.routes ?? [],
        safeArea: spec.safeArea,
        requiredIds: spec.requiredIds,
        root: presentation.view,
        ...(spec.allowPlainTextMath ? {allowPlainTextMath: true} : {}),
      });
      report = withDurationFinding(report, presentation);
      this.lastReport.set(context.generation, report);
      this.initialReport.set(context.generation, report);

      // A re-authoring round trip is a real LLM call (seconds); nudging a
      // node apart from a neighbor plus one re-render is local
      // (milliseconds). Try the cheap fix before giving up on the
      // candidate - most observed failures of this shape were a few pixels
      // of drift, not a structurally wrong scene. (Missing registration is
      // no longer handled here - `buildFreshItems` above already closes
      // that gap before this check ever runs.)
      if (!report.passed && !context.isCancelled()) {
        const repair = attemptMechanicalRepair(
          items,
          report.findings,
          spec.safeArea,
        );
        if (repair.attempted) {
          const rerendered = await presentation.renderOnce();
          if (rerendered && !context.isCancelled()) {
            items = buildFreshItems();
            report = evaluateVisualAudit({
              items,
              routes: spec.routes ?? [],
              safeArea: spec.safeArea,
              requiredIds: spec.requiredIds,
              root: presentation.view,
              ...(spec.allowPlainTextMath ? {allowPlainTextMath: true} : {}),
            });
            report = withDurationFinding(report, presentation);
            this.lastReport.set(context.generation, report);
          }
        }
      }

      // Frame 0 alone can't see a collision that only exists mid-transition
      // (two elements crossing paths partway through a `growThrough` call,
      // say) - sample the rest of the beat's own timeline with the same
      // static check before declaring it ready.
      if (report.passed && !context.isCancelled()) {
        const motionReport = await this.sampleMotion(
          presentation,
          buildFreshItems,
          spec,
        );
        if (!motionReport.passed) {
          report = {
            passed: false,
            findings: [...report.findings, ...motionReport.findings],
          };
        }
        this.lastReport.set(context.generation, report);

        // A resting-position nudge changes where a node sits for the WHOLE
        // beat, not just the frame the collision was caught at - unlike the
        // frame-0 repair above, fixing this can't be checked by re-running
        // the same single evaluation, it has to re-sample the whole
        // timeline again to confirm the nudge didn't just relocate the
        // overlap to a different frame. Cheap to try anyway: still local
        // arithmetic plus a handful of re-renders, not a new LLM call.
        if (!report.passed && !context.isCancelled()) {
          items = buildFreshItems();
          const repair = attemptMechanicalRepair(
            items,
            report.findings,
            spec.safeArea,
          );
          if (repair.attempted) {
            const rerendered = await presentation.renderOnce();
            if (rerendered && !context.isCancelled()) {
              items = buildFreshItems();
              let retried = evaluateVisualAudit({
                items,
                safeArea: spec.safeArea,
                requiredIds: spec.requiredIds,
                root: presentation.view,
                ...(spec.allowPlainTextMath ? {allowPlainTextMath: true} : {}),
              });
              retried = withDurationFinding(retried, presentation);
              if (retried.passed) {
                const retriedMotion = await this.sampleMotion(
                  presentation,
                  buildFreshItems,
                  spec,
                );
                if (!retriedMotion.passed) {
                  retried = {
                    passed: false,
                    findings: [...retried.findings, ...retriedMotion.findings],
                  };
                }
              }
              report = retried;
              this.lastReport.set(context.generation, report);
            }
          }
        }
      }

      // `sampleMotion` above leaves the playhead back at the beat's first
      // frame, and a backward seek re-executes the scene generator from
      // scratch (see that method's own remarks) - which replaces every node
      // a mechanical repair moved with a fresh instance at its AUTHORED
      // position. The verdict reached so far therefore describes geometry
      // that is no longer on screen: without this, a beat whose collision was
      // repaired would still activate showing the colliding layout. Re-derive
      // the items from the view as it actually is now, re-run the frame-0
      // gate, and re-apply the repair if the regenerated geometry collides
      // again. The repair is deterministic, so re-applying it lands on the
      // same positions the motion sampling above already approved - which is
      // what keeps that earlier verdict valid rather than stale.
      if (report.passed && !context.isCancelled()) {
        const scene = presentation.player.playback
          .currentScene as unknown as SceneWithDuration;
        // Force the regeneration to happen NOW rather than after the verdict:
        // seeking backwards re-executes the generator synchronously, so the
        // re-derivation below reads the nodes that will actually be on screen.
        presentation.player.requestSeek(scene.firstFrame);
        await presentation.renderOnce();
        if (!context.isCancelled()) {
          items = buildFreshItems();
          let settled = this.evaluateFrameZero(presentation, items, spec);
          if (!settled.passed) {
            const repair = attemptMechanicalRepair(
              items,
              settled.findings,
              spec.safeArea,
            );
            if (repair.attempted && (await presentation.renderOnce())) {
              items = buildFreshItems();
              settled = this.evaluateFrameZero(presentation, items, spec);
            }
          }
          report = settled;
          this.lastReport.set(context.generation, report);
        }
      }

      if (report.passed && !context.isCancelled()) {
        this.guardGeometry(presentation, buildFreshItems, spec);
        presentation.ready = true;
        context.markReady();

        // Fired, never awaited: an LLM vision call can take seconds, and its
        // findings must never add latency to a beat the geometry gate
        // already accepted, nor ever affect whether it activates - see
        // `BeatManifest.advisoryCheck`'s own remarks.
        if (request.beat.advisoryCheck) {
          void this.runAdvisoryCheck(
            context.generation,
            request.beat.advisoryCheck,
            presentation,
          );
        }
      }
      // On a failing report: do not mark ready. The candidate is refused and
      // disposed by `TransitionOwner.stage` on its own; nothing here has to
      // decide that, and the learner never sees a beat that failed its own
      // audit.
      return presentation;
    } catch (error) {
      if (presentation) presentation.dispose();
      throw error;
    }
  }

  /**
   * Make incoming presentation visible and begin playback, crossfading from outgoing.
   *
   * @remarks
   * Smooth crossfade driven by TransitionDriver: incoming fades from 0 to 1
   * while outgoing fades from 1 to 0 over `transitionDurationMs` (default 300ms).
   * Upon crossfade completion, `onTransitionComplete` fires to retire outgoing.
   * Under interruption mid-flight, TransitionDriver cancels cleanly and cleans
   * up the interrupted outgoing presentation.
   */
  public activate(
    incoming: BeatPresentation,
    outgoing: BeatPresentation | null,
  ): void {
    this.stageSlot.append(incoming.container);
    this.transitionDriver.startTransition(incoming, outgoing, () => {
      this.onTransitionComplete?.(incoming, outgoing);
    });
  }

  public dispose(presentation: BeatPresentation): void {
    this.guards.get(presentation)?.();
    this.guards.delete(presentation);
    presentation.dispose();
  }

  public disposeAdapter(): void {
    this.transitionDriver.dispose();
  }

  /**
   * Keep re-asserting an approved beat's geometry for as long as it lives.
   *
   * @remarks
   * This closes a real, reproduced gap. The engine re-executes a scene's
   * generator more than once - while recalculating the timeline, while
   * sampling frames, and again around activation - and every execution
   * reassigns the beat's module-scope node variables to brand-new nodes built
   * at their AUTHORED positions. A mechanical repair applied during `prepare`
   * is therefore silently discarded, and the beat goes on screen showing the
   * very collision the gate approved a fix for. Observed directly, before
   * this guard existed: two rects repaired from a 51px overlap back to their
   * authored coordinates, with a live `evaluateVisualAudit` over the visible
   * beat reporting the collision again - a beat the gate had called ready.
   *
   * A one-shot re-check at any single moment cannot close this, because the
   * regeneration is asynchronous and was measured landing after both
   * `prepare` resolved and the beat had been activated. So the guard watches
   * every render instead, which catches the regeneration whenever it happens.
   * The repair is deterministic, so re-applying it lands on the same
   * positions the audit already approved rather than inventing new ones, and
   * a render that passes is left alone.
   *
   * Bounded by `MAX_GEOMETRY_REAPPLICATIONS`: the convergence this relies on
   * (`regenerate -> collide -> repair -> pass`) is real, but a beat whose
   * geometry never converges must not spin the render loop forever.
   */
  private guardGeometry(
    presentation: BeatPresentation,
    rebuild: () => readonly AuditItem[],
    spec: BeatAuditSpec,
  ): void {
    if (this.guards.has(presentation)) return;
    let reapplications = 0;
    const dispose = presentation.player.onRender.subscribe(async () => {
      if (presentation.disposeCount > 0) return;

      // Only the beat's RESTING frame is gate material. A beat plays on a
      // loop, and mid-playback frames legitimately contain transient overlaps
      // (two elements crossing) and items still fading in - judging those with
      // the frame-0 gate would report both as defects and "repair" an
      // animation that is working exactly as authored.
      const scene = presentation.player.playback
        .currentScene as unknown as SceneWithDuration;
      if (Math.round(presentation.player.playback.frame) !== scene.firstFrame) {
        return;
      }
      if (reapplications >= MAX_GEOMETRY_REAPPLICATIONS) return;

      const items = rebuild();
      const report = this.evaluateFrameZero(presentation, items, spec);
      if (report.passed) {
        // The cap bounds *consecutive* failing repairs, not a lifetime total.
        // A looping beat legitimately needs one repair per cycle, because
        // looping seeks backward and a backward seek re-runs the scene
        // generator - so a lifetime counter would silently stop protecting the
        // beat after a handful of loops.
        reapplications = 0;
        return;
      }

      const repair = attemptMechanicalRepair(
        items,
        report.findings,
        spec.safeArea,
      );
      if (!repair.attempted) return;

      reapplications++;
      presentation.player.requestRender();
      presentation.player.wake();
    });
    this.guards.set(presentation, dispose);
  }

  /**
   * The frame-0 gate as a single call: the same static checks plus the
   * beat-duration finding, against whatever `items` currently describe.
   */
  private evaluateFrameZero(
    presentation: BeatPresentation,
    items: readonly AuditItem[],
    spec: BeatAuditSpec,
  ): AuditReport {
    return withDurationFinding(
      evaluateVisualAudit({
        items,
        routes: spec.routes ?? [],
        safeArea: spec.safeArea,
        requiredIds: spec.requiredIds,
        root: presentation.view,
        // A beat that echoes the learner's own words takes the same exemption
        // in the cross-frame sample as in the frame-0 gate. Applying it in
        // only one place would have left the opener failing on "x^2" exactly
        // as before, just later in `prepare`.
        ...(spec.allowPlainTextMath ? {allowPlainTextMath: true} : {}),
        // Every other check skips items that draw nothing, so without this a
        // scene whose required nodes are all at opacity 0 passes the whole
        // gate and shows the learner an empty canvas. Only the frame-0 gate
        // asks for it: mid-timeline, an invisible item may simply be fading
        // in, and the cross-frame sampler must not flag that.
        requireVisibleIds: true,
        // Advisory only, and so unable to refuse anything. Collected here
        // because composition describes the scene rather than a frame, and
        // left in the report for a caller to act on - a beat that is
        // collision-free but badly composed still ships, and the finding is
        // the material a re-authoring pass would work from.
        includeComposition: true,
      }),
      presentation,
    );
  }

  /**
   * Sample the beat's own timeline (past frame 0) with the same static
   * check, so a collision that only exists mid-transition (two elements
   * crossing paths partway through a `growThrough` call, say) doesn't slip
   * through a frame-0-only check. Always leaves the playhead back at the
   * beat's own first frame before returning - a beat is inert once shown
   * (no auto-play driver yet), so whatever frame sampling last left the
   * player on is what would be displayed if this didn't reset it.
   */
  private async sampleMotion(
    presentation: BeatPresentation,
    buildFreshItems: () => readonly AuditItem[],
    spec: BeatAuditSpec,
  ): Promise<AuditReport> {
    const scene = presentation.player.playback
      .currentScene as unknown as SceneWithDuration;
    const sampleFrames = transitionSampleFrames(
      scene.firstFrame,
      scene.lastFrame,
    ).filter(frame => frame !== scene.firstFrame);
    if (sampleFrames.length === 0) return {passed: true, findings: []};

    // `itemsAtFrame` is called fresh after every seek+render (see
    // `auditStaticChecksAcrossFrames`'s own implementation) precisely so a
    // scene that regenerates its own nodes on seek doesn't get checked
    // against a stale item list from before the seek - `buildFreshItems`
    // re-derives the registry from whatever the view actually looks like
    // right now, every time this is called.
    const motionReport = await auditStaticChecksAcrossFrames({
      seek: frame => presentation.player.requestSeek(frame),
      render: async () => {
        await presentation.renderOnce();
      },
      frames: sampleFrames,
      itemsAtFrame: () => buildFreshItems(),
      routes: spec.routes ?? [],
      requiredIds: spec.requiredIds,
      safeArea: spec.safeArea,
      root: presentation.view,
      ...(spec.allowPlainTextMath ? {allowPlainTextMath: true} : {}),
    });
    presentation.player.requestSeek(scene.firstFrame);
    await presentation.renderOnce();
    return motionReport;
  }

  /**
   * Runs a beat's `advisoryCheck` after the fact and folds its findings into
   * `lastReport`, forcing `severity: 'advisory'` on every one of them
   * regardless of what the check itself claims - a misbehaving or
   * misconfigured advisory check must not be able to retroactively fail a
   * beat that already activated. A late-arriving report is still useful to a
   * caller: it can log it, surface it for the next authoring round, or feed
   * it into a repair-retry loop, none of which this package prescribes.
   */
  private async runAdvisoryCheck(
    generation: number,
    advisoryCheck: (
      frame: HTMLCanvasElement,
    ) => Promise<readonly AuditFinding[]>,
    presentation: BeatPresentation,
  ): Promise<void> {
    let findings: readonly AuditFinding[];
    try {
      findings = await advisoryCheck(presentation.canvas);
    } catch (error) {
      presentation.project.logger.error({
        message: 'Beat advisory check failed',
        remarks: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    if (findings.length === 0 || presentation.disposeCount > 0) return;

    const current = this.lastReport.get(generation);
    if (!current) return;
    this.lastReport.set(generation, {
      ...current,
      findings: [
        ...current.findings,
        ...findings.map(finding => ({
          ...finding,
          severity: 'advisory' as const,
        })),
      ],
    });
  }
}

interface SceneWithDuration {
  readonly firstFrame: number;
  readonly lastFrame: number;
}

/**
 * Fold a `beat-duration` finding into the report when the beat's own
 * recalculated length exceeds `MAX_BEAT_SECONDS`.
 *
 * @remarks
 * Not a geometry check, so it doesn't belong in `@ovacanvas/2d`'s
 * `audit` module - it needs the `Player`-recalculated scene length, which
 * only exists once a `Player` is involved. Blocking, not advisory: an
 * overlong beat isn't mechanically repairable (nothing here can shorten a
 * scene's own animation), and letting it through would eat the playtime
 * slack the next beat needs to finish cooking behind it.
 */
function withDurationFinding(
  report: AuditReport,
  presentation: BeatPresentation,
): AuditReport {
  const scene = presentation.player.playback
    .currentScene as unknown as SceneWithDuration;
  const fps = presentation.player.playback.fps;
  const seconds = (scene.lastFrame - scene.firstFrame) / fps;
  if (seconds <= MAX_BEAT_SECONDS) return report;

  const finding: AuditFinding = {
    ruleId: 'beat-duration',
    severity: 'blocking',
    entities: [],
    message: `Beat runs ${seconds.toFixed(1)}s, over the ${MAX_BEAT_SECONDS}s cap`,
  };
  return {passed: false, findings: [...report.findings, finding]};
}

/**
 * Check a beat's own audit spec before the gate consumes it.
 *
 * @remarks
 * A beat's `buildAuditSpec` is **compiled but never type-checked** against
 * `BeatAuditSpec` - the source is model-generated and only has to compile, so
 * nothing verifies the shape it returns. A spec missing `requiredIds` used to
 * reach the audit and die as
 * `Cannot read properties of undefined (reading 'filter')`, and that string is
 * exactly what the retry loop feeds back to the model as feedback. The model
 * cannot act on it, so the attempt is spent and the next one repeats the same
 * mistake.
 *
 * Naming the missing field turns an unactionable attempt into a fixable one,
 * which is the whole point of a retry loop that re-asks rather than retrying
 * blindly.
 */
function assertAuditSpec(spec: BeatAuditSpec, beatId: string): BeatAuditSpec {
  const missing: string[] = [];
  if (!Array.isArray(spec?.items)) missing.push('items');
  if (!Array.isArray(spec?.requiredIds)) missing.push('requiredIds');
  if (spec?.safeArea === undefined) missing.push('safeArea');
  if (missing.length > 0) {
    throw new Error(
      `Beat ${beatId}: buildAuditSpec() did not return ${missing.join(', ')}. ` +
        'It must return {items, requiredIds, safeArea} - requiredIds lists the ' +
        'item ids the audit must find, and safeArea is the region content must ' +
        'stay inside.',
    );
  }
  return spec;
}
