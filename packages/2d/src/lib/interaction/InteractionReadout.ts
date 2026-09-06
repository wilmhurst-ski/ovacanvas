import {createSignal} from '@ovacanvas/core';
import type {InteractionController} from './InteractionController';

/**
 * A reactive read of what presentation should currently show.
 *
 * @remarks
 * The interaction controller decides *what* presentation should show: the
 * value a learner is provisionally holding when there is one, and the accepted
 * value otherwise. It says so by dispatching
 * {@link InteractionController.onProvisionalChanged}, and it deliberately owns
 * no signal - interaction semantics should not depend on a presentation
 * library's reactivity.
 *
 * This is the other half of that seam, and the whole of it: it holds one
 * signal, bumps it when the controller says something changed, and reads the
 * controller through it. A scene that reads {@link valueFor} inside a signal
 * or an effect is re-evaluated when a learner explores, discards or commits,
 * without the host inventing a version counter of its own.
 *
 * **It is a read.** Nothing here holds state, owns truth or can write.
 * Accepted state still belongs to the runtime authority, the provisional
 * overlay still belongs to the controller, discarding still means dropping
 * that overlay, and committing still goes through the generation-scoped
 * mutation capability. This object would be correct if it were deleted and
 * every caller went back to reading the controller directly - they would
 * simply stop being woken.
 *
 * **It tracks provisional changes, not accepted ones.** A commit is observed
 * because the controller performs it, but accepted state moving for any other
 * reason - another generation committing, say - is the authority's
 * `onRevisionChanged`, which a host mirrors separately.
 *
 * @internal Not a public API. Its name and shape are not frozen, and it
 *           implies no product contract.
 */
export class InteractionReadout<TState extends object> {
  private readonly version = createSignal(0);
  private readonly unsubscribe: () => void;
  private disposed = false;

  public constructor(
    private readonly controller: InteractionController<TState>,
  ) {
    this.unsubscribe = controller.onProvisionalChanged.subscribe(() => {
      this.version(this.version() + 1);
    });
  }

  /**
   * What presentation should show for a target. Reactive.
   *
   * @remarks
   * The held value when a learner is holding one, the accepted value
   * otherwise - exactly {@link InteractionController.valueFor}, read through
   * this readout's dependency.
   */
  public valueFor(target: string): number {
    this.version();
    return this.controller.valueFor(target);
  }

  /**
   * The held value for a target, or `null` when nothing is held for it.
   * Reactive.
   */
  public provisionalValue(target: string): number | null {
    this.version();
    return this.controller.provisionalValue(target);
  }

  /**
   * Stop tracking the controller.
   *
   * @remarks
   * Idempotent. Reads afterwards still work and still return the truth; they
   * just stop being reactive.
   */
  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe();
  }
}
