import type {InteractionTargets, PickableNode} from '@ovacanvas/2d';
import type {Scene} from '@ovacanvas/core';
import {createSignal} from '@ovacanvas/core';
import type {
  MutationCapability,
  PreparedGeneration,
} from '@ovacanvas/core/lib/internal';
import {RuntimeAuthority} from '@ovacanvas/core/lib/internal';

/**
 * The authoritative runtime projection this fixture realizes.
 *
 * @remarks
 * Deliberately neutral: a movable handle and a count of accepted presses.
 * Nothing here names a subject, a control or a chart - CAP-01 supplies
 * mechanics, and what an interaction *means* belongs above it.
 */
export interface InteractionState {
  handle: {x: number; y: number};
  presses: number;
}

/** Where the handle sits before anything moves it. */
export const HandleOrigin = {x: 0, y: 130};

/**
 * A `RuntimeAuthority` plus the reactive mirror presentation reads.
 *
 * @remarks
 * The same shape the foundation fixture uses. There is no write method: the
 * only way to change accepted state is a generation-scoped capability, and
 * interaction reaches it through the dispatcher rather than around it.
 */
export class InteractionStore {
  public readonly authority: RuntimeAuthority<InteractionState>;

  private readonly handleXMirror = createSignal(HandleOrigin.x);
  private readonly handleYMirror = createSignal(HandleOrigin.y);
  private readonly disposeRevision: () => void;

  public constructor(public readonly runtimeId: string) {
    this.authority = new RuntimeAuthority<InteractionState>({
      handle: {...HandleOrigin},
      presses: 0,
    });
    this.disposeRevision = this.authority.onRevisionChanged.subscribe(() => {
      const {handle} = this.authority.read();
      this.handleXMirror(handle.x);
      this.handleYMirror(handle.y);
    });
  }

  public get revision(): number {
    return this.authority.revision;
  }

  public read(): Readonly<InteractionState> {
    return this.authority.read();
  }

  public handleX(): number {
    return this.handleXMirror();
  }

  public handleY(): number {
    return this.handleYMirror();
  }

  public prepareGeneration(targets: InteractionTargets): {
    prepared: PreparedGeneration<InteractionState>;
    binding: InteractionBinding;
  } {
    const prepared = this.authority.prepare();
    return {prepared, binding: new InteractionBinding(this, prepared, targets)};
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
 * A read-only projection plus the registry a generation binds its semantic
 * targets into. Registering a node as interactive is not authority: the scene
 * still cannot write, and the id it registers outlives the node it registers.
 */
export class InteractionBinding {
  /** Presentation reconstructions inside this generation. */
  public reconstructions = 0;

  public constructor(
    private readonly store: InteractionStore,
    private readonly generationHandle: PreparedGeneration<InteractionState>,
    private readonly registry: InteractionTargets,
  ) {}

  public get generation(): number {
    return this.generationHandle.id;
  }

  public isAccepted(): boolean {
    return this.generationHandle.capability.isValid();
  }

  public handleX(): number {
    return this.store.handleX();
  }

  public handleY(): number {
    return this.store.handleY();
  }

  /** Bind a semantic target to the node that currently realizes it. */
  public bindTarget(target: string, node: PickableNode) {
    this.registry.bind(target, node);
  }

  /** A rebuilt presentation starts from no bindings at all. */
  public beginReconstruction() {
    this.reconstructions++;
    this.registry.clear();
  }
}

export type InteractionCapability = MutationCapability<InteractionState>;
export type InteractionGeneration = PreparedGeneration<InteractionState>;

const Bindings = new WeakMap<object, InteractionBinding>();

export function registerBinding(scene: Scene, binding: InteractionBinding) {
  Bindings.set(scene, binding);
}

export function bindingFor(scene: Scene): InteractionBinding {
  const binding = Bindings.get(scene);
  if (!binding) {
    throw new Error('No interaction binding registered for this scene');
  }
  return binding;
}
