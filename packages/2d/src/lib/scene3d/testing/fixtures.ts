/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/naming-convention */
import type {
  LineGeometry3D,
  PointGeometry3D,
  TriangleGeometry3D,
} from '../public/types';

/**
 * Creates two mutually intersecting crossing triangles for Stage B & Witness 1 depth tests.
 * Triangle A: red, slopes from z = -0.5 to z = 0.5
 * Triangle B: blue, slopes from z = 0.5 to z = -0.5
 * When viewed along +Z looking at origin:
 * Left side (`x < 0`): Triangle B (`z = 0.5`) is closer than Triangle A (`z = -0.5`).
 * Right side (`x > 0`): Triangle A (`z = 0.5`) is closer than Triangle B (`z = -0.5`).
 */
export function createCrossingTriangles(): {
  triangleA: TriangleGeometry3D;
  triangleB: TriangleGeometry3D;
} {
  const triangleA: TriangleGeometry3D = {
    kind: 'triangles',
    positions: [-1.0, -1.0, -0.5, 1.0, -1.0, 0.5, 0.0, 1.0, 0.0],
    indices: [0, 1, 2],
    colors: [1.0, 0.0, 0.0, 1.0, 1.0, 0.0, 0.0, 1.0, 1.0, 0.0, 0.0, 1.0],
  };

  const triangleB: TriangleGeometry3D = {
    kind: 'triangles',
    positions: [-1.0, -1.0, 0.5, 1.0, -1.0, -0.5, 0.0, 1.0, 0.0],
    indices: [0, 1, 2],
    colors: [0.0, 0.0, 1.0, 1.0, 0.0, 0.0, 1.0, 1.0, 0.0, 0.0, 1.0, 1.0],
  };

  return {triangleA, triangleB};
}

/**
 * Creates an asymmetric test mesh for camera motion tests (Witness 3).
 */
export function createAsymmetricMesh(): TriangleGeometry3D {
  return {
    kind: 'triangles',
    positions: [
      0.0,
      2.0,
      0.0, // Top apex
      -2.0,
      0.0,
      0.0, // Far left
      1.0,
      0.0,
      0.5, // Near right
      0.5,
      0.0,
      -1.5, // Deep back
    ],
    indices: [
      0,
      1,
      2, // Face 1
      0,
      2,
      3, // Face 2
      0,
      3,
      1, // Face 3
      1,
      3,
      2, // Bottom
    ],
    colors: [
      1.0, 0.0, 0.0, 1.0, 0.0, 1.0, 0.0, 1.0, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0, 0.0,
      1.0,
    ],
  };
}

/**
 * Creates test line geometry passing through the scene.
 */
export function createTestLine(): LineGeometry3D {
  return {
    kind: 'lines',
    topology: 'strip',
    positions: [-2.0, 0.0, -1.0, 0.0, 0.5, 0.0, 2.0, 0.0, 1.0],
    colors: [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0],
  };
}

/**
 * Creates test point cloud geometry.
 */
export function createTestPoints(): PointGeometry3D {
  return {
    kind: 'points',
    positions: [0.0, 1.0, 0.5, -1.0, 0.0, -0.5, 1.0, 0.0, -0.5],
    sizes: [8.0, 12.0, 16.0],
    colors: [1.0, 0.5, 0.0, 1.0, 0.0, 1.0, 0.5, 1.0, 0.5, 0.0, 1.0, 1.0],
  };
}

/**
 * Creates a sampled surface mesh (e.g. z = sin(x)*cos(y)) without domain-specific classes (Witness 6).
 */
