export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface Vec4 extends Vec3 {
  readonly w: number;
}

export type Matrix4 = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

export interface Transform3D {
  readonly translation?: Vec3;
  readonly rotation?: Vec3;
  readonly scale?: Vec3;
}

export interface Camera3D {
  readonly eye: Vec3;
  readonly target: Vec3;
  readonly up?: Vec3;
}

export interface PerspectiveProjection {
  readonly kind: 'perspective';
  readonly verticalFovRadians: number;
  readonly aspect: number;
  readonly near: number;
  readonly far: number;
}

export interface OrthographicProjection {
  readonly kind: 'orthographic';
  readonly left: number;
  readonly right: number;
  readonly bottom: number;
  readonly top: number;
  readonly near: number;
  readonly far: number;
}

export type Projection3D = PerspectiveProjection | OrthographicProjection;

export interface Viewport3D {
  readonly x?: number;
  readonly y?: number;
  readonly width: number;
  readonly height: number;
}

export interface Vertex3D {
  readonly id: string;
  readonly position: Vec3;
}

export interface Face3D {
  readonly id: string;
  readonly vertexIds: readonly string[];
}

export interface Geometry3D {
  readonly vertices: readonly Vertex3D[];
  readonly faces: readonly Face3D[];
}

export interface ProjectionOptions {
  readonly model?: Matrix4;
  readonly view?: Matrix4;
  readonly camera?: Camera3D;
  readonly projection: Projection3D;
  readonly viewport: Viewport3D;
  readonly backfaceCulling?: boolean;
  readonly singularityEpsilon?: number;
}

export interface ProjectedPoint3D {
  readonly x: number;
  readonly y: number;
  readonly ndcDepth: number;
  readonly cameraDepth: number;
  readonly sourceVertexId?: string;
}

export interface ProjectedVertex3D {
  readonly id: string;
  readonly status: 'projected' | 'behind-near-plane';
  readonly point?: ProjectedPoint3D;
}

export interface ProjectedFace3D {
  readonly id: string;
  readonly points: readonly ProjectedPoint3D[];
  readonly depth: number;
}

export interface CulledFace3D {
  readonly id: string;
  readonly reason: 'back-face' | 'near-plane';
}

export interface ProjectionResult3D {
  readonly vertices: readonly ProjectedVertex3D[];
  /** Visible faces in painter order, farthest first. */
  readonly faces: readonly ProjectedFace3D[];
  readonly culledFaces: readonly CulledFace3D[];
}

export type ProjectionErrorCode =
  | 'INVALID_GEOMETRY'
  | 'INVALID_ID'
  | 'DUPLICATE_VERTEX_ID'
  | 'DUPLICATE_FACE_ID'
  | 'MISSING_VERTEX'
  | 'INVALID_FACE'
  | 'NON_FINITE_NUMBER'
  | 'INVALID_MATRIX'
  | 'SINGULAR_MATRIX'
  | 'INVALID_CAMERA'
  | 'INVALID_PROJECTION'
  | 'INVALID_VIEWPORT'
  | 'PROJECTION_SINGULARITY'
  | 'DEGENERATE_FACE';

export class ProjectionError extends Error {
  public constructor(
    public readonly code: ProjectionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ProjectionError';
  }
}
