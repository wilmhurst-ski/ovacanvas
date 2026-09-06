import {
  Force,
  ForceLinkDatum,
  ForceNodeDatum,
  forceCenter,
  forceLink,
  forceManyBody,
} from 'd3-force';
import {canonicalizeGraph, finiteConfig} from './canonical';
import {
  ForceLayoutConfig,
  GraphInput,
  GraphLayoutError,
  GraphLayoutResult,
} from './types';

const MAX_ITERATIONS = 100_000;
const UINT32_MAX = 0xffffffff;

interface ForceNode extends ForceNodeDatum {
  readonly id: string;
  index: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface ForceEdge extends ForceLinkDatum<ForceNode> {
  readonly id: string;
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function validateForceConfig(config: ForceLayoutConfig) {
  if (config === null || typeof config !== 'object') {
    throw new GraphLayoutError(
      'INVALID_CONFIGURATION',
      'Force layout configuration must be an object.',
    );
  }
  if (
    !Number.isSafeInteger(config.seed) ||
    config.seed < 0 ||
    config.seed > UINT32_MAX
  ) {
    throw new GraphLayoutError(
      'INVALID_SEED',
      `seed must be an unsigned 32-bit integer.`,
    );
  }
  if (
    !Number.isSafeInteger(config.iterations) ||
    config.iterations < 1 ||
    config.iterations > MAX_ITERATIONS
  ) {
    throw new GraphLayoutError(
      'INVALID_ITERATIONS',
      `iterations must be an integer from 1 through ${MAX_ITERATIONS}.`,
    );
  }

  return {
    linkDistance: finiteConfig(config.linkDistance, 80, 'linkDistance', 0),
    linkStrength: finiteConfig(config.linkStrength, 0.7, 'linkStrength', 0),
    manyBodyStrength: finiteConfig(
      config.manyBodyStrength,
      -120,
      'manyBodyStrength',
    ),
    centerX: finiteConfig(config.centerX, 0, 'centerX'),
    centerY: finiteConfig(config.centerY, 0, 'centerY'),
    centerStrength: finiteConfig(
      config.centerStrength,
      1,
      'centerStrength',
      0,
      1,
    ),
    initialRadius: finiteConfig(config.initialRadius, 100, 'initialRadius', 0),
    alphaDecay: finiteConfig(
      config.alphaDecay,
      1 - Math.pow(0.001, 1 / 300),
      'alphaDecay',
      0,
      1,
    ),
    velocityDecay: finiteConfig(
      config.velocityDecay,
      0.4,
      'velocityDecay',
      0,
      1,
    ),
  };
}

/**
 * Compute a seeded force layout using a fixed, synchronous iteration count.
 *
 * The adapter initializes d3's pure force primitives directly. It deliberately
 * never creates a d3 simulation, timer, animation frame, or scheduler.
 *
 * @internal This capability boundary is not a frozen public serialization API.
 */
export function layoutForceGraph(
  input: GraphInput,
  config: ForceLayoutConfig,
): GraphLayoutResult {
  const canonical = canonicalizeGraph(input);
  const options = validateForceConfig(config);
  if (canonical.vertices.length === 0) {
    return {kind: 'force', vertices: [], edges: []};
  }

  const random = seededRandom(config.seed);
  const nodes: ForceNode[] = canonical.vertices.map((vertex, index) => {
    const angle = random() * Math.PI * 2;
    const radius = options.initialRadius * Math.sqrt((index + 1) / 2);
    return {
      id: vertex.id,
      index,
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
      vx: 0,
      vy: 0,
    };
  });
  const links: ForceEdge[] = canonical.edges.map(edge => ({...edge}));
  const forces: Force<ForceNode>[] = [
    forceLink<ForceNode, ForceEdge>(links)
      .id(node => node.id)
      .distance(options.linkDistance)
      .strength(options.linkStrength)
      .iterations(1),
    forceManyBody<ForceNode>().strength(options.manyBodyStrength),
    forceCenter<ForceNode>(options.centerX, options.centerY).strength(
      options.centerStrength,
    ),
  ];
  for (const force of forces) force.initialize?.(nodes, random);

  let alpha = 1;
  const velocityRetention = 1 - options.velocityDecay;
  for (let iteration = 0; iteration < config.iterations; iteration += 1) {
    alpha += (0 - alpha) * options.alphaDecay;
    for (const force of forces) force(alpha);
    for (const node of nodes) {
      node.x += node.vx *= velocityRetention;
      node.y += node.vy *= velocityRetention;
    }
  }

  const nodeById = new Map(nodes.map(node => [node.id, node]));
  const vertices = canonical.vertices.map(vertex => {
    const node = nodeById.get(vertex.id)!;
    if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) {
      throw new GraphLayoutError(
        'INCOMPLETE_LAYOUT',
        `Vertex ${vertex.id} did not receive finite coordinates.`,
      );
    }
    return {...vertex, x: node.x, y: node.y};
  });
  const edges = canonical.edges.map(edge => {
    const source = nodeById.get(edge.source)!;
    const target = nodeById.get(edge.target)!;
    return {
      ...edge,
      points: [
        {x: source.x, y: source.y},
        {x: target.x, y: target.y},
      ],
    };
  });

  return {kind: 'force', vertices, edges};
}
