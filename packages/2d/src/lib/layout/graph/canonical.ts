import {
  GraphEdgeInput,
  GraphInput,
  GraphLayoutError,
  GraphVertexInput,
} from './types';

export interface CanonicalGraph {
  readonly vertices: readonly Required<GraphVertexInput>[];
  readonly edges: readonly GraphEdgeInput[];
}

const SEMANTIC_ID = /^[A-Za-z0-9_-]+$/;

export function compareStableIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function compareEdges(a: GraphEdgeInput, b: GraphEdgeInput): number {
  const source = compareStableIds(a.source, b.source);
  if (source !== 0) return source;

  const target = compareStableIds(a.target, b.target);
  if (target !== 0) return target;

  return compareStableIds(a.id, b.id);
}

function validateId(id: unknown, kind: string): asserts id is string {
  if (typeof id !== 'string' || !SEMANTIC_ID.test(id)) {
    throw new GraphLayoutError(
      'INVALID_ID',
      `${kind} must match the canonical semantic ID grammar [A-Za-z0-9_-]+.`,
    );
  }
}

function finiteDimension(value: unknown, name: string): number {
  if (value === undefined) return 0;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new GraphLayoutError(
      'INVALID_CONFIGURATION',
      `${name} must be a finite, non-negative number.`,
    );
  }
  return value;
}

export function canonicalizeGraph(input: GraphInput): CanonicalGraph {
  if (
    input === null ||
    typeof input !== 'object' ||
    !Array.isArray(input.vertices) ||
    !Array.isArray(input.edges)
  ) {
    throw new GraphLayoutError(
      'INVALID_GRAPH',
      'Graph input must contain vertex and edge arrays.',
    );
  }

  const vertexIds = new Set<string>();
  const vertices = input.vertices.map((vertex, index) => {
    if (vertex === null || typeof vertex !== 'object') {
      throw new GraphLayoutError(
        'INVALID_GRAPH',
        `Vertex at index ${index} must be an object.`,
      );
    }
    validateId(vertex.id, `Vertex ID at index ${index}`);
    if (vertexIds.has(vertex.id)) {
      throw new GraphLayoutError(
        'DUPLICATE_VERTEX_ID',
        `Duplicate vertex ID: ${vertex.id}.`,
      );
    }
    vertexIds.add(vertex.id);
    return {
      id: vertex.id,
      width: finiteDimension(vertex.width, `Vertex ${vertex.id} width`),
      height: finiteDimension(vertex.height, `Vertex ${vertex.id} height`),
    };
  });

  const edgeIds = new Set<string>();
  const edges = input.edges.map((edge, index) => {
    if (edge === null || typeof edge !== 'object') {
      throw new GraphLayoutError(
        'INVALID_GRAPH',
        `Edge at index ${index} must be an object.`,
      );
    }
    validateId(edge.id, `Edge ID at index ${index}`);
    validateId(edge.source, `Edge ${edge.id} source`);
    validateId(edge.target, `Edge ${edge.id} target`);
    if (edgeIds.has(edge.id)) {
      throw new GraphLayoutError(
        'DUPLICATE_EDGE_ID',
        `Duplicate edge ID: ${edge.id}.`,
      );
    }
    edgeIds.add(edge.id);
    if (!vertexIds.has(edge.source) || !vertexIds.has(edge.target)) {
      throw new GraphLayoutError(
        'MISSING_ENDPOINT',
        `Edge ${edge.id} references missing endpoint ${
          !vertexIds.has(edge.source) ? edge.source : edge.target
        }.`,
      );
    }
    return {id: edge.id, source: edge.source, target: edge.target};
  });

  vertices.sort((a, b) => compareStableIds(a.id, b.id));
  edges.sort(compareEdges);
  return {vertices, edges};
}

export function finiteConfig(
  value: number | undefined,
  fallback: number,
  name: string,
  minimum = -Infinity,
  maximum = Infinity,
): number {
  const resolved = value ?? fallback;
  if (
    typeof resolved !== 'number' ||
    !Number.isFinite(resolved) ||
    resolved < minimum ||
    resolved > maximum
  ) {
    throw new GraphLayoutError(
      'INVALID_CONFIGURATION',
      `${name} must be a finite number from ${minimum} through ${maximum}.`,
    );
  }
  return resolved;
}
