import {Color} from '@ovacanvas/core';
import {resolveCameraMatrices} from '../math/camera';
import {Vector3} from '../math/vector3';
import type {
  Camera3DSpec,
  ColorLike,
  RendererObservations3D,
} from '../public/types';
import {Line3D} from '../scene/Line3D';
import {Mesh3D} from '../scene/Mesh3D';
import {PointCloud3D} from '../scene/PointCloud3D';
import type {SceneWorld3D} from '../scene/SceneWorld3D';
import {RenderList} from './RenderList';
import type {Scene3DContextOwner} from './Scene3DContextOwner';

export interface RenderTargetView {
  width: number;
  height: number;
  resolutionScale?: number;
}

export function parseColor(
  color?: ColorLike | null,
  defaultAlpha = 1.0,
): [number, number, number, number] {
  if (!color) return [1, 1, 1, defaultAlpha];
  if (color instanceof Color) {
    const rgb = color.rgb();
    return [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, color.alpha()];
  }
  if (typeof color === 'string') {
    try {
      const c = new Color(color);
      const rgb = c.rgb();
      return [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, c.alpha()];
    } catch {
      return [1, 1, 1, defaultAlpha];
    }
  }
  return [1, 1, 1, defaultAlpha];
}

export class Scene3DRenderer {
  private readonly renderList = new RenderList();

