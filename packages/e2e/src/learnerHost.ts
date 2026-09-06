import type {
  InteractionAccepted,
  InteractionOutcome,
  InteractionPolicy,
  InteractionRefused,
  PointerSessionView,
} from '@ovacanvas/2d';
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
import project from '../learner/project?project';
import type {
  LearnerCapability,
  LearnerGeneration,
  LearnerState,
} from '../learner/runtimeState';
import {
  AcceptedOffset,
  AcceptedRate,
  LearnerBinding,
  LearnerStore,
  decayModel,
  registerBinding,
  sampleFor,
} from '../learner/runtimeState';

export const Size = 400;

/** Counts every animation frame the runtime asks for. */
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
 * Named policies the driver can switch between at runtime.
 *
 * @remarks
 * Interaction permission is not fixed at scene construction; these exist so a
 * regression can change what a learner may do while the presentation is
 * alive.
 */
export const Policies: Record<string, InteractionPolicy> = {
  default: {
    readout: {inspect: true},
    offset: {inspect: true, explore: true},
    rate: {inspect: true, explore: true, commit: true},
  },
  readOnly: {
    readout: {inspect: true},
    offset: {inspect: true},
    rate: {inspect: true},
  },
  rateExploreOnly: {
    readout: {inspect: true},
    offset: {inspect: true, explore: true},
    rate: {inspect: true, explore: true},
  },
};

/**
 * An outcome flattened for fixture use.
 *
 * @remarks
 * This workspace inherits a non-strict tsconfig, where narrowing into the
 * branches of a boolean-literal discriminant is not dependable. The runtime
 * shape is guaranteed by the controller, so the casts are safe; flattening
 * here keeps the regressions readable, exactly as the foundation fixture
 * does for activation results.
 */
export interface FlatOutcome<TValue> {
  ok: boolean;
  reason: string | null;
  value: TValue | null;
}

export function flatten<TValue>(
  outcome: InteractionOutcome<TValue>,
): FlatOutcome<TValue> {
  return outcome.ok
    ? {
        ok: true,
        reason: null,
        value: (outcome as InteractionAccepted<TValue>).value,
      }
    : {ok: false, reason: (outcome as InteractionRefused).reason, value: null};
}

export interface LearnerEvent {
  kind: string;
  target: string | null;
  ok: boolean;
  reason: string | null;
  value: number | null;
}

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

type HostMode = 'boot' | 'idle' | 'dirty' | 'playing' | 'disposed';

/**
 * A runtime host wiring CAP-01 pointer mechanics to the product interaction
 * layer, and the product layer to CAP-05.
 */
export class LearnerHost {
  public readonly store: LearnerStore;
  public readonly stage = new Stage();
  public readonly player: Player;
  public readonly targets = new InteractionTargets();
  public readonly controller: InteractionController<LearnerState>;
  public readonly dispatcher: PointerDispatcher<LearnerState>;
  public readonly generation: LearnerGeneration;
  public readonly binding: LearnerBinding;

  public mode: HostMode = 'boot';
  public renderCount = 0;
  public ready = false;
  public events: LearnerEvent[] = [];

  /** Playback frame recorded when presentation was last held. */
  public heldAtFrame: number | null = null;
  public holdCalls = 0;
  public releaseCalls = 0;
  /**
   * Checkpoints left in the accepted trajectory right after a commit.
   *
   * @remarks
   * Sampled here rather than in a snapshot, because taking a sample
   * repopulates the very cache that is being measured.
   */
  public acceptedCheckpointsAtCommit: number | null = null;

  private readonly capability: LearnerCapability;
  /** The trajectory for accepted state; its model changes only on commit. */
  private acceptedSystem: DynamicalSystem;
  /** A throwaway trajectory for whatever a learner is holding. */
  private previewSystem: DynamicalSystem | null = null;
  private acceptedModelRevision = 1;
  private readonly readout: InteractionReadout<LearnerState>;
  private dirtyPending = false;
  private settle: (() => void) | null = null;
  private readonly disposers: Array<() => void> = [];

