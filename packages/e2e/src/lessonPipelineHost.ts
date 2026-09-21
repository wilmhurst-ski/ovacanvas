import type {AuditItem, AuditReport} from '@ovacanvas/2d';
import {Rect, Txt, evaluateVisualAudit, makeScene2D} from '@ovacanvas/2d';
import {BBox, waitFor} from '@ovacanvas/core';
import {
  BeatPresentation,
  Lesson,
  LessonHost,
  attemptMechanicalRepair,
  createFallbackBeat,
  createHarmonicOscillatorBeat,
  resolveBeatSource,
  type BeatAuditSpec,
  type BeatManifest,
} from '@ovacanvas/host';

/**
 * A real browser fixture for the lesson pipeline's gate-audited staging
 * claim: `LessonHost.stage()` -\> `BeatStagingCoordinator` -\>
 * `TransitionOwner` -\> `BeatAdapter.prepare()` -\> render -\>
 * `evaluateVisualAudit` -\> mechanical repair -\> `markReady()`.
 *
 * @remarks
 * Deliberately NOT a jsdom unit test. `BeatAdapter` imports the full
 * `@ovacanvas/2d` barrel, which does not initialize under jsdom, and the
 * whole point of the claim under test is that a real audit reads real
 * rendered geometry - a mocked canvas would verify nothing. This page
 * exposes `window.ovcLesson` for a Playwright test to drive, the same
 * browser-exposed-object pattern `contractEvidenceHost.ts` uses.
 *
 * `SAFE_AREA` is in canvas space (origin top-left, 1920x1080), which is the
 * space `worldBBox()` reports in - not the centre-origin space a node's own
 * `position` prop uses.
 */
const SAFE_AREA = new BBox(60, 60, 1800, 960);
const INK = '#151922';

export type BeatKind =
  | 'overlap'
  | 'overlap-unrepairable'
  | 'fixed'
  | 'repairable'
  | 'coverage-gap'
  | 'advisory'
  | 'simulation';

/**
 * Big enough that mechanical repair provably cannot resolve the overlap:
 * `attemptMechanicalRepair` hands `arrangeWithoutOverlap` each item's real,
 * *unexpanded* size, so it separates two 79px-tall labels by ~160px - which
 * clears `halo: 0` and even `halo: 30`, but not two 60px halos (79 + 120).
 * Measured against this fixture's own probe output, not assumed.
 */
const UNREPAIRABLE_HALO = 60;

function twoLabelBeat(
  id: string,
  title: string,
  positions: readonly (readonly [number, number])[],
  halo: number,
): BeatManifest {
  let alpha: Txt;
  let beta: Txt;

  const runner = makeScene2D(function* (view) {
    alpha = new Txt({
      text: 'Alpha',
      fontSize: 64,
      fill: INK,
      position: [positions[0][0], positions[0][1]],
    });
    beta = new Txt({
      text: 'Beta',
      fontSize: 64,
      fill: INK,
      position: [positions[1][0], positions[1][1]],
    });
    view.add([alpha, beta]);
    yield* waitFor(1);
  }).config;

  const buildAuditSpec = (): BeatAuditSpec => ({
    items: [
      {id: 'alpha', node: alpha as never, halo},
      {id: 'beta', node: beta as never, halo},
    ],
    requiredIds: ['alpha', 'beta'],
    safeArea: SAFE_AREA,
  });

  return {id, title, runner, buildAuditSpec};
}

/**
 * Two rectangles whose real boxes overlap by 50px - a genuine collision that
 * `arrangeWithoutOverlap` has an unambiguous, meaning-preserving fix for.
 */

function twoRectBeat(
  id: string,
  title: string,
  xs: readonly [number, number],
): BeatManifest {
  let left: Rect;
  let right: Rect;

  const runner = makeScene2D(function* (view) {
    left = new Rect({width: 200, height: 120, fill: INK, position: [xs[0], 0]});
    right = new Rect({
      width: 200,
      height: 120,
      fill: INK,
      position: [xs[1], 0],
    });
    view.add([left, right]);
    yield* waitFor(1);
  }).config;

  const buildAuditSpec = (): BeatAuditSpec => ({
    items: [
      {id: 'left', node: left as never, halo: 0},
      {id: 'right', node: right as never, halo: 0},
    ],
    requiredIds: ['left', 'right'],
    safeArea: SAFE_AREA,
  });

  return {id, title, runner, buildAuditSpec};
}

