import {describe, expect, it, vi} from 'vitest';
import {
  composeModelMatrix,
  homogeneousDivide,
  identityMatrix4,
  lookAtViewMatrix,
  orthographicMatrix,
  perspectiveMatrix,
  transformPoint3,
  transformVector4,
} from './matrix';
import {projectGeometry3D, projectPoint3D} from './project';
import {
  Geometry3D,
  OrthographicProjection,
  PerspectiveProjection,
  ProjectionError,
} from './types';

const VIEWPORT = {width: 200, height: 100};
const PERSPECTIVE: PerspectiveProjection = {
  kind: 'perspective',
  verticalFovRadians: Math.PI / 2,
  aspect: 1,
  near: 1,
  far: 20,
};
const ORTHOGRAPHIC: OrthographicProjection = {
  kind: 'orthographic',
  left: -2,
  right: 2,
  bottom: -2,
  top: 2,
  near: 1,
  far: 20,
};

function expectCode(callback: () => unknown, code: string) {
  try {
    callback();
  } catch (error) {
    expect(error).toBeInstanceOf(ProjectionError);
    expect((error as ProjectionError).code).toBe(code);
    return;
  }
  throw new Error(`Expected ${code}.`);
}

function faceGeometry(depth: number, faceId = 'face'): Geometry3D {
  return {
    vertices: [
      {id: `${faceId}-a`, position: {x: -1, y: -1, z: depth}},
      {id: `${faceId}-b`, position: {x: 1, y: -1, z: depth}},
      {id: `${faceId}-c`, position: {x: 0, y: 1, z: depth}},
    ],
    faces: [
      {
        id: faceId,
        vertexIds: [`${faceId}-a`, `${faceId}-b`, `${faceId}-c`],
      },
    ],
  };
}

describe('CAP-04 matrices and projection', () => {
  it('projects a known point through the identity matrix', () => {
    expect(
      projectPoint3D({x: 0.5, y: -0.5, z: 0}, identityMatrix4(), VIEWPORT),
    ).toEqual({
      x: 150,
      y: 75,
      ndcDepth: 0,
      cameraDepth: 0,
    });
  });

  it('composes scale, rotation, and translation deterministically', () => {
    const model = composeModelMatrix({
      scale: {x: 2, y: 1, z: 1},
      rotation: {x: 0, y: 0, z: Math.PI / 2},
      translation: {x: 1, y: 2, z: -2},
    });
    const result = transformPoint3(model, {x: 1, y: 0, z: 0});
    expect(result.x).toBeCloseTo(1, 6);
    expect(result.y).toBeCloseTo(4, 6);
    expect(result.z).toBeCloseTo(-2, 6);
  });

  it('performs the explicit homogeneous x/w, y/w, z/w divide', () => {
    expect(homogeneousDivide({x: 2, y: 4, z: 6, w: 2})).toEqual({
      x: 1,
      y: 2,
      z: 3,
    });

    const matrix = perspectiveMatrix({
      ...PERSPECTIVE,
      far: 9,
    });
    const clip = transformVector4(matrix, {x: 1, y: 2, z: -4, w: 1});
    expect(clip.w).toBeCloseTo(4, 7);
    expect(homogeneousDivide(clip)).toEqual({x: 0.25, y: 0.5, z: 0.6875});
  });

  it('shows perspective foreshortening at greater camera depth', () => {
    const matrix = perspectiveMatrix(PERSPECTIVE);
    const nearLeft = projectPoint3D({x: -1, y: 0, z: -2}, matrix, VIEWPORT);
    const nearRight = projectPoint3D({x: 1, y: 0, z: -2}, matrix, VIEWPORT);
    const farLeft = projectPoint3D({x: -1, y: 0, z: -4}, matrix, VIEWPORT);
    const farRight = projectPoint3D({x: 1, y: 0, z: -4}, matrix, VIEWPORT);
    const nearWidth = nearRight.x - nearLeft.x;
    const farWidth = farRight.x - farLeft.x;
    expect(nearWidth).toBeCloseTo(100, 6);
    expect(farWidth).toBeCloseTo(50, 6);
    expect(farWidth).toBeCloseTo(nearWidth / 2, 6);
  });

  it('keeps orthographic size independent of depth', () => {
    const matrix = orthographicMatrix(ORTHOGRAPHIC);
    const nearLeft = projectPoint3D({x: -1, y: 0, z: -2}, matrix, VIEWPORT);
    const nearRight = projectPoint3D({x: 1, y: 0, z: -2}, matrix, VIEWPORT);
    const farLeft = projectPoint3D({x: -1, y: 0, z: -8}, matrix, VIEWPORT);
    const farRight = projectPoint3D({x: 1, y: 0, z: -8}, matrix, VIEWPORT);
    expect(nearRight.x - nearLeft.x).toBe(100);
    expect(farRight.x - farLeft.x).toBe(100);
  });

  it('constructs a deterministic right-handed look-at view', () => {
    const view = lookAtViewMatrix({
      eye: {x: 0, y: 0, z: 5},
      target: {x: 0, y: 0, z: 0},
    });
    expect(transformPoint3(view, {x: 0, y: 0, z: 0})).toEqual({
      x: 0,
      y: 0,
      z: -5,
    });

    const result = projectGeometry3D(faceGeometry(0), {
      camera: {eye: {x: 0, y: 0, z: 5}, target: {x: 0, y: 0, z: 0}},
      projection: PERSPECTIVE,
      viewport: VIEWPORT,
    });
    expect(result.faces).toHaveLength(1);
    expect(result.faces[0].depth).toBe(-5);
  });

  it('rejects non-finite input, invalid matrices, cameras, and projections', () => {
    expectCode(
      () =>
        projectGeometry3D(
          {
            vertices: [{id: 'a', position: {x: Number.NaN, y: 0, z: -2}}],
            faces: [],
          },
          {projection: PERSPECTIVE, viewport: VIEWPORT},
        ),
      'NON_FINITE_NUMBER',
    );
    expectCode(
      () =>
        projectPoint3D(
          {x: 0, y: 0, z: -2},
          new Array(16).fill(0) as never,
          VIEWPORT,
        ),
      'SINGULAR_MATRIX',
    );
    expectCode(
      () =>
        lookAtViewMatrix({
          eye: {x: 0, y: 0, z: 0},
          target: {x: 0, y: 0, z: 0},
        }),
      'INVALID_CAMERA',
    );
    expectCode(
      () => perspectiveMatrix({...PERSPECTIVE, near: 0}),
      'INVALID_PROJECTION',
    );
    expectCode(
      () => homogeneousDivide({x: 1, y: 1, z: 1, w: 0}),
      'PROJECTION_SINGULARITY',
    );
    expectCode(
      () => homogeneousDivide({x: 1, y: 1, z: 1, w: 1e-12}),
      'PROJECTION_SINGULARITY',
    );
  });
});

