import type {SceneNode, Touch, Value} from '../document/model.js';
import {
  FieldErrors,
  PLACEMENT_FIELDS,
  asRecord,
  checkPlacement,
  isNumberPair,
  placementBox,
  texWidthEm,
  tokens,
} from './fields.js';
import type {KitExpansion, KitNode, KitPart, KitSpec} from './types.js';

const FIELDS = [
  'points',
  'segments',
  'dashed',
  'polygons',
  'angles',
  'rightAngles',
  'labels',
  'sideLabels',
  ...PLACEMENT_FIELDS,
];
const NAME = /^[A-Za-z][A-Za-z0-9]{0,3}$/;
const DOT_SIZE = 12;
const LETTER_SIZE = 34;
const ARC_RADIUS = 34;
const ANGLE_LABEL_SIZE = 26;
const SIDE_LABEL_SIZE = 32;
/**
 * Perpendicular room a letter or angle label needs from a line: its box's
 * half-diagonal (a letter is about 0.6 x 1.2 em), both audit halos, and a
 * small margin.
 */
function clearanceFor(tex: string, size: number): number {
  const halfWidth = (Math.max(0.6, texWidthEm(tex)) * size) / 2;
  const halfHeight = (1.2 * size) / 2;
  return Math.hypot(halfWidth, halfHeight) + 8 + 4 + 6;
}
/** Room around the figure for letters and angle labels. */
const PADDING = 100;
const HIGHLIGHT_COLORS = ['blue', 'green', 'magenta', 'coral', 'cyan'];

type Vec = [number, number];

/**
 * Split a point path: "KLP" (single-letter names) or "K1-L-P" (any names).
 */
function pathOf(token: string): string[] {
  return token.includes('-') ? token.split('-').filter(Boolean) : [...token];
}

interface Parsed {
  points: Map<string, Vec>;
  segments: {a: string; b: string; dashed: boolean}[];
  polygons: string[][];
  angles: {path: string[]; tex: string}[];
  rightAngles: string[][];
  labels: Map<string, string>;
  sideLabels: {a: string; b: string; tex: string}[];
}

