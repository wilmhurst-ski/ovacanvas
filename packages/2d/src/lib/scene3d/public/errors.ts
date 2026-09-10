export type Scene3DErrorCode =
  | 'WEBGL2_UNAVAILABLE'
  | 'CONTEXT_LOST'
  | 'INVALID_VECTOR'
  | 'INVALID_MATRIX'
  | 'SINGULAR_TRANSFORM'
  | 'INVALID_CAMERA'
  | 'INVALID_GEOMETRY_LENGTH'
  | 'INVALID_INDEX'
  | 'DEGENERATE_PRIMITIVE'
  | 'DUPLICATE_OBJECT_ID'
  | 'UNSUPPORTED_MATERIAL'
  | 'SHADER_COMPILATION_FAILURE'
  | 'BUFFER_ALLOCATION_FAILURE'
  | 'VIEWPORT_NO_EXTENT'
  | 'PICKING_CAPACITY_EXCEEDED'
  | 'UNSUPPORTED_TRANSPARENCY_CASE';

export interface Scene3DErrorDetails {
  objectId?: string;
  field?: string;
  expected?: string;
  received?: unknown;
  cause?: unknown;
}

export class Scene3DError extends Error {
  public readonly code: Scene3DErrorCode;
  public readonly details?: Scene3DErrorDetails;

  public constructor(
    code: Scene3DErrorCode,
    message: string,
    details?: Scene3DErrorDetails,
  ) {
    super(`[Scene3D:${code}] ${message}`);
    this.name = 'Scene3DError';
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, Scene3DError.prototype);
  }
}
