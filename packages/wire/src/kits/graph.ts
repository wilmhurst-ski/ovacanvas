import dagre from '@dagrejs/dagre';
import type {SceneNode, Touch, Value} from '../document/model.js';
import {isObject} from '../document/values.js';
import {drawIcon} from '../icons/draw.js';
import {resolveIcon} from '../icons/library.js';
import {
  ACCENTS,
  FieldErrors,
  PLACEMENT_FIELDS,
  checkPlacement,
  colorValue,
  placementBox,
  textWidth,
} from './fields.js';
import {checkIconName} from './icon.js';
import type {KitExpansion, KitNode, KitPart, KitSpec} from './types.js';

const FIELDS = ['nodes', 'edges', 'layout', 'shape', ...PLACEMENT_FIELDS];
const LAYOUTS = ['flow', 'tree', 'cycle', 'hub', 'grid'] as const;
const SHAPES = ['box', 'circle', 'pill'] as const;
const NODE_ID = /^[A-Za-z][A-Za-z0-9]{0,23}$/;
const LABEL_SIZE = 28;
const EDGE_LABEL_SIZE = 22;

interface GraphNode {
  id: string;
  label: string;
  color?: Value;
  shape: (typeof SHAPES)[number];
  /** An icon drawn above the label, named in words. */
  icon?: string;
}

const ICON = 44;

interface GraphEdge {
  from: string;
  to: string;
  label?: string;
  dashed: boolean;
}

// Edge forms: "a->b", "a -> b: label", "a--b" (no arrow head), "a..>b" (dashed).
const EDGE =
  /^\s*([A-Za-z][A-Za-z0-9]*)\s*(->|--|\.\.>)\s*([A-Za-z][A-Za-z0-9]*)\s*(?::\s*(.+))?$/;

function parse(
  node: KitNode,
  errors?: FieldErrors,
): {nodes: GraphNode[]; edges: (GraphEdge & {arrow: boolean})[]} {
  const shape = (SHAPES as readonly string[]).includes(String(node.shape))
    ? (node.shape as GraphNode['shape'])
    : 'box';
  const nodes: GraphNode[] = [];
  const raw = node.nodes;
  const add = (
    id: string,
    label: string,
    color?: Value,
    nodeShape?: Value,
    icon?: Value,
  ) => {
    if (!NODE_ID.test(id)) {
      errors?.error(
        'nodes',
        `node id "${id}" must be letters and digits, starting with a letter`,
      );
      return;
    }
    if (nodes.some(n => n.id === id)) {
      errors?.error('nodes', `node "${id}" is listed twice`);
      return;
    }
    const s = (SHAPES as readonly string[]).includes(String(nodeShape))
      ? (nodeShape as GraphNode['shape'])
      : shape;
    if (icon !== undefined && errors) checkIconName(errors, 'nodes', icon);
    nodes.push({
      id,
      label,
      ...(color !== undefined ? {color} : {}),
      shape: s,
      ...(typeof icon === 'string' ? {icon} : {}),
    });
  };
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === 'string') add(item, item);
      else if (isObject(item) && typeof item.id === 'string') {
        add(
          item.id,
          typeof item.label === 'string' ? item.label : item.id,
          item.color,
          item.shape,
          item.icon,
        );
      } else {
        errors?.error(
          'nodes',
          'each node is a name, or {"id", "label"?, "icon"?, "color"?, "shape"?}',
        );
      }
    }
  } else if (isObject(raw)) {
    for (const [id, label] of Object.entries(raw)) {
      if (typeof label === 'string') add(id, label);
      else if (isObject(label)) {
        add(
          id,
          typeof label.label === 'string' ? label.label : id,
          label.color,
          label.shape,
          label.icon,
        );
      } else errors?.error('nodes', `node "${id}" needs a label string`);
    }
  } else {
    errors?.error(
      'nodes',
      'nodes is a list of names, or an object {"id": "Label"}',
      'e.g. {"sun": "Sun", "leaf": "Leaf"}',
    );
  }
  if (raw !== undefined && nodes.length === 0) {
    errors?.error('nodes', 'a graph needs at least one node');
  }

  const edges: (GraphEdge & {arrow: boolean})[] = [];
  const ids = new Set(nodes.map(n => n.id));
  const edgeList = node.edges === undefined ? [] : node.edges;
  if (!Array.isArray(edgeList)) {
    errors?.error('edges', 'edges is a list like ["a->b", "b->c: label"]');
  } else {
    for (const item of edgeList) {
      let parsed: (GraphEdge & {arrow: boolean}) | null = null;
      if (typeof item === 'string') {
        const m = item.match(EDGE);
        if (m) {
          parsed = {
            from: m[1],
            to: m[3],
            arrow: m[2] !== '--',
            dashed: m[2] === '..>',
            ...(m[4] ? {label: m[4].trim()} : {}),
          };
        }
      } else if (
        isObject(item) &&
        typeof item.from === 'string' &&
        typeof item.to === 'string'
      ) {
        parsed = {
          from: item.from,
          to: item.to,
          arrow: item.arrow !== false,
          dashed: item.dashed === true,
          ...(typeof item.label === 'string' ? {label: item.label} : {}),
        };
      }
      if (!parsed) {
        errors?.error(
          'edges',
          `edge ${JSON.stringify(item)} is not "a->b", "a--b", "a..>b" or "a->b: label"`,
        );
        continue;
      }
      for (const end of [parsed.from, parsed.to]) {
        if (!ids.has(end)) {
          errors?.error(
            'edges',
            `edge ${JSON.stringify(item)} names unknown node "${end}"`,
            `nodes are ${[...ids].join(', ')}`,
          );
        }
      }
      if (parsed.from === parsed.to) {
        errors?.error(
          'edges',
          `edge ${JSON.stringify(item)} connects a node to itself`,
        );
      }
      edges.push(parsed);
    }
  }
  return {nodes, edges};
}

