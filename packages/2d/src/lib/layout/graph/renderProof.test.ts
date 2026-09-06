import {describe, expect, it} from 'vitest';
import {Circle} from '../../components/Circle';
import {Line} from '../../components/Line';
import {mockScene2D} from '../../components/__tests__/mockScene2D';
import {layoutLayeredGraph} from './layered';

describe('graph layout renderer consumption', () => {
  mockScene2D();

  it('places existing OvaCanvas nodes and lines from neutral layout output', () => {
    const result = layoutLayeredGraph({
      vertices: [
        {id: 'a', width: 30, height: 30},
        {id: 'b', width: 30, height: 30},
        {id: 'c', width: 30, height: 30},
      ],
      edges: [
        {id: 'a-b', source: 'a', target: 'b'},
        {id: 'a-c', source: 'a', target: 'c'},
      ],
    });

    const nodes = result.vertices.map(
      vertex =>
        new Circle({
          position: [vertex.x, vertex.y],
          size: [vertex.width, vertex.height],
        }),
    );
    const lines = result.edges.map(
      edge => new Line({points: edge.points.map(point => [point.x, point.y])}),
    );

    result.vertices.forEach((vertex, index) => {
      expect(nodes[index].position().x).toBe(vertex.x);
      expect(nodes[index].position().y).toBe(vertex.y);
    });
    result.edges.forEach((edge, index) => {
      expect(
        lines[index].parsedPoints().map(point => ({x: point.x, y: point.y})),
      ).toEqual(edge.points);
    });
  });
});