describe('CAP-04 face projection', () => {
  it('uses geometric winding for back-face culling', () => {
    const front = faceGeometry(-3, 'front');
    const geometry: Geometry3D = {
      vertices: front.vertices,
      faces: [
        front.faces[0],
        {id: 'rear', vertexIds: [...front.faces[0].vertexIds].reverse()},
      ],
    };
    const results = [PERSPECTIVE, ORTHOGRAPHIC].map(projection =>
      projectGeometry3D(geometry, {projection, viewport: VIEWPORT}),
    );
    for (const result of results) {
      expect(result.faces.map(face => face.id)).toEqual(['front']);
      expect(result.culledFaces).toEqual([{id: 'rear', reason: 'back-face'}]);
    }
  });

  it('sorts faces far-to-near and resolves equal depth by stable ID', () => {
    const geometry: Geometry3D = {
      vertices: [
        ...faceGeometry(-2, 'near').vertices,
        ...faceGeometry(-6, 'far').vertices,
        ...faceGeometry(-4, 'beta').vertices,
        ...faceGeometry(-4, 'alpha').vertices,
      ],
      faces: [
        ...faceGeometry(-2, 'near').faces,
        ...faceGeometry(-4, 'beta').faces,
        ...faceGeometry(-6, 'far').faces,
        ...faceGeometry(-4, 'alpha').faces,
      ],
    };
    const result = projectGeometry3D(geometry, {
      projection: PERSPECTIVE,
      viewport: VIEWPORT,
    });
    expect(result.faces.map(face => face.id)).toEqual([
      'far',
      'alpha',
      'beta',
      'near',
    ]);
  });

  it('is independent of vertex and face array insertion order', () => {
    const geometry: Geometry3D = {
      vertices: [
        ...faceGeometry(-2, 'near').vertices,
        ...faceGeometry(-6, 'far').vertices,
      ],
      faces: [
        ...faceGeometry(-2, 'near').faces,
        ...faceGeometry(-6, 'far').faces,
      ],
    };
    const shuffled: Geometry3D = {
      vertices: [...geometry.vertices].reverse(),
      faces: [...geometry.faces].reverse(),
    };
    const options = {projection: PERSPECTIVE, viewport: VIEWPORT};
    expect(projectGeometry3D(shuffled, options)).toEqual(
      projectGeometry3D(geometry, options),
    );
  });

  it('clips crossing polygons at the near plane and culls fully hidden faces', () => {
    const result = projectGeometry3D(
      {
        vertices: [
          {id: 'a', position: {x: -1, y: -1, z: -2}},
          {id: 'b', position: {x: 1, y: -1, z: -2}},
          {id: 'c', position: {x: 0, y: 1, z: -0.5}},
          {id: 'd', position: {x: -1, y: -1, z: -0.5}},
          {id: 'e', position: {x: 1, y: -1, z: -0.5}},
          {id: 'f', position: {x: 0, y: 1, z: -0.5}},
        ],
        faces: [
          {id: 'crossing', vertexIds: ['a', 'b', 'c']},
          {id: 'hidden', vertexIds: ['d', 'e', 'f']},
        ],
      },
      {projection: PERSPECTIVE, viewport: VIEWPORT},
    );
    expect(result.faces).toHaveLength(1);
    expect(result.faces[0].id).toBe('crossing');
    expect(result.faces[0].points).toHaveLength(4);
    expect(
      result.faces[0].points.filter(point => !point.sourceVertexId),
    ).toHaveLength(2);
    expect(result.culledFaces).toContainEqual({
      id: 'hidden',
      reason: 'near-plane',
    });
    expect(
      result.vertices
        .filter(vertex => vertex.status === 'behind-near-plane')
        .map(vertex => vertex.id),
    ).toEqual(['c', 'd', 'e', 'f']);
    for (const point of result.faces[0].points) {
      expect(
        Object.values(point).every(
          value => typeof value === 'string' || Number.isFinite(value),
        ),
      ).toBe(true);
    }
  });

  it('preserves vertex and face identities when derived transforms change', () => {
    const geometry = faceGeometry(-4, 'stable');
    const first = projectGeometry3D(geometry, {
      projection: PERSPECTIVE,
      viewport: VIEWPORT,
    });
    const second = projectGeometry3D(geometry, {
      model: composeModelMatrix({translation: {x: 0.5, y: 0, z: -1}}),
      projection: PERSPECTIVE,
      viewport: VIEWPORT,
    });
    expect(second.vertices.map(vertex => vertex.id)).toEqual(
      first.vertices.map(vertex => vertex.id),
    );
    expect(second.faces.map(face => face.id)).toEqual(
      first.faces.map(face => face.id),
    );
    expect(second.faces[0].points).not.toEqual(first.faces[0].points);
  });

  it('creates no timers, animation frames, or background work', () => {
    const raf = vi.spyOn(window, 'requestAnimationFrame');
    const timeout = vi.spyOn(window, 'setTimeout');
    const interval = vi.spyOn(window, 'setInterval');
    try {
      const result = projectGeometry3D(faceGeometry(-3), {
        projection: PERSPECTIVE,
        viewport: VIEWPORT,
      });
      expect(result.faces).toHaveLength(1);
      expect(raf).not.toHaveBeenCalled();
      expect(timeout).not.toHaveBeenCalled();
      expect(interval).not.toHaveBeenCalled();
    } finally {
      raf.mockRestore();
      timeout.mockRestore();
      interval.mockRestore();
    }
  });

  it('validates identity, references, viewport, and degenerate faces', () => {
    expectCode(
      () =>
        projectGeometry3D(
          {
            vertices: [{id: 'bad id', position: {x: 0, y: 0, z: -2}}],
            faces: [],
          },
          {projection: PERSPECTIVE, viewport: VIEWPORT},
        ),
      'INVALID_ID',
    );
    expectCode(
      () =>
        projectGeometry3D(
          {
            vertices: [
              {id: 'a', position: {x: 0, y: 0, z: -2}},
              {id: 'b', position: {x: 1, y: 0, z: -2}},
            ],
            faces: [{id: 'face', vertexIds: ['a', 'b', 'missing']}],
          },
          {projection: PERSPECTIVE, viewport: VIEWPORT},
        ),
      'MISSING_VERTEX',
    );
    expectCode(
      () =>
        projectGeometry3D(faceGeometry(-3), {
          projection: PERSPECTIVE,
          viewport: {...VIEWPORT, width: Infinity},
        }),
      'NON_FINITE_NUMBER',
    );
    expectCode(
      () =>
        projectGeometry3D(
          {
            vertices: [
              {id: 'a', position: {x: 0, y: 0, z: -2}},
              {id: 'b', position: {x: 1, y: 0, z: -2}},
              {id: 'c', position: {x: 2, y: 0, z: -2}},
            ],
            faces: [{id: 'line', vertexIds: ['a', 'b', 'c']}],
          },
          {
            projection: PERSPECTIVE,
            viewport: VIEWPORT,
            backfaceCulling: false,
          },
        ),
      'DEGENERATE_FACE',
    );
  });
});
