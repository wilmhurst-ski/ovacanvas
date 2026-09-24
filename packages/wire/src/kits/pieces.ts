import chroma from 'chroma-js';
import type {SceneNode, Touch} from '../document/model.js';
import {isObject} from '../document/values.js';
import {ICON_HEX, hexColor} from '../icons/draw.js';
import {
  FieldErrors,
  PLACEMENT_FIELDS,
  checkPlacement,
  placementBox,
  texWidthEm,
} from './fields.js';
import {PARAMS_FIELD, coordinate, readParams, type Params} from './params.js';
import type {KitExpansion, KitNode, KitPart, KitSpec} from './types.js';

/**
 * Pieces: flat shapes that move between arrangements as solid pieces.
 *
 * @remarks
 * Rearrangement is how a great many things are shown - a dissection proof
 * of Pythagoras, a parallelogram cut into a rectangle, fractions of a
 * whole, a tangram. The author lists where each piece is in each
 * arrangement (corners can be expressions in params, `["a+b", 0]`) and a
 * beat `{"set": {"proof.layout": "square"}}` moves them. The kit works out
 * the rest:
 *
 * - a piece in the same shape in two arrangements travels there as a solid
 *   piece - sliding and turning the short way - rather than melting from
 *   one outline into the other;
 * - a piece that joins an arrangement comes out of a piece of the same
 *   shape already there (copies peel off the original), and one that
 *   leaves goes back into one;
 * - the frame fits every arrangement, and every param value a beat sets,
 *   so nothing ever leaves the box or jumps in scale.
 */

const FIELDS = ['params', 'layouts', 'layout', 'color', ...PLACEMENT_FIELDS];
const NAME = /^[A-Za-z][A-Za-z0-9]{0,11}$/;
const ENTRY_KEYS = ['points', 'color', 'label', 'outline'];
/** How closely a piece must match a turned copy to count as the same shape. */
const RIGID = 0.5;

type Vec = [number, number];

interface PieceEntry {
  points: Vec[];
  color?: string;
  label?: string;
  outline: boolean;
}
type Layout = Map<string, PieceEntry>;

interface Parsed {
  params: Params;
  layouts: Map<string, Layout>;
  layout: string;
  color?: string;
}

function parse(node: KitNode, errors?: FieldErrors): Parsed {
  const params = readParams(node.params, errors);
  const layouts = new Map<string, Layout>();
  if (!isObject(node.layouts) || !Object.keys(node.layouts).length) {
    errors?.error(
      'layouts',
      'layouts is {"<layout>": {"<piece>": [[x, y], ...], ...}, ...}',
      'e.g. "layouts": {"start": {"T": [[0, 0], [4, 0], [0, 3]]}}',
    );
  } else {
    for (const [layoutName, pieces] of Object.entries(node.layouts)) {
      if (!NAME.test(layoutName)) {
        errors?.error(
          'layouts',
          `layout name "${layoutName}" must be letters and digits`,
        );
      }
      if (!isObject(pieces) || !Object.keys(pieces).length) {
        errors?.error(
          'layouts',
          `layout "${layoutName}" is {"<piece>": [[x, y], ...], ...}`,
        );
        continue;
      }
      const layout: Layout = new Map();
      for (const [name, raw] of Object.entries(pieces)) {
        const where = `layout "${layoutName}", piece "${name}"`;
        if (!NAME.test(name)) {
          errors?.error(
            'layouts',
            `piece name "${name}" must be letters and digits`,
          );
          continue;
        }
        const entry = isObject(raw) ? raw : {points: raw};
        if (isObject(raw)) {
          const extra = Object.keys(raw).filter(k => !ENTRY_KEYS.includes(k));
          if (extra.length) {
            errors?.error(
              'layouts',
              `${where} has unknown key(s) ${extra.join(', ')}`,
              'a piece is [[x, y], ...] or {"points", "color"?, "label"?, "outline"?}',
            );
          }
        }
        if (!Array.isArray(entry.points) || entry.points.length < 3) {
          errors?.error(
            'layouts',
            `${where} needs at least three corners [[x, y], ...]`,
          );
          continue;
        }
        const points: Vec[] = [];
        for (const corner of entry.points) {
          if (!Array.isArray(corner) || corner.length !== 2) {
            errors?.error('layouts', `${where}: a corner is [x, y]`);
            continue;
          }
          const x = coordinate(corner[0], params, errors, 'layouts');
          const y = coordinate(corner[1], params, errors, 'layouts');
          if (x !== null && y !== null) points.push([x, y]);
        }
        if (points.length !== entry.points.length) continue;
        if (entry.color !== undefined && typeof entry.color !== 'string') {
          errors?.error('layouts', `${where}: color is a colour name`);
        }
        if (entry.label !== undefined && typeof entry.label !== 'string') {
          errors?.error('layouts', `${where}: label is LaTeX, e.g. "c^2"`);
        }
        if (entry.outline !== undefined && typeof entry.outline !== 'boolean') {
          errors?.error('layouts', `${where}: outline is true or false`);
        }
        layout.set(name, {
          points,
          ...(typeof entry.color === 'string' ? {color: entry.color} : {}),
          ...(typeof entry.label === 'string' ? {label: entry.label} : {}),
          outline: entry.outline === true,
        });
      }
      layouts.set(layoutName, layout);
    }
  }
  const names = [...layouts.keys()];
  let layout = names[0] ?? '';
  if (node.layout !== undefined) {
    if (typeof node.layout === 'string' && layouts.has(node.layout)) {
      layout = node.layout;
    } else {
      errors?.error(
        'layout',
        `layout ${JSON.stringify(node.layout)} is not one of the layouts`,
        names.length ? `layouts: ${names.join(', ')}` : undefined,
      );
    }
  }
  if (node.color !== undefined && typeof node.color !== 'string') {
    errors?.error('color', 'color is a colour name, e.g. "magenta"');
  }
  return {
    params,
    layouts,
    layout,
    ...(typeof node.color === 'string' ? {color: node.color} : {}),
  };
}

