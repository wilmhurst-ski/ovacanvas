import type {Color, Vector2} from '@ovacanvas/core';

export type Vec3Like =
  | readonly [number, number, number]
  | Readonly<{x: number; y: number; z: number}>;

export type QuaternionLike =
  | readonly [number, number, number, number]
  | Readonly<{x: number; y: number; z: number; w: number}>;

export interface Transform3DSpec {
  translation?: Vec3Like;
  rotation?: QuaternionLike;
  scale?: Vec3Like;
}

export interface Bounds3D {
  min: Readonly<{x: number; y: number; z: number}>;
  max: Readonly<{x: number; y: number; z: number}>;
}

export interface Ray3D {
  origin: Readonly<{x: number; y: number; z: number}>;
  direction: Readonly<{x: number; y: number; z: number}>;
}

export interface TriangleGeometry3D {
  kind: 'triangles';
  positions: readonly number[] | Float32Array;
  indices: readonly number[] | Uint16Array | Uint32Array;
  normals?: readonly number[] | Float32Array;
  colors?: readonly number[] | Float32Array;
}

export interface LineGeometry3D {
  kind: 'lines';
  positions: readonly number[] | Float32Array;
  indices?: readonly number[] | Uint16Array | Uint32Array;
  colors?: readonly number[] | Float32Array;
  topology: 'segments' | 'strip';
}

export interface PointGeometry3D {
  kind: 'points';
  positions: readonly number[] | Float32Array;
  colors?: readonly number[] | Float32Array;
  sizes?: readonly number[] | Float32Array;
}

export type PrimitiveGeometry3D =
  | TriangleGeometry3D
  | LineGeometry3D
  | PointGeometry3D;

export type Camera3DSpec =
  | {
      kind: 'perspective';
      eye: Vec3Like;
      target: Vec3Like;
      up?: Vec3Like;
      verticalFovRadians: number;
      near: number;
      far: number;
    }
  | {
      kind: 'orthographic';
      eye: Vec3Like;
      target: Vec3Like;
      up?: Vec3Like;
      verticalSize: number;
      near: number;
      far: number;
    };

export type ColorLike = Color | string;

export interface UnlitMaterial3DSpec {
  kind: 'unlit';
  color?: ColorLike;
  vertexColors?: boolean;
  opacity?: number;
  side?: 'front' | 'back' | 'double';
}

export interface LambertMaterial3DSpec {
  kind: 'lambert';
  color?: ColorLike;
  vertexColors?: boolean;
  opacity?: number;
  side?: 'front' | 'back' | 'double';
}

export type Material3DSpec = UnlitMaterial3DSpec | LambertMaterial3DSpec;

export interface AmbientLight3DSpec {
  kind: 'ambient';
  color?: ColorLike;
  intensity?: number;
}

export interface DirectionalLight3DSpec {
  kind: 'directional';
  direction: Vec3Like;
  color?: ColorLike;
  intensity?: number;
}

export type Light3DSpec = AmbientLight3DSpec | DirectionalLight3DSpec;

export interface PickResult3D {
  objectId: string;
  primitiveKind: 'triangle' | 'line' | 'point';
  primitiveIndex: number;
  worldPosition: Readonly<{x: number; y: number; z: number}>;
  localPosition: Readonly<{x: number; y: number; z: number}>;
  distance: number;
  barycentric?: readonly [number, number, number];
}

export interface ProjectedAnchor3D {
  position: Vector2;
  depth: number;
  inFront: boolean;
  insideClip: boolean;
  insideViewport: boolean;
  facingCamera?: boolean;
}

export interface RendererObservations3D {
  drawCalls: number;
  activeBuffers: number;
  activeVAOs: number;
  renderedTriangles: number;
  renderedLines: number;
  renderedPoints: number;
  reusedBuffers: number;
  allocatedBuffers: number;
}

export interface FitCameraOptions {
  bounds: Bounds3D;
  kind?: 'perspective' | 'orthographic';
  aspectRatio: number;
  padding?: number;
  direction?: Vec3Like;
  verticalFovRadians?: number;
}
