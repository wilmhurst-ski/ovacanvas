import {describe, expect, it} from 'vitest';
import {projectGeometry3D} from './project';
import {Geometry3D} from './types';

function workload(faceCount: number): Geometry3D {
  const vertices: Geometry3D['vertices'][number][] = [];
  const faces: Geometry3D['faces'][number][] = [];
  for (let index = 0; index < faceCount; index += 1) {
    const faceId = `f${index.toString().padStart(4, '0')}`;
    const x = (index % 40) * 3 - 60;
    const y = Math.floor(index / 40) * 3 - 40;
    const z = -2 - (index % 10);
    const ids = ['a', 'b', 'c', 'd'].map(suffix => `${faceId}-${suffix}`);
    vertices.push(
      {id: ids[0], position: {x, y, z}},
      {id: ids[1], position: {x: x + 2, y, z}},
      {id: ids[2], position: {x: x + 2, y: y + 2, z}},
      {id: ids[3], position: {x, y: y + 2, z}},
    );
    faces.push({id: faceId, vertexIds: ids});
  }
  return {vertices, faces};
}

describe('projection representative performance', () => {
  it('records pure projection cost for small, moderate, and larger workloads', () => {
    const timings: Record<string, number> = {};
    for (const faceCount of [6, 120, 1000]) {
      const geometry = workload(faceCount);
      const start = performance.now();
      const result = projectGeometry3D(geometry, {
        projection: {
          kind: 'orthographic',
          left: -80,
          right: 80,
          bottom: -80,
          top: 80,
          near: 1,
          far: 20,
        },
        viewport: {width: 800, height: 800},
      });
      timings[String(faceCount)] = performance.now() - start;
      expect(result.faces).toHaveLength(faceCount);
    }
    console.info(`CAP04_TIMINGS ${JSON.stringify(timings)}`);
  });
});
