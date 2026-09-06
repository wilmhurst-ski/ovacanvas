import type {InteractionPolicy, PointerSessionView} from '@ovacanvas/2d';
import {
  Circle,
  InteractionController,
  InteractionReadout,
  InteractionTargets,
  Line,
  PointerDispatcher,
  Rect,
  Scene2D,
  View2D,
  makeScene2D,
} from '@ovacanvas/2d';
import type {
  FullSceneDescription,
  Project,
  ThreadGeneratorFactory,
  Versions,
} from '@ovacanvas/core';
import {
  DynamicalSystem,
  MetaFile,
  Player,
  Stage,
  Vector2,
  bootstrap,
  createEffect,
  waitFor,
} from '@ovacanvas/core';
import type {PreparationContext} from '@ovacanvas/core/lib/internal';
import {TransitionOwner} from '@ovacanvas/core/lib/internal';
import compiledProject from '../learner/project?project';
import type {
  LearnerCapability,
  LearnerGeneration,
  LearnerState,
} from '../learner/runtimeState';
import {
  AcceptedRate,
  LearnerBinding,
  LearnerStore,
  decayModel,
  registerBinding,
  sampleFor,
} from '../learner/runtimeState';
import type {FlatOutcome} from './learnerHost';
import {flatten} from './learnerHost';

export const Size = 320;

/** Counts every animation frame any runtime asks for. */
export const rafLedger = {requested: 0, fired: 0};

const NativeRaf = window.requestAnimationFrame.bind(window);
window.requestAnimationFrame = (callback: FrameRequestCallback) => {
  rafLedger.requested++;
  return NativeRaf((time: number) => {
    rafLedger.fired++;
    callback(time);
  });
};

/**
 * Which construction route a candidate presentation is built through.
 *
 * @remarks
 * `compiled` is the route every previous proof used: a project object the
 * bundler produced from a `?project` import. `runtime` is the route under
 * test. `runtime-broken` is the same runtime route handed material that is
 * not a usable presentation.
 */
export type CandidateKind = 'compiled' | 'runtime' | 'runtime-broken';

/**
 * Package versions a runtime-built project reports.
 *
 * @remarks
 * `bootstrap` stores these on the project and nothing in the runtime reads
 * them back - the only consumer in this repository is the editor's version
 * footer. They exist so the editor can warn about mismatched packages, not so
 * the runtime can work.
 */
const RuntimeVersions: Versions = {
  core: 'runtime-spike',
  two: 'runtime-spike',
  ui: null,
  vitePlugin: null,
};

/**
 * The runtime construction route under test.
 *
 * @remarks
 * This is what the `?project` module would otherwise have been generated to
 * do. Everything it uses is an ordinary exported runtime value:
 *
 * - `makeScene2D` builds a scene description around a generator, including
 *   the scene metadata `createSceneMetadata` produces;
 * - `name` is the one field the `?scene` transform supplies that the runtime
 *   actually needs, and it is donor bookkeeping - the scene's own label, used
 *   for node keys and thread names. It is *not* semantic identity;
 * - `onReplaced` is deliberately omitted. It is the hot-reload channel, and
 *   `Player` subscribes to it optionally;
 * - the meta files are constructed with no backing source, which `MetaFile`
 *   supports: metadata stays in memory and is never written anywhere;
 * - `plugins` is empty, so no editor plugin and not even `DefaultPlugin`
 *   participates.
 *
 * @remarks
 * NON-NORMATIVE. This is a capability proof, not a compiler API, not an
 * authoring surface and not a serialization format. Nothing about its shape,
 * naming or granularity is frozen.
 */
export function buildRuntimeProject(
  name: string,
  runner: ThreadGeneratorFactory<View2D>,
): Project {
  const description = {
    ...makeScene2D(runner),
    name,
  } as unknown as FullSceneDescription<ThreadGeneratorFactory<View2D>>;

  return bootstrap(
    name,
    RuntimeVersions,
    [],
    {scenes: [description]},
    new MetaFile(`${name}.project`),
    new MetaFile(`${name}.settings`),
  );
}

