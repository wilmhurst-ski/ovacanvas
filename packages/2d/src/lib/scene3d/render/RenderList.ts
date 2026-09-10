import {Matrix4} from '../math/matrix4';
import {Vector3} from '../math/vector3';
import {Line3D} from '../scene/Line3D';
import {Mesh3D} from '../scene/Mesh3D';
import {PointCloud3D} from '../scene/PointCloud3D';
import type {SceneWorld3D} from '../scene/SceneWorld3D';

export interface OpaqueMeshItem {
  mesh: Mesh3D;
  worldMatrix: Matrix4;
  normalMatrix: Float32Array;
}

export interface OpaqueLineItem {
  line: Line3D;
  worldMatrix: Matrix4;
}

export interface OpaquePointItem {
  points: PointCloud3D;
  worldMatrix: Matrix4;
}

export interface TransparentItem {
  item: Mesh3D | Line3D | PointCloud3D;
  worldMatrix: Matrix4;
  normalMatrix?: Float32Array;
  depth: number;
}

export class RenderList {
  public opaqueMeshes: OpaqueMeshItem[] = [];
  public opaqueLines: OpaqueLineItem[] = [];
  public opaquePoints: OpaquePointItem[] = [];
  public transparentItems: TransparentItem[] = [];

  public build(
    world: SceneWorld3D,
    cameraEye: Vector3,
    cameraViewDir: Vector3,
  ): void {
    this.opaqueMeshes.length = 0;
    this.opaqueLines.length = 0;
    this.opaquePoints.length = 0;
    this.transparentItems.length = 0;

    world.traverse(obj => {
      if (!obj.visible) return;

      const worldMatrix = obj.getWorldMatrix();

      if (obj instanceof Mesh3D) {
        const opacity = obj.material.opacity ?? 1.0;
        const isTransparent = opacity < 1.0;
        const normalMatrix = worldMatrix.normalMatrix();

        if (isTransparent) {
          const center = obj.getWorldBounds().getCenter();
          const depth = center.sub(cameraEye).dot(cameraViewDir);
          this.transparentItems.push({
            item: obj,
            worldMatrix,
            normalMatrix,
            depth,
          });
        } else {
          this.opaqueMeshes.push({
            mesh: obj,
            worldMatrix,
            normalMatrix,
          });
        }
      } else if (obj instanceof Line3D) {
        const isTransparent = obj.opacity < 1.0;
        if (isTransparent) {
          const center = obj.getWorldBounds().getCenter();
          const depth = center.sub(cameraEye).dot(cameraViewDir);
          this.transparentItems.push({
            item: obj,
            worldMatrix,
            depth,
          });
        } else {
          this.opaqueLines.push({
            line: obj,
            worldMatrix,
          });
        }
      } else if (obj instanceof PointCloud3D) {
        const isTransparent = obj.opacity < 1.0;
        if (isTransparent) {
          const center = obj.getWorldBounds().getCenter();
          const depth = center.sub(cameraEye).dot(cameraViewDir);
          this.transparentItems.push({
            item: obj,
            worldMatrix,
            depth,
          });
        } else {
          this.opaquePoints.push({
            points: obj,
            worldMatrix,
          });
        }
      }
    });

    // Sort transparent items back-to-front (greatest depth first)
    this.transparentItems.sort((a, b) => {
      if (Math.abs(b.depth - a.depth) > 1e-6) {
        return b.depth - a.depth;
      }
      return a.item.id.localeCompare(b.item.id);
    });
  }
}