/**
 * A beat that declares a required id it never registers - a real coverage
 * gap, and the clearest case of a finding no mechanical pass can repair (the
 * missing thing does not exist to be moved).
 */
function coverageGapBeat(id: string, title: string): BeatManifest {
  let heading: Txt;

  const runner = makeScene2D(function* (view) {
    heading = new Txt({
      text: 'Heading',
      fontSize: 56,
      fill: INK,
      position: [0, 0],
    });
    view.add(heading);
    yield* waitFor(1);
  }).config;

  const buildAuditSpec = (): BeatAuditSpec => ({
    items: [{id: 'heading', node: heading as never, halo: 10}],
    requiredIds: ['heading', 'never_registered'],
    safeArea: SAFE_AREA,
  });

  return {id, title, runner, buildAuditSpec};
}

/**
 * A clean, audit-passing beat whose advisory check reports a finding and
 * *claims* it is blocking.
 *
 * @remarks
 * The claim is the point. `BeatManifest.advisoryCheck` is the seam a host
 * wires a vision review into, and a misbehaving or misconfigured review must
 * never be able to retroactively fail a beat the geometry gate already
 * accepted - so `BeatAdapter` forces every advisory finding to
 * `severity: 'advisory'` regardless of what it says about itself. This
 * fixture lies, and the host must not believe it.
 */
function advisoryBeat(id: string, title: string): BeatManifest {
  let label: Txt;

  const runner = makeScene2D(function* (view) {
    label = new Txt({
      text: 'Reviewed',
      fontSize: 56,
      fill: INK,
      position: [0, 0],
    });
    view.add(label);
    yield* waitFor(1);
  }).config;

  const buildAuditSpec = (): BeatAuditSpec => ({
    items: [{id: 'label', node: label as never, halo: 10}],
    requiredIds: ['label'],
    safeArea: SAFE_AREA,
  });

  return {
    id,
    title,
    runner,
    buildAuditSpec,
    advisoryCheck: async () => [
      {
        ruleId: 'vision-layout',
        severity: 'blocking',
        entities: [],
        message: 'a vision review that wrongly believes it can block',
      },
    ],
  };
}

function buildBeat(kind: BeatKind): BeatManifest {
  switch (kind) {
    case 'overlap':
      return twoLabelBeat(
        'overlap',
        'Two labels on top of each other',
        [
          [0, 0],
          [0, 0],
        ],
        0,
      );
    case 'overlap-unrepairable':
      return twoLabelBeat(
        'overlap-unrepairable',
        'Two labels whose halos overlap beyond repair',
        [
          [0, 0],
          [0, 0],
        ],
        UNREPAIRABLE_HALO,
      );
    case 'fixed':
      return twoLabelBeat(
        'fixed',
        'Two labels genuinely apart',
        [
          [-400, 0],
          [400, 0],
        ],
        0,
      );
    case 'repairable':
      return twoRectBeat(
        'repairable',
        'Two rects drifting into each other',
        [0, 150],
      );
    case 'coverage-gap':
      return coverageGapBeat(
        'coverage-gap',
        'A beat missing a required registration',
      );
    case 'advisory':
      return advisoryBeat(
        'advisory',
        'A clean beat with an opinionated review',
      );
    case 'simulation':
      return createHarmonicOscillatorBeat(
        'sim-oscillator',
        'Damped Harmonic Oscillator',
      );
  }
}

function summarize(presentation: BeatPresentation | null) {
  if (!presentation) return null;
  return {
    beatId: presentation.manifest.id,
    ready: presentation.ready,
    visible: presentation.isVisible,
    renderCount: presentation.renderCount,
    disposeCount: presentation.disposeCount,
    opacity: presentation.opacity,
  };
}

/**
 * Drives the real `LessonHost` from the browser. Every method returns a
 * plain-JSON snapshot so a Playwright `page.evaluate` can marshal it back.
 */
export class LessonPipelineHarness {
  public readonly container: HTMLDivElement;
  public host: LessonHost | null = null;
  public lesson: Lesson<BeatPresentation> | null = null;