  public constructor(
    public readonly id: string,
    container: HTMLElement,
  ) {
    this.store = new LearnerStore(id);
    const {prepared, binding} = this.store.prepareGeneration(this.targets);
    this.generation = prepared;
    this.binding = binding;
    this.capability = prepared.capability;
    this.acceptedSystem = new DynamicalSystem(
      decayModel(AcceptedRate, this.acceptedModelRevision),
    );

    this.stage.configure({
      size: new Vector2(Size, Size),
      resolutionScale: 1,
      background: '#101216',
    });
    const canvas = this.stage.finalBuffer;
    container.append(canvas);

    this.player = new Player(
      project,
      {size: new Vector2(Size, Size), resolutionScale: 1, fps: 30},
      {paused: true, loop: false, muted: true},
      0,
    );

    const scene = this.player.playback.currentScene;
    registerBinding(scene, this.binding);

    this.controller = new InteractionController<LearnerState>({
      capability: this.capability,
      read: () => this.store.read(),
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
        offset: state.offset,
        revision: this.store.revision,
      }),
      policy: Policies.default,
      presentation: {
        hold: () => {
          this.holdCalls++;
          this.heldAtFrame = this.player.playback.frame;
          if (this.mode === 'playing') {
            this.player.togglePlayback(false);
            this.mode = 'idle';
          }
        },
        release: () => {
          this.releaseCalls++;
        },
      },
    });

    // Presentation reads what the interaction layer says to display, through
    // the reactive read the interaction layer supplies. Nothing here holds
    // truth, and no host-local version counter exists any more.
    this.readout = new InteractionReadout<LearnerState>(this.controller);
    this.binding.displayRate = () => this.readout.valueFor('rate');
    this.binding.displayOffset = () => this.readout.valueFor('offset');
    this.binding.displaySample = () => this.currentSample();

    this.disposers.push(
      scene.onReset.subscribe(() => {
        this.binding.beginReconstruction();
        this.dispatcher?.cancelAll('reset');
        // A rebuilt presentation cannot keep holding a learner's value.
        this.controller?.resolveActive('reset');
      }),
    );

    this.disposers.push(
      this.player.onRender.subscribe(async () => {
        if (this.mode === 'disposed') return;
        await this.stage.render(
          this.player.playback.currentScene,
          this.player.playback.previousScene,
        );
        this.renderCount++;
        if (this.mode !== 'playing') {
          this.player.sleep();
          this.mode = 'idle';
        }
        if (!this.ready) {
          this.ready = true;
          this.generation.markReady();
          this.store.authority.activate(this.generation);
        }
        const settle = this.settle;
        this.settle = null;
        settle?.();
      }),
    );

    this.disposers.push(
      createEffect(() => {
        // Depend on what presentation displays, so an overlay change wakes
        // rendering the same way an accepted change does.
        this.readout.valueFor('rate');
        this.readout.valueFor('offset');
        if (this.ready && this.mode === 'idle') this.markDirty();
      }),
    );

    this.dispatcher = new PointerDispatcher<LearnerState>({
      element: canvas,
      scene: scene as Scene2D,
      targets: this.targets,
      capability: this.capability,
      handlers: {
        onPress: session => this.handlePress(session),
        onMove: session => this.handleMove(session),
        // Release deliberately does not commit. A learner keeps or discards
        // an exploration by a separate deliberate act.
        onRelease: () => undefined,
        onCancel: (_session, reason) => {
          if (reason !== 'reset') this.controller.resolveActive('reset');
          this.record('pointer-cancel', null, true, reason, null);
        },
      },
    });
  }

  /** The rate a learner is currently being shown. */
  private displayedRate(): number {
    return this.controller.valueFor('rate');
  }

  /** The trajectory sample for the displayed rate. */
  private currentSample(): number {
    const provisional = this.readout.provisionalValue('rate');
    if (provisional === null) return sampleFor(this.acceptedSystem);
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
      this.record(
        'begin',
        target,
        opened.ok,
        opened.reason,
        opened.value ? opened.value.value : null,
      );
      if (opened.value) this.openExploration = opened.value.id;
      return;
    }
    const inspected = flatten(this.controller.inspect(target));
    this.record('inspect', target, inspected.ok, inspected.reason, null);
    if (inspected.value) this.lastInspection = inspected.value.data;
  }

  private handleMove(session: PointerSessionView) {
    if (this.openExploration === null) return;
    const base = session.target === 'offset' ? AcceptedOffset : AcceptedRate;
    const next = base + session.delta.x / 100;
    const updated = flatten(this.controller.update(this.openExploration, next));
    if (!updated.ok) {
      this.record('update', session.target, false, updated.reason, null);
      this.openExploration = null;
    }
  }

  public openExploration: number | null = null;
  public lastInspection: unknown = null;

  private record(
    kind: string,
    target: string | null,
    ok: boolean,
    reason: string | null,
    value: number | null,
  ) {
    this.events.push({kind, target, ok, reason, value});
  }

  private markDirty() {
    if (this.dirtyPending || this.mode !== 'idle') return;
    this.dirtyPending = true;
    queueMicrotask(() => {
      this.dirtyPending = false;
      if (this.mode !== 'idle') return;
      this.mode = 'dirty';
      this.player.requestRender();
      this.player.wake();
    });
  }

  public async settled(before = this.renderCount, timeout = 4000) {
    const deadline = Date.now() + timeout;
    while (this.renderCount <= before && Date.now() < deadline) await wait(4);
    return this.renderCount > before;
  }

  /** Deliberately accept whatever the learner is holding. */
  public commitOpen(): FlatOutcome<number> {
    if (this.openExploration === null) {
      return {ok: false, reason: 'no-open-exploration', value: null};
    }
    const result = flatten(this.controller.commit(this.openExploration));
    if (!result.value) {
      this.record('commit', null, false, result.reason, null);
      return {ok: false, reason: result.reason, value: null};
    }
    this.openExploration = null;
    // The accepted model changed, so CAP-05 gets a new revision namespace.
    this.acceptedModelRevision++;
    this.acceptedSystem.updateModel(
      decayModel(this.store.read().rate, this.acceptedModelRevision),
    );
    this.acceptedCheckpointsAtCommit =
      this.acceptedSystem.diagnostics().checkpointCount;
    this.previewSystem = null;
    this.record('commit', result.value.target, true, null, result.value.value);
    return {ok: true, reason: null, value: result.value.value};
  }

  /** Abandon whatever the learner is holding. */
  public discardOpen(): FlatOutcome<number> {
    if (this.openExploration === null) {
      return {ok: false, reason: 'no-open-exploration', value: null};
    }
    const result = flatten(this.controller.discard(this.openExploration));
    if (!result.value) {
      this.record('discard', null, false, result.reason, null);
      return {ok: false, reason: result.reason, value: null};
    }
    this.openExploration = null;
    this.previewSystem = null;
    return {ok: true, reason: null, value: result.value.value};
  }

  public setPolicy(name: string) {
    const policy = Policies[name];
    if (!policy) throw new Error(`unknown policy ${name}`);
    const revoked = this.controller.setPolicy(policy);
    if (revoked) this.openExploration = null;
    return revoked;
  }

  public async play() {
    this.mode = 'playing';
    this.player.togglePlayback(true);
    this.player.wake();
    const before = this.renderCount;
    await this.settled(before);
    return this.player.playback.frame;
  }

  public async resumeAfterInteraction() {
    if (this.mode === 'disposed') return this.player.playback.frame;
    this.mode = 'playing';
    this.player.togglePlayback(true);
    this.player.wake();
    await this.settled(this.renderCount);
    return this.player.playback.frame;
  }

  public stopPlayback() {
    if (this.mode === 'playing') {
      this.player.togglePlayback(false);
      this.mode = 'idle';
    }
  }

  /** Where the rate handle currently sits, in scene coordinates. */
  public rateHandlePoint() {
    return {x: (this.controller.valueFor('rate') - 1.5) * 100, y: 40};
  }

  public clientPoint(sceneX: number, sceneY: number) {
    const rect = this.stage.finalBuffer.getBoundingClientRect();
    const width = this.stage.finalBuffer.clientWidth || rect.width;
    const height = this.stage.finalBuffer.clientHeight || rect.height;
    return {
      x: rect.left + ((sceneX + Size / 2) * width) / Size,
      y: rect.top + ((sceneY + Size / 2) * height) / Size,
    };
  }

  /** Retire this generation by accepting a successor on the same authority. */
  public retireGeneration() {
    const successor = this.store.authority.prepare();
    successor.markReady();
    return this.store.authority.activate(successor).ok;
  }

  public async resetScene() {
    const before = this.renderCount;
    this.player.requestReset();
    this.player.wake();
    await this.settled(before);
    return this.snapshot();
  }

  public snapshot() {
    const state = this.store.read();
    return {
      id: this.id,
      mode: this.mode,
      revision: this.store.revision,
      acceptedRate: state.rate,
      acceptedOffset: state.offset,
      displayedRate: this.displayedRate(),
      displayedOffset: this.controller.valueFor('offset'),
      sample: this.currentSample(),
      acceptedSample: sampleFor(this.acceptedSystem),
      acceptedToken: this.acceptedSystem.revisionToken,
      acceptedCheckpointsAtCommit: this.acceptedCheckpointsAtCommit,
      acceptedModelRevision: this.acceptedSystem.modelRevision,
      hasActiveExploration: this.controller.hasActiveExploration,
      openExploration: this.openExploration,
      isPresentationHeld: this.controller.isPresentationHeld,
      heldAtFrame: this.heldAtFrame,
      holdCalls: this.holdCalls,
      releaseCalls: this.releaseCalls,
      frame: this.player.playback.frame,
      renderCount: this.renderCount,
      reconstructions: this.binding.reconstructions,
      canvasHash: this.mode === 'disposed' ? null : hashCanvas(this.stage),
      lastInspection: this.lastInspection,
      events: this.events.length,
      controllerDisposed: this.controller.isDisposed,
      generationAccepted: this.binding.isAccepted(),
    };
  }

  public clearEvents() {
    this.events = [];
    this.lastInspection = null;
  }

  public dispose() {
    if (this.mode === 'disposed') return;
    this.mode = 'disposed';
    this.dispatcher.dispose();
    this.readout.dispose();
    this.controller.dispose();
    for (const dispose of this.disposers.splice(0)) dispose();
    this.player.dispose();
    this.stage.dispose();
    this.generation.discard();
    this.store.dispose();
  }
}

export const wait = (ms: number) =>
  new Promise<void>(resolve => setTimeout(resolve, ms));
