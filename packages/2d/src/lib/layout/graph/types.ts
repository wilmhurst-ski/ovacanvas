export interface GraphVertexInput {
  readonly id: string;
  readonly width?: number;
  readonly height?: number;
}

export interface GraphEdgeInput {
  readonly id: string;
  readonly source: string;
  readonly target: string;
}

export interface GraphInput {
  readonly vertices: readonly GraphVertexInput[];
  readonly edges: readonly GraphEdgeInput[];
}

export interface GraphPoint {
  readonly x: number;
  readonly y: number;
}

export interface LayoutVertex extends GraphPoint {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly layer?: number;
}

export interface LayoutEdge {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly points: readonly GraphPoint[];
}

export interface GraphLayoutResult {
  readonly kind: 'layered' | 'force';
  readonly vertices: readonly LayoutVertex[];
  readonly edges: readonly LayoutEdge[];
}

export type LayerDirection = 'TB' | 'BT' | 'LR' | 'RL';

export interface LayeredLayoutConfig {
  readonly direction?: LayerDirection;
  readonly nodeSeparation?: number;
  readonly rankSeparation?: number;
  readonly edgeSeparation?: number;
  readonly marginX?: number;
  readonly marginY?: number;
}

export interface ForceLayoutConfig {
  readonly seed: number;
  readonly iterations: number;
  readonly linkDistance?: number;
  readonly linkStrength?: number;
  readonly manyBodyStrength?: number;
  readonly centerX?: number;
  readonly centerY?: number;
  readonly centerStrength?: number;
  readonly initialRadius?: number;
  readonly alphaDecay?: number;
  readonly velocityDecay?: number;
}

export type GraphLayoutErrorCode =
  | 'INVALID_GRAPH'
  | 'INVALID_ID'
  | 'DUPLICATE_VERTEX_ID'
  | 'DUPLICATE_EDGE_ID'
  | 'MISSING_ENDPOINT'
  | 'INVALID_CONFIGURATION'
  | 'INVALID_SEED'
  | 'INVALID_ITERATIONS'
  | 'CYCLE'
  | 'INCOMPLETE_LAYOUT';

export class GraphLayoutError extends Error {
  public constructor(
    public readonly code: GraphLayoutErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'GraphLayoutError';
  }
}