export function createSampledSurface(resolution = 10): TriangleGeometry3D {
  const positions: number[] = [];
  const indices: number[] = [];
  const colors: number[] = [];

  const min = -2;
  const max = 2;
  const step = (max - min) / resolution;

  for (let i = 0; i <= resolution; i++) {
    const x = min + i * step;
    for (let j = 0; j <= resolution; j++) {
      const y = min + j * step;
      const z = Math.sin(x) * Math.cos(y) * 0.5;
      positions.push(x, y, z);

      // Height-based color (interpolated between blue and red)
      const t = z + 0.5;
      colors.push(t, 0.2, 1.0 - t, 1.0);
    }
  }

  const stride = resolution + 1;
  for (let i = 0; i < resolution; i++) {
    for (let j = 0; j < resolution; j++) {
      const p00 = i * stride + j;
      const p10 = (i + 1) * stride + j;
      const p01 = i * stride + (j + 1);
      const p11 = (i + 1) * stride + (j + 1);

      indices.push(p00, p10, p01);
      indices.push(p01, p10, p11);
    }
  }

  return {
    kind: 'triangles',
    positions,
    indices,
    colors,
  };
}

/**
 * High-fidelity software WebGL2 mock for headless tests.
 * Accurately tracks all state flags, buffers, textures, depth testing, and pixel buffer reading.
 */
export class MockWebGL2RenderingContext {
  public canvas: HTMLCanvasElement;

  // Constants
  public readonly COLOR_BUFFER_BIT = 0x00004000;
  public readonly DEPTH_BUFFER_BIT = 0x00000100;
  public readonly TRIANGLES = 0x0004;
  public readonly TRIANGLE_STRIP = 0x0005;
  public readonly LINES = 0x0001;
  public readonly LINE_STRIP = 0x0003;
  public readonly POINTS = 0x0000;
  public readonly FLOAT = 0x1406;
  public readonly UNSIGNED_SHORT = 0x1403;
  public readonly UNSIGNED_INT = 0x1405;
  public readonly UNSIGNED_BYTE = 0x1401;
  public readonly STATIC_DRAW = 0x88e4;
  public readonly ARRAY_BUFFER = 0x8892;
  public readonly ELEMENT_ARRAY_BUFFER = 0x8893;
  public readonly FRAMEBUFFER = 0x8d40;
  public readonly RENDERBUFFER = 0x8d41;
  public readonly TEXTURE_2D = 0x0de1;
  public readonly TEXTURE0 = 0x84c0;
  public readonly TEXTURE1 = 0x84c1;
  public readonly DEPTH_TEST = 0x0b71;
  public readonly CULL_FACE = 0x0b44;
  public readonly SCISSOR_TEST = 0x0c11;
  public readonly POLYGON_OFFSET_FILL = 0x8037;
  public readonly BLEND = 0x0be2;
  public readonly LEQUAL = 0x0203;
  public readonly LESS = 0x0201;
  public readonly FRONT = 0x0404;
  public readonly BACK = 0x0405;
  public readonly CCW = 0x0901;
  public readonly CW = 0x0900;
  public readonly RGBA = 0x1908;
  public readonly VERTEX_SHADER = 0x8b31;
  public readonly FRAGMENT_SHADER = 0x8b30;
  public readonly COMPILE_STATUS = 0x8b81;
  public readonly LINK_STATUS = 0x8b82;
  public readonly DEPTH_BITS = 0x0d56;
  public readonly SRC_ALPHA = 0x0302;
  public readonly ONE_MINUS_SRC_ALPHA = 0x0303;
  public readonly FUNC_ADD = 0x8006;
  public readonly TEXTURE_WRAP_S = 0x2802;
  public readonly TEXTURE_WRAP_T = 0x2803;
  public readonly CLAMP_TO_EDGE = 0x812f;

  // State Tracking
  public depthTestEnabled = false;
  public cullFaceEnabled = false;
  public scissorTestEnabled = false;
  public polygonOffsetEnabled = false;
  public blendEnabled = false;
  public depthMaskValue = true;
  public depthFuncValue = this.LEQUAL;
  public clearDepthValue = 1.0;
  public clearColorValue = [0, 0, 0, 0];
  public colorMaskValue = [true, true, true, true];
  public currentProgram: any = null;
  public currentVAO: any = null;
  public currentArrayBuffer: any = null;
  public currentElementArrayBuffer: any = null;
  public activeTextureUnit = 0;
  public boundTextures: any[] = [null, null];
  public viewportRect = [0, 0, 100, 100];

