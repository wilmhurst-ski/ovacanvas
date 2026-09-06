import {
  InteractionController,
  InteractionReadout,
  InteractionTargets,
} from '@ovacanvas/2d';
import {Player, Stage, Vector2, createEffect} from '@ovacanvas/core';
import type {PreparationContext} from '@ovacanvas/core/lib/internal';
import {TransitionOwner} from '@ovacanvas/core/lib/internal';
import project from '../learner/project?project';
import type {LearnerCapability, LearnerState} from '../learner/runtimeState';
import {
  LearnerBinding,
  LearnerStore,
  registerBinding,
} from '../learner/runtimeState';

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

const Policy = {
  readout: {inspect: true},
  offset: {inspect: true, explore: true},
  rate: {inspect: true, explore: true, commit: true},
};

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

const wait = (ms: number) =>
  new Promise<void>(resolve => setTimeout(resolve, ms));

/**
 * One presentation: its own stage, player, scene and interaction, bound to a
 * generation of the runtime's shared authority.
 *
 * @remarks
 * Built offstage in a detached container. Nothing here is authoritative; the
 * authority is the runtime's, and this generation's capability is inert until
 * the transition owner activates it.
 */
export class Presentation {
  public readonly stage = new Stage();
  public readonly player: Player;
  public readonly targets: InteractionTargets;
  public readonly controller: InteractionController<LearnerState>;
  public readonly binding: LearnerBinding;
  public readonly container: HTMLElement;

  public renderCount = 0;
  public ready = false;
  public disposeCount = 0;
  public sleeping = false;

  private readonly readout: InteractionReadout<LearnerState>;
  private readonly disposers: Array<() => void> = [];
  private settle: (() => void) | null = null;

  public constructor(
    public readonly name: string,
    public readonly generation: number,
    public readonly capability: LearnerCapability,
    binding: LearnerBinding,
    targets: InteractionTargets,
    store: LearnerStore,
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
    this.canvas.style.opacity = '1';
    this.container.append(this.canvas);

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
      read: () => store.read(),
      valueOf: (target, state) =>
        target === 'offset' ? state.offset : state.rate,
      apply: (draft, target, value) => {
        if (target === 'offset') draft.offset = value;
        else draft.rate = value;
      },
      describe: (target, state) => ({target, label: state.label}),
      policy: Policy,
    });

    this.readout = new InteractionReadout<LearnerState>(this.controller);
    binding.displayRate = () => this.readout.valueFor('rate');
    binding.displayOffset = () => this.readout.valueFor('offset');
    binding.displaySample = () => Math.exp(-this.readout.valueFor('rate'));

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
        this.sleeping = true;
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

  /** Whether this presentation's canvas is in a document-attached container. */
  public get isVisible(): boolean {
    return this.canvas.isConnected;
  }

  private markDirty() {
    if (this.disposeCount > 0) return;
    queueMicrotask(() => {
      if (this.disposeCount > 0) return;
      this.player.requestRender();
      this.player.wake();
      this.sleeping = false;
    });
  }

  /** Draw one frame and wait for it. */
  public async renderOnce(timeout = 6000) {
    if (this.disposeCount > 0) return false;
    const before = this.renderCount;
    const settled = new Promise<void>(resolve => (this.settle = resolve));
    this.player.requestRender();
    this.player.wake();
    this.sleeping = false;
    const deadline = Date.now() + timeout;
    while (this.renderCount <= before && Date.now() < deadline) {
      await Promise.race([settled, wait(4)]);
    }
    return this.renderCount > before;
  }

  public semanticTargets(): string[] {
    return this.targets.targets.sort();
  }

  /** The node instance currently realizing a semantic target. */
  public nodeFor(target: string): object | null {
    return (this.targets.nodeFor(target) as object) ?? null;
  }

  public canvasHash(): number | null {
    return this.disposeCount > 0 ? null : hashCanvas(this.stage);
  }

  public dispose() {
    this.disposeCount++;
    if (this.disposeCount > 1) return;
    this.readout.dispose();
    this.controller.dispose();
    for (const dispose of this.disposers.splice(0)) dispose();
    this.player.dispose();
    this.stage.dispose();
    this.container.remove();
  }
}

export interface CandidateOptions {
  /** Fail while the candidate is being built. */
  failPrepare?: boolean;
  /** Finish building but never declare readiness. */
  skipReady?: boolean;
  /** Delay before the candidate finishes, so cancellation can race it. */
  delayMs?: number;
}

/**
 * One OvaCanvas runtime: a shared authority, a visible slot, and the owner
 * that decides which presentation is in it.
 */
export class TransitionRuntime {
  public readonly store: LearnerStore;
  public readonly owner: TransitionOwner<LearnerState, Presentation>;
  public readonly stageSlot: HTMLElement;

  public options: CandidateOptions = {};
  public overlapProgress = 0;
  public overlapSteps = 0;
  /** How many steps the current crossfade is divided into. */
  public overlapTotal = 4;
  private overlapDone = 0;
  public prepareMs = 0;
  public activateMs = 0;
  public retireMs = 0;
  /** Presentations built but released because preparation failed part-way. */
  public partialReleases = 0;

  private nextName = 0;