/**
 * The same runtime route handed material that is not a presentation.
 *
 * @remarks
 * A project with no scenes. This is the narrowest natural failure the runtime
 * route exposes: the bundler would never emit it, so it is exactly the class
 * of mistake runtime construction newly makes possible.
 */
export function buildBrokenRuntimeProject(name: string): Project {
  return bootstrap(
    name,
    RuntimeVersions,
    [],
    {scenes: []},
    new MetaFile(`${name}.project`),
    new MetaFile(`${name}.settings`),
  );
}

/**
 * Candidate B's content, assembled at runtime.
 *
 * @remarks
 * Materially different from the compiled learner scene: a circle whose radius
 * is the derived sample instead of a bar whose width is, a line and a second
 * annotation that the compiled scene has no equivalent of, and neither of the
 * compiled scene's `offset` or `readout` targets.
 *
 * The runner closes over its binding directly. The compiled scene cannot do
 * that - a module the bundler compiled has no way to reach a host object, so
 * it looks its binding up through a registry. That difference is a property
 * of runtime construction, not a requirement of it.
 */
function runtimeRunner(
  binding: LearnerBinding,
): ThreadGeneratorFactory<View2D> {
  return function* (view) {
    // The derived response: a radius, where the compiled scene used a width.
    const response = new Circle({
      x: -70,
      y: -90,
      size: () => 40 + binding.displaySample() * 240,
      fill: '#c0603a',
    });
    // The continuing identity, in a presentation that looks nothing like A.
    const rateHandle = new Rect({
      x: () => (binding.displayRate() - 1.5) * 100,
      y: 40,
      width: 60,
      height: 60,
      fill: '#e6d17a',
      radius: 2,
    });
    // New material with no counterpart in A.
    const vector = new Line({
      points: [[-130, 130], () => [-130 + binding.displayRate() * 90, 130]],
      stroke: '#5fd0a0',
      lineWidth: 10,
    });
    const annotation = new Rect({
      x: 110,
      y: -150,
      width: 90,
      height: 28,
      fill: '#7f8fd6',
      radius: 3,
    });

    view.add(response);
    view.add(rateHandle);
    view.add(vector);
    view.add(annotation);

    binding.bindTarget('rate', rateHandle);
    binding.bindTarget('vector', vector);
    binding.bindTarget('annotation', annotation);

    yield* waitFor(1);
  };
}

/**
 * What a learner may do with each semantic target.
 *
 * @remarks
 * `rate` continues from A with the permissions it already had. `vector` and
 * `annotation` are new identities this fixture declares; nothing about the
 * production permission model changed to accommodate them.
 */
const Policy: InteractionPolicy = {
  readout: {inspect: true},
  offset: {inspect: true, explore: true},
  rate: {inspect: true, explore: true, commit: true},
  vector: {inspect: true},
  annotation: {inspect: true},
};

const wait = (ms: number) =>
  new Promise<void>(resolve => setTimeout(resolve, ms));