function parse(node: KitNode, errors?: FieldErrors): Parsed {
  const points = new Map<string, Vec>();
  const raw = asRecord(node.points);
  if (!raw) {
    errors?.error(
      'points',
      'points is an object of named coordinates',
      'e.g. {"A": [0, 0], "B": [4, 0], "C": [0, 3]}',
    );
  } else {
    for (const [name, value] of Object.entries(raw)) {
      if (!NAME.test(name)) {
        errors?.error(
          'points',
          `point name "${name}" must be 1-4 letters/digits starting with a letter`,
        );
      } else if (!isNumberPair(value)) {
        errors?.error('points', `point "${name}" must be [x, y]`);
      } else points.set(name, value);
    }
    if (points.size < 2 && raw) {
      errors?.error('points', 'a figure needs at least two points');
    }
  }
  const known = (names: string[], field: string, token: string) => {
    for (const name of names) {
      if (!points.has(name)) {
        errors?.error(
          field,
          `"${token}" names unknown point "${name}"`,
          `points are ${[...points.keys()].join(', ')}`,
        );
        return false;
      }
    }
    return true;
  };

  const segments: Parsed['segments'] = [];
  const seen = new Set<string>();
  for (const [field, dashed] of [
    ['segments', false],
    ['dashed', true],
  ] as const) {
    for (const token of tokens(node[field])) {
      const path = pathOf(token);
      if (path.length !== 2) {
        errors?.error(
          field,
          `"${token}" is not a segment between two points`,
          'write "AB", or "A1-B2" for longer names',
        );
        continue;
      }
      if (!known(path, field, token)) continue;
      const key = [...path].sort().join('-');
      if (seen.has(key)) continue;
      seen.add(key);
      segments.push({a: path[0], b: path[1], dashed});
    }
  }

  const polygons: string[][] = [];
  for (const token of tokens(node.polygons)) {
    const path = pathOf(token);
    if (path.length < 3) {
      errors?.error('polygons', `"${token}" needs at least three points`);
    } else if (known(path, 'polygons', token)) polygons.push(path);
  }

  const angles: Parsed['angles'] = [];
  const rawAngles = node.angles === undefined ? {} : asRecord(node.angles);
  if (!rawAngles) {
    errors?.error(
      'angles',
      'angles is an object {"ABC": "\\\\alpha"} - the angle at the middle point',
    );
  } else {
    for (const [token, tex] of Object.entries(rawAngles)) {
      const path = pathOf(token);
      if (path.length !== 3) {
        errors?.error(
          'angles',
          `"${token}" must name three points, the vertex in the middle`,
        );
      } else if (typeof tex !== 'string') {
        errors?.error(
          'angles',
          `angle "${token}" label must be a LaTeX string ("" for no label)`,
        );
      } else if (known(path, 'angles', token)) angles.push({path, tex});
    }
  }

  const rightAngles: string[][] = [];
  for (const token of tokens(node.rightAngles)) {
    const path = pathOf(token);
    if (path.length !== 3) {
      errors?.error(
        'rightAngles',
        `"${token}" must name three points, the vertex in the middle`,
      );
    } else if (known(path, 'rightAngles', token)) rightAngles.push(path);
  }

  const labels = new Map<string, string>(
    [...points.keys()].map(name => [name, name]),
  );
  if (node.labels !== undefined) {
    if (node.labels === false) labels.clear();
    else {
      const custom = asRecord(node.labels);
      if (!custom) {
        errors?.error(
          'labels',
          'labels is false, or an object {"A": "A\'"} of LaTeX overrides',
        );
      }
      for (const [name, tex] of Object.entries(custom ?? {})) {
        if (!points.has(name)) {
          errors?.error('labels', `label for unknown point "${name}"`);
        } else if (tex === null || tex === '') labels.delete(name);
        else if (typeof tex === 'string') labels.set(name, tex);
      }
    }
  }
  const sideLabels: Parsed['sideLabels'] = [];
  if (node.sideLabels !== undefined) {
    const custom = asRecord(node.sideLabels);
    if (!custom) {
      errors?.error(
        'sideLabels',
        'sideLabels is an object {"AB": "4"} of LaTeX labels for sides',
      );
    }
    for (const [token, tex] of Object.entries(custom ?? {})) {
      const path = pathOf(token);
      if (path.length !== 2) {
        errors?.error(
          'sideLabels',
          `"${token}" must name the two ends of a side`,
        );
      } else if (typeof tex !== 'string' || !tex) {
        errors?.error('sideLabels', `side "${token}" needs a LaTeX label`);
      } else if (known(path, 'sideLabels', token)) {
        sideLabels.push({a: path[0], b: path[1], tex});
      }
    }
  }
  return {points, segments, polygons, angles, rightAngles, labels, sideLabels};
}

function sub(a: Vec, b: Vec): Vec {
  return [a[0] - b[0], a[1] - b[1]];
}
function len(v: Vec): number {
  return Math.hypot(v[0], v[1]);
}
function unit(v: Vec): Vec {
  const l = len(v) || 1;
  return [v[0] / l, v[1] / l];
}
function deg(v: Vec): number {
  return (Math.atan2(v[1], v[0]) * 180) / Math.PI;
}
function round(v: Vec): Vec {
  return [Math.round(v[0]), Math.round(v[1])];
}

/** Interior angle at `v` between rays to `a` and `b`, as a clockwise arc. */
function arcAngles(
  v: Vec,
  a: Vec,
  b: Vec,
): {start: number; end: number; bisector: number; half: number} {
  let start = deg(sub(a, v));
  let end = deg(sub(b, v));
  if ((end - start + 360) % 360 > 180) [start, end] = [end, start];
  if (end < start) end += 360;
  const bisector = (start + end) / 2;
  return {start, end, bisector, half: ((end - start) / 2) * (Math.PI / 180)};
}

function distanceToSegment(p: Vec, a: Vec, b: Vec): number {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const length2 = abx * abx + aby * aby || 1;
  const t = Math.max(
    0,
    Math.min(1, ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / length2),
  );
  return Math.hypot(p[0] - (a[0] + t * abx), p[1] - (a[1] + t * aby));
}

