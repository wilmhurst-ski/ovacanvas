import {PossibleVector2, SignalValue, SimpleSignal} from '@ovacanvas/core';
import {nodeName, signal} from '../decorators';
import {Line, LineProps} from './Line';
import {PortNode} from './PortNode';

/** A reference to a named port on a {@link PortNode}. */
export interface PortRef {
  node: PortNode;
  port: string;
}

/** Where a {@link Wire} attaches: a literal point, or a live port. */
export type WireEndpoint = PossibleVector2 | PortRef;

export interface WireProps extends Omit<LineProps, 'points'> {
  /** {@inheritDoc Wire.from} */
  from: SignalValue<WireEndpoint>;
  /** {@inheritDoc Wire.to} */
  to: SignalValue<WireEndpoint>;
}

function isPortRef(value: WireEndpoint): value is PortRef {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    'node' in value &&
    'port' in value &&
    (value as {node: unknown}).node instanceof PortNode
  );
}

/**
 * A line whose endpoints can be bound to a named {@link PortNode} port
 * instead of a literal coordinate.
 *
 * @remarks
 * This is the fix for "the wire doesn't quite touch the gate/box/pin": a
 * `Wire` endpoint bound to `{node, port}` reads the exact same live number
 * the port host computes for itself, on every frame, so there is no second,
 * hand-typed coordinate that can drift out of sync with the first. Passing a
 * literal point instead (`[x, y]`, a `Vector2`, `{x, y}`) still works, so a
 * `Wire` can freely mix a live port on one end with a fixed point on the
 * other.
 *
 * @example
 * ```tsx
 * <Wire from={{node: gateA, port: 'output'}} to={{node: gateB, port: 'input1'}} />
 * ```
 */
@nodeName('Wire')
export class Wire extends Line {
  @signal()
  public declare readonly from: SimpleSignal<WireEndpoint, this>;

  @signal()
  public declare readonly to: SimpleSignal<WireEndpoint, this>;

  public constructor(props: WireProps) {
    super(props);
    this.points(() => [
      this.resolveEndpoint(this.from()),
      this.resolveEndpoint(this.to()),
    ]);
  }

  private resolveEndpoint(endpoint: WireEndpoint): PossibleVector2 {
    if (isPortRef(endpoint)) {
      return endpoint.node
        .portWorldPosition(endpoint.port)
        .transformAsPoint(this.worldToParent());
    }
    return endpoint;
  }
}
