import {describe, expect, it} from 'vitest';
import {Node} from './Node';
import {PortNode} from './PortNode';
import {mockScene2D} from './__tests__/mockScene2D';

describe('PortNode', () => {
  mockScene2D();

  it('resolves a declared port to its local-space position', () => {
    const node = new PortNode({
      ports: {input: [-50, 0], output: [50, 0]},
    });

    expect(node.portLocalPosition('input')).toEqual(
      expect.objectContaining({x: -50, y: 0}),
    );
    expect(node.portLocalPosition('output')).toEqual(
      expect.objectContaining({x: 50, y: 0}),
    );
  });

  it('lists and checks port names', () => {
    const node = new PortNode({ports: {a: [0, 0], b: [1, 1]}});
    expect(node.portNames()).toEqual(['a', 'b']);
    expect(node.hasPort('a')).toBe(true);
    expect(node.hasPort('missing')).toBe(false);
  });

  it('throws a legible error for an unknown port, naming what is actually declared', () => {
    const node = new PortNode({ports: {input: [0, 0], output: [10, 0]}});
    expect(() => node.portLocalPosition('nope')).toThrow(
      /Unknown port "nope".*Known ports: input, output/s,
    );
  });

  it('reports "(none declared)" when the node has no ports at all', () => {
    const node = new PortNode({});
    expect(() => node.portLocalPosition('anything')).toThrow(
      /\(none declared\)/,
    );
  });

  it("follows this node's own transform when resolving to world space", () => {
    const parent = new Node({position: [100, 200]});
    const gate = new PortNode({
      position: [10, 0],
      ports: {output: [20, 0]},
    });
    parent.add(gate);

    // parent(100,200) + gate-local(10,0) + port-local(20,0) = (130, 200)
    const world = gate.portWorldPosition('output');
    expect(world.x).toBeCloseTo(130);
    expect(world.y).toBeCloseTo(200);
  });

  it('re-evaluates a port bound to a live signal, not a frozen snapshot', () => {
    let x = 0;
    const node = new PortNode({ports: {tracker: () => [x, 0]}});

    expect(node.portLocalPosition('tracker').x).toBe(0);
    x = 42;
    expect(node.portLocalPosition('tracker').x).toBe(42);
  });
});