function segmentsCross(p1: Vec, p2: Vec, p3: Vec, p4: Vec): boolean {
  const d = (a: Vec, b: Vec, c: Vec) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const d1 = d(p3, p4, p1);
  const d2 = d(p3, p4, p2);
  const d3 = d(p1, p2, p3);
  const d4 = d(p1, p2, p4);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

export const geometryFigure: KitSpec = {
  name: 'geometry.figure',
  summary:
    'A labelled geometric figure: named points, segments, dashed segments, polygons, angle arcs and right-angle marks. Letters and angle labels are placed for you, clear of the lines.',
  fields: {
    points: {
      type: '{"A": [x, y], ...}',
      required: true,
      doc: 'Named points in any units, y down; the figure is scaled to fit its region.',
    },
    segments: {
      type: '"AB BC CA" or ["AB", ...]',
      doc: 'Solid segments. Use "A1-B2" for names longer than one letter.',
    },
    dashed: {
      type: 'same as segments',
      doc: 'Dashed segments (constructions, hidden edges).',
    },
    polygons: {
      type: '["ABC", ...]',
      doc: 'Closed outlines through the points.',
    },
    angles: {
      type: '{"ABC": "\\\\alpha", ...}',
      doc: 'Angle arcs at the middle point, with a LaTeX label ("" for an unlabelled arc).',
    },
    rightAngles: {
      type: '["ABC", ...]',
      doc: 'Right-angle squares at the middle point.',
    },
    labels: {
      type: 'false | {"A": "A\'"}',
      doc: 'Point letters default to the point names; override or hide them.',
    },
    sideLabels: {
      type: '{"AB": "4", "BC": "c"}',
      doc: 'LaTeX labels for sides (lengths, names), placed at the midpoint on the outside of the figure. Use this rather than anchoring a label to a segment.',
    },
    region: {
      type: 'full | left | right | center | top | bottom',
      doc: 'Where the figure goes (default full).',
    },
    box: {
      type: '[centreX, centreY, width, height]',
      doc: 'An explicit stage box instead of a region.',
    },
  },
  parts:
    '"<id>.A" a point, "<id>.AB" a segment, "<id>.ABC" the triangle (or polygon) through those points - highlight draws it, "<id>.angle.ABC" a declared angle or right-angle mark, "<id>.side.AB" a side label',
  // Point and angle names are capital letters by convention.
  /* eslint-disable @typescript-eslint/naming-convention */
  example: {
    id: 'fig',
    kit: 'geometry.figure',
    region: 'left',
    points: {A: [0, 3], B: [4, 3], C: [0, 0]},
    segments: 'AB BC CA',
    rightAngles: ['BAC'],
    angles: {ABC: '\\theta'},
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
    const {
      points,
      segments,
      polygons,
      angles,
      rightAngles,
      labels,
      sideLabels,
    } = parse(node);
    const box = placementBox(node);
    const id = node.id;

    // Fit the authored coordinates into the box, preserving aspect - every
    // position a beat will move the points to included, so the figure
    // holds its scale while a point moves.
    const every = (context.variants ?? [node]).flatMap(v =>
      v === node ? [...points.values()] : [...parse(v).points.values()],
    );
    const xs = every.map(p => p[0]);
    const ys = every.map(p => p[1]);
    const spanX = Math.max(...xs) - Math.min(...xs) || 1;
    const spanY = Math.max(...ys) - Math.min(...ys) || 1;
    const scale = Math.min(
      (box.width - 2 * PADDING) / spanX,
      (box.height - 2 * PADDING) / spanY,
    );
    const cx = (Math.max(...xs) + Math.min(...xs)) / 2;
    const cy = (Math.max(...ys) + Math.min(...ys)) / 2;
    const at = new Map<string, Vec>(
      [...points].map(([name, p]) => [
        name,
        round([box.x + (p[0] - cx) * scale, box.y + (p[1] - cy) * scale]),
      ]),
    );

    const nodes: SceneNode[] = [];
    const touches: Touch[] = [];
    const parts = new Map<string, KitPart>();
    const pointId = (n: string) => `${id}_pt${n}`;
    const letterId = (n: string) => `${id}_lb${n}`;
    const segId = (a: string, b: string) => `${id}_sg${a}${b}`;

    // Directions from each point along its edges, for label placement.
    const rays = new Map<string, number[]>(
      [...points.keys()].map(n => [n, []]),
    );
    const edges: [string, string][] = [
      ...segments.map(s => [s.a, s.b] as [string, string]),
      ...polygons.flatMap(poly =>
        poly.map(
          (p, i) => [p, poly[(i + 1) % poly.length]] as [string, string],
        ),
      ),
    ];
    for (const [a, b] of edges) {
      rays.get(a)!.push(deg(sub(at.get(b)!, at.get(a)!)));
      rays.get(b)!.push(deg(sub(at.get(a)!, at.get(b)!)));
    }
    // Points lying inside a segment (a line drawn through a vertex, a foot
    // on a base): the segment passes through them, in both directions.
    const passesThrough = new Map<string, string[]>();
    for (const s of segments) {
      const pa = at.get(s.a)!;
      const pb = at.get(s.b)!;
      const ab = sub(pb, pa);
      const length2 = ab[0] * ab[0] + ab[1] * ab[1] || 1;
      for (const [name, p] of at) {
        if (name === s.a || name === s.b) continue;
        const ap = sub(p, pa);
        const t = (ap[0] * ab[0] + ap[1] * ab[1]) / length2;
        if (t <= 0.01 || t >= 0.99) continue;
        const off =
          Math.abs(ap[0] * ab[1] - ap[1] * ab[0]) / Math.sqrt(length2);
        if (off > 2.5) continue;
        passesThrough.set(name, [
          ...(passesThrough.get(name) ?? []),
          segId(s.a, s.b),
        ]);
        rays.get(name)!.push(deg(sub(pa, p)), deg(sub(pb, p)));
      }
    }
    // Angle sectors at each vertex are reserved for angle labels.
    const sectors = new Map<string, {start: number; end: number}[]>();
    for (const {path} of [...angles, ...rightAngles.map(path => ({path}))]) {
      const {start, end} = arcAngles(
        at.get(path[1])!,
        at.get(path[0])!,
        at.get(path[2])!,
      );
      sectors.set(path[1], [...(sectors.get(path[1]) ?? []), {start, end}]);
    }
    const inSector = (vertex: string, angle: number) =>
      (sectors.get(vertex) ?? []).some(s => {
        const a = (((angle - s.start) % 360) + 360) % 360;
        return a <= s.end - s.start;
      });

    // Segments first (drawn under the points).
    for (const s of segments) {
      nodes.push({
        id: segId(s.a, s.b),
        component: 'Line',
        props: {
          points: [{ref: pointId(s.a)}, {ref: pointId(s.b)}],
          stroke: {theme: 'ink'},
          lineWidth: 3,
          ...(s.dashed ? {lineDash: [10, 8]} : {}),
        },
      });
      const part: KitPart = {
        nodes: [segId(s.a, s.b)],
        traceable: [segId(s.a, s.b)],
      };
      parts.set(`${s.a}${s.b}`, part);
      parts.set(`${s.b}${s.a}`, part);
      parts.set(`${s.a}-${s.b}`, part);
    }
    polygons.forEach((poly, index) => {
      const polyId = `${id}_pg${index}`;
      nodes.push({
        id: polyId,
        component: 'Line',
        props: {
          points: poly.map(p => ({ref: pointId(p)})),
          closed: true,
          stroke: {theme: 'ink'},
          lineWidth: 3,
        },
      });
      parts.set(poly.join(poly.some(p => p.length > 1) ? '-' : ''), {
        nodes: [polyId],
        traceable: [polyId],
      });
    });
    // Segments that cross in their interiors meet on purpose.
    const lineParts = [
      ...segments.map(s => ({id: segId(s.a, s.b), ends: [s.a, s.b]})),
    ];
    for (let i = 0; i < lineParts.length; i++) {
      for (let j = i + 1; j < lineParts.length; j++) {
        const [a, b] = lineParts[i].ends;
        const [c, d] = lineParts[j].ends;
        if (segmentsCross(at.get(a)!, at.get(b)!, at.get(c)!, at.get(d)!)) {
          touches.push({
            a: lineParts[i].id,
            b: lineParts[j].id,
            reason: 'segments of the figure cross',
          });
        }
      }
    }

    // A segment through a point meets that point and every line ending there.
    for (const [name, through] of passesThrough) {
      const ending = segments
        .filter(s => s.a === name || s.b === name)
        .map(s => segId(s.a, s.b));
      through.forEach((line, i) => {
        for (const other of [
          pointId(name),
          ...ending,
          ...through.slice(i + 1),
        ]) {
          touches.push({
            a: line,
            b: other,
            reason: `the lines meet at ${name}`,
          });
        }
      });
    }

    const allLines = (): [Vec, Vec][] => [
      ...segments.map(s => [at.get(s.a)!, at.get(s.b)!] as [Vec, Vec]),
      ...polygons.flatMap(poly =>
        poly.map(
          (p, k) =>
            [at.get(p)!, at.get(poly[(k + 1) % poly.length])!] as [Vec, Vec],
        ),
      ),
    ];
    // Points and their letters. A letter goes in the widest gap between
    // its point's own lines - unless another line passes close by or a
    // letter already sits there (points strung along one axis, rays
    // crossing near a point), when the spot around the point with the most
    // room is used instead.
    const figureLines = allLines();
    const letterBoxes: {x: number; y: number; w: number; h: number}[] = [];
    for (const [name, p] of at) {
      nodes.push({
        id: pointId(name),
        component: 'Circle',
        fixed: true,
        props: {size: DOT_SIZE, fill: {theme: 'ink'}, position: p},
      });
      const partNodes = [pointId(name)];
      const tex = labels.get(name);
      if (tex !== undefined) {
        // The widest gap between this point's rays that is not an angle sector.
        const dirs = [...rays.get(name)!].sort((a, b) => a - b);
        let direction = -135;
        let gapDegrees = 360;
        if (dirs.length === 1) direction = dirs[0] + 180;
        else if (dirs.length > 1) {
          let best = -1;
          dirs.forEach((a, i) => {
            const b = i + 1 < dirs.length ? dirs[i + 1] : dirs[0] + 360;
            const mid = (a + b) / 2;
            const gap = (b - a) * (inSector(name, mid) ? 0.25 : 1);
            if (gap > best) {
              best = gap;
              direction = mid;
              gapDegrees = b - a;
            }
          });
        }
        const r = (direction * Math.PI) / 180;
        // Far enough into the gap that the letter clears both edges beside it.
        const halfGap = Math.min(Math.PI / 2, (gapDegrees * Math.PI) / 360);
        // Outside the vertex's angle marks too: the audit sees each arc as its whole circle.
        const minimum = sectors.has(name)
          ? ARC_RADIUS + 2 + clearanceFor(tex, LETTER_SIZE)
          : 30;
        const distance = Math.min(
          140,
          Math.max(
            minimum,
            clearanceFor(tex, LETTER_SIZE) / Math.sin(Math.max(halfGap, 0.05)),
          ),
        );
        const clearance = clearanceFor(tex, LETTER_SIZE) - 6;
        const w = Math.max(0.6, texWidthEm(tex)) * LETTER_SIZE + 24;
        const h = LETTER_SIZE * 1.2 + 24;
        const room = (q: Vec) =>
          Math.min(
            Infinity,
            ...figureLines.map(([a, b]) => distanceToSegment(q, a, b)),
          );
        const onLetter = (q: Vec) =>
          letterBoxes.some(
            o =>
              Math.abs(o.x - q[0]) * 2 < o.w + w &&
              Math.abs(o.y - q[1]) * 2 < o.h + h,
          );
        let spot: Vec = [
          p[0] + Math.cos(r) * distance,
          p[1] + Math.sin(r) * distance,
        ];
        if (room(spot) < clearance || onLetter(spot)) {
          let bestScore = -Infinity;
          for (const d of [distance, 36, 52, 70, 90, 115, 140]) {
            for (let k = 0; k < 16; k++) {
              const angle = (k / 16) * 2 * Math.PI;
              const q: Vec = [
                p[0] + Math.cos(angle) * d,
                p[1] + Math.sin(angle) * d,
              ];
              const deg = (angle * 180) / Math.PI;
              const score =
                Math.min(room(q), clearance * 2) -
                (onLetter(q) ? 1000 : 0) -
                (inSector(name, deg) ? 40 : 0) -
                d * 0.1;
              if (score > bestScore) {
                bestScore = score;
                spot = q;
              }
            }
          }
        }
        letterBoxes.push({x: spot[0], y: spot[1], w, h});
        nodes.push({
          id: letterId(name),
          component: 'Latex',
          props: {
            tex,
            fontSize: LETTER_SIZE,
            position: round(spot),
          },
        });
        touches.push({
          a: letterId(name),
          b: pointId(name),
          reason: `the letter names point ${name}`,
        });
        partNodes.push(letterId(name));
      }
      parts.set(name, {nodes: partNodes});
    }

    // Side labels: at the midpoint, pushed away from the figure's centre.
    const centre: Vec = [
      [...at.values()].reduce((sum, p) => sum + p[0], 0) / at.size,
      [...at.values()].reduce((sum, p) => sum + p[1], 0) / at.size,
    ];
    // Every label already placed (letters, angle labels) as a box, so a
    // side label is put where it overlaps none of them.
    const labelBoxes = nodes
      .filter(n => n.component === 'Latex')
      .map(n => {
        const size = Number(n.props!.fontSize ?? 30);
        const [x, y] = n.props!.position as number[];
        return {
          x,
          y,
          w: texWidthEm(String(n.props!.tex)) * size + 24,
          h: size * 1.2 + 24,
        };
      });
    const lines = allLines();
    for (const {a, b, tex} of sideLabels) {
      const pa = at.get(a)!;
      const pb = at.get(b)!;
      const direction = unit(sub(pb, pa));
      let normal: Vec = [-direction[1], direction[0]];
      const mid: Vec = [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2];
      const outward = sub(mid, centre);
      if (normal[0] * outward[0] + normal[1] * outward[1] < 0) {
        normal = [-normal[0], -normal[1]];
      }
      // Clear of its side by its own extent along the normal and both halos;
      // along the side and further out when something is in the way.
      const width = texWidthEm(tex) * SIDE_LABEL_SIZE;
      const height = SIDE_LABEL_SIZE * 1.2;
      const base =
        Math.abs(normal[0]) * (width / 2) +
        Math.abs(normal[1]) * (height / 2) +
        8 +
        4 +
        8;
      let position: Vec = [
        mid[0] + normal[0] * base,
        mid[1] + normal[1] * base,
      ];
      let fewest = Infinity;
      search: for (const extra of [0, 16, 32]) {
        for (const t of [0.5, 0.38, 0.62, 0.28, 0.72]) {
          const along: Vec = [
            pa[0] + (pb[0] - pa[0]) * t,
            pa[1] + (pb[1] - pa[1]) * t,
          ];
          const spot: Vec = [
            along[0] + normal[0] * (base + extra),
            along[1] + normal[1] * (base + extra),
          ];
          const box = {x: spot[0], y: spot[1], w: width + 24, h: height + 24};
          const overlaps =
            labelBoxes.filter(
              o =>
                Math.abs(o.x - box.x) * 2 < o.w + box.w &&
                Math.abs(o.y - box.y) * 2 < o.h + box.h,
            ).length +
            lines.filter(
              ([p0, p1]) =>
                !(p0 === pa && p1 === pb) &&
                !(p0 === pb && p1 === pa) &&
                distanceToSegment(spot, p0, p1) <
                  Math.hypot(width, height) / 2 + 12,
            ).length;
          if (overlaps < fewest) {
            fewest = overlaps;
            position = spot;
          }
          if (overlaps === 0) break search;
        }
      }
      labelBoxes.push({
        x: position[0],
        y: position[1],
        w: width + 24,
        h: height + 24,
      });
      const labelId = `${id}_sl${a}${b}`;
      nodes.push({
        id: labelId,
        component: 'Latex',
        props: {
          tex,
          fontSize: SIDE_LABEL_SIZE,
          position: round(position),
        },
      });
      parts.set(`side.${a}${b}`, {nodes: [labelId]});
      parts.set(`side.${b}${a}`, {nodes: [labelId]});
    }

    // Angle arcs and labels.
    // Every line through a vertex: its segments and the polygons with it as a corner.
    const segmentsAt = (v: string) => [
      ...segments.filter(s => s.a === v || s.b === v).map(s => segId(s.a, s.b)),
      ...(passesThrough.get(v) ?? []),
      ...polygons.flatMap((poly, index) =>
        poly.includes(v) ? [`${id}_pg${index}`] : [],
      ),
    ];
    const arcsAt = new Map<string, string[]>();
    const anglesLabelsAt = new Map<string, string[]>();
    for (const {path, tex} of angles) {
      const [a, v, b] = path;
      const vertex = at.get(v)!;
      const arc = arcAngles(vertex, at.get(a)!, at.get(b)!);
      const key = path.join(path.some(p => p.length > 1) ? '-' : '');
      const arcId = `${id}_ar${path.join('')}`;
      nodes.push({
        id: arcId,
        component: 'Circle',
        fixed: true,
        halo: 2,
        props: {
          size: ARC_RADIUS * 2,
          startAngle: Math.round(arc.start),
          endAngle: Math.round(arc.end),
          stroke: {theme: 'coral'},
          lineWidth: 2.5,
          position: vertex,
        },
      });
      // The audit judges an arc by its whole circle's box, so it meets every
      // line at its vertex; those are the lines it is drawn among.
      for (const other of [pointId(v), ...segmentsAt(v)]) {
        touches.push({
          a: arcId,
          b: other,
          reason: `the angle mark sits where the lines meet at ${v}`,
        });
      }
      arcsAt.set(v, [...(arcsAt.get(v) ?? []), arcId]);
      const partNodes = [arcId];
      if (tex) {
        // Far enough along the bisector that the label clears both rays -
        // or, for an angle too narrow to hold it, just outside one of its
        // arms, on the side with the most room from every line.
        const clearance = clearanceFor(tex, ANGLE_LABEL_SIZE);
        const inside = Math.max(
          ARC_RADIUS + clearance,
          clearance / Math.sin(Math.max(arc.half, 0.05)),
        );
        const lines = allLines();
        const labelWidth = texWidthEm(tex) * ANGLE_LABEL_SIZE;
        const onLabel = (p: Vec) =>
          labelBoxes.some(
            o =>
              Math.abs(o.x - p[0]) * 2 < o.w + labelWidth + 24 &&
              Math.abs(o.y - p[1]) * 2 < o.h + ANGLE_LABEL_SIZE * 1.2 + 24,
          );
        const room = (p: Vec) =>
          Math.min(
            Infinity,
            ...lines.map(([p0, p1]) => distanceToSegment(p, p0, p1)),
          );
        const toward = (angle: number, d: number): Vec => [
          vertex[0] + Math.cos((angle * Math.PI) / 180) * d,
          vertex[1] + Math.sin((angle * Math.PI) / 180) * d,
        ];
        let position = toward(arc.bisector, Math.min(200, inside));
        if (inside > 200 || room(position) < clearance || onLabel(position)) {
          const d = ARC_RADIUS + clearance * 1.3;
          const spread =
            (Math.asin(Math.min(1, clearance / d)) * 180) / Math.PI;
          const candidates = [
            toward(arc.start - spread, d),
            toward(arc.end + spread, d),
            toward(arc.start - spread, d * 1.5),
            toward(arc.end + spread, d * 1.5),
          ];
          // Clear of other labels first, then the most room from lines.
          const score = (p: Vec) => (onLabel(p) ? -1000 : 0) + room(p);
          const best = candidates.reduce((x, y) =>
            score(y) > score(x) ? y : x,
          );
          if (score(best) > score(position)) position = best;
        }
        const labelId = `${id}_an${path.join('')}`;
        nodes.push({
          id: labelId,
          component: 'Latex',
          props: {
            tex,
            fontSize: ANGLE_LABEL_SIZE,
            fill: {theme: 'coral'},
            position: round(position),
          },
        });
        touches.push({
          a: labelId,
          b: arcId,
          reason: 'the label names its angle',
        });
        anglesLabelsAt.set(v, [...(anglesLabelsAt.get(v) ?? []), labelId]);
        labelBoxes.push({
          x: position[0],
          y: position[1],
          w: labelWidth + 24,
          h: ANGLE_LABEL_SIZE * 1.2 + 24,
        });
        partNodes.push(labelId);
      }
      parts.set(`angle.${key}`, {nodes: partNodes});
    }

    // Several angles at one vertex: their arcs' boxes overlap each other and
    // the neighbouring labels, though the drawn arcs do not.
    for (const [v, arcs] of arcsAt) {
      const labelsHere = anglesLabelsAt.get(v) ?? [];
      arcs.forEach((arcId, i) => {
        for (const other of [...arcs.slice(i + 1), ...labelsHere]) {
          touches.push({
            a: arcId,
            b: other,
            reason: `angle marks share the corner at ${v}`,
          });
        }
      });
    }

    // Right-angle squares.
    for (const path of rightAngles) {
      const [a, v, b] = path;
      const vertex = at.get(v)!;
      const u1 = unit(sub(at.get(a)!, vertex));
      const u2 = unit(sub(at.get(b)!, vertex));
      const s = 18;
      const markId = `${id}_ra${path.join('')}`;
      nodes.push({
        id: markId,
        component: 'Line',
        props: {
          points: [
            round([vertex[0] + u1[0] * s, vertex[1] + u1[1] * s]),
            round([
              vertex[0] + (u1[0] + u2[0]) * s,
              vertex[1] + (u1[1] + u2[1]) * s,
            ]),
            round([vertex[0] + u2[0] * s, vertex[1] + u2[1] * s]),
          ],
          stroke: {theme: 'ink'},
          lineWidth: 2,
        },
      });
      for (const other of [pointId(v), ...segmentsAt(v)]) {
        touches.push({
          a: markId,
          b: other,
          reason: `the right-angle mark sits in the corner at ${v}`,
        });
      }
      parts.set(`angle.${path.join(path.some(p => p.length > 1) ? '-' : '')}`, {
        nodes: [markId],
      });
    }

    // Overlays for the parts beats will highlight.
    let color = 0;
    for (const partName of context.highlighted) {
      const existing = parts.get(partName);
      const path = pathOf(partName);
      const overlayId = `${id}_hl${path.join('')}`;
      if (
        path.length >= 2 &&
        path.every(p => at.has(p)) &&
        (!existing || existing.traceable)
      ) {
        nodes.push({
          id: overlayId,
          component: 'Line',
          props: {
            points: path.map(p => ({ref: pointId(p)})),
            ...(path.length >= 3 ? {closed: true} : {}),
            stroke: {
              theme: HIGHLIGHT_COLORS[color++ % HIGHLIGHT_COLORS.length],
            },
            lineWidth: 7,
            opacity: 0,
          },
        });
        touches.push({
          a: overlayId,
          b: '*',
          reason: 'the highlight traces the figure',
        });
        parts.set(partName, {
          nodes: existing?.nodes ?? [],
          overlay: overlayId,
          traceable: existing?.traceable,
        });
      } else if (path.length === 1 && at.has(partName)) {
        nodes.push({
          id: overlayId,
          component: 'Circle',
          fixed: true,
          props: {
            size: 34,
            stroke: {
              theme: HIGHLIGHT_COLORS[color++ % HIGHLIGHT_COLORS.length],
            },
            lineWidth: 4,
            position: at.get(partName)!,
            opacity: 0,
          },
        });
        touches.push({
          a: overlayId,
          b: '*',
          reason: 'the highlight rings the point',
        });
        parts.set(partName, {nodes: existing?.nodes ?? [], overlay: overlayId});
      }
    }

    return {nodes, touches, parts};
  },
};

export type {Value};
