import {canonicalizeGraph, finiteConfig} from './canonical';
import {
  GraphInput,
  GraphLayoutError,
  GraphLayoutResult,
  LayoutEdge,
  LayoutVertex,
  RadialLayoutConfig,
} from './types';

/**
 * Compute a radial / balloon tree layout for hub/star and tree graph topologies.
 *
 * @remarks
 * Places the central hub / root at `(centerX, centerY)` and assigns concentric
 * orbital rings of radius `depth * layerRadius`. Angular sectors are partitioned
 * proportionally to subtree weights, guaranteeing strictly positive angular
 * separation and eliminating the edge-crossing and clustering issues of generic
 * force-directed layouts on star/hub topologies (e.g. electron orbits, molecule
 * hubs, concept trees).
 */
export function layoutRadialTreeGraph(
  input: GraphInput,
  config: RadialLayoutConfig = {},
): GraphLayoutResult {
  const canonical = canonicalizeGraph(input);
  if (canonical.vertices.length === 0) {
    return {kind: 'radial', vertices: [], edges: []};
  }

  const centerX = finiteConfig(config.centerX, 0, 'centerX');
  const centerY = finiteConfig(config.centerY, 0, 'centerY');
  const layerRadius = finiteConfig(config.layerRadius, 180, 'layerRadius', 10);
  const startAngle = finiteConfig(config.startAngle, 0, 'startAngle');
  const endAngle = finiteConfig(config.endAngle, 2 * Math.PI, 'endAngle');

  if (endAngle <= startAngle) {
    throw new GraphLayoutError(
      'INVALID_CONFIGURATION',
      'endAngle must be greater than startAngle.',
    );
  }

  const vertexById = new Map(canonical.vertices.map(v => [v.id, v]));

  // Build adjacency list (undirected for topology exploration)
  const adjacency = new Map<string, string[]>();
  for (const v of canonical.vertices) {
    adjacency.set(v.id, []);
  }
  for (const e of canonical.edges) {
    adjacency.get(e.source)?.push(e.target);
    adjacency.get(e.target)?.push(e.source);
  }

  // 1. Determine root: explicit config.rootId or highest-degree hub
  let rootId: string;
  if (config.rootId !== undefined) {
    if (!vertexById.has(config.rootId)) {
      throw new GraphLayoutError(
        'MISSING_ENDPOINT',
        `Specified rootId "${config.rootId}" does not exist in graph vertices.`,
      );
    }
    rootId = config.rootId;
  } else {
    // Select vertex with maximum degree (central hub)
    let maxDegree = -1;
    let selected = canonical.vertices[0].id;
    for (const v of canonical.vertices) {
      const deg = adjacency.get(v.id)?.length ?? 0;
      if (deg > maxDegree) {
        maxDegree = deg;
        selected = v.id;
      }
    }
    rootId = selected;
  }

  // 2. Build BFS spanning tree rooted at rootId
  interface TreeNode {
    readonly id: string;
    readonly depth: number;
    readonly children: TreeNode[];
    weight: number;
  }

  const treeNodes = new Map<string, TreeNode>();
  const visited = new Set<string>([rootId]);
  const queue: string[] = [rootId];

  const rootTreeNode: TreeNode = {
    id: rootId,
    depth: 0,
    children: [],
    weight: 1,
  };
  treeNodes.set(rootId, rootTreeNode);

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const parentNode = treeNodes.get(currentId)!;
    const neighbors = adjacency.get(currentId) ?? [];

    for (const neighborId of neighbors) {
      if (!visited.has(neighborId)) {
        visited.add(neighborId);
        const childNode: TreeNode = {
          id: neighborId,
          depth: parentNode.depth + 1,
          children: [],
          weight: 1,
        };
        parentNode.children.push(childNode);
        treeNodes.set(neighborId, childNode);
        queue.push(neighborId);
      }
    }
  }

  // Any disconnected components: append to root at depth 1
  for (const v of canonical.vertices) {
    if (!visited.has(v.id)) {
      visited.add(v.id);
      const disconnectedNode: TreeNode = {
        id: v.id,
        depth: 1,
        children: [],
        weight: 1,
      };
      rootTreeNode.children.push(disconnectedNode);
      treeNodes.set(v.id, disconnectedNode);
    }
  }

  // 3. Compute subtree weights (leaves = 1, parents = sum of child weights)
  function computeWeight(node: TreeNode): number {
    if (node.children.length === 0) {
      node.weight = 1;
      return 1;
    }
    let sum = 0;
    for (const child of node.children) {
      sum += computeWeight(child);
    }
    node.weight = Math.max(1, sum);
    return node.weight;
  }
  computeWeight(rootTreeNode);

  // 4. Assign radial coordinates
  const positions = new Map<string, {x: number; y: number; layer: number}>();
  positions.set(rootId, {x: centerX, y: centerY, layer: 0});

  function layoutSubtree(
    node: TreeNode,
    sectorStart: number,
    sectorEnd: number,
  ): void {
    if (node.children.length === 0) return;

    const totalWeight = node.children.reduce((acc, c) => acc + c.weight, 0);
    const sectorSpan = sectorEnd - sectorStart;
    let currentStart = sectorStart;

    for (const child of node.children) {
      const childSpan = (child.weight / totalWeight) * sectorSpan;
      const childEnd = currentStart + childSpan;
      const angle = currentStart + childSpan / 2;
      const radius = child.depth * layerRadius;

      positions.set(child.id, {
        x: centerX + Math.cos(angle) * radius,
        y: centerY + Math.sin(angle) * radius,
        layer: child.depth,
      });

      layoutSubtree(child, currentStart, childEnd);
      currentStart = childEnd;
    }
  }

  layoutSubtree(rootTreeNode, startAngle, endAngle);

  // 5. Construct layout vertices and edges
  const layoutVertices: LayoutVertex[] = canonical.vertices.map(v => {
    const pos = positions.get(v.id)!;
    return {
      id: v.id,
      x: pos.x,
      y: pos.y,
      width: v.width,
      height: v.height,
      layer: pos.layer,
    };
  });

  const layoutEdges: LayoutEdge[] = canonical.edges.map(e => {
    const srcPos = positions.get(e.source)!;
    const tgtPos = positions.get(e.target)!;
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      points: [
        {x: srcPos.x, y: srcPos.y},
        {x: tgtPos.x, y: tgtPos.y},
      ],
    };
  });

  return {
    kind: 'radial',
    vertices: layoutVertices,
    edges: layoutEdges,
  };
}