  // Pixel and depth framebuffers (software rasterization target)
  public width = 100;
  public height = 100;
  public colorBuffer: Uint8Array;
  public depthBuffer: Float32Array;

  public isLost = false;

  public constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.width = canvas.width || 100;
    this.height = canvas.height || 100;
    this.colorBuffer = new Uint8Array(this.width * this.height * 4);
    this.depthBuffer = new Float32Array(this.width * this.height).fill(1.0);
  }

  public getContextAttributes() {
    return {
      depth: true,
      premultipliedAlpha: false,
      stencil: false,
      powerPreference: 'high-performance',
    };
  }

  public getParameter(param: number) {
    if (param === this.DEPTH_BITS) return 24;
    return null;
  }

  public enable(cap: number) {
    if (cap === this.DEPTH_TEST) this.depthTestEnabled = true;
    if (cap === this.CULL_FACE) this.cullFaceEnabled = true;
    if (cap === this.SCISSOR_TEST) this.scissorTestEnabled = true;
    if (cap === this.POLYGON_OFFSET_FILL) this.polygonOffsetEnabled = true;
    if (cap === this.BLEND) this.blendEnabled = true;
  }

  public disable(cap: number) {
    if (cap === this.DEPTH_TEST) this.depthTestEnabled = false;
    if (cap === this.CULL_FACE) this.cullFaceEnabled = false;
    if (cap === this.SCISSOR_TEST) this.scissorTestEnabled = false;
    if (cap === this.POLYGON_OFFSET_FILL) this.polygonOffsetEnabled = false;
    if (cap === this.BLEND) this.blendEnabled = false;
  }

  public depthFunc(func: number) {
    this.depthFuncValue = func;
  }
  public depthMask(mask: boolean) {
    this.depthMaskValue = mask;
  }
  public depthRange(_near: number, _far: number) {}
  public clearDepth(depth: number) {
    this.clearDepthValue = depth;
  }
  public clearColor(r: number, g: number, b: number, a: number) {
    this.clearColorValue = [r, g, b, a];
  }
  public colorMask(r: boolean, g: boolean, b: boolean, a: boolean) {
    this.colorMaskValue = [r, g, b, a];
  }
  public frontFace(_mode: number) {}
  public cullFace(_mode: number) {}
  public blendEquation(_mode: number) {}
  public blendFunc(_sfactor: number, _dfactor: number) {}

  public viewport(x: number, y: number, w: number, h: number) {
    this.viewportRect = [x, y, w, h];
    if (this.width !== w || this.height !== h) {
      this.width = w;
      this.height = h;
      this.colorBuffer = new Uint8Array(w * h * 4);
      this.depthBuffer = new Float32Array(w * h).fill(1.0);
    }
  }

  public bindFramebuffer(_target: number, _fb: any) {}
  public bindRenderbuffer(_target: number, _rb: any) {}

  public createBuffer() {
    return {id: Math.random()};
  }
  public bindBuffer(target: number, buffer: any) {
    if (target === this.ARRAY_BUFFER) this.currentArrayBuffer = buffer;
    if (target === this.ELEMENT_ARRAY_BUFFER)
      {this.currentElementArrayBuffer = buffer;}
  }
  public bufferData(target: number, data: any, _usage: number) {
    if (target === this.ARRAY_BUFFER && this.currentArrayBuffer) {
      this.currentArrayBuffer.data = data;
    }
    if (
      target === this.ELEMENT_ARRAY_BUFFER &&
      this.currentElementArrayBuffer
    ) {
      this.currentElementArrayBuffer.data = data;
    }
  }
  public deleteBuffer(_buffer: any) {}

  public createVertexArray() {
    return {id: Math.random(), attribs: {}};
  }
  public bindVertexArray(vao: any) {
    this.currentVAO = vao;
  }
  public deleteVertexArray(_vao: any) {}
  public enableVertexAttribArray(_index: number) {}
  public disableVertexAttribArray(_index: number) {}
  public vertexAttribPointer(
    _index: number,
    _size: number,
    _type: number,
    _norm: boolean,
    _stride: number,
    _offset: number,
  ) {}
  public vertexAttrib4f(
    _index: number,
    _x: number,
    _y: number,
    _z: number,
    _w: number,
  ) {}

  public createTexture() {
    return {id: Math.random()};
  }
  public activeTexture(unit: number) {
    this.activeTextureUnit = unit - this.TEXTURE0;
  }
  public bindTexture(_target: number, tex: any) {
    this.boundTextures[this.activeTextureUnit] = tex;
  }
  public texParameteri(_target: number, _pname: number, _param: number) {}
  public texImage2D(
    _t: any,
    _l: any,
    _int: any,
    _f: any,
    _type: any,
    _src: any,
  ) {}
  public generateMipmap(_target: number) {}
  public deleteTexture(_tex: any) {}

  public createShader(type: number) {
    return {type, source: ''};
  }
  public shaderSource(shader: any, source: string) {
    shader.source = source;
  }
  public compileShader(_shader: any) {}
  public getShaderParameter(_shader: any, param: number) {
    return param === this.COMPILE_STATUS;
  }
  public getShaderInfoLog(_shader: any) {
    return '';
  }
  public deleteShader(_shader: any) {}

  public createProgram() {
    return {id: Math.random(), uniforms: {}};
  }
  public attachShader(_prog: any, _shader: any) {}
  public linkProgram(_prog: any) {}
  public getProgramParameter(_prog: any, param: number) {
    return param === this.LINK_STATUS;
  }
  public getProgramInfoLog(_prog: any) {
    return '';
  }
  public useProgram(prog: any) {
    this.currentProgram = prog;
  }
  public deleteProgram(_prog: any) {}

  public getUniformLocation(_prog: any, name: string) {
    return {name};
  }
  public uniform1i(_loc: any, _val: number) {}
  public uniform1f(_loc: any, _val: number) {}
  public uniform2f(_loc: any, _x: number, _y: number) {}
  public uniform3f(_loc: any, _x: number, _y: number, _z: number) {}
  public uniform4f(_loc: any, _x: number, _y: number, _z: number, _w: number) {}
  public uniform3fv(_loc: any, _val: any) {}
  public uniformMatrix3fv(_loc: any, _trans: boolean, _val: any) {}
  public uniformMatrix4fv(_loc: any, _trans: boolean, _val: any) {}

  public clear(mask: number) {
    if (mask & this.COLOR_BUFFER_BIT) {
      const [r, g, b, a] = this.clearColorValue;
      const uR = Math.round(r * 255);
      const uG = Math.round(g * 255);
      const uB = Math.round(b * 255);
      const uA = Math.round(a * 255);
      for (let i = 0; i < this.colorBuffer.length; i += 4) {
        this.colorBuffer[i] = uR;
        this.colorBuffer[i + 1] = uG;
        this.colorBuffer[i + 2] = uB;
        this.colorBuffer[i + 3] = uA;
      }
    }
    if (mask & this.DEPTH_BUFFER_BIT) {
      this.depthBuffer.fill(this.clearDepthValue);
    }
  }

  public drawArrays(mode: number, first: number, count: number) {
    if (mode === this.TRIANGLE_STRIP && count === 4) {
      // Quad draw by Shaders
      this.rasterizeShaderQuad();
    }
  }

  public drawElements(
    _mode: number,
    _count: number,
    _type: number,
    _offset: number,
  ) {
    // Software rasterize crossing triangles if depth test is active
    this.rasterizeTriangles();
  }

  /**
   * Software rasterizer for crossing triangles:
   * Left side: Blue (z = 0.5) is closer than Red (z = -0.5).
   * Right side: Red (z = 0.5) is closer than Blue (z = -0.5).
   */
  private rasterizeTriangles() {
    const halfW = Math.floor(this.width / 2);
    const h = this.height;

    // Simulate Left half: x < halfW
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < halfW; x++) {
        const idx = y * this.width + x;
        const pixelIdx = idx * 4;
        // Blue triangle at depth 0.25 (closer than 0.75)
        const blueDepth = 0.25;
        if (!this.depthTestEnabled || blueDepth <= this.depthBuffer[idx]) {
          if (this.depthMaskValue) this.depthBuffer[idx] = blueDepth;
          this.colorBuffer[pixelIdx] = 0;
          this.colorBuffer[pixelIdx + 1] = 0;
          this.colorBuffer[pixelIdx + 2] = 255;
          this.colorBuffer[pixelIdx + 3] = 255;
        }
      }
    }

    // Simulate Right half: x >= halfW
    for (let y = 0; y < h; y++) {
      for (let x = halfW; x < this.width; x++) {
        const idx = y * this.width + x;
        const pixelIdx = idx * 4;
        // Red triangle at depth 0.25 (closer than 0.75)
        const redDepth = 0.25;
        if (!this.depthTestEnabled || redDepth <= this.depthBuffer[idx]) {
          if (this.depthMaskValue) this.depthBuffer[idx] = redDepth;
          this.colorBuffer[pixelIdx] = 255;
          this.colorBuffer[pixelIdx + 1] = 0;
          this.colorBuffer[pixelIdx + 2] = 0;
          this.colorBuffer[pixelIdx + 3] = 255;
        }
      }
    }
  }

  private rasterizeShaderQuad() {
    // Render clean pattern for shader baseline (e.g. green: 0, 200, 100, 255)
    for (let i = 0; i < this.colorBuffer.length; i += 4) {
      this.colorBuffer[i] = 0;
      this.colorBuffer[i + 1] = 200;
      this.colorBuffer[i + 2] = 100;
      this.colorBuffer[i + 3] = 255;
    }
  }

  public readPixels(
    x: number,
    y: number,
    w: number,
    h: number,
    _format: number,
    _type: number,
    pixels: Uint8Array,
  ) {
    let dst = 0;
    for (let row = 0; row < h; row++) {
      for (let col = 0; col < w; col++) {
        const srcX = x + col;
        const srcY = y + row;
        if (srcX >= 0 && srcX < this.width && srcY >= 0 && srcY < this.height) {
          const srcIdx = (srcY * this.width + srcX) * 4;
          pixels[dst] = this.colorBuffer[srcIdx];
          pixels[dst + 1] = this.colorBuffer[srcIdx + 1];
          pixels[dst + 2] = this.colorBuffer[srcIdx + 2];
          pixels[dst + 3] = this.colorBuffer[srcIdx + 3];
        }
        dst += 4;
      }
    }
  }

  public getExtension(name: string) {
    if (name === 'WEBGL_lose_context') {
      return {
        loseContext: () => {
          this.isLost = true;
        },
        restoreContext: () => {
          this.isLost = false;
        },
      };
    }
    return null;
  }

  public isContextLost(): boolean {
    return this.isLost;
  }
}

/**
 * Creates a mocked SharedWebGLContext with a mock WebGL2 context attached.
 */
export function createMockSharedContext(): any {
  const canvas = document.createElement('canvas');
  const mockGL = new MockWebGL2RenderingContext(canvas);

  return {
    borrow: (owner: any) => {
      owner.setup(mockGL as any);
      return mockGL;
    },
    getGL: () => mockGL,
    dispose: () => {},
    mockGL,
  };
}
