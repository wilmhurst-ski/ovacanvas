import {describe, expect, it} from 'vitest';
import {layoutRadialTreeGraph} from './radial';
import {GraphInput, GraphLayoutError} from './types';

describe('radial tree graph layout', () => {
  it('handles empty graphs gracefully', () => {
    const result = layoutRadialTreeGraph({vertices: [], edges: []});
    expect(result.kind).toBe('radial');
    expect(result.vertices).toEqual([]);
    expect(result.edges).toEqual([]);
  });

  it('lays out a single vertex at center coordinates', () => {
    const result = layoutRadialTreeGraph(
      {
        vertices: [{id: 'center', width: 50, height: 50}],
        edges: [],
      },
      {centerX: 100, centerY: -50},
    );

    expect(result.vertices).toHaveLength(1);
    expect(result.vertices[0].id).toBe('center');
    expect(result.vertices[0].x).toBe(100);
    expect(result.vertices[0].y).toBe(-50);
    expect(result.vertices[0].layer).toBe(0);
  });

  it('auto-detects highest-degree hub in star topology and places spokes radially', () => {
    const starGraph: GraphInput = {
      vertices: [
        {id: 'spoke1', width: 30, height: 30},
        {id: 'spoke2', width: 30, height: 30},
        {id: 'hub', width: 50, height: 50},
        {id: 'spoke3', width: 30, height: 30},
        {id: 'spoke4', width: 30, height: 30},
      ],
      edges: [
        {id: 'e1', source: 'hub', target: 'spoke1'},
        {id: 'e2', source: 'hub', target: 'spoke2'},
        {id: 'e3', source: 'hub', target: 'spoke3'},
        {id: 'e4', source: 'hub', target: 'spoke4'},
      ],
    };

    const result = layoutRadialTreeGraph(starGraph, {
      centerX: 0,
      centerY: 0,
      layerRadius: 150,
    });

    expect(result.kind).toBe('radial');
    const vertices = new Map(result.vertices.map(v => [v.id, v]));

    // Hub is at origin with layer 0
    const hub = vertices.get('hub')!;
    expect(hub.layer).toBe(0);
    expect(hub.x).toBeCloseTo(0);
    expect(hub.y).toBeCloseTo(0);

    // Spokes are all at radius 150 with layer 1
    const spokes = ['spoke1', 'spoke2', 'spoke3', 'spoke4'].map(
      id => vertices.get(id)!,
    );
    for (const spoke of spokes) {
      expect(spoke.layer).toBe(1);
      const dist = Math.hypot(spoke.x, spoke.y);
      expect(dist).toBeCloseTo(150);
    }

    // Spokes have distinct positions and positive angular separation
    const angles = spokes.map(s => Math.atan2(s.y, s.x));
    for (let i = 0; i < angles.length; i++) {
      for (let j = i + 1; j < angles.length; j++) {
        const diff = Math.abs(angles[i] - angles[j]);
        expect(diff).toBeGreaterThan(0.2);
      }
    }

    // Edge geometry connects hub to spokes
    expect(result.edges).toHaveLength(4);
    for (const edge of result.edges) {
      expect(edge.points).toHaveLength(2);
      const src = vertices.get(edge.source)!;
      const tgt = vertices.get(edge.target)!;
      expect(edge.points[0].x).toBeCloseTo(src.x);
      expect(edge.points[0].y).toBeCloseTo(src.y);
      expect(edge.points[1].x).toBeCloseTo(tgt.x);
      expect(edge.points[1].y).toBeCloseTo(tgt.y);
    }
  });

  it('respects explicit rootId and throws MISSING_ENDPOINT for nonexistent root', () => {
    const graph: GraphInput = {
      vertices: [
        {id: 'a', width: 20, height: 20},
        {id: 'b', width: 20, height: 20},
      ],
      edges: [{id: 'e1', source: 'a', target: 'b'}],
    };

    const result = layoutRadialTreeGraph(graph, {rootId: 'b'});
    const b = result.vertices.find(v => v.id === 'b')!;
    expect(b.layer).toBe(0);
    expect(b.x).toBe(0);
    expect(b.y).toBe(0);

    expect(() =>
      layoutRadialTreeGraph(graph, {rootId: 'nonexistent'}),
    ).toThrowError(GraphLayoutError);
  });

  it('validates startAngle and endAngle configuration', () => {
    const graph: GraphInput = {
      vertices: [{id: 'a', width: 10, height: 10}],
      edges: [],
    };

    expect(() =>
      layoutRadialTreeGraph(graph, {startAngle: Math.PI, endAngle: 0}),
    ).toThrowError(GraphLayoutError);
  });

  it('lays out multi-level tree hierarchy in concentric rings', () => {
    const hierarchy: GraphInput = {
      vertices: [
        {id: 'root', width: 40, height: 40},
        {id: 'branchA', width: 30, height: 30},
        {id: 'branchB', width: 30, height: 30},
        {id: 'leafA1', width: 20, height: 20},
        {id: 'leafA2', width: 20, height: 20},
        {id: 'leafB1', width: 20, height: 20},
      ],
      edges: [
        {id: 'e-r-a', source: 'root', target: 'branchA'},
        {id: 'e-r-b', source: 'root', target: 'branchB'},
        {id: 'e-a-1', source: 'branchA', target: 'leafA1'},
        {id: 'e-a-2', source: 'branchA', target: 'leafA2'},
        {id: 'e-b-1', source: 'branchB', target: 'leafB1'},
      ],
    };

    const layerRadius = 200;
    const result = layoutRadialTreeGraph(hierarchy, {
      rootId: 'root',
      layerRadius,
    });

    const vertices = new Map(result.vertices.map(v => [v.id, v]));

    // Root is at layer 0 (radius 0)
    expect(vertices.get('root')!.layer).toBe(0);
    expect(
      Math.hypot(vertices.get('root')!.x, vertices.get('root')!.y),
    ).toBeCloseTo(0);

    // Branches are at layer 1 (radius 200)
    expect(vertices.get('branchA')!.layer).toBe(1);
    expect(vertices.get('branchB')!.layer).toBe(1);
    expect(
      Math.hypot(vertices.get('branchA')!.x, vertices.get('branchA')!.y),
    ).toBeCloseTo(layerRadius);
    expect(
      Math.hypot(vertices.get('branchB')!.x, vertices.get('branchB')!.y),
    ).toBeCloseTo(layerRadius);

    // Leaves are at layer 2 (radius 400)
    for (const leafId of ['leafA1', 'leafA2', 'leafB1']) {
      const leaf = vertices.get(leafId)!;
      expect(leaf.layer).toBe(2);
      expect(Math.hypot(leaf.x, leaf.y)).toBeCloseTo(layerRadius * 2);
    }
  });

  it('is deterministic regardless of input node and edge insertion order', () => {
    const g1: GraphInput = {
      vertices: [
        {id: 'h', width: 10, height: 10},
        {id: 'c1', width: 10, height: 10},
        {id: 'c2', width: 10, height: 10},
      ],
      edges: [
        {id: 'e1', source: 'h', target: 'c1'},
        {id: 'e2', source: 'h', target: 'c2'},
      ],
    };

    const g2: GraphInput = {
      vertices: [
        {id: 'c2', width: 10, height: 10},
        {id: 'h', width: 10, height: 10},
        {id: 'c1', width: 10, height: 10},
      ],
      edges: [
        {id: 'e2', source: 'h', target: 'c2'},
        {id: 'e1', source: 'h', target: 'c1'},
      ],
    };

    const r1 = layoutRadialTreeGraph(g1);
    const r2 = layoutRadialTreeGraph(g2);

    expect(r1.vertices).toEqual(r2.vertices);
    expect(r1.edges).toEqual(r2.edges);
  });
});