  public render(
    owner: Scene3DContextOwner,
    world: SceneWorld3D,
    cameraSpec: Camera3DSpec,
    target: RenderTargetView,
  ): RendererObservations3D {
    const gl = owner.gl;
    if (!gl) {
      throw new Error('Scene3DContextOwner has no active WebGL2 context');
    }

    const scale = target.resolutionScale ?? 1.0;
    const pixelWidth = Math.max(1, Math.round(target.width * scale));
    const pixelHeight = Math.max(1, Math.round(target.height * scale));

    if (gl.canvas.width !== pixelWidth || gl.canvas.height !== pixelHeight) {
      gl.canvas.width = pixelWidth;
      gl.canvas.height = pixelHeight;
    }

    gl.viewport(0, 0, pixelWidth, pixelHeight);

    // Clear
    if (world.background) {
      const bg = parseColor(world.background, 1.0);
      gl.clearColor(bg[0], bg[1], bg[2], bg[3]);
    } else {
      gl.clearColor(0, 0, 0, 0);
    }

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    gl.clearDepth(1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const aspect = pixelWidth / pixelHeight;
    const camera = resolveCameraMatrices(cameraSpec, aspect);
    const cameraViewDir = camera.target.sub(camera.eye).normalize();

    this.renderList.build(world, camera.eye, cameraViewDir);

    let drawCalls = 0;
    let renderedTriangles = 0;
    let renderedLines = 0;
    let renderedPoints = 0;

    const programs = owner.programs;

    // Lights
    let ambientLightColor = [0.1, 0.1, 0.1];
    const directionalLightDirs: number[] = [];
    const directionalLightColors: number[] = [];
    let numDirectionalLights = 0;

    for (const light of world.lights) {
      const intensity = light.intensity ?? 1.0;
      const c = parseColor(light.color);
      if (light.kind === 'ambient') {
        ambientLightColor = [
          c[0] * intensity,
          c[1] * intensity,
          c[2] * intensity,
        ];
      } else if (light.kind === 'directional' && numDirectionalLights < 4) {
        const dir = Vector3.from(light.direction).normalize();
        directionalLightDirs.push(dir.x, dir.y, dir.z);
        directionalLightColors.push(
          c[0] * intensity,
          c[1] * intensity,
          c[2] * intensity,
        );
        numDirectionalLights++;
      }
    }

    // 1. OPAQUE MESH PASS
    if (this.renderList.opaqueMeshes.length > 0) {
      gl.useProgram(programs.meshProgram);
      const u = programs.meshUniforms;

      gl.depthMask(true);
      gl.enable(gl.DEPTH_TEST);

      gl.uniform3f(
        u.ambientLightColor,
        ambientLightColor[0],
        ambientLightColor[1],
        ambientLightColor[2],
      );
      if (numDirectionalLights > 0) {
        gl.uniform3fv(
          u.directionalLightDir,
          new Float32Array(directionalLightDirs),
        );
        gl.uniform3fv(
          u.directionalLightColor,
          new Float32Array(directionalLightColors),
        );
      }
      gl.uniform1i(u.numDirectionalLights, numDirectionalLights);

      for (const item of this.renderList.opaqueMeshes) {
        const mesh = item.mesh;
        const mvp = camera.viewProjection.multiply(item.worldMatrix);

        gl.uniformMatrix4fv(u.modelViewProjection, false, mvp.elements);
        gl.uniformMatrix4fv(u.model, false, item.worldMatrix.elements);
        gl.uniformMatrix3fv(u.normalMatrix, false, item.normalMatrix);

        const matColor = parseColor(mesh.material.color);
        gl.uniform4f(
          u.materialColor,
          matColor[0],
          matColor[1],
          matColor[2],
          matColor[3],
        );
        gl.uniform1i(u.materialKind, mesh.material.kind === 'lambert' ? 1 : 0);
        gl.uniform1i(
          u.useVertexColors,
          mesh.material.vertexColors && mesh.geometry.colors ? 1 : 0,
        );
        gl.uniform1f(u.opacity, mesh.material.opacity ?? 1.0);

        // Side policy
        if (mesh.material.side === 'front') {
          gl.enable(gl.CULL_FACE);
          gl.cullFace(gl.BACK);
        } else if (mesh.material.side === 'back') {
          gl.enable(gl.CULL_FACE);
          gl.cullFace(gl.FRONT);
        } else {
          gl.disable(gl.CULL_FACE);
        }

        const rec = owner.geometries.getMesh(
          gl,
          mesh.geometry,
          mesh.fingerprint,
        );
        gl.bindVertexArray(rec.vao);
        gl.drawElements(gl.TRIANGLES, rec.indexCount, rec.indexType, 0);
        drawCalls++;
        renderedTriangles += rec.indexCount / 3;
      }
    }

    // 2. OPAQUE LINE PASS
    if (this.renderList.opaqueLines.length > 0) {
      gl.useProgram(programs.lineProgram);
      const u = programs.lineUniforms;
      gl.disable(gl.CULL_FACE);

      for (const item of this.renderList.opaqueLines) {
        const line = item.line;
        if (line.depthTest) {
          gl.enable(gl.DEPTH_TEST);
        } else {
          gl.disable(gl.DEPTH_TEST);
        }
        gl.depthMask(line.depthTest);

        const mvp = camera.viewProjection.multiply(item.worldMatrix);
        gl.uniformMatrix4fv(u.modelViewProjection, false, mvp.elements);

        const lColor = parseColor(line.color);
        gl.uniform4f(u.lineColor, lColor[0], lColor[1], lColor[2], lColor[3]);
        gl.uniform1i(u.useVertexColors, line.geometry.colors ? 1 : 0);
        gl.uniform1f(u.opacity, line.opacity);

        const rec = owner.geometries.getLine(
          gl,
          line.geometry,
          line.fingerprint,
        );
        gl.bindVertexArray(rec.vao);

        if (rec.isIndexed) {
          gl.drawElements(gl.LINES, rec.count, rec.indexType!, 0);
          renderedLines += rec.count / 2;
        } else if (line.geometry.topology === 'strip') {
          gl.drawArrays(gl.LINE_STRIP, 0, rec.count);
          renderedLines += Math.max(0, rec.count - 1);
        } else {
          gl.drawArrays(gl.LINES, 0, rec.count);
          renderedLines += Math.floor(rec.count / 2);
        }
        drawCalls++;
      }
    }

    // 3. OPAQUE POINT PASS
    if (this.renderList.opaquePoints.length > 0) {
      gl.useProgram(programs.pointProgram);
      const u = programs.pointUniforms;
      gl.disable(gl.CULL_FACE);

      for (const item of this.renderList.opaquePoints) {
        const points = item.points;
        if (points.depthTest) {
          gl.enable(gl.DEPTH_TEST);
        } else {
          gl.disable(gl.DEPTH_TEST);
        }
        gl.depthMask(points.depthTest);

        const mvp = camera.viewProjection.multiply(item.worldMatrix);
        gl.uniformMatrix4fv(u.modelViewProjection, false, mvp.elements);

        const pColor = parseColor(points.color);
        gl.uniform4f(u.pointColor, pColor[0], pColor[1], pColor[2], pColor[3]);
        gl.uniform1f(u.defaultPointSize, points.pointSize);
        gl.uniform1i(u.useVertexColors, points.geometry.colors ? 1 : 0);
        gl.uniform1i(u.useVertexSizes, points.geometry.sizes ? 1 : 0);
        gl.uniform1f(u.opacity, points.opacity);

        const rec = owner.geometries.getPoint(
          gl,
          points.geometry,
          points.fingerprint,
        );
        gl.bindVertexArray(rec.vao);
        gl.drawArrays(gl.POINTS, 0, rec.count);
        drawCalls++;
        renderedPoints += rec.count;
      }
    }

    // 4. TRANSPARENT PASS (sorted back-to-front, depth writes disabled)
    if (this.renderList.transparentItems.length > 0) {
      gl.depthMask(false);
      gl.enable(gl.DEPTH_TEST);

      for (const item of this.renderList.transparentItems) {
        const obj = item.item;
        const mvp = camera.viewProjection.multiply(item.worldMatrix);

        if (obj instanceof Mesh3D) {
          gl.useProgram(programs.meshProgram);
          const u = programs.meshUniforms;

          gl.uniformMatrix4fv(u.modelViewProjection, false, mvp.elements);
          gl.uniformMatrix4fv(u.model, false, item.worldMatrix.elements);
          gl.uniformMatrix3fv(u.normalMatrix, false, item.normalMatrix!);

          const matColor = parseColor(obj.material.color);
          gl.uniform4f(
            u.materialColor,
            matColor[0],
            matColor[1],
            matColor[2],
            matColor[3],
          );
          gl.uniform1i(u.materialKind, obj.material.kind === 'lambert' ? 1 : 0);
          gl.uniform1i(
            u.useVertexColors,
            obj.material.vertexColors && obj.geometry.colors ? 1 : 0,
          );
          gl.uniform1f(u.opacity, obj.material.opacity ?? 1.0);

          if (obj.material.side === 'front') {
            gl.enable(gl.CULL_FACE);
            gl.cullFace(gl.BACK);
          } else if (obj.material.side === 'back') {
            gl.enable(gl.CULL_FACE);
            gl.cullFace(gl.FRONT);
          } else {
            gl.disable(gl.CULL_FACE);
          }

          const rec = owner.geometries.getMesh(
            gl,
            obj.geometry,
            obj.fingerprint,
          );
          gl.bindVertexArray(rec.vao);
          gl.drawElements(gl.TRIANGLES, rec.indexCount, rec.indexType, 0);
          drawCalls++;
          renderedTriangles += rec.indexCount / 3;
        } else if (obj instanceof Line3D) {
          gl.useProgram(programs.lineProgram);
          const u = programs.lineUniforms;
          gl.disable(gl.CULL_FACE);

          gl.uniformMatrix4fv(u.modelViewProjection, false, mvp.elements);
          const lColor = parseColor(obj.color);
          gl.uniform4f(u.lineColor, lColor[0], lColor[1], lColor[2], lColor[3]);
          gl.uniform1i(u.useVertexColors, obj.geometry.colors ? 1 : 0);
          gl.uniform1f(u.opacity, obj.opacity);

          const rec = owner.geometries.getLine(
            gl,
            obj.geometry,
            obj.fingerprint,
          );
          gl.bindVertexArray(rec.vao);
          if (rec.isIndexed) {
            gl.drawElements(gl.LINES, rec.count, rec.indexType!, 0);
          } else if (obj.geometry.topology === 'strip') {
            gl.drawArrays(gl.LINE_STRIP, 0, rec.count);
          } else {
            gl.drawArrays(gl.LINES, 0, rec.count);
          }
          drawCalls++;
        } else if (obj instanceof PointCloud3D) {
          gl.useProgram(programs.pointProgram);
          const u = programs.pointUniforms;
          gl.disable(gl.CULL_FACE);

          gl.uniformMatrix4fv(u.modelViewProjection, false, mvp.elements);
          const pColor = parseColor(obj.color);
          gl.uniform4f(
            u.pointColor,
            pColor[0],
            pColor[1],
            pColor[2],
            pColor[3],
          );
          gl.uniform1f(u.defaultPointSize, obj.pointSize);
          gl.uniform1i(u.useVertexColors, obj.geometry.colors ? 1 : 0);
          gl.uniform1i(u.useVertexSizes, obj.geometry.sizes ? 1 : 0);
          gl.uniform1f(u.opacity, obj.opacity);

          const rec = owner.geometries.getPoint(
            gl,
            obj.geometry,
            obj.fingerprint,
          );
          gl.bindVertexArray(rec.vao);
          gl.drawArrays(gl.POINTS, 0, rec.count);
          drawCalls++;
        }
      }
    }

    // Clean unbinds
    gl.bindVertexArray(null);
    gl.useProgram(null);

    return {
      drawCalls,
      activeBuffers: owner.geometries.activeBufferCount,
      activeVAOs: owner.geometries.activeVAOCount,
      renderedTriangles,
      renderedLines,
      renderedPoints,
      reusedBuffers: owner.geometries.reusedBuffers,
      allocatedBuffers: owner.geometries.allocatedBuffers,
    };
  }
}
