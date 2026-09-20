import {describe, expect, it} from 'vitest';
import {Node} from './Node';
import {PortNode} from './PortNode';
import {Wire} from './Wire';
import {mockScene2D} from './__tests__/mockScene2D';

describe('Wire', () => {
  mockScene2D();

  it('resolves both endpoints to literal points when given literal points', () => {
    const wire = new Wire({from: [0, 0], to: [100, 50]});
    const points = wire.parsedPoints();
    expect(points[0]).toEqual(expect.objectContaining({x: 0, y: 0}));
    expect(points[1]).toEqual(expect.objectContaining({x: 100, y: 50}));
  });

  it("resolves an endpoint bound to a port to that port's live position", () => {
    const gate = new PortNode({position: [100, 0], ports: {output: [20, 0]}});
    const wire = new Wire({from: [0, 0], to: {node: gate, port: 'output'}});

    const points = wire.parsedPoints();
    expect(points[1].x).toBeCloseTo(120);
    expect(points[1].y).toBeCloseTo(0);
  });

  it('never drifts from the port it targets as the host moves', () => {
    const gate = new PortNode({position: [0, 0], ports: {output: [20, 0]}});
    const wire = new Wire({from: [0, 0], to: {node: gate, port: 'output'}});

    const before = wire.parsedPoints()[1];
    expect(before.x).toBeCloseTo(20);

    gate.position([300, 40]);
    const after = wire.parsedPoints()[1];
    expect(after.x).toBeCloseTo(320);
    expect(after.y).toBeCloseTo(40);
  });

  it('connects two ports on two different hosts, both live', () => {
    const gateA = new PortNode({position: [0, 0], ports: {output: [30, 0]}});
    const gateB = new PortNode({position: [200, 0], ports: {input: [-30, 0]}});
    const wire = new Wire({
      from: {node: gateA, port: 'output'},
      to: {node: gateB, port: 'input'},
    });

    const points = wire.parsedPoints();
    // gateA.output world = (30, 0); gateB.input world = (170, 0)
    expect(points[0].x).toBeCloseTo(30);
    expect(points[1].x).toBeCloseTo(170);

    gateB.position([250, 10]);
    const after = wire.parsedPoints();
    expect(after[1].x).toBeCloseTo(220);
    expect(after[1].y).toBeCloseTo(10);
  });

  it("accounts for the wire's own parent space, not just world space", () => {
    // `gate` sits at the scene root, so its world position and its local
    // position are the same: output world = (10, 0). `wire` instead lives
    // inside `container`, offset to world (500, 0) - reading the port from
    // *inside* that container must subtract the container's own offset, so
    // the raw world number (10, 0) is not what a naive read would produce.
    const gate = new PortNode({position: [0, 0], ports: {output: [10, 0]}});
    const container = new Node({position: [500, 0]});
    const wire = new Wire({from: [0, 0], to: {node: gate, port: 'output'}});
    container.add(wire);

    const points = wire.parsedPoints();
    expect(points[1].x).toBeCloseTo(-490);
    expect(points[1].y).toBeCloseTo(0);
  });

  it('degrades to an empty, safely-rendered line instead of crashing when targeting an undeclared port', () => {
    // The reactive/computed layer catches and logs errors raised while
    // resolving a signal's value rather than letting them escape (see
    // `SignalContext.getter`/`ComputedContext.invoke`) - a broken point
    // shouldn't take down the whole render. `Wire` inherits that behavior
    // for free: a bad port reference logs, and the line falls back to
    // `Line`'s own no-points behavior instead of drawing a wrong point.
    // The direct, non-reactive throw (for authors calling the port lookup
    // themselves) is covered in `PortNode.test.ts`.
    const gate = new PortNode({ports: {output: [0, 0]}});
    const wire = new Wire({from: [0, 0], to: {node: gate, port: 'missing'}});
    expect(() => wire.parsedPoints()).not.toThrow();
    expect(wire.parsedPoints()).toEqual([]);
  });
});
