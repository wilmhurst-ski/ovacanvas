import {
  assertInvertibleMatrix4,
  DEFAULT_SINGULARITY_EPSILON,
  homogeneousDivide,
  identityMatrix4,
  lookAtViewMatrix,
  multiplyMatrix4,
  normalizeFinite,
  projectionMatrix,
  transformVector4,
  validateMatrix4,
  validateVec3,
} from './matrix';
import {
  Face3D,
  Geometry3D,
  Matrix4,
  ProjectedFace3D,
  ProjectedPoint3D,
  ProjectionError,
  ProjectionOptions,
  ProjectionResult3D,
  Vec3,
  Viewport3D,
} from './types';

const SEMANTIC_ID = /^[A-Za-z0-9_-]+$/;
const DEPTH_TIE_EPSILON = 1e-7;

interface CanonicalGeometry {
  readonly vertices: readonly {id: string; position: Vec3}[];
  readonly faces: readonly Face3D[];
}

interface ViewVertex {
  readonly position: Vec3;
  readonly sourceVertexId?: string;
}

interface ResolvedViewport {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function validateId(id: unknown, description: string): asserts id is string {
  if (typeof id !== 'string' || !SEMANTIC_ID.test(id)) {
    throw new ProjectionError(
      'INVALID_ID',
      `${description} must match [A-Za-z0-9_-]+.`,
    );
  }
}

function canonicalizeGeometry(geometry: Geometry3D): CanonicalGeometry {
  if (
    geometry === null ||
    typeof geometry !== 'object' ||
    !Array.isArray(geometry.vertices) ||
    !Array.isArray(geometry.faces)
  ) {
    throw new ProjectionError(
      'INVALID_GEOMETRY',
      'Geometry must contain vertex and face arrays.',
    );
  }

  const vertexIds = new Set<string>();
  const vertices = geometry.vertices.map((vertex, index) => {
    if (vertex === null || typeof vertex !== 'object') {
      throw new ProjectionError(
        'INVALID_GEOMETRY',
        `Vertex at index ${index} must be an object.`,
      );
    }
    validateId(vertex.id, `Vertex ID at index ${index}`);
    if (vertexIds.has(vertex.id)) {
      throw new ProjectionError(
        'DUPLICATE_VERTEX_ID',
        `Duplicate vertex ID: ${vertex.id}.`,
      );
    }
    vertexIds.add(vertex.id);
    return {
      id: vertex.id,
      position: validateVec3(vertex.position, `Vertex ${vertex.id}`),
    };
  });

  const faceIds = new Set<string>();
  const faces = geometry.faces.map((face, index) => {
    if (
      face === null ||
      typeof face !== 'object' ||
      !Array.isArray(face.vertexIds) ||
      face.vertexIds.length < 3
    ) {
      throw new ProjectionError(
        'INVALID_FACE',
        `Face at index ${index} must reference at least three vertices.`,
      );
    }
    validateId(face.id, `Face ID at index ${index}`);
    if (faceIds.has(face.id)) {
      throw new ProjectionError(
        'DUPLICATE_FACE_ID',
        `Duplicate face ID: ${face.id}.`,
      );
    }
    faceIds.add(face.id);
    const references = new Set<string>();
    for (const vertexId of face.vertexIds) {
      validateId(vertexId, `Face ${face.id} vertex reference`);
      if (!vertexIds.has(vertexId)) {
        throw new ProjectionError(
          'MISSING_VERTEX',
          `Face ${face.id} references missing vertex ${vertexId}.`,
        );
      }
      if (references.has(vertexId)) {
        throw new ProjectionError(
          'INVALID_FACE',
          `Face ${face.id} repeats vertex ${vertexId}.`,
        );
      }
      references.add(vertexId);
    }
    return {id: face.id, vertexIds: [...face.vertexIds]};
  });

  vertices.sort((a, b) => compareIds(a.id, b.id));
  faces.sort((a, b) => compareIds(a.id, b.id));
  return {vertices, faces};
}

function resolveViewport(viewport: Viewport3D): ResolvedViewport {
  if (viewport === null || typeof viewport !== 'object') {
    throw new ProjectionError(
      'INVALID_VIEWPORT',
      'Viewport must be an object.',
    );
  }
  const resolved = {
    x: normalizeFinite(viewport.x ?? 0, 'viewport.x'),
    y: normalizeFinite(viewport.y ?? 0, 'viewport.y'),
    width: normalizeFinite(viewport.width, 'viewport.width'),
    height: normalizeFinite(viewport.height, 'viewport.height'),
  };
  if (resolved.width <= 0 || resolved.height <= 0) {
    throw new ProjectionError(
      'INVALID_VIEWPORT',
      'Viewport width and height must be greater than zero.',
    );
  }
  return resolved;
}

function projectViewVertex(
  vertex: ViewVertex,
  projection: Matrix4,
  viewport: ResolvedViewport,
  epsilon: number,
): ProjectedPoint3D {
  const clip = transformVector4(projection, {...vertex.position, w: 1});
  const ndc = homogeneousDivide(clip, epsilon);
  return {
    x: normalizeFinite(
      viewport.x + ((ndc.x + 1) * viewport.width) / 2,
      'viewport x',
    ),
    y: normalizeFinite(
      viewport.y + ((1 - ndc.y) * viewport.height) / 2,
      'viewport y',
    ),
    ndcDepth: ndc.z,
    cameraDepth: normalizeFinite(vertex.position.z, 'camera depth'),
    ...(vertex.sourceVertexId === undefined
      ? {}
      : {sourceVertexId: vertex.sourceVertexId}),
  };
}

function clipAgainstNearPlane(
  vertices: readonly ViewVertex[],
  near: number,
): ViewVertex[] {
  const result: ViewVertex[] = [];
  const plane = -near;
  for (let index = 0; index < vertices.length; index += 1) {
    const start = vertices[index];
    const end = vertices[(index + 1) % vertices.length];
    const startInside = start.position.z <= plane;
    const endInside = end.position.z <= plane;

    if (startInside) result.push(start);
    if (startInside === endInside) continue;

    const t = (plane - start.position.z) / (end.position.z - start.position.z);
    result.push({
      position: {
        x: normalizeFinite(
          start.position.x + (end.position.x - start.position.x) * t,
          'near clip x',
        ),
        y: normalizeFinite(
          start.position.y + (end.position.y - start.position.y) * t,
          'near clip y',
        ),
        z: plane,
      },
    });
  }
  return result;
}

function faceOrientation(
  vertices: readonly ViewVertex[],
  faceId: string,
  perspective: boolean,
) {
  const origin = vertices[0].position;
  let normal: Vec3 | undefined;
  for (let index = 1; index < vertices.length - 1; index += 1) {
    const a = vertices[index].position;
    const b = vertices[index + 1].position;
    const ab = {x: a.x - origin.x, y: a.y - origin.y, z: a.z - origin.z};
    const ac = {x: b.x - origin.x, y: b.y - origin.y, z: b.z - origin.z};
    const candidate = {
      x: ab.y * ac.z - ab.z * ac.y,
      y: ab.z * ac.x - ab.x * ac.z,
      z: ab.x * ac.y - ab.y * ac.x,
    };
    if (
      Math.hypot(candidate.x, candidate.y, candidate.z) >
      DEFAULT_SINGULARITY_EPSILON
    ) {
      normal = candidate;
      break;
    }
  }
  if (!normal) {
    throw new ProjectionError(
      'DEGENERATE_FACE',
      `Face ${faceId} has no geometric orientation.`,
    );
  }
  const centroid = vertices.reduce(
    (sum, vertex) => ({
      x: sum.x + vertex.position.x / vertices.length,
      y: sum.y + vertex.position.y / vertices.length,
      z: sum.z + vertex.position.z / vertices.length,
    }),
    {x: 0, y: 0, z: 0},
  );
  return perspective
    ? normal.x * centroid.x + normal.y * centroid.y + normal.z * centroid.z
    : -normal.z;
}

function compareProjectedFaces(a: ProjectedFace3D, b: ProjectedFace3D) {
  const delta = a.depth - b.depth;
  return Math.abs(delta) < DEPTH_TIE_EPSILON
    ? compareIds(a.id, b.id)
    : delta < 0
      ? -1
      : 1;
}

/**
 * Project renderer-neutral, non-intersecting polygonal 3D geometry.
 *
 * Uses a right-handed view looking down negative Z, OpenGL NDC depth, and a
 * y-down 2D viewport. Near-plane clipping occurs in camera space before the
 * explicit per-vertex homogeneous divide.
 *
 * @internal This capability boundary is not a frozen public serialization API.
 */
export function projectGeometry3D(
  geometry: Geometry3D,
  options: ProjectionOptions,
): ProjectionResult3D {
  if (options === null || typeof options !== 'object') {
    throw new ProjectionError(
      'INVALID_PROJECTION',
      'Projection options must be an object.',
    );
  }
  const canonical = canonicalizeGeometry(geometry);
  if (
    options.backfaceCulling !== undefined &&
    typeof options.backfaceCulling !== 'boolean'
  ) {
    throw new ProjectionError(
      'INVALID_PROJECTION',
      'backfaceCulling must be a boolean.',
    );
  }
  if (options.view && options.camera) {
    throw new ProjectionError(
      'INVALID_CAMERA',
      'Specify either a view matrix or a camera, not both.',
    );
  }
  const model = options.model ?? identityMatrix4();
  const view =
    options.view ??
    (options.camera ? lookAtViewMatrix(options.camera) : identityMatrix4());
  validateMatrix4(model, 'model');
  validateMatrix4(view, 'view');
  assertInvertibleMatrix4(model, 'model');
  assertInvertibleMatrix4(view, 'view');
  const projection = projectionMatrix(options.projection);
  const viewport = resolveViewport(options.viewport);
  const epsilon = normalizeFinite(
    options.singularityEpsilon ?? DEFAULT_SINGULARITY_EPSILON,
    'singularityEpsilon',
  );
  if (epsilon <= 0) {
    throw new ProjectionError(
      'INVALID_PROJECTION',
      'singularityEpsilon must be greater than zero.',
    );
  }

  const modelView = multiplyMatrix4(view, model);
  const viewVertices = new Map(
    canonical.vertices.map(vertex => {
      const transformed = transformVector4(modelView, {
        ...vertex.position,
        w: 1,
      });
      if (Math.abs(transformed.w - 1) > epsilon) {
        throw new ProjectionError(
          'INVALID_MATRIX',
          'Model-view matrices must preserve affine point w.',
        );
      }
      return [
        vertex.id,
        {
          position: {x: transformed.x, y: transformed.y, z: transformed.z},
          sourceVertexId: vertex.id,
        } satisfies ViewVertex,
      ] as const;
    }),
  );
  const near = options.projection.near;
  const vertices = canonical.vertices.map(vertex => {
    const viewVertex = viewVertices.get(vertex.id)!;
    return viewVertex.position.z <= -near
      ? {
          id: vertex.id,
          status: 'projected' as const,
          point: projectViewVertex(viewVertex, projection, viewport, epsilon),
        }
      : {id: vertex.id, status: 'behind-near-plane' as const};
  });

  const faces: ProjectedFace3D[] = [];
  const culledFaces: ProjectionResult3D['culledFaces'][number][] = [];
  for (const face of canonical.faces) {
    const clipped = clipAgainstNearPlane(
      face.vertexIds.map(vertexId => viewVertices.get(vertexId)!),
      near,
    );
    if (clipped.length < 3) {
      culledFaces.push({id: face.id, reason: 'near-plane'});
      continue;
    }
    const orientation = faceOrientation(
      clipped,
      face.id,
      options.projection.kind === 'perspective',
    );
    if (options.backfaceCulling !== false && orientation >= 0) {
      culledFaces.push({id: face.id, reason: 'back-face'});
      continue;
    }
    const points = clipped.map(vertex =>
      projectViewVertex(vertex, projection, viewport, epsilon),
    );
    const depth = normalizeFinite(
      clipped.reduce((sum, vertex) => sum + vertex.position.z, 0) /
        clipped.length,
      `Face ${face.id} depth`,
    );
    faces.push({id: face.id, points, depth});
  }

  faces.sort(compareProjectedFaces);
  culledFaces.sort((a, b) => compareIds(a.id, b.id));
  return {vertices, faces, culledFaces};
}

/** Project one point with an already-composed MVP matrix. */
export function projectPoint3D(
  point: Vec3,
  mvp: Matrix4,
  viewport: Viewport3D,
  epsilon = DEFAULT_SINGULARITY_EPSILON,
): ProjectedPoint3D {
  assertInvertibleMatrix4(mvp, 'mvp', epsilon);
  const resolvedViewport = resolveViewport(viewport);
  const validPoint = validateVec3(point, 'point');
  const clip = transformVector4(mvp, {...validPoint, w: 1});
  const ndc = homogeneousDivide(clip, epsilon);
  return {
    x: normalizeFinite(
      resolvedViewport.x + ((ndc.x + 1) * resolvedViewport.width) / 2,
      'viewport x',
    ),
    y: normalizeFinite(
      resolvedViewport.y + ((1 - ndc.y) * resolvedViewport.height) / 2,
      'viewport y',
    ),
    ndcDepth: ndc.z,
    cameraDepth: validPoint.z,
  };
}
