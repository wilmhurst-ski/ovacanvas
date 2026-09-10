import {Scene3DError} from '../public/errors';
import {
  LINE_FRAGMENT_SHADER,
  LINE_VERTEX_SHADER,
  MESH_FRAGMENT_SHADER,
  MESH_VERTEX_SHADER,
  POINT_FRAGMENT_SHADER,
  POINT_VERTEX_SHADER,
} from './shaders';

export interface MeshUniforms {
  modelViewProjection: WebGLUniformLocation | null;
  model: WebGLUniformLocation | null;
  normalMatrix: WebGLUniformLocation | null;
  useVertexColors: WebGLUniformLocation | null;
  materialColor: WebGLUniformLocation | null;
  materialKind: WebGLUniformLocation | null;
  opacity: WebGLUniformLocation | null;
  ambientLightColor: WebGLUniformLocation | null;
  directionalLightDir: WebGLUniformLocation | null;
  directionalLightColor: WebGLUniformLocation | null;
  numDirectionalLights: WebGLUniformLocation | null;
}

export interface LineUniforms {
  modelViewProjection: WebGLUniformLocation | null;
  lineColor: WebGLUniformLocation | null;
  useVertexColors: WebGLUniformLocation | null;
  opacity: WebGLUniformLocation | null;
}

export interface PointUniforms {
  modelViewProjection: WebGLUniformLocation | null;
  pointColor: WebGLUniformLocation | null;
  defaultPointSize: WebGLUniformLocation | null;
  useVertexColors: WebGLUniformLocation | null;
  useVertexSizes: WebGLUniformLocation | null;
  opacity: WebGLUniformLocation | null;
}

export class ProgramResources {
  public meshProgram: WebGLProgram | null = null;
  public meshUniforms!: MeshUniforms;

  public lineProgram: WebGLProgram | null = null;
  public lineUniforms!: LineUniforms;

  public pointProgram: WebGLProgram | null = null;
  public pointUniforms!: PointUniforms;

  private gl: WebGL2RenderingContext | null = null;

  public init(gl: WebGL2RenderingContext): void {
    if (this.gl === gl && this.meshProgram) {
      return;
    }
    this.dispose();
    this.gl = gl;

    this.meshProgram = this.createProgram(
      gl,
      MESH_VERTEX_SHADER,
      MESH_FRAGMENT_SHADER,
      'Mesh',
    );
    this.meshUniforms = {
      modelViewProjection: gl.getUniformLocation(
        this.meshProgram,
        'u_modelViewProjection',
      ),
      model: gl.getUniformLocation(this.meshProgram, 'u_model'),
      normalMatrix: gl.getUniformLocation(this.meshProgram, 'u_normalMatrix'),
      useVertexColors: gl.getUniformLocation(
        this.meshProgram,
        'u_useVertexColors',
      ),
      materialColor: gl.getUniformLocation(this.meshProgram, 'u_materialColor'),
      materialKind: gl.getUniformLocation(this.meshProgram, 'u_materialKind'),
      opacity: gl.getUniformLocation(this.meshProgram, 'u_opacity'),
      ambientLightColor: gl.getUniformLocation(
        this.meshProgram,
        'u_ambientLightColor',
      ),
      directionalLightDir: gl.getUniformLocation(
        this.meshProgram,
        'u_directionalLightDir',
      ),
      directionalLightColor: gl.getUniformLocation(
        this.meshProgram,
        'u_directionalLightColor',
      ),
      numDirectionalLights: gl.getUniformLocation(
        this.meshProgram,
        'u_numDirectionalLights',
      ),
    };

    this.lineProgram = this.createProgram(
      gl,
      LINE_VERTEX_SHADER,
      LINE_FRAGMENT_SHADER,
      'Line',
    );
    this.lineUniforms = {
      modelViewProjection: gl.getUniformLocation(
        this.lineProgram,
        'u_modelViewProjection',
      ),
      lineColor: gl.getUniformLocation(this.lineProgram, 'u_lineColor'),
      useVertexColors: gl.getUniformLocation(
        this.lineProgram,
        'u_useVertexColors',
      ),
      opacity: gl.getUniformLocation(this.lineProgram, 'u_opacity'),
    };

    this.pointProgram = this.createProgram(
      gl,
      POINT_VERTEX_SHADER,
      POINT_FRAGMENT_SHADER,
      'Point',
    );
    this.pointUniforms = {
      modelViewProjection: gl.getUniformLocation(
        this.pointProgram,
        'u_modelViewProjection',
      ),
      pointColor: gl.getUniformLocation(this.pointProgram, 'u_pointColor'),
      defaultPointSize: gl.getUniformLocation(
        this.pointProgram,
        'u_defaultPointSize',
      ),
      useVertexColors: gl.getUniformLocation(
        this.pointProgram,
        'u_useVertexColors',
      ),
      useVertexSizes: gl.getUniformLocation(
        this.pointProgram,
        'u_useVertexSizes',
      ),
      opacity: gl.getUniformLocation(this.pointProgram, 'u_opacity'),
    };
  }

  private createProgram(
    gl: WebGL2RenderingContext,
    vertexSrc: string,
    fragmentSrc: string,
    name: string,
  ): WebGLProgram {
    const vs = gl.createShader(gl.VERTEX_SHADER)!;
    gl.shaderSource(vs, vertexSrc);
    gl.compileShader(vs);
    if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(vs);
      gl.deleteShader(vs);
      throw new Scene3DError(
        'SHADER_COMPILATION_FAILURE',
        `Vertex shader compilation failed for ${name}: ${log}`,
      );
    }

    const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
    gl.shaderSource(fs, fragmentSrc);
    gl.compileShader(fs);
    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(fs);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      throw new Scene3DError(
        'SHADER_COMPILATION_FAILURE',
        `Fragment shader compilation failed for ${name}: ${log}`,
      );
    }

    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);

    gl.deleteShader(vs);
    gl.deleteShader(fs);

    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(prog);
      gl.deleteProgram(prog);
      throw new Scene3DError(
        'SHADER_COMPILATION_FAILURE',
        `Program link failed for ${name}: ${log}`,
      );
    }

    return prog;
  }

  public dispose(): void {
    if (!this.gl) return;
    if (this.meshProgram) {
      this.gl.deleteProgram(this.meshProgram);
      this.meshProgram = null;
    }
    if (this.lineProgram) {
      this.gl.deleteProgram(this.lineProgram);
      this.lineProgram = null;
    }
    if (this.pointProgram) {
      this.gl.deleteProgram(this.pointProgram);
      this.pointProgram = null;
    }
    this.gl = null;
  }
}