function nodeSize(n: GraphNode): [number, number] {
  const w = Math.max(n.icon ? 120 : 90, textWidth(n.label, LABEL_SIZE) + 44);
  if (n.shape === 'circle') {
    const d = Math.max(n.icon ? 150 : 110, w * 0.85);
    return [d, d];
  }
  // An icon sits above the label, inside the same box.
  return [w, n.icon ? 72 + ICON + 12 : 72];
}

type Vec = [number, number];

function layout(
  kind: string,
  nodes: GraphNode[],
  edges: GraphEdge[],
  spacing = 1,
): Map<string, Vec> {
  const positions = new Map<string, Vec>();
  if (kind === 'flow' || kind === 'tree') {
    const g = new dagre.graphlib.Graph();
    const labelled = edges.some(e => e.label);
    g.setGraph({
      rankdir: kind === 'flow' ? 'LR' : 'TB',
      nodesep: Math.round((labelled ? 90 : 60) * spacing),
      ranksep: Math.round((labelled ? 170 : 110) * spacing),
    });
    g.setDefaultEdgeLabel(() => ({}));
    for (const n of nodes) {
      const [width, height] = nodeSize(n);
      g.setNode(n.id, {width, height});
    }
    for (const e of edges) g.setEdge(e.from, e.to);
    dagre.layout(g);
    for (const n of nodes) {
      const p = g.node(n.id) as {x: number; y: number};
      positions.set(n.id, [p.x, p.y]);
    }
  } else if (kind === 'cycle' || kind === 'hub') {
    const ring = kind === 'hub' ? nodes.slice(1) : nodes;
    if (kind === 'hub') positions.set(nodes[0].id, [0, 0]);
    ring.forEach((n, i) => {
      const angle = -Math.PI / 2 + (2 * Math.PI * i) / Math.max(1, ring.length);
      positions.set(n.id, [Math.cos(angle) * 300, Math.sin(angle) * 300]);
    });
  } else {
    const columns = Math.ceil(Math.sqrt(nodes.length));
    nodes.forEach((n, i) =>
      positions.set(n.id, [(i % columns) * 280, Math.floor(i / columns) * 170]),
    );
  }
  return positions;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Centre-and-size rectangles overlap. */
function rectsOverlap(a: Rect, b: Rect): boolean {
  return (
    Math.abs(a.x - b.x) * 2 < a.w + b.w && Math.abs(a.y - b.y) * 2 < a.h + b.h
  );
}

/** Whether a line segment passes through a centre-and-size rectangle. */
function segmentHitsRect(p: Vec, q: Vec, r: Rect): boolean {
  const x0 = r.x - r.w / 2;
  const x1 = r.x + r.w / 2;
  const y0 = r.y - r.h / 2;
  const y1 = r.y + r.h / 2;
  // Liang-Barsky clipping: the segment meets the box if any part survives.
  let t0 = 0;
  let t1 = 1;
  const dx = q[0] - p[0];
  const dy = q[1] - p[1];
  const edges: [number, number][] = [
    [-dx, p[0] - x0],
    [dx, x1 - p[0]],
    [-dy, p[1] - y0],
    [dy, y1 - p[1]],
  ];
  for (const [pk, qk] of edges) {
    if (pk === 0) {
      if (qk < 0) return false;
      continue;
    }
    const t = qk / pk;
    if (pk < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return false;
  }
  return true;
}

function segmentsCross(p1: Vec, p2: Vec, p3: Vec, p4: Vec): boolean {
  const d = (a: Vec, b: Vec, c: Vec) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  return d(p3, p4, p1) * d(p3, p4, p2) < 0 && d(p1, p2, p3) * d(p1, p2, p4) < 0;
}

/** The middle of one side of a box centred at `centre`. */
function sidePoint(centre: Vec, size: Vec, side: string): Vec {
  const [w, h] = size;
  if (side === 'right') return [centre[0] + w / 2, centre[1]];
  if (side === 'left') return [centre[0] - w / 2, centre[1]];
  if (side === 'top') return [centre[0], centre[1] - h / 2];
  return [centre[0], centre[1] + h / 2];
}

/** The side of a box facing a direction, as an anchor side name. */
function sideToward(dx: number, dy: number): string {
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  if (angle > -45 && angle <= 45) return 'right';
  if (angle > 45 && angle <= 135) return 'bottom';
  if (angle > -135 && angle <= -45) return 'top';
  return 'left';
}

export const graph: KitSpec = {
  name: 'graph',
  summary:
    'A diagram of labelled nodes joined by arrows: flows, cycles, trees, hubs. Layout, sizes, arrow sides and edge labels are handled for you. Use it for any "what leads to what" explanation.',
  fields: {
    nodes: {
      type: '{"id": "Label", ...} or ["a", "b"] or [{"id", "label", "icon"?, "color"?, "shape"?}] - "icon" names an icon in words ("database", "user", "cloud")',
      required: true,
      doc: 'The nodes; ids are letters and digits.',
    },
    edges: {
      type: '["a->b", "b->c: label", "c--d", "d..>e"]',
      doc: '"->" arrow, "--" plain line, "..>" dashed arrow; ": text" labels the edge.',
    },
    layout: {
      type: '"flow" | "tree" | "cycle" | "hub" | "grid"',
      doc: 'flow = left to right, tree = top down, cycle = a ring in order, hub = first node in the middle. Default flow.',
    },
    shape: {
      type: '"box" | "circle" | "pill"',
      doc: 'Node shape (default box); a node can override it.',
    },
    region: {
      type: 'full | left | right | center | top | bottom',
      doc: 'Where the diagram goes (default full).',
    },
    box: {
      type: '[centreX, centreY, width, height]',
      doc: 'An explicit stage box instead of a region.',
    },
  },
  parts: '"<id>.<nodeId>" a node, "<id>.a->b" an edge (trace draws it)',
  example: {
    id: 'water',
    kit: 'graph',
    layout: 'cycle',
    nodes: {sea: 'Ocean', cloud: 'Clouds', rain: 'Rain', river: 'Rivers'},
    edges: [
      'sea->cloud: evaporation',
      'cloud->rain: condensation',
      'rain->river',
      'river->sea',
    ],
  },

  validate(node) {
    const errors = new FieldErrors(node);
    errors.onlyFields(FIELDS);
    checkPlacement(node, errors);
    if (
      node.layout !== undefined &&
      !(LAYOUTS as readonly string[]).includes(String(node.layout))
    ) {
      errors.error('layout', `layout must be one of ${LAYOUTS.join(', ')}`);
    }
    if (
      node.shape !== undefined &&
      !(SHAPES as readonly string[]).includes(String(node.shape))
    ) {
      errors.error('shape', `shape must be one of ${SHAPES.join(', ')}`);
    }
    parse(node, errors);
    return errors.issues;
  },

  expand(node): KitExpansion {
    const {nodes, edges} = parse(node);
    const box = placementBox(node);
    const id = node.id;
    const kind = typeof node.layout === 'string' ? node.layout : 'flow';
    const sizes = new Map(nodes.map(n => [n.id, nodeSize(n)]));
    // Fit the layout into the box, keeping node sizes and aspect. A tight
    // box first spends the room between boxes - ranks and neighbours drawn
    // closer - and only then shrinks the boxes and their type.
    const fitOf = (positions: Map<string, Vec>) => {
      const xs = nodes.flatMap(n => [
        positions.get(n.id)![0] - sizes.get(n.id)![0] / 2,
        positions.get(n.id)![0] + sizes.get(n.id)![0] / 2,
      ]);
      const ys = nodes.flatMap(n => [
        positions.get(n.id)![1] - sizes.get(n.id)![1] / 2,
        positions.get(n.id)![1] + sizes.get(n.id)![1] / 2,
      ]);
      const spanX = Math.max(...xs) - Math.min(...xs) || 1;
      const spanY = Math.max(...ys) - Math.min(...ys) || 1;
      return {
        xs,
        ys,
        scale: Math.min(
          1.4,
          (box.width - 60) / spanX,
          (box.height - 60) / spanY,
        ),
      };
    };
    let raw = layout(kind, nodes, edges);
    let fit = fitOf(raw);
    if (kind === 'flow' || kind === 'tree') {
      // Labelled edges keep room between ranks for their labels.
      const tightest = edges.some(e => e.label) ? 0.55 : 0.4;
      for (const spacing of [0.75, 0.55, 0.4]) {
        if (fit.scale >= 0.95 || spacing < tightest) break;
        const tighter = layout(kind, nodes, edges, spacing);
        const tighterFit = fitOf(tighter);
        if (tighterFit.scale > fit.scale) {
          raw = tighter;
          fit = tighterFit;
        }
      }
    }
    const {xs, ys, scale} = fit;
    const cx = (Math.max(...xs) + Math.min(...xs)) / 2;
    const cy = (Math.max(...ys) + Math.min(...ys)) / 2;
    const at = new Map<string, Vec>(
      nodes.map(n => [
        n.id,
        [
          Math.round(box.x + (raw.get(n.id)![0] - cx) * scale),
          Math.round(box.y + (raw.get(n.id)![1] - cy) * scale),
        ],
      ]),
    );

    // A diagram shrunk to fit its box shrinks whole: boxes, type and icons
    // with the spacing, or its boxes would overlap.
    const shrink = Math.min(1, scale);
    for (const [key, [w, h]] of sizes) sizes.set(key, [w * shrink, h * shrink]);
    const labelSize = Math.max(16, Math.round(LABEL_SIZE * shrink));
    const edgeLabelSize = Math.max(14, Math.round(EDGE_LABEL_SIZE * shrink));
    const iconSize = Math.max(20, Math.round(ICON * shrink));

    const out: SceneNode[] = [];
    const touches: Touch[] = [];
    const parts = new Map<string, KitPart>();
    const shapeId = (n: string) => `${id}_n${n}`;
    const labelId = (n: string) => `${id}_t${n}`;

    // Where every edge runs. A tree is drawn the way textbooks draw one:
    // down from the parent to a shared bar, then straight down into each
    // child - so edges leaving one node never crowd into a fan, and each
    // label sits beside its own drop. Other layouts go box side to box side.
    const orthogonal = kind === 'tree';
    const top = (n: string) => at.get(n)![1] - sizes.get(n)![1] / 2;
    const bottom = (n: string) => at.get(n)![1] + sizes.get(n)![1] / 2;
    const busY = new Map<string, number>();
    if (orthogonal) {
      for (const e of edges) {
        const childTop = Math.min(
          ...edges.filter(x => x.from === e.from).map(x => top(x.to)),
        );
        busY.set(e.from, bottom(e.from) + (childTop - bottom(e.from)) * 0.4);
      }
    }
    const routeHitsRect = (route: Vec[], rect: Rect) =>
      route.some((p, k) => k > 0 && segmentHitsRect(route[k - 1], p, rect));
    const nodeRects = nodes.map(n => {
      const [x, y] = at.get(n.id)!;
      const [w, h] = sizes.get(n.id)!;
      return {x, y, w, h};
    });
    // Clear of a box by both audit halos and a little air.
    const CLEAR = 16;
    const blocked = (route: Vec[], from: string, to: string) =>
      nodes.some((n, k) => {
        if (n.id === from || n.id === to) return false;
        const r = nodeRects[k];
        return routeHitsRect(route, {
          x: r.x,
          y: r.y,
          w: r.w + 2 * CLEAR,
          h: r.h + 2 * CLEAR,
        });
      });
    const detoured = new Set<number>();
    const routes: Vec[][] = edges.map((e, index) => {
      const a = at.get(e.from)!;
      const b = at.get(e.to)!;
      if (orthogonal && top(e.to) > bottom(e.from)) {
        const y = busY.get(e.from)!;
        return Math.abs(a[0] - b[0]) < 1
          ? [
              [a[0], bottom(e.from)],
              [b[0], top(e.to)],
            ]
          : [
              [a[0], bottom(e.from)],
              [a[0], y],
              [b[0], y],
              [b[0], top(e.to)],
            ];
      }
      const fromSide = sideToward(b[0] - a[0], b[1] - a[1]);
      const toSide = sideToward(a[0] - b[0], a[1] - b[1]);
      const straight: Vec[] = [
        sidePoint(a, sizes.get(e.from)!, fromSide),
        sidePoint(b, sizes.get(e.to)!, toSide),
      ];
      if (!blocked(straight, e.from, e.to)) return straight;
      // A box stands in the way (a grid row, a cycle's far side): bend
      // around it through the nearest clear point beside the straight line,
      // leaving and arriving on the sides that face the bend.
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const normal: Vec = [-(b[1] - a[1]) / length, (b[0] - a[0]) / length];
      const mid: Vec = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      for (let d = 40; d <= 420; d += 20) {
        for (const sign of [-1, 1]) {
          const w: Vec = [
            mid[0] + normal[0] * d * sign,
            mid[1] + normal[1] * d * sign,
          ];
          const route: Vec[] = [
            sidePoint(
              a,
              sizes.get(e.from)!,
              sideToward(w[0] - a[0], w[1] - a[1]),
            ),
            w,
            sidePoint(
              b,
              sizes.get(e.to)!,
              sideToward(w[0] - b[0], w[1] - b[1]),
            ),
          ];
          if (!blocked(route, e.from, e.to)) {
            detoured.add(index);
            return route;
          }
        }
      }
      return straight;
    });
    const placedLabels: {x: number; y: number; w: number; h: number}[] = [];

    // Edges first, under the nodes.
    const edgeLines: {id: string; a: Vec; b: Vec; from: string; to: string}[] =
      [];
    edges.forEach((e, index) => {
      const a = at.get(e.from)!;
      const b = at.get(e.to)!;
      const lineId = `${id}_e${index}`;
      const fromSide = sideToward(b[0] - a[0], b[1] - a[1]);
      const toSide = sideToward(a[0] - b[0], a[1] - b[1]);
      const route = routes[index];
      out.push({
        id: lineId,
        component: 'Line',
        props: {
          points:
            orthogonal || detoured.has(index)
              ? route.map(([x, y]) => [Math.round(x), Math.round(y)])
              : [
                  {ref: shapeId(e.from), side: fromSide},
                  {ref: shapeId(e.to), side: toSide},
                ],
          ...(detoured.has(index) ? {radius: 40} : {}),
          stroke: {theme: 'ink'},
          lineWidth: 3,
          ...(e.arrow ? {endArrow: true, arrowSize: 16} : {}),
          ...(e.dashed ? {lineDash: [10, 8]} : {}),
        },
      });
      edgeLines.push({id: lineId, a, b, from: e.from, to: e.to});
      if (orthogonal || detoured.has(index)) {
        // Drawn from fixed points, so the boxes it joins are named here.
        for (const end of [e.from, e.to]) {
          touches.push({
            a: lineId,
            b: shapeId(end),
            reason: 'the arrow joins this box',
          });
        }
      }
      const partNodes = [lineId];
      if (e.label) {
        // Measured on the arrow as drawn: first beside the leg arriving at
        // the target (the whole edge when it is straight), then beside its
        // earlier legs - a tree's bar - when the last leg is too short.
        const legs = route
          .slice(1)
          .map((pb, k) => ({pa: route[k], pb, k}))
          .reverse();
        // A label is tried on one line, then - when no spot is clear -
        // wrapped onto two, which fits between edges a single line cannot.
        const words = e.label.split(/\s+/);
        const split = Math.ceil(words.length / 2);
        const forms: string[][] = [[e.label]];
        if (words.length > 1) {
          forms.push([
            words.slice(0, split).join(' '),
            words.slice(split).join(' '),
          ]);
        }
        const lineHeight = edgeLabelSize * 1.3;
        let best: {spot: Vec; lines: string[]; w: number; h: number} | null =
          null;
        let fewest = Infinity;
        search: for (const lines of forms) {
          // Measured, plus the overhang the audit allows either side.
          const labelWidth =
            Math.max(...lines.map(l => textWidth(l, edgeLabelSize))) +
            edgeLabelSize * 0.2;
          const labelHeight = lines.length * lineHeight + edgeLabelSize * 0.1;
          for (const {pa, pb, k: leg} of legs) {
            const length = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) || 1;
            let normal: Vec = [
              -(pb[1] - pa[1]) / length,
              (pb[0] - pa[0]) / length,
            ];
            if (normal[1] > 0 || (normal[1] === 0 && normal[0] < 0)) {
              normal = [-normal[0], -normal[1]];
            }
            // Clear of the line by the label's own extent along the normal
            // (a long label beside a diagonal needs more room than a short
            // one), plus both audit halos and a little air.
            const offset =
              Math.abs(normal[0]) * (labelWidth / 2) +
              Math.abs(normal[1]) * (labelHeight / 2) +
              8 +
              4 +
              14;
            // This edge's other legs are obstacles for a label beside this one.
            const ownOthers = route
              .slice(1)
              .map((p, k) => [route[k], p] as [Vec, Vec])
              .filter((_, k) => k !== leg);
            // The middle first, then toward either end, on either side: where
            // edges fan out of one node the middles crowd together; further
            // along, they spread apart.
            for (const t of [0.5, 0.62, 0.38, 0.72, 0.28, 0.8, 0.2]) {
              for (const sign of [1, -1]) {
                const cx =
                  pa[0] + (pb[0] - pa[0]) * t + normal[0] * offset * sign;
                const cy =
                  pa[1] + (pb[1] - pa[1]) * t + normal[1] * offset * sign;
                const rect = {
                  x: cx,
                  y: cy,
                  w: labelWidth + 30,
                  h: labelHeight + 30,
                };
                // Leaving the diagram's box counts as badly as covering a node.
                const outside =
                  Math.abs(cx - box.x) + rect.w / 2 > box.width / 2 ||
                  Math.abs(cy - box.y) + rect.h / 2 > box.height / 2;
                const conflicts =
                  (outside ? 3 : 0) +
                  3 * nodeRects.filter(r => rectsOverlap(rect, r)).length +
                  2 * placedLabels.filter(r => rectsOverlap(rect, r)).length +
                  routes.filter(
                    (other, k) => k !== index && routeHitsRect(other, rect),
                  ).length +
                  ownOthers.filter(([p, q]) => segmentHitsRect(p, q, rect))
                    .length;
                // A wrapped label must do strictly better to be chosen.
                if (conflicts < fewest) {
                  fewest = conflicts;
                  best = {spot: [cx, cy], lines, w: rect.w, h: rect.h};
                }
                if (conflicts === 0) break search;
              }
            }
          }
        }
        let chosen = best!;
        // No clear spot beside the line (a tree squeezed into a band): the
        // label sits on the line instead, on a patch of paper, the way a
        // printed diagram labels a tight edge - if that spot is clear of
        // the boxes and the other labels.
        let onLine = false;
        if (fewest > 0) {
          const longest = legs.reduce((x, y) =>
            Math.hypot(y.pb[0] - y.pa[0], y.pb[1] - y.pa[1]) >
            Math.hypot(x.pb[0] - x.pa[0], x.pb[1] - x.pa[1])
              ? y
              : x,
          );
          const lines = [e.label];
          const w =
            textWidth(e.label, edgeLabelSize) + edgeLabelSize * 0.2 + 12;
          const h = lineHeight + 6;
          const spot: Vec = [
            (longest.pa[0] + longest.pb[0]) / 2,
            (longest.pa[1] + longest.pb[1]) / 2,
          ];
          const rect = {x: spot[0], y: spot[1], w: w + 24, h: h + 24};
          const clear =
            !nodeRects.some(r => rectsOverlap(rect, r)) &&
            !placedLabels.some(r => rectsOverlap(rect, r));
          if (clear) {
            chosen = {spot, lines, w: rect.w, h: rect.h};
            onLine = true;
          }
        }
        const patchId = `${id}_l${index}bg`;
        if (onLine) {
          out.push({
            id: patchId,
            component: 'Rect',
            halo: 0,
            props: {
              size: [
                Math.round(textWidth(e.label, edgeLabelSize) + 12),
                Math.round(lineHeight + 4),
              ],
              radius: 6,
              fill: {theme: 'paper'},
              position: [
                Math.round(chosen.spot[0]),
                Math.round(chosen.spot[1]),
              ],
            },
          });
          touches.push(
            {a: patchId, b: lineId, reason: 'the label sits on its own edge'},
            {
              a: `${id}_l${index}`,
              b: lineId,
              reason: 'the label sits on its own edge',
            },
            {
              a: `${id}_l${index}`,
              b: patchId,
              reason: 'the label is drawn on its patch',
            },
          );
        }
        placedLabels.push({
          x: chosen.spot[0],
          y: chosen.spot[1],
          w: chosen.w,
          h: chosen.h,
        });
        const tid = `${id}_l${index}`;
        const lineIds = chosen.lines.map((_, k) =>
          k === 0 ? tid : `${tid}_${k}`,
        );
        chosen.lines.forEach((line, k) => {
          out.push({
            id: lineIds[k],
            component: 'Txt',
            props: {
              text: line,
              fontSize: edgeLabelSize,
              fill: {theme: 'secondaryInk'},
              position: [
                Math.round(chosen.spot[0]),
                Math.round(
                  chosen.spot[1] +
                    (k - (chosen.lines.length - 1) / 2) * lineHeight,
                ),
              ],
            },
          });
        });
        if (lineIds.length > 1) {
          touches.push({
            a: lineIds[0],
            b: lineIds[1],
            reason: 'two lines of one label',
          });
        }
        partNodes.push(...lineIds.slice(1));
        partNodes.push(tid);
        if (onLine) partNodes.push(patchId);
      }
      const part: KitPart = {nodes: partNodes, traceable: [lineId]};
      parts.set(`${e.from}->${e.to}`, part);
      parts.set(`${e.from}-${e.to}`, part);
    });
    for (let i = 0; i < edgeLines.length; i++) {
      for (let j = i + 1; j < edgeLines.length; j++) {
        const p = edgeLines[i];
        const q = edgeLines[j];
        const shared = [p.from, p.to].some(n => n === q.from || n === q.to);
        if (shared || segmentsCross(p.a, p.b, q.a, q.b)) {
          touches.push({
            a: p.id,
            b: q.id,
            reason: shared
              ? 'arrows meet at the same node'
              : 'arrows of the diagram cross',
          });
        }
      }
    }

    // Nodes: a shape with its label inside.
    nodes.forEach((n, index) => {
      const [w, h] = sizes.get(n.id)!;
      const color = colorValue(
        n.color as Value,
        ACCENTS[index % ACCENTS.length],
      );
      out.push({
        id: shapeId(n.id),
        component: n.shape === 'circle' ? 'Circle' : 'Rect',
        props: {
          size: n.shape === 'circle' ? w : [Math.round(w), h],
          ...(n.shape === 'circle'
            ? {}
            : {radius: n.shape === 'pill' ? h / 2 : 14}),
          fill: {theme: 'clearField'},
          stroke: color,
          lineWidth: 3,
          position: at.get(n.id)!,
        },
      });
      const def = n.icon ? resolveIcon(n.icon) : null;
      out.push({
        id: labelId(n.id),
        component: 'Txt',
        parent: shapeId(n.id),
        props: {
          text: n.label,
          fontSize: labelSize,
          ...(def ? {position: [0, Math.round(iconSize / 2 + 6)]} : {}),
        },
      });
      const iconIds: string[] = [];
      let traceable: string[] = [];
      if (def) {
        // Drawn in the node's own colour, inside its box, above the label.
        const drawn = drawIcon(
          `${shapeId(n.id)}Glyph`,
          def,
          [0, -Math.round(iconSize / 2 + 4)],
          {
            size: iconSize,
            style: 'line',
            color:
              typeof n.color === 'string'
                ? n.color
                : ACCENTS[index % ACCENTS.length],
          },
        );
        for (const part of drawn.nodes) {
          out.push({...part, parent: shapeId(n.id)});
        }
        touches.push(...drawn.touches);
        iconIds.push(...drawn.ids);
        traceable = drawn.strokeId ? [drawn.strokeId] : [];
        for (const part of drawn.ids) {
          touches.push({
            a: part,
            b: labelId(n.id),
            reason: 'the icon and name of one node',
          });
        }
      }
      parts.set(n.id, {
        nodes: [shapeId(n.id), labelId(n.id), ...iconIds],
        ...(traceable.length ? {traceable} : {}),
      });
    });
    return {nodes: out, touches, parts};
  },
};
