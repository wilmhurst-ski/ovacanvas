import {describe, expect, it, vi} from 'vitest';
import {layoutForceGraph} from './force';
import {layoutLayeredGraph} from './layered';
import {GraphInput, GraphLayoutError} from './types';

const DAG: GraphInput = {
  vertices: [
    {id: 'root', width: 40, height: 30},
    {id: 'left', width: 30, height: 20},
    {id: 'right', width: 30, height: 20},
    {id: 'leaf', width: 40, height: 30},
  ],
  edges: [
    {id: 'edge-root-left', source: 'root', target: 'left'},
    {id: 'edge-root-right', source: 'root', target: 'right'},
    {id: 'edge-left-leaf', source: 'left', target: 'leaf'},
    {id: 'edge-right-leaf', source: 'right', target: 'leaf'},
  ],
};

function expectErrorCode(callback: () => unknown, code: string) {
  try {
    callback();
  } catch (error) {
    expect(error).toBeInstanceOf(GraphLayoutError);
    expect((error as GraphLayoutError).code).toBe(code);
    return;
  }
  throw new Error(`Expected ${code} failure.`);
}

describe('layered graph layout', () => {
  it('lays out every vertex and edge in deterministic DAG layers', () => {
    const result = layoutLayeredGraph(DAG);
    expect(result.kind).toBe('layered');
    expect(result.vertices.map(vertex => vertex.id)).toEqual([
      'leaf',
      'left',
      'right',
      'root',
    ]);
    expect(result.edges.map(edge => edge.id)).toEqual([
      'edge-left-leaf',
      'edge-right-leaf',
      'edge-root-left',
      'edge-root-right',
    ]);
    expect(new Set(result.vertices.map(vertex => vertex.id)).size).toBe(4);
    expect(new Set(result.edges.map(edge => edge.id)).size).toBe(4);
    for (const vertex of result.vertices) {
      expect(Number.isFinite(vertex.x)).toBe(true);
      expect(Number.isFinite(vertex.y)).toBe(true);
    }

    const vertices = new Map(
      result.vertices.map(vertex => [vertex.id, vertex]),
    );
    expect(vertices.get('root')!.layer).toBe(0);
    expect(vertices.get('left')!.layer).toBe(1);
    expect(vertices.get('right')!.layer).toBe(1);
    expect(vertices.get('leaf')!.layer).toBe(2);
    expect(vertices.get('root')!.y).toBeLessThan(vertices.get('left')!.y);
    expect(vertices.get('left')!.y).toBeLessThan(vertices.get('leaf')!.y);
  });

  it('is independent of caller insertion order and repeats bit-exactly', () => {
    const shuffled: GraphInput = {
      vertices: [
        DAG.vertices[2],
        DAG.vertices[0],
        DAG.vertices[3],
        DAG.vertices[1],
      ],
      edges: [DAG.edges[3], DAG.edges[1], DAG.edges[0], DAG.edges[2]],
    };
    const expected = layoutLayeredGraph(DAG);
    expect(layoutLayeredGraph(shuffled)).toEqual(expected);
    expect(layoutLayeredGraph(DAG)).toEqual(expected);
  });

  it('returns finite deterministic waypoint routes owned by their edge IDs', () => {
    const first = layoutLayeredGraph(DAG);
    const second = layoutLayeredGraph(DAG);
    expect(second.edges).toEqual(first.edges);

    const vertices = new Map(first.vertices.map(vertex => [vertex.id, vertex]));
    for (const edge of first.edges) {
      expect(edge.points.length).toBeGreaterThanOrEqual(2);
      for (const point of edge.points) {
        expect(Number.isFinite(point.x)).toBe(true);
        expect(Number.isFinite(point.y)).toBe(true);
      }
      const source = vertices.get(edge.source)!;
      const target = vertices.get(edge.target)!;
      const firstPoint = edge.points[0];
      const lastPoint = edge.points.at(-1)!;
      const startToSource = Math.hypot(
        firstPoint.x - source.x,
        firstPoint.y - source.y,
      );
      const startToTarget = Math.hypot(
        firstPoint.x - target.x,
        firstPoint.y - target.y,
      );
      const endToSource = Math.hypot(
        lastPoint.x - source.x,
        lastPoint.y - source.y,
      );
      const endToTarget = Math.hypot(
        lastPoint.x - target.x,
        lastPoint.y - target.y,
      );
      expect(startToSource).toBeLessThan(startToTarget);
      expect(endToTarget).toBeLessThan(endToSource);
    }
  });

  it('preserves retained semantic IDs across topology recomputation', () => {
    const before = layoutLayeredGraph({
      vertices: [{id: 'a'}, {id: 'b'}],
      edges: [{id: 'a-b', source: 'a', target: 'b'}],
    });
    const after = layoutLayeredGraph({
      vertices: [{id: 'c'}, {id: 'b'}, {id: 'a'}],
      edges: [
        {id: 'b-c', source: 'b', target: 'c'},
        {id: 'a-c', source: 'a', target: 'c'},
      ],
    });

    const beforeIds = before.vertices.map(vertex => vertex.id);
    const afterIds = after.vertices.map(vertex => vertex.id);
    expect(afterIds.filter(id => beforeIds.includes(id))).toEqual(['a', 'b']);
    expect(afterIds.filter(id => !beforeIds.includes(id))).toEqual(['c']);
    expect(after.vertices).toHaveLength(3);
    expect(after.edges).toHaveLength(2);
  });

  it('fails closed for duplicate identities, missing endpoints, and cycles', () => {
    expectErrorCode(
      () =>
        layoutLayeredGraph({
          vertices: [{id: 'a'}, {id: 'a'}],
          edges: [],
        }),
      'DUPLICATE_VERTEX_ID',
    );
    expectErrorCode(
      () =>
        layoutLayeredGraph({
          vertices: [{id: 'a'}, {id: 'b'}],
          edges: [
            {id: 'same', source: 'a', target: 'b'},
            {id: 'same', source: 'a', target: 'b'},
          ],
        }),
      'DUPLICATE_EDGE_ID',
    );
    expectErrorCode(
      () =>
        layoutLayeredGraph({
          vertices: [{id: 'a'}],
          edges: [{id: 'a-b', source: 'a', target: 'b'}],
        }),
      'MISSING_ENDPOINT',
    );
    expectErrorCode(
      () =>
        layoutLayeredGraph({
          vertices: [{id: 'a'}, {id: 'b'}],
          edges: [
            {id: 'a-b', source: 'a', target: 'b'},
            {id: 'b-a', source: 'b', target: 'a'},
          ],
        }),
      'CYCLE',
    );
  });

  it('rejects malformed IDs and non-finite layout configuration', () => {
    expectErrorCode(
      () => layoutLayeredGraph({vertices: [{id: 'not canonical'}], edges: []}),
      'INVALID_ID',
    );
    expectErrorCode(
      () => layoutLayeredGraph(DAG, {rankSeparation: Number.NaN}),
      'INVALID_CONFIGURATION',
    );
  });
});

