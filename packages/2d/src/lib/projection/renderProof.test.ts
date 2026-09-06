import {describe, expect, it} from 'vitest';
import {Line} from '../components/Line';
import {mockScene2D} from '../components/__tests__/mockScene2D';
import {projectGeometry3D} from './project';

describe('projected geometry renderer consumption', () => {
  mockScene2D();

  it('drives existing Lines in deterministic painter order', () => {
    const result = projectGeometry3D(
      {
        vertices: [
          {id: 'near-a', position: {x: -1, y: -1, z: -2}},
          {id: 'near-b', position: {x: 1, y: -1, z: -2}},
          {id: 'near-c', position: {x: 0, y: 1, z: -2}},
          {id: 'far-a', position: {x: -1, y: -1, z: -6}},
          {id: 'far-b', position: {x: 1, y: -1, z: -6}},
          {id: 'far-c', position: {x: 0, y: 1, z: -6}},
        ],
        faces: [
          {id: 'near', vertexIds: ['near-a', 'near-b', 'near-c']},
          {id: 'far', vertexIds: ['far-a', 'far-b', 'far-c']},
        ],
      },
      {
        projection: {
          kind: 'perspective',
          verticalFovRadians: Math.PI / 2,
          aspect: 1,
          near: 1,
          far: 20,
        },
        viewport: {width: 200, height: 200},
      },
    );
    const lines = result.faces.map(
      face =>
        new Line({
          points: face.points.map(point => [point.x, point.y]),
          closed: true,
        }),
    );

    expect(result.faces.map(face => face.id)).toEqual(['far', 'near']);
    result.faces.forEach((face, index) => {
      expect(
        lines[index].parsedPoints().map(point => ({x: point.x, y: point.y})),
      ).toEqual(face.points.map(point => ({x: point.x, y: point.y})));
      expect(lines[index].arcLength()).toBeGreaterThan(0);
    });
  });
});