  public constructor() {
    // Reuse the page's own container rather than creating a second element
    // with the same id: the page's is the one the stylesheet sizes and
    // centres, and a duplicate id makes any locator for it ambiguous.
    const existing = document.getElementById('lesson');
    if (existing) {
      this.container = existing as HTMLDivElement;
      return;
    }
    this.container = document.createElement('div');
    this.container.id = 'lesson';
    document.body.append(this.container);
  }

  public boot(question: string): Promise<unknown> {
    this.lesson?.dispose();
    this.lesson = null;
    this.host?.dispose();
    this.host = new LessonHost('lesson', question, this.container);
    return this.host
      .start()
      .then(result => ({result, snapshot: this.snapshot()}));
  }

  public async startLesson(
    kinds: BeatKind[],
    options?: {transitionDurationMs?: number},
  ): Promise<unknown> {
    this.lesson?.dispose();
    this.host?.dispose();
    this.host = new LessonHost(
      'lesson',
      'Multi-beat Lesson',
      this.container,
      options,
    );
    const beats = kinds.map((k, i) => {
      const b = buildBeat(k);
      return {...b, id: `${b.id}-${i}`};
    });
    this.lesson = this.host.createLesson(beats);
    const result = await this.lesson.start();
    return {
      result,
      snapshot: this.snapshot(),
      lessonStatus: this.lesson.status(),
    };
  }

  public async advanceLesson(): Promise<unknown> {
    if (!this.lesson) throw new Error('startLesson() has not been called');
    const result = await this.lesson.advance();
    return {
      result,
      snapshot: this.snapshot(),
      lessonStatus: this.lesson.status(),
    };
  }

  public async exploreLesson(
    kind: BeatKind,
    question?: string,
  ): Promise<unknown> {
    if (!this.lesson) throw new Error('startLesson() has not been called');
    const beat = buildBeat(kind);
    const explorationBeat = {...beat, id: `exploration-${beat.id}`};
    const result = await this.lesson.explore(explorationBeat, {question});
    return {
      result,
      snapshot: this.snapshot(),
      lessonStatus: this.lesson.status(),
    };
  }

  public async abandonExploration(): Promise<unknown> {
    if (!this.lesson) throw new Error('startLesson() has not been called');
    const result = await this.lesson.abandonExploration();
    return {
      result,
      snapshot: this.snapshot(),
      lessonStatus: this.lesson.status(),
    };
  }

  public async commitExploration(question?: string): Promise<unknown> {
    if (!this.lesson) throw new Error('startLesson() has not been called');
    const result = await this.lesson.commitExploration({question});
    return {
      result,
      snapshot: this.snapshot(),
      lessonStatus: this.lesson.status(),
    };
  }

  public getTransitionOpacities(): {
    current: {beatId: string; opacity: number} | null;
    outgoing: {beatId: string; opacity: number} | null;
  } {
    const host = this.requireHost();
    return {
      current: host.current
        ? {beatId: host.current.manifest.id, opacity: host.current.opacity}
        : null,
      outgoing: host.outgoing
        ? {beatId: host.outgoing.manifest.id, opacity: host.outgoing.opacity}
        : null,
    };
  }

  public getScrubberState(): unknown {
    return this.host?.scrubber?.getState() ?? null;
  }

  public async scrubToRatio(ratio: number): Promise<void> {
    const host = this.requireHost();
    const scrubber = host.scrubber;
    if (!scrubber) throw new Error('Scrubber is not present on host');
    scrubber.seekToRatio(ratio);
    const current = host.current;
    if (current) {
      for (let i = 0; i < 6; i++) {
        await current.renderOnce();
        await new Promise(resolve => setTimeout(resolve, 60));
      }
    }
  }

  public async startScrub(ratio = 0.5): Promise<void> {
    const host = this.requireHost();
    const scrubber = host.scrubber;
    if (!scrubber) throw new Error('Scrubber is not present on host');
    const rect = scrubber.trackElement.getBoundingClientRect();
    const clientX = rect.left + rect.width * ratio;
    scrubber.trackElement.dispatchEvent(
      new PointerEvent('pointerdown', {clientX, pointerId: 1, bubbles: true}),
    );
  }

