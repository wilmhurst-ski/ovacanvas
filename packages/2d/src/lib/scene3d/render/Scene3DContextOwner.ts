import type {WebGLContextOwner} from '@ovacanvas/core';
import {GeometryResources} from './GeometryResources';
import {ProgramResources} from './ProgramResources';

export class Scene3DContextOwner implements WebGLContextOwner {
  public gl: WebGL2RenderingContext | null = null;
  public readonly programs = new ProgramResources();
  public readonly geometries = new GeometryResources();

  public setup(gl: WebGL2RenderingContext): void {
    this.gl = gl;

    // 1. Unbind framebuffers & renderbuffers to target canvas
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);

    // 2. Clear flags & scissor
    gl.disable(gl.SCISSOR_TEST);
    gl.colorMask(true, true, true, true);

    // 3. Depth state
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    gl.depthRange(0.0, 1.0);
    gl.clearDepth(1.0);

    // 4. Face winding & culling
    gl.frontFace(gl.CCW);
    gl.cullFace(gl.BACK);
    gl.disable(gl.CULL_FACE); // will be enabled per-primitive when appropriate

    // 5. Blending
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    // 6. Unbind existing vertex arrays and buffers
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);

    // 7. Active textures
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, null);

    // 8. Initialize program resources
    this.programs.init(gl);
  }

  public teardown(gl: WebGL2RenderingContext): void {
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.useProgram(null);
    this.gl = null;
  }

  public dispose(): void {
    if (this.gl) {
      this.geometries.dispose(this.gl);
      this.programs.dispose();
      this.teardown(this.gl);
    }
  }
}