function centroid(points: readonly Vec[]): Vec {
  // Area centroid, so a turn spins a piece about its middle.
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < points.length; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[(i + 1) % points.length];
    const cross = x0 * y1 - x1 * y0;
    area += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  if (Math.abs(area) < 1e-9) {
    return [
      points.reduce((s, p) => s + p[0], 0) / points.length,
      points.reduce((s, p) => s + p[1], 0) / points.length,
    ];
  }
  return [cx / (3 * area), cy / (3 * area)];
}

/**
 * The turn (degrees) taking `local` (about its centroid) onto `target`
 * (about its centroid), trying every way round the corners - or null when
 * the two are not the same shape.
 */
function rigidTurn(
  local: readonly Vec[],
  target: readonly Vec[],
): number | null {
  if (local.length !== target.length) return null;
  const n = local.length;
  const c = centroid(target);
  const t = target.map(([x, y]) => [x - c[0], y - c[1]] as Vec);
  for (const reversed of [false, true]) {
    for (let shift = 0; shift < n; shift++) {
      const pair = (i: number) =>
        t[reversed ? (shift - i + n) % n : (i + shift) % n];
      // Best rotation in closed form (2D Kabsch).
      let sxx = 0;
      let sxy = 0;
      for (let i = 0; i < n; i++) {
        const [ax, ay] = local[i];
        const [bx, by] = pair(i);
        sxx += ax * bx + ay * by;
        sxy += ax * by - ay * bx;
      }
      const angle = Math.atan2(sxy, sxx);
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      let worst = 0;
      for (let i = 0; i < n; i++) {
        const [ax, ay] = local[i];
        const [bx, by] = pair(i);
        worst = Math.max(
          worst,
          Math.hypot(ax * cos - ay * sin - bx, ax * sin + ay * cos - by),
        );
      }
      if (worst < RIGID) return (angle * 180) / Math.PI;
    }
  }
  return null;
}

function tint(color: string): {fill: string; stroke: string} {
  const hex = hexColor(color, ICON_HEX.magenta ?? '#b5489c');
  return {
    fill: chroma.mix(hex, '#FFFFFF', 0.55, 'rgb').hex(),
    stroke: hex,
  };
}

