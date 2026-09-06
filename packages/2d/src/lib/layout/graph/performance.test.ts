import {describe, expect, it} from 'vitest';
import {layoutForceGraph} from './force';
import {layoutLayeredGraph} from './layered';
import {GraphInput} from './types';

function graphOfSize(size: number): GraphInput {
  const vertices = Array.from({length: size}, (_, index) => ({
    id: `v${index.toString().padStart(3, '0')}`,
    width: 20,
    height: 20,
  }));
  const edges = [];
  for (let index = 1; index < size; index += 1) {
    edges.push({
      id: `e${index.toString().padStart(3, '0')}`,
      source: vertices[Math.floor((index - 1) / 2)].id,
      target: vertices[index].id,
    });
  }
  return {vertices, edges};
}

describe('graph layout representative performance', () => {
  it('records bounded small, medium, and 200-vertex computations', () => {
    const timings: Record<string, {layeredMs: number; forceMs: number}> = {};
    for (const size of [10, 80, 200]) {
      const graph = graphOfSize(size);
      const layeredStart = performance.now();
      const layered = layoutLayeredGraph(graph);
      const layeredMs = performance.now() - layeredStart;
      const forceStart = performance.now();
      const force = layoutForceGraph(graph, {seed: 20260906, iterations: 100});
      const forceMs = performance.now() - forceStart;
      expect(layered.vertices).toHaveLength(size);
      expect(force.vertices).toHaveLength(size);
      timings[String(size)] = {layeredMs, forceMs};
    }
    console.info(`CAP02_TIMINGS ${JSON.stringify(timings)}`);
  });
});
