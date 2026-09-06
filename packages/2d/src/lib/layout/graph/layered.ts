import {Graph, layout} from '@dagrejs/dagre';
import {canonicalizeGraph, compareStableIds, finiteConfig} from './canonical';
import {
  GraphInput,
  GraphLayoutError,
  GraphLayoutResult,
  LayerDirection,
  LayeredLayoutConfig,
} from './types';

interface DagreNode {
  width: number;
  height: number;
  x?: number;
  y?: number;
}

interface DagreEdge {
  points?: {x: number; y: number}[];
}

const DIRECTIONS = new Set<LayerDirection>(['TB', 'BT', 'LR', 'RL']);

function assignLayers(
  vertexIds: readonly string[],
  edges: readonly {source: string; target: string}[],
): ReadonlyMap<string, number> {
  const incoming = new Map(vertexIds.map(id => [id, 0]));
  const outgoing = new Map(vertexIds.map(id => [id, [] as string[]]));

  for (const edge of edges) {
    incoming.set(edge.target, incoming.get(edge.target)! + 1);
    outgoing.get(edge.source)!.push(edge.target);
  }
  for (const targets of outgoing.values()) targets.sort(compareStableIds);

  const ready = vertexIds.filter(id => incoming.get(id) === 0);
  const layers = new Map(vertexIds.map(id => [id, 0]));
  let visited = 0;

  while (ready.length > 0) {
    const id = ready.shift()!;
    visited += 1;
    for (const target of outgoing.get(id)!) {
      layers.set(target, Math.max(layers.get(target)!, layers.get(id)! + 1));
      const remaining = incoming.get(target)! - 1;
      incoming.set(target, remaining);
      if (remaining === 0) {
        ready.push(target);
        ready.sort(compareStableIds);
      }
    }
  }

  if (visited !== vertexIds.length) {
    throw new GraphLayoutError(
      'CYCLE',
      'Layered layout requires a directed acyclic graph.',
    );
  }
  return layers;
}

function finitePoint(
  point: {x?: number; y?: number},
  description: string,
): {x: number; y: number} {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new GraphLayoutError(
      'INCOMPLETE_LAYOUT',
      `${description} did not receive finite coordinates.`,
    );
  }
  return {x: point.x!, y: point.y!};
}

/**
 * Compute a deterministic layered layout for a directed acyclic graph.
 *
 * @internal This capability boundary is not a frozen public serialization API.
 */
export function layoutLayeredGraph(
  input: GraphInput,
  config: LayeredLayoutConfig = {},
): GraphLayoutResult {
  if (config === null || typeof config !== 'object') {
    throw new GraphLayoutError(
      'INVALID_CONFIGURATION',
      'Layered layout configuration must be an object.',
    );
  }
  const canonical = canonicalizeGraph(input);
  const direction = config.direction ?? 'TB';
  if (!DIRECTIONS.has(direction)) {
    throw new GraphLayoutError(
      'INVALID_CONFIGURATION',
      `Unsupported layered direction: ${String(direction)}.`,
    );
  }

  const layers = assignLayers(
    canonical.vertices.map(vertex => vertex.id),
    canonical.edges,
  );
  const graph = new Graph<unknown, DagreNode, DagreEdge>({
    directed: true,
    multigraph: true,
  });
  graph.setGraph({
    rankdir: direction,
    nodesep: finiteConfig(config.nodeSeparation, 50, 'nodeSeparation', 0),
    ranksep: finiteConfig(config.rankSeparation, 80, 'rankSeparation', 0),
    edgesep: finiteConfig(config.edgeSeparation, 20, 'edgeSeparation', 0),
    marginx: finiteConfig(config.marginX, 0, 'marginX', 0),
    marginy: finiteConfig(config.marginY, 0, 'marginY', 0),
    ranker: 'network-simplex',
  });
  graph.setDefaultEdgeLabel(() => ({}));

  for (const vertex of canonical.vertices) {
    graph.setNode(vertex.id, {
      // Dagre 3.1.1 produces NaN edge intersections for an exactly 0x0 box.
      // Keep semantic dimensions unchanged in the result and use the smallest
      // useful internal routing box only when the caller omitted dimensions.
      width: Math.max(1, vertex.width),
      height: Math.max(1, vertex.height),
    });
  }
  for (const edge of canonical.edges) {
    graph.setEdge(edge.source, edge.target, {}, edge.id);
  }

  layout(graph);

  const vertices = canonical.vertices.map(vertex => {
    const point = finitePoint(graph.node(vertex.id), `Vertex ${vertex.id}`);
    return {...vertex, ...point, layer: layers.get(vertex.id)!};
  });
  const edges = canonical.edges.map(edge => {
    const route = graph.edge({v: edge.source, w: edge.target, name: edge.id});
    if (!route?.points || route.points.length < 2) {
      throw new GraphLayoutError(
        'INCOMPLETE_LAYOUT',
        `Edge ${edge.id} did not receive waypoint geometry.`,
      );
    }
    return {
      ...edge,
      points: route.points.map((point, index) =>
        finitePoint(point, `Edge ${edge.id} waypoint ${index}`),
      ),
    };
  });

  return {kind: 'layered', vertices, edges};
}
