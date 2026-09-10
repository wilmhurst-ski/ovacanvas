import type {
  CanonicalLineGeometry,
  CanonicalPointGeometry,
  CanonicalTriangleGeometry,
} from '../geometry/canonicalize';

export interface GpuMeshRecord {
  vao: WebGLVertexArrayObject;
  positionBuffer: WebGLBuffer;
  normalBuffer: WebGLBuffer;
  colorBuffer: WebGLBuffer | null;
  indexBuffer: WebGLBuffer;
  indexCount: number;
  indexType: number; // gl.UNSIGNED_SHORT or gl.UNSIGNED_INT
}

export interface GpuLineRecord {
  vao: WebGLVertexArrayObject;
  positionBuffer: WebGLBuffer;
  colorBuffer: WebGLBuffer | null;
  indexBuffer: WebGLBuffer | null;
  count: number;
  isIndexed: boolean;
  indexType?: number;
}

export interface GpuPointRecord {
  vao: WebGLVertexArrayObject;
  positionBuffer: WebGLBuffer;
  colorBuffer: WebGLBuffer | null;
  sizeBuffer: WebGLBuffer | null;
  count: number;
}

export class GeometryResources {
  private meshCache = new Map<string, GpuMeshRecord>();
  private lineCache = new Map<string, GpuLineRecord>();
  private pointCache = new Map<string, GpuPointRecord>();

  public reusedBuffers = 0;
  public allocatedBuffers = 0;

  public getMesh(
    gl: WebGL2RenderingContext,
    geom: CanonicalTriangleGeometry,
    fingerprint: string,
  ): GpuMeshRecord {
    if (this.meshCache.has(fingerprint)) {
      this.reusedBuffers++;
      return this.meshCache.get(fingerprint)!;
    }

    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);

    // Positions (location 0)
    const positionBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, geom.positions, gl.STATIC_DRAW);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(0);

    // Normals (location 1)
    const normalBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, geom.normals, gl.STATIC_DRAW);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(1);

    // Colors (location 2)
    let colorBuffer: WebGLBuffer | null = null;
    if (geom.colors) {
      colorBuffer = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, geom.colors, gl.STATIC_DRAW);
      gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 0, 0);
      gl.enableVertexAttribArray(2);
    } else {
      gl.disableVertexAttribArray(2);
      gl.vertexAttrib4f(2, 1, 1, 1, 1);
    }

    // Indices
    const indexBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geom.indices, gl.STATIC_DRAW);

    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);

    const indexType =
      geom.indices instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
    const record: GpuMeshRecord = {
      vao,
      positionBuffer,
      normalBuffer,
      colorBuffer,
      indexBuffer,
      indexCount: geom.indices.length,
      indexType,
    };

    this.allocatedBuffers++;
    this.meshCache.set(fingerprint, record);
    return record;
  }

  public getLine(
    gl: WebGL2RenderingContext,
    geom: CanonicalLineGeometry,
    fingerprint: string,
  ): GpuLineRecord {
    if (this.lineCache.has(fingerprint)) {
      this.reusedBuffers++;
      return this.lineCache.get(fingerprint)!;
    }

    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);

    // Positions (location 0)
    const positionBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, geom.positions, gl.STATIC_DRAW);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(0);

    // Colors (location 1)
    let colorBuffer: WebGLBuffer | null = null;
    if (geom.colors) {
      colorBuffer = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, geom.colors, gl.STATIC_DRAW);
      gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
      gl.enableVertexAttribArray(1);
    } else {
      gl.disableVertexAttribArray(1);
      gl.vertexAttrib4f(1, 1, 1, 1, 1);
    }

    let indexBuffer: WebGLBuffer | null = null;
    let isIndexed = false;
    let count = geom.vertexCount;
    let indexType: number | undefined;

    if (geom.indices) {
      indexBuffer = gl.createBuffer()!;
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geom.indices, gl.STATIC_DRAW);
      isIndexed = true;
      count = geom.indices.length;
      indexType =
        geom.indices instanceof Uint32Array
          ? gl.UNSIGNED_INT
          : gl.UNSIGNED_SHORT;
    }

    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);

    const record: GpuLineRecord = {
      vao,
      positionBuffer,
      colorBuffer,
      indexBuffer,
      count,
      isIndexed,
      indexType,
    };

    this.allocatedBuffers++;
    this.lineCache.set(fingerprint, record);
    return record;
  }

  public getPoint(
    gl: WebGL2RenderingContext,
    geom: CanonicalPointGeometry,
    fingerprint: string,
  ): GpuPointRecord {
    if (this.pointCache.has(fingerprint)) {
      this.reusedBuffers++;
      return this.pointCache.get(fingerprint)!;
    }

    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);

    // Positions (location 0)
    const positionBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, geom.positions, gl.STATIC_DRAW);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(0);

    // Colors (location 1)
    let colorBuffer: WebGLBuffer | null = null;
    if (geom.colors) {
      colorBuffer = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, geom.colors, gl.STATIC_DRAW);
      gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
      gl.enableVertexAttribArray(1);
    } else {
      gl.disableVertexAttribArray(1);
      gl.vertexAttrib4f(1, 1, 1, 1, 1);
    }

    // Sizes (location 2)
    let sizeBuffer: WebGLBuffer | null = null;
    if (geom.sizes) {
      sizeBuffer = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, sizeBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, geom.sizes, gl.STATIC_DRAW);
      gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 0, 0);
      gl.enableVertexAttribArray(2);
    } else {
      gl.disableVertexAttribArray(2);
    }

    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    const record: GpuPointRecord = {
      vao,
      positionBuffer,
      colorBuffer,
      sizeBuffer,
      count: geom.vertexCount,
    };

    this.allocatedBuffers++;
    this.pointCache.set(fingerprint, record);
    return record;
  }

  public get activeVAOCount(): number {
    return this.meshCache.size + this.lineCache.size + this.pointCache.size;
  }

  public get activeBufferCount(): number {
    let count = 0;
    for (const m of this.meshCache.values()) {
      count += 3 + (m.colorBuffer ? 1 : 0);
    }
    for (const l of this.lineCache.values()) {
      count += 1 + (l.colorBuffer ? 1 : 0) + (l.indexBuffer ? 1 : 0);
    }
    for (const p of this.pointCache.values()) {
      count += 1 + (p.colorBuffer ? 1 : 0) + (p.sizeBuffer ? 1 : 0);
    }
    return count;
  }

  public dispose(gl: WebGL2RenderingContext): void {
    for (const record of this.meshCache.values()) {
      gl.deleteVertexArray(record.vao);
      gl.deleteBuffer(record.positionBuffer);
      gl.deleteBuffer(record.normalBuffer);
      if (record.colorBuffer) gl.deleteBuffer(record.colorBuffer);
      gl.deleteBuffer(record.indexBuffer);
    }
    this.meshCache.clear();

    for (const record of this.lineCache.values()) {
      gl.deleteVertexArray(record.vao);
      gl.deleteBuffer(record.positionBuffer);
      if (record.colorBuffer) gl.deleteBuffer(record.colorBuffer);
      if (record.indexBuffer) gl.deleteBuffer(record.indexBuffer);
    }
    this.lineCache.clear();

    for (const record of this.pointCache.values()) {
      gl.deleteVertexArray(record.vao);
      gl.deleteBuffer(record.positionBuffer);
      if (record.colorBuffer) gl.deleteBuffer(record.colorBuffer);
      if (record.sizeBuffer) gl.deleteBuffer(record.sizeBuffer);
    }
    this.pointCache.clear();
  }
}