function hashCanvas(stage: Stage) {
  const {data} = stage.context.getImageData(0, 0, Size, Size);
  let hash = 2166136261;
  for (let i = 0; i < data.length; i += 4) {
    hash ^=
      data[i] | (data[i + 1] << 8) | (data[i + 2] << 16) | (data[i + 3] << 24);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export interface RuntimeBuiltEvent {
  kind: string;
  target: string | null;
  ok: boolean;
  reason: string | null;
}

/**
 * One presentation, built through whichever construction route it was asked
 * for, carrying the accepted production surfaces unchanged.
 */
export class Presentation {
  public readonly project: Project;
  public readonly stage: Stage;
  public readonly player: Player;
  public readonly targets: InteractionTargets;
  public readonly controller: InteractionController<LearnerState>;
  public readonly dispatcher: PointerDispatcher<LearnerState>;
  public readonly binding: LearnerBinding;
  public readonly container: HTMLElement;

  public renderCount = 0;
  public ready = false;
  public disposeCount = 0;
  public lastInspection: unknown = null;
  public events: RuntimeBuiltEvent[] = [];

  public get openExploration(): number | null {
    return this.controller.hasActiveExploration ? this.openedId : null;
  }
  private openedId: number | null = null;

  private previewSystem: DynamicalSystem | null = null;
  private readonly readout: InteractionReadout<LearnerState>;
  private readonly disposers: Array<() => void> = [];
  private settle: (() => void) | null = null;

  public constructor(
    public readonly name: string,
    public readonly kind: CandidateKind,
    public readonly generation: number,
    public readonly capability: LearnerCapability,
    binding: LearnerBinding,
    targets: InteractionTargets,
    private readonly runtime: RuntimeBuiltRuntime,
  ) {
    this.binding = binding;
    this.targets = targets;

    // Construction first, so material that is not a presentation fails before
    // this object owns a stage, a canvas or anything attached to the document.
    if (kind === 'compiled') {
      this.project = compiledProject;
    } else if (kind === 'runtime') {
      this.project = buildRuntimeProject(
        `ovc-runtime-${name}`,
        runtimeRunner(binding),
      );
    } else {
      this.project = buildBrokenRuntimeProject(`ovc-broken-${name}`);
    }

    this.player = new Player(
      this.project,
      {size: new Vector2(Size, Size), resolutionScale: 1, fps: 30},
      {paused: true, loop: false, muted: true},
      0,
    );

    this.stage = new Stage();
    this.stage.configure({
      size: new Vector2(Size, Size),
      resolutionScale: 1,
      background: '#101216',
    });
    const canvas = this.stage.finalBuffer;
    canvas.style.opacity = '1';

    this.container = document.createElement('div');
    this.container.className = 'presentation';
    this.container.dataset.presentation = name;
    this.container.append(canvas);

    const scene = this.player.playback.currentScene;
    // Only the compiled scene needs the registry: it cannot close over a host.
    if (kind === 'compiled') registerBinding(scene, binding);

    this.controller = new InteractionController<LearnerState>({
      capability,
      read: () => runtime.store.read(),
      valueOf: (target, state) =>
        target === 'offset' ? state.offset : state.rate,
      apply: (draft, target, value) => {
        if (target === 'offset') draft.offset = value;
        else draft.rate = value;
      },
      describe: (target, state) => ({
        target,
        label: state.label,
        rate: state.rate,
        revision: runtime.store.revision,
      }),
      policy: Policy,
    });

    this.readout = new InteractionReadout<LearnerState>(this.controller);
    binding.displayRate = () => this.readout.valueFor('rate');
    binding.displayOffset = () => this.readout.valueFor('offset');
    binding.displaySample = () => this.currentSample();

    this.disposers.push(
      scene.onReset.subscribe(() => {
        binding.beginReconstruction();
        this.controller?.resolveActive('reset');
      }),
    );

    this.disposers.push(
      this.player.onRender.subscribe(async () => {
        if (this.disposeCount > 0) return;
        await this.stage.render(
          this.player.playback.currentScene,
          this.player.playback.previousScene,
        );
        this.renderCount++;
        this.player.sleep();
        const settle = this.settle;
        this.settle = null;
        settle?.();
      }),
    );

    this.disposers.push(
      createEffect(() => {
        this.readout.valueFor('rate');
        this.readout.valueFor('offset');
        if (this.ready) this.markDirty();
      }),
    );

    this.dispatcher = new PointerDispatcher<LearnerState>({
      element: canvas,
      scene: scene as Scene2D,
      targets: this.targets,
      capability,
      handlers: {
        onPress: session => this.handlePress(session),
        onMove: session => this.handleMove(session),
        onRelease: () => undefined,
        onCancel: (_session, reason) => {
          this.record('pointer-cancel', null, true, reason);
          this.openedId = null;
        },
      },
    });
  }

  public get canvas(): HTMLCanvasElement {
    return this.stage.finalBuffer;
  }

  public get opacity(): number {
    return Number(this.canvas.style.opacity || '1');
  }

  public set opacity(value: number) {
    this.canvas.style.opacity = String(value);
  }

  public get isVisible(): boolean {
    return this.canvas.isConnected;
  }

  private currentSample(): number {
    const provisional = this.readout.provisionalValue('rate');
    if (provisional === null) return this.runtime.acceptedSample();
    if (!this.previewSystem) {
      this.previewSystem = new DynamicalSystem(decayModel(provisional, 1));
    } else {
      this.previewSystem.updateModel(decayModel(provisional, 1));
    }
    return sampleFor(this.previewSystem);
  }

  private handlePress(session: PointerSessionView) {
    const target = session.target;
    if (this.controller.policy[target]?.explore) {
      const opened = flatten(this.controller.begin(target));
      this.record('begin', target, opened.ok, opened.reason);
      if (opened.value) this.openedId = opened.value.id;
      return;
    }
    const inspected = flatten(this.controller.inspect(target));
    this.record('inspect', target, inspected.ok, inspected.reason);
    if (inspected.value) this.lastInspection = inspected.value.data;
  }

  private handleMove(session: PointerSessionView) {
    if (this.openExploration === null) return;
    const next = this.runtime.store.read().rate + session.delta.x / 100;
    const updated = flatten(this.controller.update(this.openExploration, next));
    if (!updated.ok) {
      this.record('update', session.target, false, updated.reason);
      this.openedId = null;
    }
  }

  private record(
    kind: string,
    target: string | null,
    ok: boolean,
    reason: string | null,
  ) {
    this.events.push({kind, target, ok, reason});
  }

  private markDirty() {
    if (this.disposeCount > 0) return;
    queueMicrotask(() => {
      if (this.disposeCount > 0) return;
      this.player.requestRender();
      this.player.wake();
    });
  }

  public async renderOnce(timeout = 6000) {
    if (this.disposeCount > 0) return false;
    const before = this.renderCount;
    const settled = new Promise<void>(resolve => (this.settle = resolve));
    this.player.requestRender();
    this.player.wake();
    const deadline = Date.now() + timeout;
    while (this.renderCount <= before && Date.now() < deadline) {
      await Promise.race([settled, wait(4)]);
    }
    return this.renderCount > before;
  }

  public commitOpen(): FlatOutcome<number> {
    if (this.openExploration === null) {
      return {ok: false, reason: 'no-open-exploration', value: null};
    }
    const result = flatten(this.controller.commit(this.openExploration));
    if (!result.value) {
      this.record('commit', null, false, result.reason);
      return {ok: false, reason: result.reason, value: null};
    }
    this.openedId = null;
    this.previewSystem = null;
    this.record('commit', result.value.target, true, null);
    return {ok: true, reason: null, value: result.value.value};
  }

  public discardOpen(): FlatOutcome<number> {
    if (this.openExploration === null) {
      return {ok: false, reason: 'no-open-exploration', value: null};
    }
    const result = flatten(this.controller.discard(this.openExploration));
    this.openedId = null;
    this.previewSystem = null;
    return {
      ok: result.ok,
      reason: result.reason,
      value: result.value ? result.value.value : null,
    };
  }

  public inspect(target: string) {
    const result = flatten(this.controller.inspect(target));
    return {
      ok: result.ok,
      reason: result.reason,
      data: result.value ? result.value.data : null,
    };
  }

  public nodeFor(target: string): object | null {
    return (this.targets.nodeFor(target) as object) ?? null;
  }

  /**
   * Where candidate B came from, mechanically.
   *
   * @remarks
   * `fromCompiledProject` is object identity against the `?project` module,
   * and `sharesSceneWithCompiled` catches the subtler cheat of assembling a
   * fresh project around the bundler's scene description.
   */
  public provenance() {
    const compiledScenes = compiledProject.scenes;
    return {
      kind: this.kind,
      projectName: this.project.name,
      fromCompiledProject:
        (this.project as unknown) === (compiledProject as unknown),
      sharesSceneWithCompiled: this.project.scenes.some(scene =>
        compiledScenes.includes(scene),
      ),
      pluginCount: this.project.plugins.length,
      pluginNames: this.project.plugins.map(plugin => plugin.name).sort(),
      sceneNames: this.project.scenes.map(scene => scene.name),
      sceneName: this.player.playback.currentScene.name,
      hasProjectMeta: this.project.meta !== undefined,
      hasSettingsMeta: this.project.settings !== undefined,
      versions: this.project.versions,
    };
  }

  /** The scene graph the presentation actually built, by node type. */
  public structure() {
    const scene = this.player.playback.currentScene as Scene2D;
    const children = scene.getView().children();
    return {
      nodeCount: children.length,
      nodeKinds: children.map(child => child.constructor.name),
    };
  }

  public canvasHash(): number | null {
    return this.disposeCount > 0 ? null : hashCanvas(this.stage);
  }

  public snapshot() {
    return {
      name: this.name,
      kind: this.kind,
      generation: this.generation,
      visible: this.isVisible,
      opacity: this.opacity,
      writable: this.capability.isValid(),
      renderCount: this.renderCount,
      displayedRate: this.controller.valueFor('rate'),
      provisionalRate: this.controller.provisionalValue('rate'),
      sample: this.currentSample(),
      hasActiveExploration: this.controller.hasActiveExploration,
      openExploration: this.openExploration,
      targets: this.targets.targets.slice().sort(),
      events: this.events.map(event => event.kind),
      lastInspection: this.lastInspection,
      disposeCount: this.disposeCount,
      hash: this.canvasHash(),
      provenance: this.provenance(),
      structure: this.structure(),
    };
  }

  public dispose() {
    this.disposeCount++;
    if (this.disposeCount > 1) return;
    this.dispatcher.dispose();
    this.readout.dispose();
    this.controller.dispose();
    for (const dispose of this.disposers.splice(0)) dispose();
    this.player.dispose();
    this.stage.dispose();
    this.container.remove();
  }
}

/**
 * One OvaCanvas runtime: a shared authority, the accepted CAP-05 trajectory,
 * a visible slot, and the transition owner that decides what is in it.
 *
 * @remarks
 * Identical in shape to the composition fixture. The only new thing is that a
 * candidate can be asked for by construction route.
 */
export class RuntimeBuiltRuntime {
  public readonly store: LearnerStore;
  public readonly owner: TransitionOwner<LearnerState, Presentation>;
  public readonly stageSlot: HTMLElement;

  /** How the next staged candidate is built. */
  public nextKind: CandidateKind = 'compiled';
  /** Presentations released because preparation failed part-way. */
  public releasedOnFailure = 0;

  public overlapProgress = 0;
  private overlapDone = 0;
  private readonly overlapTotal = 4;
  private nextName = 0;
  private acceptedModelRevision = 1;
  private acceptedSystem: DynamicalSystem;
  private readonly disposeRevision: () => void;

  public constructor(
    public readonly id: string,
    container: HTMLElement,
  ) {
    this.store = new LearnerStore(id);
    this.acceptedSystem = new DynamicalSystem(
      decayModel(AcceptedRate, this.acceptedModelRevision),
    );
    this.disposeRevision = this.store.authority.onRevisionChanged.subscribe(
      () => {
        this.acceptedModelRevision++;
        this.acceptedSystem.updateModel(
          decayModel(this.store.read().rate, this.acceptedModelRevision),
        );
      },
    );

    this.stageSlot = document.createElement('div');
    this.stageSlot.className = 'slot';
    this.stageSlot.dataset.runtime = id;
    container.append(this.stageSlot);

    this.owner = new TransitionOwner<LearnerState, Presentation>({
      authority: this.store.authority,
      adapter: {
        prepare: context => this.buildCandidate(context),
        activate: (incoming, outgoing) => {
          this.stageSlot.append(incoming.container);
          if (outgoing) {
            incoming.opacity = 0;
            outgoing.opacity = 1;
            this.overlapProgress = 0;
            this.overlapDone = 0;
          } else {
            incoming.opacity = 1;
            this.overlapProgress = 1;
          }
        },
        dispose: presentation => presentation.dispose(),
        quiescence: presentation => presentation.controller,
      },
    });
  }

  public acceptedSample(): number {
    return sampleFor(this.acceptedSystem);
  }

  public acceptedToken(): string {
    return this.acceptedSystem.revisionToken;
  }

  private async buildCandidate(
    context: PreparationContext<LearnerState>,
  ): Promise<Presentation> {
    const targets = new InteractionTargets();
    const binding = new LearnerBinding(
      {
        id: context.generation,
        preparedAtRevision: context.preparedAtRevision,
        state: 'preparing',
        capability: context.capability,
        markReady: (): void => undefined,
        discard: (): void => undefined,
      } as unknown as LearnerGeneration,
      targets,
    );

    let presentation: Presentation | null = null;
    try {
      presentation = new Presentation(
        `${this.id}-p${++this.nextName}`,
        this.nextKind,
        context.generation,
        context.capability,
        binding,
        targets,
        this,
      );
      // Readiness is one real rendered frame, the same point the earlier
      // transition proofs used. A constructor finishing is not readiness.
      const rendered = await presentation.renderOnce();
      if (!rendered) throw new Error('candidate never rendered');
      presentation.ready = true;
      if (!context.isCancelled()) context.markReady();
      return presentation;
    } catch (error) {
      if (presentation) {
        this.releasedOnFailure++;
        presentation.dispose();
      }
      throw error;
    }
  }

  public async advanceOverlap(steps = 1) {
    const incoming = this.owner.current;
    const outgoing = this.owner.outgoing;
    if (!incoming || !outgoing) return this.overlapProgress;
    for (let step = 0; step < steps; step++) {
      this.overlapDone = Math.min(this.overlapTotal, this.overlapDone + 1);
      this.overlapProgress = this.overlapDone / this.overlapTotal;
      incoming.opacity = this.overlapProgress;
      outgoing.opacity = 1 - this.overlapProgress;
      await incoming.renderOnce();
    }
    return this.overlapProgress;
  }

  public raiseOutgoing(raised: boolean) {
    const outgoing = this.owner.outgoing;
    if (!outgoing) return false;
    outgoing.canvas.style.zIndex = raised ? '5' : '';
    return true;
  }

  public clientPoint(sceneX: number, sceneY: number) {
    const rect = this.stageSlot.getBoundingClientRect();
    return {
      x: rect.left + sceneX + Size / 2,
      y: rect.top + sceneY + Size / 2,
    };
  }

  /** Where the rate handle sits for whatever value is currently displayed. */
  public rateHandlePoint() {
    const current = this.owner.current;
    const rate = current ? current.controller.valueFor('rate') : AcceptedRate;
    return {x: (rate - 1.5) * 100, y: 40};
  }

  public snapshot() {
    const status = this.owner.status();
    const current = this.owner.current;
    const outgoing = this.owner.outgoing;
    const candidate = this.owner.pendingCandidate;
    return {
      id: this.id,
      ...status,
      acceptedRate: this.store.read().rate,
      acceptedSample: this.acceptedSample(),
      acceptedToken: this.acceptedToken(),
      overlapProgress: this.overlapProgress,
      canvasesInSlot: this.stageSlot.querySelectorAll('canvas').length,
      releasedOnFailure: this.releasedOnFailure,
      current: current ? current.snapshot() : null,
      outgoing: outgoing ? outgoing.snapshot() : null,
      candidate: candidate ? candidate.snapshot() : null,
    };
  }

  public dispose() {
    this.owner.dispose();
    this.disposeRevision();
    this.store.dispose();
  }
}

export {wait};