describe('force graph layout', () => {
  const forceGraph: GraphInput = {
    vertices: [{id: 'a'}, {id: 'b'}, {id: 'c'}, {id: 'd'}],
    edges: [
      {id: 'a-b', source: 'a', target: 'b'},
      {id: 'b-c', source: 'b', target: 'c'},
      {id: 'c-d', source: 'c', target: 'd'},
      {id: 'd-a', source: 'd', target: 'a'},
    ],
  };

  it('is deterministic for the same seed and fixed iteration count', () => {
    const config = {seed: 0x12345678, iterations: 120};
    const first = layoutForceGraph(forceGraph, config);
    const second = layoutForceGraph(forceGraph, config);
    expect(second).toEqual(first);
    expect(first.vertices).toHaveLength(4);
    expect(first.edges).toHaveLength(4);
    for (const vertex of first.vertices) {
      expect(Number.isFinite(vertex.x)).toBe(true);
      expect(Number.isFinite(vertex.y)).toBe(true);
    }
  });

  it('is independent of caller insertion order and changes with the seed', () => {
    const shuffled: GraphInput = {
      vertices: [...forceGraph.vertices].reverse(),
      edges: [
        forceGraph.edges[2],
        forceGraph.edges[0],
        forceGraph.edges[3],
        forceGraph.edges[1],
      ],
    };
    const config = {seed: 42, iterations: 80};
    const canonical = layoutForceGraph(forceGraph, config);
    expect(layoutForceGraph(shuffled, config)).toEqual(canonical);
    expect(layoutForceGraph(forceGraph, {...config, seed: 43})).not.toEqual(
      canonical,
    );
  });

  it('uses no timers or animation frames and returns synchronously', () => {
    const raf = vi.spyOn(window, 'requestAnimationFrame');
    const timeout = vi.spyOn(window, 'setTimeout');
    const interval = vi.spyOn(window, 'setInterval');
    try {
      const result = layoutForceGraph(forceGraph, {seed: 7, iterations: 25});
      expect(result.vertices).toHaveLength(4);
      expect(raf).not.toHaveBeenCalled();
      expect(timeout).not.toHaveBeenCalled();
      expect(interval).not.toHaveBeenCalled();
    } finally {
      raf.mockRestore();
      timeout.mockRestore();
      interval.mockRestore();
    }
  });

  it('rejects invalid seeds, iteration counts, and numeric configuration', () => {
    expectErrorCode(
      () => layoutForceGraph(forceGraph, {seed: -1, iterations: 10}),
      'INVALID_SEED',
    );
    expectErrorCode(
      () => layoutForceGraph(forceGraph, {seed: 1, iterations: 0}),
      'INVALID_ITERATIONS',
    );
    expectErrorCode(
      () => layoutForceGraph(forceGraph, {seed: 1, iterations: 1.5}),
      'INVALID_ITERATIONS',
    );
    expectErrorCode(
      () =>
        layoutForceGraph(forceGraph, {
          seed: 1,
          iterations: 10,
          linkDistance: Infinity,
        }),
      'INVALID_CONFIGURATION',
    );
  });
});
