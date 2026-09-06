import type {Scene} from '@ovacanvas/core';
import {createComputed, createSignal} from '@ovacanvas/core';
import type {
  MutationCapability,
  PreparedGeneration,
} from '@ovacanvas/core/lib/internal';
import {RuntimeAuthority} from '@ovacanvas/core/lib/internal';

/**
 * The authoritative runtime projection this fixture realizes.
 *
 * @remarks
 * Plain data on purpose. The authority hands out frozen snapshots of it, so
 * presentation code cannot reach a mutable handle.
 */
export interface FoundationState {
  width: number;
  label: string;
}

/**
 * Fixture host state: a `RuntimeAuthority` plus the reactive mirror that
 * presentation reads.
 *
 * @remarks
 * The store lives outside Scene, Generator and Node lifetime. It no longer
 * offers a `write` method of its own: the only way to change accepted state is
 * a generation-scoped `MutationCapability` issued by the authority and held by
 * the host, never by scene code.
 *
 * This is fixture support. The governing safety lives in `@ovacanvas/core`.
 */
export class RuntimeStore {
  public readonly authority: RuntimeAuthority<FoundationState>;

  /**
   * Read-only reactive mirror of the accepted projection.
   *
   * @remarks
   * Presentation binds to this so that an accepted write wakes rendering. It
   * is written only by this class, in response to the authority.
   */
  private readonly widthMirror = createSignal(120);
  public readonly doubled = createComputed(() => this.widthMirror() * 2);

  private readonly disposeRevision: () => void;

  public constructor(public readonly runtimeId: string) {
    this.authority = new RuntimeAuthority<FoundationState>({
      width: 120,
      label: 'initial',
    });
    this.disposeRevision = this.authority.onRevisionChanged.subscribe(() => {
      this.widthMirror(this.authority.read().width);
    });
  }

  public get revision(): number {
    return this.authority.revision;
  }

  public read(): Readonly<FoundationState> {
    return this.authority.read();
  }

  /** The reactive read used by presentation. */
  public width(): number {
    return this.widthMirror();
  }

  /** Start a generation and hand back a binding for its presentation. */
  public prepareGeneration(): {
    prepared: PreparedGeneration<FoundationState>;
    binding: PresentationBinding;
  } {
    const prepared = this.authority.prepare();
    return {prepared, binding: new PresentationBinding(this, prepared)};
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
 * A read-only projection plus the semantic-identity slots this generation
 * rebinds. There is deliberately no mutation method here: a node that holds a
 * binding still holds no authority.
 */
export class PresentationBinding {
  /**
   * Presentation reconstructions inside this generation (reset, seek, HMR).
   *
   * @remarks
   * Distinct from the accepted generation id: reconstructing nodes is not
   * accepting new work.
   */
  public reconstructions = 0;

  /** The node currently bound to semantic ID `S1`, if any. */
  public boundNode: {key: string} | null = null;

  /** The media node bound to semantic ID `S2`, if any. */
  public boundVideo: {elementForProbe(): HTMLVideoElement} | null = null;

  /** Whether this generation's scene mounts a media node. */
  public withMedia = false;

  /**
   * Makes the scene generator throw during preparation.
   *
   * @remarks
   * Non-normative failure injection for the failed-preparation regression.
   */
  public failOnPrepare = false;

  public constructor(
    private readonly store: RuntimeStore,
    private readonly generationHandle: PreparedGeneration<FoundationState>,
  ) {}

  /** The accepted generation this presentation belongs to. */
  public get generation(): number {
    return this.generationHandle.id;
  }

  /** Whether this generation currently holds accepted authority. */
  public isAccepted(): boolean {
    return this.generationHandle.capability.isValid();
  }

  /** Reactive read-only projection. */
  public width(): number {
    return this.store.width();
  }

  public doubled(): number {
    return this.store.doubled();
  }

  public beginReconstruction() {
    this.reconstructions++;
    this.boundNode = null;
    this.boundVideo = null;
  }
}

/**
 * The capability a host holds for one generation.
 *
 * @remarks
 * Re-exported so fixture code names the core type rather than inventing one.
 */
export type FoundationCapability = MutationCapability<FoundationState>;

/** Re-exported so fixture code names the core type rather than inventing one. */
export type FoundationGeneration = PreparedGeneration<FoundationState>;

const Bindings = new WeakMap<object, PresentationBinding>();

/** Bind a presentation binding to one scene instance - never to a module-global. */
export function registerBinding(scene: Scene, binding: PresentationBinding) {
  Bindings.set(scene, binding);
}

export function bindingFor(scene: Scene): PresentationBinding {
  const binding = Bindings.get(scene);
  if (!binding) {
    throw new Error('No presentation binding registered for this scene');
  }
  return binding;
}
