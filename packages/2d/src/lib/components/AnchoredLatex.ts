import {
  Origin,
  SignalValue,
  SimpleSignal,
  Vector2,
  originToOffset,
} from '@ovacanvas/core';
import {computed, initial, nodeName, signal} from '../decorators';
import {Latex, LatexProps} from './Latex';
import type {Node} from './Node';

export interface AnchoredLatexProps extends LatexProps {
  /** The node this equation stays glued to. */
  anchor: SignalValue<Node>;
  /** Which side of the anchor the equation sits on. Defaults to {@link Origin.Right}. */
  origin?: SignalValue<Origin>;
  /** Distance from the anchor, in pixels along each non-zero axis of `origin`. Defaults to 24. */
  distance?: SignalValue<number>;
}

/**
 * A LaTeX equation whose position is permanently derived from another
 * node's position, never authored directly.
 *
 * @remarks
 * The `Latex` counterpart to `AnchoredLabel` - same computed-signal-ownership
 * trick (`this.position(() => ...)` called after `super(props)`), applied to
 * `Latex` instead of `Txt`. This exists because "anchor a short equation to
 * a point" and "equations must be Latex, never plain text" are both real
 * requirements at once: without this, the only anchored-label primitive in
 * the engine was `Txt`-only, which is itself how a label like `a = 3` ends
 * up authored as plain text next to a triangle's leg instead of as Latex -
 * exactly what `collectPlainTextMathNotation` (`audit/textNotation.ts`)
 * exists to catch. `AnchoredLatex` closes that gap instead of leaving
 * "anchored" and "must be Latex" in tension.
 */
@nodeName('AnchoredLatex')
export class AnchoredLatex extends Latex {
  @signal()
  public declare readonly anchor: SimpleSignal<Node, this>;

  @initial(Origin.Right)
  @signal()
  public declare readonly origin: SimpleSignal<Origin, this>;

  @initial(24)
  @signal()
  public declare readonly distance: SimpleSignal<number, this>;

  public constructor(props: AnchoredLatexProps) {
    super(props);
    this.position(() => this.anchoredPosition());
  }

  @computed()
  protected anchoredPosition(): Vector2 {
    const anchor = this.anchor();
    const anchorWorld = Vector2.zero.transformAsPoint(anchor.localToWorld());
    const anchorLocal = anchorWorld.transformAsPoint(this.worldToParent());
    return anchorLocal.add(
      originToOffset(this.origin()).scale(this.distance()),
    );
  }
}
