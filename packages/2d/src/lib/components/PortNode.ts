import {
  PossibleVector2,
  SignalValue,
  SimpleSignal,
  unwrap,
  Vector2,
} from '@ovacanvas/core';
import {initial, nodeName, signal} from '../decorators';
import {Node, NodeProps} from './Node';

/** A named set of connection points, in the host node's own local space. */
export type PortMap = Record<string, SignalValue<PossibleVector2>>;

export interface PortNodeProps extends NodeProps {
  /** {@inheritDoc PortNode.ports} */
  ports?: SignalValue<PortMap>;
}

/**
 * A node that exposes named connection points ("ports") in its own local
 * space, so other nodes can attach to an exact, live-computed spot on it
 * instead of a hand-typed coordinate.
 *
 * @remarks
 * This is the general primitive behind every schematic-style symbol (logic
 * gates, resistors, block diagrams, and anything else built from a body plus
 * pins/leads/edges other things connect to) - deliberately with no prebuilt
 * symbols on top of it. A symbol declares where its pins are, once, in terms
 * of the same numbers used to draw its own body (e.g. a zigzag's own width
 * and amplitude, computed once and used for both the drawn line and the
 * port positions); everything downstream - most centrally `Wire` - reads
 * that declaration instead of re-deriving the coordinate.
 * That is what makes "the wire doesn't quite touch the gate" structurally
 * impossible rather than a mistake to catch after rendering: there is only
 * ever one number for where a given port is, and both the body drawing and
 * anything attached to the port read the same one.
 *
 * A port entry may itself be a function (`() => ...`), so a port can move
 * as the symbol animates (e.g. a gate that grows, or resizes its pin
 * spacing) without anything attached to it needing to change.
 */
@nodeName('PortNode')
export class PortNode extends Node {
  @initial({})
  @signal()
  public declare readonly ports: SimpleSignal<PortMap, this>;

  public constructor(props: PortNodeProps) {
    super(props);
  }

  /** The names of every port currently declared on this node. */
  public portNames(): readonly string[] {
    return Object.keys(this.ports());
  }

  public hasPort(name: string): boolean {
    return name in this.ports();
  }

  /** A port's position in this node's own local space. */
  public portLocalPosition(name: string): Vector2 {
    const map = this.ports();
    const entry = map[name];
    if (entry === undefined) {
      const known = Object.keys(map);
      throw new Error(
        `Unknown port "${name}" on <${this.constructor.name} key="${this.key}">. ` +
          `Known ports: ${known.length > 0 ? known.join(', ') : '(none declared)'}.`,
      );
    }
    return new Vector2(unwrap(entry));
  }

  /** A port's position in world space, following this node's own transform. */
  public portWorldPosition(name: string): Vector2 {
    return this.portLocalPosition(name).transformAsPoint(this.localToWorld());
  }
}