  public async moveScrub(ratio: number): Promise<void> {
    const host = this.requireHost();
    const scrubber = host.scrubber;
    if (!scrubber) throw new Error('Scrubber is not present on host');
    const rect = scrubber.trackElement.getBoundingClientRect();
    const clientX = rect.left + rect.width * ratio;
    window.dispatchEvent(
      new PointerEvent('pointermove', {clientX, pointerId: 1, bubbles: true}),
    );
  }

  public async endScrub(): Promise<void> {
    const host = this.requireHost();
    const scrubber = host.scrubber;
    if (!scrubber) throw new Error('Scrubber is not present on host');
    window.dispatchEvent(
      new PointerEvent('pointerup', {clientX: 0, pointerId: 1, bubbles: true}),
    );
  }

  public async stage(kind: BeatKind): Promise<unknown> {
    const host = this.requireHost();
    const result = await host.stage({beat: buildBeat(kind)});
    return {result, snapshot: this.snapshot()};
  }

  /**
   * The browser half of the authoring chain: take a compiled beat module and
   * drive it all the way to the visible stage.
   *
   * @remarks
   * The compiled text arrives as a string because that is the real interface
   * between the two halves of this pipeline - a Node process compiles (it has
   * `ts.sys` and the installed `@ovacanvas/*` declarations), the browser
   * resolves (it has one live engine instance and a DOM).
   */
  public async stageSource(
    id: string,
    title: string,
    code: string,
  ): Promise<unknown> {
    const host = this.requireHost();
    let manifest: BeatManifest;
    try {
      manifest = await resolveBeatSource(id, title, code);
    } catch (error) {
      return {
        resolved: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    const result = await host.stage({beat: manifest});
    const snapshot = this.snapshot();
    if (result.ok) host.activate();
    return {resolved: true, result, snapshot, after: this.snapshot()};
  }

  /**
   * Stage the host-authored fallback beat - what a caller puts up when
   * authoring has run out of road. Needs no model, so it is verifiable
   * unconditionally.
   */
  public async stageFallback(question: string): Promise<unknown> {
    const host = this.requireHost();
    const result = await host.stage({beat: createFallbackBeat(question)});
    return {result, snapshot: this.snapshot()};
  }

  public activate(): unknown {
    const host = this.requireHost();
    return {result: host.activate(), snapshot: this.snapshot()};
  }

  public retireOutgoing(): unknown {
    const host = this.requireHost();
    return {result: host.retireOutgoing(), snapshot: this.snapshot()};
  }

  /**
   * Render one fixture's beat directly and report what the raw audit sees
   * before any repair, what repair changed, and the verdict afterwards.
   *
   * @remarks
   * `stage()` alone cannot distinguish "this geometry never collided" from
   * "it collided and the mechanical pass fixed it" - both end in `ok: true`.
   * This exposes the intermediate state so a test can assert the fixture is
   * exercising the branch it claims to.
   */
  public async probe(kind: BeatKind): Promise<unknown> {
    const beat = buildBeat(kind);
    const presentation = new BeatPresentation(beat);
    try {
      const rendered = await presentation.renderOnce();
      const spec = beat.buildAuditSpec(presentation.view);
      const items: readonly AuditItem[] = spec.items;
      const positions = () =>
        items.map(item => {
          const node = item.node as unknown as {
            position?: () => {x: number; y: number};
          };
          const position = node.position?.();
          return position
            ? {id: item.id, x: position.x, y: position.y}
            : {id: item.id};
        });

      const before = evaluateVisualAudit({
        items,
        routes: spec.routes ?? [],
        safeArea: spec.safeArea,
        requiredIds: spec.requiredIds,
        root: presentation.view,
      });
      const beforePositions = positions();
      const repair = attemptMechanicalRepair(
        items,
        before.findings,
        spec.safeArea,
      );
      const afterPositions = positions();
      if (repair.attempted) {
        const rerendered = await presentation.renderOnce();
        if (!rerendered) {
          return {rendered, before, repair, note: 'rerender failed'};
        }
      }
      const after = evaluateVisualAudit({
        items,
        routes: spec.routes ?? [],
        safeArea: spec.safeArea,
        requiredIds: spec.requiredIds,
        root: presentation.view,
      });
      return {
        rendered,
        before: {
          passed: before.passed,
          findings: before.findings.map(f => f.message),
        },
        repair,
        beforePositions,
        afterPositions,
        after: {
          passed: after.passed,
          findings: after.findings.map(f => f.message),
        },
      };
    } finally {
      presentation.dispose();
    }
  }

  /**
   * Where the currently-visible beat's own registered items actually sit
   * right now, read from the live view - so a test can assert that what was
   * rendered is the repaired geometry, not just that `passed` came back true.
   */
  public currentBeatPositions(): unknown {
    const host = this.requireHost();
    const current = host.current;
    if (!current) return null;
    const spec = current.manifest.buildAuditSpec(current.view);
    return spec.items.map(item => {
      const node = item.node as unknown as {
        position?: () => {x: number; y: number};
      };
      const position = node.position?.();
      return position
        ? {id: item.id, x: position.x, y: position.y}
        : {id: item.id};
    });
  }

  /**
   * Run the real audit against the currently-visible beat exactly as it
   * stands now - the check that tells "the gate approved this" apart from
   * "what is on screen actually passes".
   */
  public auditCurrent(): unknown {
    const host = this.requireHost();
    const current = host.current;
    if (!current) return null;
    const spec = current.manifest.buildAuditSpec(current.view);
    const report = evaluateVisualAudit({
      items: spec.items,
      routes: spec.routes ?? [],
      safeArea: spec.safeArea,
      requiredIds: spec.requiredIds,
      root: current.view,
    });
    return {
      passed: report.passed,
      findings: report.findings.map(f => f.message),
    };
  }

  /** Where the visible beat's playhead currently is, and whether it is moving. */
  public playbackState(): unknown {
    const current = this.requireHost().current;
    if (!current) return null;
    return {
      isPlaying: current.isPlaying,
      frame: current.player.playback.frame,
      duration: current.player.playback.duration,
      renderCount: current.renderCount,
    };
  }

  /**
   * Stop the visible beat on its resting frame.
   *
   * @remarks
   * A playing beat is a moving target, so anything that needs to inspect or
   * capture one specific frame - an ink check, a screenshot - has to freeze it
   * first, and freeze it at the frame the readiness gate actually judged.
   */
  public async freezeAtRest(): Promise<unknown> {
    const current = this.requireHost().current;
    if (!current) return null;

    current.pause();
    // Seeking back to the first frame is what makes a capture deterministic,
    // and it is safe: a backward seek re-runs the scene generator, which is
    // exactly the case that used to break a `Latex` node. That defect is fixed
    // (`Latex`'s constructor now builds its document while a scene context is
    // guaranteed present), so this doubles as a live check that it stays
    // fixed.
    const scene = current.player.playback.currentScene as unknown as {
      firstFrame: number;
    };
    current.player.requestSeek(scene.firstFrame);

    // Then render until the geometry actually exists. `Latex` typesets
    // asynchronously, so the frame immediately after a seek can still have
    // zero-sized bounds; that is a transient state a playing beat passes
    // through unnoticed.
    let settled = false;
    const settleDeadline = Date.now() + 5000;
    while (!settled && Date.now() < settleDeadline) {
      await current.renderOnce();
      settled =
        (this.auditCurrent() as {passed: boolean} | null)?.passed === true;
      if (!settled) await new Promise(resolve => setTimeout(resolve, 40));
    }
    return {...(this.playbackState() as object), settled};
  }

  /**
   * Per-item geometry as the live view currently reports it.
   *
   * @remarks
   * A diagnostic, kept because "the audit says empty-bounds" and "the node is
   * actually empty" are different facts and only this tells them apart.
   */
  public inspectCurrent(): unknown {
    const current = this.requireHost().current;
    if (!current) return null;
    const spec = current.manifest.buildAuditSpec(current.view);
    const view = current.view as unknown as {children(): readonly unknown[]};
    const reachable = new Set<unknown>();
    const walk = (node: unknown) => {
      reachable.add(node);
      const children = (
        node as {children?: () => readonly unknown[]}
      ).children?.();
      for (const child of children ?? []) walk(child);
    };
    walk(view);

    return spec.items.map(item => {
      const node = item.node as unknown as {
        cacheBBox(): {width: number; height: number};
        absoluteOpacity(): number;
        position?: () => {x: number; y: number};
        // Present on an `SVG`/`Latex` node: the raw markup its document is
        // parsed from. Its length is what separates "the computed returned
        // nothing" from "the document was built from something real".
        svg?: () => string;
        tex?: () => unknown;
      };
      const box = node.cacheBBox();
      let svgLength: number | null = null;
      try {
        const markup = node.svg?.();
        svgLength = typeof markup === 'string' ? markup.length : null;
      } catch {
        svgLength = -1;
      }
      let texValue: unknown = null;
      try {
        texValue = node.tex?.() ?? null;
      } catch {
        texValue = 'threw';
      }
      // Force the SVG document to evaluate. `parseSVG` is protected, but
      // `getChildrenById` is public and calls it, so this is the one way to
      // find out from outside whether building the document throws (a
      // swallowed error) or succeeds and yields a zero-size document (a
      // parsing problem).
      let documentProbe: unknown = null;
      if (typeof node.svg === 'function') {
        try {
          const probe = node as unknown as {
            getChildrenById?: (id: string) => unknown;
            width?: () => number;
            height?: () => number;
          };
          probe.getChildrenById?.('__probe__');
          documentProbe = {
            ok: true,
            width: probe.width?.(),
            height: probe.height?.(),
          };
        } catch (error) {
          documentProbe = {
            ok: false,
            error:
              error instanceof Error
                ? error.message.slice(0, 160)
                : String(error),
          };
        }
      }
      return {
        id: item.id,
        width: Math.round(box.width),
        height: Math.round(box.height),
        opacity: Number(node.absoluteOpacity().toFixed(3)),
        attachedToLiveView: reachable.has(item.node),
        ...(svgLength === null ? {} : {svgLength}),
        ...(texValue === null
          ? {}
          : {tex: JSON.stringify(texValue).slice(0, 60)}),
        ...(documentProbe === null ? {} : {document: documentProbe}),
      };
    });
  }

  /**
   * The visible beat's last logged error, if any.
   *
   * @remarks
   * `Player.request()` wraps scene stepping in try/catch and routes anything
   * thrown to the project's logger, so a scene that throws while rendering
   * produces no rejection and no visible exception - it just renders nothing.
   * Reading this is the only way to tell "it threw" from "it drew an empty
   * frame".
   */
  public lastError(): unknown {
    return this.requireHost().current?.lastError ?? null;
  }

  /**
   * Seek the visible beat's playhead, then render until it settles.
   *
   * @remarks
   * Exists to reproduce the backward-seek case deliberately: a backward seek
   * re-executes the scene generator, which is the condition that breaks a
   * `Latex` node.
   */
  public async seekTo(frame: number): Promise<unknown> {
    const current = this.requireHost().current;
    if (!current) return null;
    current.player.requestSeek(frame);
    for (let i = 0; i < 6; i++) {
      await current.renderOnce();
      await new Promise(resolve => setTimeout(resolve, 60));
    }
    return {
      playback: this.playbackState(),
      items: this.inspectCurrent(),
      lastError: this.lastError(),
    };
  }

  /** The most recent audit report, whatever generation it belongs to. */
  public lastReport(): unknown {
    const reports = this.reports() as Record<number, unknown>;
    const generations = Object.keys(reports).map(Number);
    if (generations.length === 0) return null;
    return reports[Math.max(...generations)];
  }

  /** Every audit report the adapter has retained, keyed by generation. */
  public reports(): Record<number, AuditReport> {
    const host = this.requireHost();
    const out: Record<number, AuditReport> = {};
    for (let generation = 0; generation <= 40; generation++) {
      const report = host.lastReportFor(generation);
      if (report) out[generation] = report;
    }
    return out;
  }

  public attemptsFor(beatId: string): number {
    return this.requireHost().attemptsFor(beatId);
  }

  public snapshot(): unknown {
    const host = this.requireHost();
    const status = host.status();
    return {
      ...status,
      attemptsForOverlap: host.attemptsFor('overlap'),
      canvasesInSlot: this.container.querySelectorAll('canvas').length,
      slotChildren: host.stageSlot.children.length,
      current: summarize(host.current),
      outgoing: summarize(host.outgoing),
      lessonStatus: this.lesson?.status() ?? null,
      scrubber: host.scrubber?.getState() ?? null,
    };
  }

  private requireHost(): LessonHost {
    if (!this.host) throw new Error('boot() has not been called');
    return this.host;
  }
}

declare global {
  interface Window {
    ovcLesson: LessonPipelineHarness;
  }
}

window.ovcLesson = new LessonPipelineHarness();
