import type {InteractionTargets, PickableNode} from '@ovacanvas/2d';
import type {Scene, SimulationModel} from '@ovacanvas/core';
import {DynamicalSystem, createSignal} from '@ovacanvas/core';
import type {
  MutationCapability,
  PreparedGeneration,
} from '@ovacanvas/core/lib/internal';
import {RuntimeAuthority} from '@ovacanvas/core/lib/internal';

/**
 * The authoritative runtime projection this fixture realizes.
 *
 * @remarks
 * Two neutral scalars and a label. `rate` is a parameter of a one-line
 * differential equation; nothing here names a subject, a control or a lesson.
 */
export interface LearnerState {
  rate: number;
  offset: number;
  label: string;
}

export const AcceptedRate = 1;
export const AcceptedOffset = 0;

/** The tick the fixture samples the trajectory at. */
export const SampleTick = 1000;

/**
 * The neutral model CAP-05 integrates: `y' = -k*y`, `y(0) = 1`.
 *
 * @remarks
 * Its closed form is `exp(-k)` at `t = 1`, so a changed `rate` is visible in
 * the sample without anyone having to believe a physical story about it.
 */
export function decayModel(rate: number, revision: number): SimulationModel {
  return {
    id: 'learner-decay',
    revision,
    dt: 0.001,
    initialState: [1],
    parameters: {k: rate},
    derivative: (_time, state, parameters) => [-parameters.k * state[0]],
  };
}

/**
 * A `RuntimeAuthority` plus the reactive mirror presentation reads.
 *
 * @remarks
 * The same shape the earlier fixtures use. There is no write method of its
 * own: accepted state changes only through a generation-scoped capability.
 */
export class LearnerStore {
  public readonly authority: RuntimeAuthority<LearnerState>;

  private readonly rateMirror = createSignal(AcceptedRate);
  private readonly offsetMirror = createSignal(AcceptedOffset);
  private readonly disposeRevision: () => void;

  public constructor(public readonly runtimeId: string) {
    this.authority = new RuntimeAuthority<LearnerState>({
      rate: AcceptedRate,
      offset: AcceptedOffset,
      label: 'accepted',
    });
    this.disposeRevision = this.authority.onRevisionChanged.subscribe(() => {
      const state = this.authority.read();
      this.rateMirror(state.rate);
      this.offsetMirror(state.offset);
    });
  }

  public get revision(): number {
    return this.authority.revision;
  }

  public read(): Readonly<LearnerState> {
    return this.authority.read();
  }

  public acceptedRate(): number {
    return this.rateMirror();
  }

  public acceptedOffset(): number {
    return this.offsetMirror();
  }

  public prepareGeneration(targets: InteractionTargets): {
    prepared: PreparedGeneration<LearnerState>;
    binding: LearnerBinding;
  } {
    const prepared = this.authority.prepare();
    return {prepared, binding: new LearnerBinding(prepared, targets)};
  }

  public dispose() {
    this.disposeRevision();
    this.authority.dispose();
  }
}

/**
 * What scene code is allowed to see.
 *
 * @remarks
 * The scene reads whatever the interaction layer says presentation should
 * show, which is the held value while a learner explores and the accepted one
 * otherwise. It still holds no authority and can write nothing.
 */
export class LearnerBinding {
  public reconstructions = 0;

  /** Set by the host: what presentation should currently show. */
  public displayRate: () => number = () => AcceptedRate;
  public displayOffset: () => number = () => AcceptedOffset;
  /** The CAP-05 sample for whatever rate is currently displayed. */
  public displaySample: () => number = () => Math.exp(-AcceptedRate);

  public constructor(
    private readonly generationHandle: PreparedGeneration<LearnerState>,
    private readonly registry: InteractionTargets,
  ) {}

  public get generation(): number {
    return this.generationHandle.id;
  }

  public isAccepted(): boolean {
    return this.generationHandle.capability.isValid();
  }

  public bindTarget(target: string, node: PickableNode) {
    this.registry.bind(target, node);
  }

  public beginReconstruction() {
    this.reconstructions++;
    this.registry.clear();
  }
}

export type LearnerCapability = MutationCapability<LearnerState>;
export type LearnerGeneration = PreparedGeneration<LearnerState>;

/**
 * A derived trajectory for one rate.
 *
 * @remarks
 * Used twice by the host: once for accepted state, once for whatever a
 * learner is provisionally holding. The provisional one is thrown away with
 * the exploration, which is what "derived" means.
 */
export function sampleFor(system: DynamicalSystem): number {
  return system.stateAtTick(SampleTick).state[0];
}

const Bindings = new WeakMap<object, LearnerBinding>();

export function registerBinding(scene: Scene, binding: LearnerBinding) {
  Bindings.set(scene, binding);
}

export function bindingFor(scene: Scene): LearnerBinding {
  const binding = Bindings.get(scene);
  if (!binding) {
    throw new Error('No learner binding registered for this scene');
  }
  return binding;
}