  public constructor(
    public readonly id: string,
    container: HTMLElement,
  ) {
    this.store = new LearnerStore(id);
    this.stageSlot = document.createElement('div');
    this.stageSlot.className = 'slot';
    this.stageSlot.dataset.runtime = id;
    container.append(this.stageSlot);

    this.owner = new TransitionOwner<LearnerState, Presentation>({
      authority: this.store.authority,
      adapter: {
        prepare: context => this.buildCandidate(context),
        activate: (incoming, outgoing) => {
          // The boundary is already crossed; this only makes it visible.
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

  /**
   * Build a candidate offstage.
   *
   * @remarks
   * The container is detached, so nothing partly built is ever in the
   * document. The adapter releases its own partial construction when it
   * fails: the owner can only dispose what it was handed.
   */
  private async buildCandidate(
    context: PreparationContext<LearnerState>,
  ): Promise<Presentation> {
    const started = performance.now();
    const targets = new InteractionTargets();
    // The fixture binding wants a prepared-generation handle; the preparation
    // context already carries the two fields it reads, and the owner keeps the
    // real handle. Casting once here avoids threading the handle through the
    // adapter just so a fixture can read an id.
    const binding = new LearnerBinding(
      {
        id: context.generation,
        preparedAtRevision: context.preparedAtRevision,
        state: 'preparing',
        capability: context.capability,
        markReady: (): void => undefined,
        discard: (): void => undefined,
      } as unknown as ConstructorParameters<typeof LearnerBinding>[0],
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
        this.store,
      );

      if (this.options.delayMs) await wait(this.options.delayMs);
      if (this.options.failPrepare) {
        throw new Error('probe-candidate-failure');
      }

      // Readiness is a rendered frame, not a returned constructor.
      const rendered = await presentation.renderOnce();
      if (!rendered) throw new Error('candidate never rendered');
      presentation.ready = true;
      if (context.isCancelled()) return presentation;
      if (!this.options.skipReady) context.markReady();

      this.prepareMs = performance.now() - started;
      return presentation;
    } catch (error) {
      // Partial construction is the adapter's to clean up.
      if (presentation) {
        presentation.dispose();
        this.partialReleases++;
      }
      throw error;
    }
  }

  public async stage(options: CandidateOptions = {}) {
    this.options = options;
    const result = await this.owner.stage();
    this.options = {};
    return result;
  }

  public activate() {
    const started = performance.now();
    const result = this.owner.activate();
    this.activateMs = performance.now() - started;
    return result;
  }

  /**
   * Advance the crossfade by one step and draw a real frame.
   *
   * @remarks
   * A crossfade is a probe, not the transition language. It is driven by the
   * caller asking for steps and by the presentation's own render path; there
   * is no timer, no interval and no second animation frame owner here.
   */
  public async advanceOverlap(steps = 1) {
    const outgoing = this.owner.outgoing;
    const incoming = this.owner.current;
    if (!incoming || !outgoing) return this.overlapProgress;

    for (let step = 0; step < steps; step++) {
      this.overlapDone = Math.min(this.overlapTotal, this.overlapDone + 1);
      this.overlapProgress = this.overlapDone / this.overlapTotal;
      this.overlapSteps++;
      incoming.opacity = this.overlapProgress;
      outgoing.opacity = 1 - this.overlapProgress;
      await incoming.renderOnce();
    }
    return this.overlapProgress;
  }

  public retireOutgoing() {
    const started = performance.now();
    const retired = this.owner.retireOutgoing();
    this.retireMs = performance.now() - started;
    return retired;
  }

  /** The host's own write path, used to move the accepted revision. */
  public writeAccepted(rate: number): number | null {
    const current = this.owner.current;
    if (!current) return null;
    try {
      return current.capability.write(draft => {
        draft.rate = rate;
      });
    } catch {
      return null;
    }
  }

  /** Open a temporary exploration on the current presentation. */
  public beginExploration(target = 'rate') {
    const current = this.owner.current;
    if (!current) return {ok: false, id: null};
    const opened = current.controller.begin(target);
    return opened.ok
      ? {ok: true, id: (opened as {value: {id: number}}).value.id}
      : {ok: false, id: null};
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
      current: current
        ? {
            name: current.name,
            generation: current.generation,
            visible: current.isVisible,
            opacity: current.opacity,
            writable: current.capability.isValid(),
            renderCount: current.renderCount,
            hash: current.canvasHash(),
            targets: current.semanticTargets(),
            hasActiveExploration: current.controller.hasActiveExploration,
            displayedRate: current.controller.valueFor('rate'),
          }
        : null,
      outgoing: outgoing
        ? {
            name: outgoing.name,
            generation: outgoing.generation,
            visible: outgoing.isVisible,
            opacity: outgoing.opacity,
            writable: outgoing.capability.isValid(),
            disposeCount: outgoing.disposeCount,
          }
        : null,
      candidate: candidate
        ? {
            name: candidate.name,
            generation: candidate.generation,
            visible: candidate.isVisible,
            writable: candidate.capability.isValid(),
            renderCount: candidate.renderCount,
          }
        : null,
      overlapProgress: this.overlapProgress,
      canvasesInSlot: this.stageSlot.querySelectorAll('canvas').length,
      partialReleases: this.partialReleases,
      timings: {
        prepareMs: this.prepareMs,
        activateMs: this.activateMs,
        retireMs: this.retireMs,
      },
    };
  }

  public dispose() {
    this.owner.dispose();
    this.store.dispose();
  }
}

export {wait};
