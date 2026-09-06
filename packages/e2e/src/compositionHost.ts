import type {InteractionPolicy, PointerSessionView} from '@ovacanvas/2d';
import {
  InteractionController,
  InteractionReadout,
  InteractionTargets,
  PointerDispatcher,
  Scene2D,
} from '@ovacanvas/2d';
import {
  DynamicalSystem,
  Player,
  Stage,
  Vector2,
  createEffect,
} from '@ovacanvas/core';
import type {PreparationContext} from '@ovacanvas/core/lib/internal';
import {TransitionOwner} from '@ovacanvas/core/lib/internal';
import project from '../learner/project?project';
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

const Policy: InteractionPolicy = {
  readout: {inspect: true},
  offset: {inspect: true, explore: true},
  rate: {inspect: true, explore: true, commit: true},
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

export interface CompositionEvent {
  kind: string;
  target: string | null;
  ok: boolean;
  reason: string | null;
}

/**
 * One presentation carrying everything a learner touches: its own stage,
 * player, scene, pointer dispatcher and interaction controller, all bound to
 * one generation of the runtime's shared authority.
 *
 * @remarks
 * This is the composition under test. Nothing new coordinates these; each is
 * the accepted production surface, wired together the way a product would.
 */
export class Presentation {
  public readonly stage = new Stage();
  public readonly player: Player;
  public readonly targets: InteractionTargets;
  public readonly controller: InteractionController<LearnerState>;
  public readonly dispatcher: PointerDispatcher<LearnerState>;
  public readonly binding: LearnerBinding;
  public readonly container: HTMLElement;

  public renderCount = 0;
  public ready = false;
  public disposeCount = 0;
  /**
   * The exploration this fixture opened, if the controller still holds it.
   *
   * @remarks
   * Derived rather than stored: quiescence can resolve an exploration without
   * telling whoever opened it, and a fixture field left behind would report a
   * session that no longer exists.
   */
  public get openExploration(): number | null {
    return this.controller.hasActiveExploration ? this.openedId : null;
  }
  private openedId: number | null = null;
  public lastInspection: unknown = null;
  public events: CompositionEvent[] = [];

  /** Playback frame recorded when the interaction layer held presentation. */
  public heldAtFrame: number | null = null;
  public holdCalls = 0;
  public releaseCalls = 0;
  public playing = false;

  /** A throwaway trajectory for whatever a learner is provisionally holding. */
  private previewSystem: DynamicalSystem | null = null;
  private readonly readout: InteractionReadout<LearnerState>;
  private readonly disposers: Array<() => void> = [];
  private settle: (() => void) | null = null;

  public constructor(
    public readonly name: string,
    public readonly generation: number,
    public readonly capability: LearnerCapability,
    binding: LearnerBinding,
    targets: InteractionTargets,
    private readonly runtime: CompositionRuntime,
  ) {
    this.binding = binding;
    this.targets = targets;
    this.container = document.createElement('div');
    this.container.className = 'presentation';
    this.container.dataset.presentation = name;

    this.stage.configure({
      size: new Vector2(Size, Size),
      resolutionScale: 1,
      background: '#101216',
    });
    const canvas = this.stage.finalBuffer;
    canvas.style.opacity = '1';
    this.container.append(canvas);

    this.player = new Player(
      project,
      {size: new Vector2(Size, Size), resolutionScale: 1, fps: 30},
      {paused: true, loop: false, muted: true},
      0,
    );

    const scene = this.player.playback.currentScene;
    registerBinding(scene, binding);

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
      presentation: {
        hold: () => {
          this.holdCalls++;
          this.heldAtFrame = this.player.playback.frame;
          if (this.playing) {
            this.player.togglePlayback(false);
            this.playing = false;
          }
        },
        release: () => {
          this.releaseCalls++;
        },
      },
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
        if (!this.playing) this.player.sleep();
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
        // Release never commits. Keeping or discarding is a separate act.
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

  /** The trajectory sample for whatever value is currently displayed. */
  private currentSample(): number {
    const provisional = this.readout.provisionalValue('rate');
    if (provisional === null) return this.runtime.acceptedSample();
    // A provisional trajectory is derived and thrown away with the value.
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
    const next = AcceptedRate + session.delta.x / 100;
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

  /** Deliberately accept whatever the learner is holding. */
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

  public play() {
    this.playing = true;
    this.player.togglePlayback(true);
    this.player.wake();
  }

  public stop() {
    if (this.playing) {
      this.player.togglePlayback(false);
      this.playing = false;
    }
  }

  public nodeFor(target: string): object | null {
    return (this.targets.nodeFor(target) as object) ?? null;
  }

  public canvasHash(): number | null {
    return this.disposeCount > 0 ? null : hashCanvas(this.stage);
  }

  public snapshot() {
    return {
      name: this.name,
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
      isPresentationHeld: this.controller.isPresentationHeld,
      holdCalls: this.holdCalls,
      releaseCalls: this.releaseCalls,
      heldAtFrame: this.heldAtFrame,
      frame: this.player.playback.frame,
      playing: this.playing,
      targets: this.targets.targets.sort(),
      events: this.events.map(event => event.kind),
      lastInspection: this.lastInspection,
      disposeCount: this.disposeCount,
      hash: this.canvasHash(),
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
 */
export class CompositionRuntime {
  public readonly store: LearnerStore;
  public readonly owner: TransitionOwner<LearnerState, Presentation>;
  public readonly stageSlot: HTMLElement;

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
    // The accepted model follows accepted runtime state, whichever generation
    // committed it. A new accepted rate is a new CAP-05 revision namespace.
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

  /** The trajectory sample for accepted state. */
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
    // The fixture binding wants a prepared-generation handle; the preparation
    // context already carries the fields it reads.
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
        context.generation,
        context.capability,
        binding,
        targets,
        this,
      );
      const rendered = await presentation.renderOnce();
      if (!rendered) throw new Error('candidate never rendered');
      presentation.ready = true;
      if (!context.isCancelled()) context.markReady();
      return presentation;
    } catch (error) {
      if (presentation) presentation.dispose();
      throw error;
    }
  }

  /** Advance the crossfade and draw a real frame. A probe, not a language. */
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

  /** Bring the still-visible outgoing canvas in front, as a stray pointer would find it. */
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