export const pieces: KitSpec = {
  name: 'pieces',
  summary:
    'Flat pieces that move between arrangements as solid shapes: dissection proofs, rearranging areas, fractions of a whole. List each arrangement; {"set": {"<id>.layout": "<name>"}} moves the pieces there - same-shaped pieces slide and turn, new ones peel off a matching piece. Corners may use params, so {"set": {"<id>.a": 3}} reshapes every arrangement at once.',
  fields: {
    layouts: {
      type: '{"<layout>": {"<piece>": [[x, y], ...] | {"points", "color"?, "label"?, "outline"?}}}',
      required: true,
      doc: 'Where every piece is in each arrangement; y down, any units (the whole thing is scaled to fit). A piece left out of an arrangement tucks under a piece of the same shape, or fades. "label" is LaTeX drawn in the middle; "outline": true is an unfilled region (a hole, a square on a side).',
    },
    layout: {
      type: 'string',
      doc: 'The arrangement shown first (default: the first listed).',
    },
    params: PARAMS_FIELD,
    color: {
      type: 'colour name',
      doc: 'Fill for every piece (default magenta); a piece can set its own "color".',
    },
    region: {
      type: 'full | left | right | center | top | bottom',
      doc: 'Where the pieces go (default full).',
    },
    box: {
      type: '[centreX, centreY, width, height]',
      doc: 'An explicit stage box instead of a region.',
    },
  },
  parts:
    '"<id>.<piece>" one piece with its label; "<id>" every piece in the current arrangement',
  // Piece names are often capital letters, as in a figure.
  /* eslint-disable @typescript-eslint/naming-convention */
  example: {
    id: 'proof',
    kit: 'pieces',
    params: {a: 3, b: 4},
    layouts: {
      halves: {
        T1: [
          [0, 0],
          ['a', 0],
          [0, 'b'],
        ],
        T2: [
          ['a', 0],
          ['a', 'b'],
          [0, 'b'],
        ],
      },
      apart: {
        T1: [
          [0, 0],
          ['a', 0],
          [0, 'b'],
        ],
        T2: [
          ['a+1', 0],
          ['2*a+1', 0],
          ['a+1', 'b'],
        ],
      },
    },
  },
  /* eslint-enable @typescript-eslint/naming-convention */

  validate(node) {
    const errors = new FieldErrors(node);
    errors.onlyFields(FIELDS);
    checkPlacement(node, errors);
    parse(node, errors);
    return errors.issues;
  },

  expand(node, context): KitExpansion {
    const parsed = parse(node);
    const box = placementBox(node);
    const id = node.id;

    // One frame for every arrangement at every param value the beats visit.
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const variant of context.variants ?? [node]) {
      for (const layout of parse(variant).layouts.values()) {
        for (const entry of layout.values()) {
          for (const [x, y] of entry.points) {
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
            minY = Math.min(minY, y);
            maxY = Math.max(maxY, y);
          }
        }
      }
    }
    const scale = Math.min(
      (box.width * 0.9) / Math.max(1e-6, maxX - minX),
      (box.height * 0.9) / Math.max(1e-6, maxY - minY),
    );
    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2;
    const toStage = ([x, y]: Vec): Vec => [
      box.x + (x - midX) * scale,
      box.y + (y - midY) * scale,
    ];
    const round = (v: number) => Math.round(v * 100) / 100;

    // Every piece, in the order first listed, with its shape: the corners
    // from the first arrangement it appears in, about its middle.
    const order: string[] = [];
    const shapes = new Map<string, {local: Vec[]; entry: PieceEntry}>();
    for (const layout of parsed.layouts.values()) {
      for (const [name, entry] of layout) {
        if (shapes.has(name)) continue;
        order.push(name);
        const stage = entry.points.map(toStage);
        const c = centroid(stage);
        shapes.set(name, {
          local: stage.map(([x, y]) => [x - c[0], y - c[1]] as Vec),
          entry,
        });
      }
    }

    const current = parsed.layouts.get(parsed.layout)!;
    const nodes: SceneNode[] = [];
    const labels: SceneNode[] = [];
    const touches: Touch[] = [];
    const parts = new Map<string, KitPart>();
    const poses = new Map<
      string,
      {position: Vec; rotation: number; points: Vec[]}
    >();

    // Where each piece sits in this arrangement.
    for (const name of order) {
      const entry = current.get(name);
      if (!entry) continue;
      const stage = entry.points.map(toStage);
      const c = centroid(stage);
      const {local} = shapes.get(name)!;
      const turn = rigidTurn(local, stage);
      poses.set(name, {
        position: c,
        rotation: turn ?? 0,
        points:
          turn === null
            ? stage.map(([x, y]) => [x - c[0], y - c[1]] as Vec)
            : local,
      });
    }
    // Pieces left out tuck under a present piece of the same shape - the
    // least used one, so copies of a group peel off their own originals.
    const used = new Map<string, number>();
    const tucked = new Map<string, string>();
    for (const name of order) {
      if (current.has(name)) continue;
      const {local} = shapes.get(name)!;
      let best: {host: string; turn: number} | null = null;
      for (const host of order) {
        if (!current.has(host)) continue;
        const pose = poses.get(host)!;
        const hostStage = pose.points.map(([x, y]) => {
          const r = (pose.rotation * Math.PI) / 180;
          return [
            pose.position[0] + x * Math.cos(r) - y * Math.sin(r),
            pose.position[1] + x * Math.sin(r) + y * Math.cos(r),
          ] as Vec;
        });
        const turn = rigidTurn(local, hostStage);
        if (turn === null) continue;
        if (!best || (used.get(host) ?? 0) < (used.get(best.host) ?? 0)) {
          best = {host, turn};
        }
      }
      if (best) {
        used.set(best.host, (used.get(best.host) ?? 0) + 1);
        tucked.set(name, best.host);
        poses.set(name, {
          position: poses.get(best.host)!.position,
          rotation: best.turn,
          points: local,
        });
      } else {
        // Nothing to tuck under: it waits, invisible, where it first was.
        const first = [...parsed.layouts.values()].find(l => l.has(name))!;
        const stage = first.get(name)!.points.map(toStage);
        poses.set(name, {
          position: centroid(stage),
          rotation: 0,
          points: local,
        });
      }
    }

    const pieceIds: string[] = [];
    const labelIds: string[] = [];
    for (const name of order) {
      const pose = poses.get(name)!;
      const entry = current.get(name) ?? shapes.get(name)!.entry;
      const present = current.has(name);
      const visible = present || tucked.has(name);
      const colors = tint(entry.color ?? parsed.color ?? 'magenta');
      const pid = `${id}_${name}`;
      nodes.push({
        id: pid,
        component: 'Line',
        halo: 0,
        props: {
          points: pose.points.map(([x, y]) => [round(x), round(y)]),
          closed: true,
          position: [round(pose.position[0]), round(pose.position[1])],
          rotation: round(pose.rotation),
          lineWidth: 3,
          lineJoin: 'round',
          // An outline is drawn in its own colour when it has one (a square
          // on a side coloured like its side), else in quiet ink.
          ...(entry.outline
            ? {stroke: entry.color ? colors.stroke : {theme: 'secondaryInk'}}
            : {fill: colors.fill, stroke: colors.stroke}),
          ...(visible ? {} : {opacity: 0}),
        },
      });
      pieceIds.push(pid);
      const partNodes = [pid];
      if (entry.label) {
        const lid = `${id}_${name}L`;
        const xs = pose.points.map(p => p[0]);
        const ys = pose.points.map(p => p[1]);
        const span = Math.min(
          Math.max(...xs) - Math.min(...xs),
          Math.max(...ys) - Math.min(...ys),
        );
        const tex = entry.label;
        const size = Math.round(
          Math.max(
            20,
            Math.min(
              44,
              span * 0.4,
              (span * 0.8) / Math.max(1, texWidthEm(tex)),
            ),
          ),
        );
        labels.push({
          id: lid,
          component: 'Latex',
          props: {
            tex,
            fontSize: size,
            position: [round(pose.position[0]), round(pose.position[1])],
            ...(present ? {} : {opacity: 0}),
          },
        });
        labelIds.push(lid);
        partNodes.push(lid);
      }
      parts.set(name, {nodes: partNodes});
    }
    nodes.push(...labels);
    parts.set('', {
      nodes: [
        ...pieceIds.filter((_, i) => current.has(order[i])),
        ...labelIds.filter(l => current.has(l.slice(id.length + 1, -1))),
      ],
    });

    // Pieces share edges and pass over one another as they move, and a
    // label rides on its piece across the others.
    const all = [...pieceIds, ...labelIds];
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        touches.push({
          a: all[i],
          b: all[j],
          reason:
            'pieces of one arrangement share edges and pass over each other',
        });
      }
    }
    return {nodes, touches, parts};
  },
};

/** Exposed for tests: the turn between two outlines, or null. */
export const rigidTurnForTest = rigidTurn;
