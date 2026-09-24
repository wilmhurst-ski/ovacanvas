import type {SceneNode, Step, Touch, Value} from '../document/model.js';
import {isObject} from '../document/values.js';
import {
  ExpressionError,
  parseExpression,
  type Expression,
} from './expression.js';
import {
  FieldErrors,
  PLACEMENT_FIELDS,
  checkPlacement,
  placementBox,
} from './fields.js';
import type {Box, KitExpansion, KitNode, KitPart, KitSpec} from './types.js';

type V3 = [number, number, number];

const COLORMAPS = ['viridis', 'plasma', 'coolwarm', 'terrain'];
const VIEWS: Readonly<Record<string, readonly [number, number]>> = {
  iso: [38, 32],
  top: [0, 82],
  front: [0, 8],
  side: [90, 8],
};
const HEX: Readonly<Record<string, string>> = {
  blue: '#2F66D0',
  cyan: '#2EAEDC',
  coral: '#F05A3C',
  yellow: '#F3C742',
  green: '#4E9B62',
  magenta: '#B968A7',
  ink: '#151922',
};
const PART_COLORS = ['coral', 'ink', 'magenta', 'green', 'cyan', 'yellow'];
const HIGHLIGHT = '#F3C742';
/** Half-height of the plot box in world units; X and Z span -1..1. */
const HY = 0.62;
const GRID = 40;
const CURVE_SAMPLES = 120;
const FOV = 0.62;

function hex(color: Value | undefined, fallback: string): string {
  if (typeof color !== 'string') return HEX[fallback] ?? fallback;
  return HEX[color] ?? color;
}

function num(value: Value | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function range(
  value: Value | undefined,
  fallback: [number, number],
): [number, number] {
  return Array.isArray(value) &&
    value.length === 2 &&
    value.every(v => typeof v === 'number' && Number.isFinite(v)) &&
    (value[0] as number) < (value[1] as number)
    ? [value[0] as number, value[1] as number]
    : fallback;
}

function round(value: number, places = 4): number {
  const f = 10 ** places;
  return Math.round(value * f) / f;
}

/** A readable tick value. */
function tickText(value: number): string {
  const r = Math.abs(value) < 1e-9 ? 0 : value;
  return String(Math.abs(r) >= 100 ? Math.round(r) : Number(r.toPrecision(2)));
}

function niceStep(span: number): number {
  const raw = span / 4;
  const power = 10 ** Math.floor(Math.log10(raw));
  const unit = raw / power;
  return (unit < 1.5 ? 1 : unit < 3.5 ? 2 : unit < 7.5 ? 5 : 10) * power;
}

// ---- the camera ---------------------------------------------------------------

interface Camera {
  readonly eye: V3;
  readonly spec: Record<string, Value>;
}

function eyeAt(azimuth: number, elevation: number, distance: number): V3 {
  const az = (azimuth * Math.PI) / 180;
  const el = (elevation * Math.PI) / 180;
  return [
    distance * Math.sin(az) * Math.cos(el),
    distance * Math.sin(el),
    distance * Math.cos(az) * Math.cos(el),
  ];
}

/** Normalised device coordinates of a point, for fitting the box in view. */
function project(eye: V3, point: V3, aspect: number): [number, number] {
  const len = (v: V3) => Math.hypot(v[0], v[1], v[2]);
  const norm = (v: V3): V3 => {
    const l = len(v) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  };
  const cross = (a: V3, b: V3): V3 => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const forward = norm([-eye[0], -eye[1], -eye[2]]);
  let right = cross(forward, [0, 1, 0]);
  if (len(right) < 1e-6) right = [1, 0, 0];
  right = norm(right);
  const up = cross(right, forward);
  const v: V3 = [point[0] - eye[0], point[1] - eye[1], point[2] - eye[2]];
  const depth = Math.max(1e-6, dot(v, forward));
  const t = Math.tan(FOV / 2);
  return [dot(v, right) / (depth * t * aspect), dot(v, up) / (depth * t)];
}

const CORNERS: V3[] = [-1, 1].flatMap(x =>
  [-HY, HY].flatMap(y => [-1, 1].map(z => [x, y, z] as V3)),
);

/** The closest camera at this angle that still frames the whole box, with room for labels. */
function fitCamera(azimuth: number, elevation: number, aspect: number): number {
  let lo = 1.5;
  let hi = 30;
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2;
    const eye = eyeAt(azimuth, elevation, mid);
    const fits = CORNERS.every(c => {
      const [x, y] = project(eye, c, aspect);
      return Math.abs(x) <= 0.8 && Math.abs(y) <= 0.8;
    });
    if (fits) hi = mid;
    else lo = mid;
  }
  return hi;
}

function camera(azimuth: number, elevation: number, distance: number): Camera {
  const eye = eyeAt(azimuth, elevation, distance).map(v => round(v)) as V3;
  return {
    eye,
    spec: {
      kind: 'perspective',
      eye,
      target: [0, 0, 0],
      up: [0, 1, 0],
      verticalFovRadians: FOV,
      near: 0.05,
      far: 100,
    },
  };
}

// ---- parsing ------------------------------------------------------------------

interface Parsed {
  readonly surface: {expr: Expression; colormap: string; color?: string} | null;
  readonly x: [number, number];
  readonly y: [number, number];
  readonly curves: {
    name: string;
    x: Expression;
    y: Expression;
    z: Expression | null;
    t: [number, number];
    color?: string;
  }[];
  readonly points: {name: string; at: number[]; color?: string}[];
  readonly vectors: {
    name: string;
    from?: number[];
    to?: number[];
    at?: number[];
    direction?: Value;
    color?: string;
  }[];
}

function parseFields(node: KitNode, errors: FieldErrors | null): Parsed {
  const parse = (
    source: Value | undefined,
    variables: string[],
    field: string,
  ): Expression | null => {
    if (typeof source !== 'string' || !source.trim()) {
      errors?.error(
        field,
        `${field} needs an expression in ${variables.join(', ')}`,
      );
      return null;
    }
    try {
      return parseExpression(source, variables);
    } catch (error) {
      errors?.error(
        field,
        error instanceof ExpressionError ? error.message : String(error),
      );
      return null;
    }
  };
  let surface: Parsed['surface'] = null;
  if (node.surface !== undefined) {
    const raw = node.surface;
    const source =
      typeof raw === 'string' ? raw : isObject(raw) ? raw.z : undefined;
    const expr = parse(source, ['x', 'y'], 'surface');
    if (expr) {
      surface = {
        expr,
        colormap: typeof node.colormap === 'string' ? node.colormap : 'viridis',
        ...(isObject(raw) && typeof raw.color === 'string'
          ? {color: raw.color}
          : {}),
      };
    }
  }
  const curves: Parsed['curves'] = [];
  for (const [name, raw] of Object.entries(
    isObject(node.curves) ? node.curves : {},
  )) {
    if (!isObject(raw)) {
      errors?.error(
        'curves',
        `curve "${name}" is {"x": "...", "y": "...", "z"?: "...", "t": [from, to]}`,
      );
      continue;
    }
    const x = parse(raw.x, ['t'], `curves.${name}.x`);
    const y = parse(raw.y, ['t'], `curves.${name}.y`);
    const z =
      raw.z === undefined ? null : parse(raw.z, ['t'], `curves.${name}.z`);
    if (raw.z === undefined && node.surface === undefined) {
      errors?.error(
        'curves',
        `curve "${name}" has no "z" and there is no surface to run along`,
      );
    }
    if (x && y) {
      curves.push({
        name,
        x,
        y,
        z,
        t: range(raw.t, [0, 1]),
        ...(typeof raw.color === 'string' ? {color: raw.color} : {}),
      });
    }
  }
  const points: Parsed['points'] = [];
  for (const [name, raw] of Object.entries(
    isObject(node.points) ? node.points : {},
  )) {
    const at = Array.isArray(raw) ? raw : isObject(raw) ? raw.at : undefined;
    if (
      !Array.isArray(at) ||
      (at.length !== 2 && at.length !== 3) ||
      !at.every(v => typeof v === 'number')
    ) {
      errors?.error(
        'points',
        `point "${name}" is [x, y] (on the surface) or [x, y, z]`,
      );
      continue;
    }
    if (at.length === 2 && node.surface === undefined) {
      errors?.error(
        'points',
        `point "${name}" gives [x, y] but there is no surface to sit on; give [x, y, z]`,
      );
      continue;
    }
    points.push({
      name,
      at: at as number[],
      ...(isObject(raw) && typeof raw.color === 'string'
        ? {color: raw.color}
        : {}),
    });
  }
  const vectors: Parsed['vectors'] = [];
  for (const [name, raw] of Object.entries(
    isObject(node.vectors) ? node.vectors : {},
  )) {
    if (!isObject(raw)) {
      errors?.error(
        'vectors',
        `vector "${name}" is {"from": [x, y, z], "to": [x, y, z]} or {"at": [x, y], "direction": "gradient"}`,
      );
      continue;
    }
    const triple = (v: Value | undefined) =>
      Array.isArray(v) &&
      (v.length === 2 || v.length === 3) &&
      v.every(n => typeof n === 'number');
    if (raw.at !== undefined) {
      if (!triple(raw.at)) {
        errors?.error(
          'vectors',
          `vector "${name}": "at" is [x, y] or [x, y, z]`,
        );
      } else if (
        raw.direction !== 'gradient' &&
        raw.direction !== 'normal' &&
        !triple(raw.direction)
      ) {
        errors?.error(
          'vectors',
          `vector "${name}": "direction" is "gradient", "normal" or [dx, dy, dz]`,
        );
      } else if (
        (raw.direction === 'gradient' || raw.direction === 'normal') &&
        node.surface === undefined
      ) {
        errors?.error(
          'vectors',
          `vector "${name}": a ${raw.direction} needs a surface`,
        );
      } else {
        vectors.push({
          name,
          at: raw.at as number[],
          direction: raw.direction,
          ...(typeof raw.color === 'string' ? {color: raw.color} : {}),
        });
      }
    } else if (triple(raw.from) && triple(raw.to)) {
      vectors.push({
        name,
        from: raw.from as number[],
        to: raw.to as number[],
        ...(typeof raw.color === 'string' ? {color: raw.color} : {}),
      });
    } else {
      errors?.error(
        'vectors',
        `vector "${name}" needs "from" and "to", or "at" and "direction"`,
      );
    }
  }
  return {
    surface,
    x: range(node.x, [-3, 3]),
    y: range(node.y, [-3, 3]),
    curves,
    points,
    vectors,
  };
}

// ---- the kit ------------------------------------------------------------------

const FIELDS = [
  'surface',
  'x',
  'y',
  'z',
  'curves',
  'points',
  'vectors',
  'labels',
  'colormap',
  'view',
  'seconds',
  ...PLACEMENT_FIELDS,
];

export const graph3d: KitSpec = {
  name: 'graph3d',
  summary:
    'A 3D science plot: a surface z = f(x, y) coloured by height, paths drawn on or above it, points, and vectors (including gradients and normals), inside a framed box with ticks and axis titles. `play` turns the camera once around the plot.',
  fields: {
    surface: {
      type: 'expression in x and y',
      doc: 'The surface height: "sin(x)cos(y)", "x^2 - y^2", "exp(-(x^2+y^2))".',
    },
    x: {type: '[from, to]', doc: 'The x range (default [-3, 3]).'},
    y: {type: '[from, to]', doc: 'The y range (default [-3, 3]).'},
    z: {
      type: '[from, to]',
      doc: 'The height range shown (default: fitted to the surface).',
    },
    curves: {
      type: '{name: {"x": "...", "y": "...", "z"?: "...", "t": [from, to]}}',
      doc: 'Paths in t. Leave out "z" to run along the surface: {"descent": {"x": "2 - t", "y": "1 - t/2", "t": [0, 2]}}.',
    },
    points: {
      type: '{name: [x, y] | [x, y, z]}',
      doc: 'Marked points; [x, y] sits on the surface. Named on the plot.',
    },
    vectors: {
      type: '{name: {"from": [x,y,z], "to": [x,y,z]} | {"at": [x, y], "direction": "gradient" | "normal" | [dx,dy,dz]}}',
      doc: 'Arrows. A gradient points uphill across the surface; a normal stands out of it.',
    },
    labels: {
      type: '{"x"?: "...", "y"?: "...", "z"?: "..."}',
      doc: 'Axis titles (default x, y, z).',
    },
    colormap: {
      type: '"viridis" | "plasma" | "coolwarm" | "terrain"',
      doc: 'How height is coloured (default viridis).',
    },
    view: {
      type: '"iso" | "top" | "front" | "side" | [azimuth, elevation]',
      doc: 'Where the camera looks from (default iso).',
    },
    seconds: {
      type: 'number',
      doc: 'How long `play` takes to turn around once (default 4).',
    },
    region: {
      type: 'full | left | right | center | top | bottom',
      doc: 'Where it goes (default full).',
    },
    box: {
      type: '[centreX, centreY, width, height]',
      doc: 'An explicit stage box instead of a region.',
    },
  },
  parts:
    '"<id>.surface", and each curve, point and vector by name ("plot.descent", "plot.P", "plot.grad"); a beat with "play": "<id>" turns the camera around once',
  example: {
    id: 'plot',
    kit: 'graph3d',
    surface: 'x^2 + y^2',
    x: [-2, 2],
    y: [-2, 2],
    curves: {descent: {x: '1.8 - 1.6t', y: '1.2 - 1.1t', t: [0, 1]}},
    points: {minimum: [0, 0]},
    region: 'left',
  },

  validate(node) {
    const errors = new FieldErrors(node);
    errors.onlyFields(FIELDS);
    checkPlacement(node, errors);
    const parsed = parseFields(node, errors);
    if (
      !parsed.surface &&
      !parsed.curves.length &&
      !parsed.points.length &&
      !parsed.vectors.length &&
      ['surface', 'curves', 'points', 'vectors'].every(
        k => node[k] === undefined,
      )
    ) {
      errors.error(
        'surface',
        'a 3D graph needs a surface, a curve, a point or a vector',
      );
    }
    for (const field of ['x', 'y', 'z']) {
      if (
        node[field] !== undefined &&
        range(node[field], [NaN, NaN]).some(Number.isNaN)
      ) {
        errors.error(field, `${field} is [from, to] with from < to`);
      }
    }
    if (
      node.colormap !== undefined &&
      !COLORMAPS.includes(String(node.colormap))
    ) {
      errors.error('colormap', `colormap is one of ${COLORMAPS.join(', ')}`);
    }
    const view = node.view;
    if (
      view !== undefined &&
      !(typeof view === 'string' && view in VIEWS) &&
      !(
        Array.isArray(view) &&
        view.length === 2 &&
        view.every(v => typeof v === 'number')
      )
    ) {
      errors.error(
        'view',
        `view is one of ${Object.keys(VIEWS).join(', ')}, or [azimuth, elevation] in degrees`,
      );
    }
    if (node.labels !== undefined && !isObject(node.labels)) {
      errors.error('labels', 'labels is {"x": "...", "y": "...", "z": "..."}');
    }
    if (
      node.seconds !== undefined &&
      !(
        typeof node.seconds === 'number' &&
        node.seconds >= 1 &&
        node.seconds <= 5.5
      )
    ) {
      errors.error('seconds', 'seconds is from 1 to 5.5');
    }
    return errors.issues;
  },

  expand(node, context): KitExpansion {
    const box: Box = placementBox(node);
    const id = node.id;
    const parsed = parseFields(node, null);
    const [x0, x1] = parsed.x;
    const [y0, y1] = parsed.y;
    const f = parsed.surface?.expr;
    const height = (x: number, y: number) => f?.evaluateWith({x, y}) ?? NaN;

    // ---- the height range: the surface's, without runaway spikes ----
    const samples: number[] = [];
    if (f) {
      for (let j = 0; j <= GRID; j++) {
        for (let i = 0; i <= GRID; i++) {
          const v = height(
            x0 + ((x1 - x0) * i) / GRID,
            y0 + ((y1 - y0) * j) / GRID,
          );
          if (Number.isFinite(v)) samples.push(v);
        }
      }
    }
    const extra: number[] = [];
    for (const c of parsed.curves) {
      if (!c.z) continue;
      for (let k = 0; k <= 20; k++) {
        const v = c.z.evaluate(c.t[0] + ((c.t[1] - c.t[0]) * k) / 20);
        if (Number.isFinite(v)) extra.push(v);
      }
    }
    for (const p of parsed.points) if (p.at.length === 3) extra.push(p.at[2]);
    let [z0, z1] = (() => {
      if (Array.isArray(node.z)) return range(node.z, [-1, 1]);
      // The full range, unless a spike (1/r near r = 0) would flatten
      // everything else - then the 2nd to 98th percentile.
      const sorted = [...samples].sort((a, b) => a - b);
      const p2 = sorted[Math.floor(sorted.length * 0.02)];
      const p98 = sorted[Math.ceil(sorted.length * 0.98) - 1];
      const spread = p98 - p2 || 1;
      const spiky =
        sorted.length > 0 &&
        (sorted[sorted.length - 1] - p98 > 3 * spread ||
          p2 - sorted[0] > 3 * spread);
      const lo = sorted.length ? (spiky ? p2 : sorted[0]) : Infinity;
      const hi = sorted.length
        ? spiky
          ? p98
          : sorted[sorted.length - 1]
        : -Infinity;
      const all = [lo, hi, ...extra].filter(Number.isFinite);
      return all.length ? [Math.min(...all), Math.max(...all)] : [-1, 1];
    })();
    if (z1 - z0 < 1e-9) {
      z0 -= 1;
      z1 += 1;
    }

    // ---- math (z up) to world (y up), normalised to the plot box ----
    const W = (x: number, y: number, z: number): V3 => [
      round(((x - (x0 + x1) / 2) / (x1 - x0)) * 2),
      round(
        ((Math.max(z0, Math.min(z1, z)) - (z0 + z1) / 2) / (z1 - z0)) * 2 * HY,
      ),
      round(-((y - (y0 + y1) / 2) / (y1 - y0)) * 2),
    ];
    const lift = 0.02;

    // ---- world parts ----
    type WorldPart = {
      name: string;
      kind: 'surface' | 'curve' | 'point' | 'vector';
      data: Record<string, Value>;
    };
    const parts3d: WorldPart[] = [];
    let colorIndex = 0;
    const nextColor = (given?: string) =>
      hex(given, PART_COLORS[colorIndex++ % PART_COLORS.length]);
    if (f) {
      const heights: number[] = [];
      for (let j = 0; j <= GRID; j++) {
        for (let i = 0; i <= GRID; i++) {
          // Row j runs along x at y = y1 - ... so world z increases with j.
          const x = x0 + ((x1 - x0) * i) / GRID;
          const y = y1 - ((y1 - y0) * j) / GRID;
          const v = height(x, y);
          heights.push(Number.isFinite(v) ? W(x, y, v)[1] : W(x, y, z0)[1]);
        }
      }
      parts3d.push({
        name: 'surface',
        kind: 'surface',
        data: {
          id: `${id}-surface`,
          x: [-1, 1],
          z: [-1, 1],
          nx: GRID,
          nz: GRID,
          heights,
          heightRange: [-HY, HY],
          ...(parsed.surface?.color
            ? {color: hex(parsed.surface.color, 'blue')}
            : {colormap: parsed.surface?.colormap ?? 'viridis'}),
          wireframe: {every: 4},
        },
      });
    }
    for (const c of parsed.curves) {
      const points: number[] = [];
      for (let k = 0; k <= CURVE_SAMPLES; k++) {
        const t = c.t[0] + ((c.t[1] - c.t[0]) * k) / CURVE_SAMPLES;
        const x = c.x.evaluate(t);
        const y = c.y.evaluate(t);
        const z = c.z ? c.z.evaluate(t) : height(x, y);
        if (![x, y, z].every(Number.isFinite)) continue;
        const p = W(x, y, z);
        if (!c.z) p[1] = round(p[1] + lift);
        points.push(...p);
      }
      if (points.length >= 6) {
        parts3d.push({
          name: c.name,
          kind: 'curve',
          data: {
            id: `${id}-${c.name}`,
            points,
            color: nextColor(c.color),
            radius: 0.022,
          },
        });
      }
    }
    const pointLabels: {name: string; at: V3}[] = [];
    for (const p of parsed.points) {
      const z = p.at.length === 3 ? p.at[2] : height(p.at[0], p.at[1]);
      const center = W(p.at[0], p.at[1], Number.isFinite(z) ? z : z0);
      // Sit on the surface rather than half inside it.
      if (p.at.length === 2) center[1] = round(center[1] + 0.03);
      parts3d.push({
        name: p.name,
        kind: 'point',
        data: {
          id: `${id}-${p.name}`,
          center,
          radius: 0.045,
          color: nextColor(p.color ?? 'yellow'),
        },
      });
      pointLabels.push({
        name: p.name,
        at: [center[0], round(center[1] + 0.13), center[2]],
      });
    }
    for (const v of parsed.vectors) {
      let from: V3;
      let to: V3;
      if (v.at) {
        const [ax, ay] = v.at;
        const az = v.at.length === 3 ? v.at[2] : height(ax, ay);
        from = W(ax, ay, az);
        if (Array.isArray(v.direction)) {
          const d = v.direction as number[];
          to = W(ax + d[0], ay + d[1], az + (d[2] ?? 0));
        } else {
          // Slopes in world units, so the arrow reads correctly in the box.
          const h = 1e-3 * Math.max(x1 - x0, y1 - y0);
          const gx = (height(ax + h, ay) - height(ax - h, ay)) / (2 * h);
          const gy = (height(ax, ay + h) - height(ax, ay - h)) / (2 * h);
          const sx = 2 / (x1 - x0);
          const sy = 2 / (y1 - y0);
          const sz = (2 * HY) / (z1 - z0);
          // World-space slope components (x, z-world = -y).
          const dwx = (gx * sz) / sx;
          const dwz = -(gy * sz) / sy;
          // A gradient runs up along the surface (its tangent in the uphill
          // direction), not flat into it; a normal stands out of it.
          let dir: V3;
          if (v.direction === 'normal') dir = [-dwx, 1, -dwz];
          else dir = [dwx, dwx * dwx + dwz * dwz, dwz];
          const len = Math.hypot(...dir) || 1;
          dir = dir.map(c => (c / len) * 0.45) as V3;
          to = [
            round(from[0] + dir[0]),
            round(from[1] + dir[1]),
            round(from[2] + dir[2]),
          ];
          from = [from[0], round(from[1] + lift * 1.5), from[2]];
          to = [to[0], round(to[1] + lift * 1.5), to[2]];
        }
      } else {
        from = W(v.from![0], v.from![1], v.from![2] ?? 0);
        to = W(v.to![0], v.to![1], v.to![2] ?? 0);
      }
      parts3d.push({
        name: v.name,
        kind: 'vector',
        data: {
          id: `${id}-${v.name}`,
          from,
          to,
          color: nextColor(v.color ?? 'ink'),
        },
      });
    }

    // ---- camera ----
    // What must be seen: every marked point and vector, and the paths. With
    // no view given, the camera looks from the first angle where none of
    // them is hidden behind the surface.
    const surfaceY = (wx: number, wz: number) => {
      const x = x0 + ((wx + 1) / 2) * (x1 - x0);
      const y = (y0 + y1) / 2 - (wz * (y1 - y0)) / 2;
      const v = height(x, y);
      return Number.isFinite(v) ? W(x, y, v)[1] : -Infinity;
    };
    const mustSee: V3[] = [];
    for (const part of parts3d) {
      if (part.kind === 'point') mustSee.push(part.data.center as V3);
      if (part.kind === 'vector') mustSee.push(part.data.from as V3);
      if (part.kind === 'curve') {
        const pts = part.data.points as number[];
        for (
          let k = 0;
          k < pts.length;
          k += Math.max(3, Math.floor(pts.length / 18 / 3) * 3)
        ) {
          mustSee.push([pts[k], pts[k + 1], pts[k + 2]]);
        }
      }
    }
    const hidden = (eyePoint: V3) =>
      f !== undefined &&
      mustSee.some(p => {
        for (let k = 1; k <= 40; k++) {
          const t = 0.03 + (k / 40) * 0.97;
          const X = p[0] + (eyePoint[0] - p[0]) * t;
          const Y = p[1] + (eyePoint[1] - p[1]) * t;
          const Z = p[2] + (eyePoint[2] - p[2]) * t;
          if (Math.abs(X) > 1 || Math.abs(Z) > 1) return false;
          // Clear by a margin, not a hair: a marker has size, and a line of
          // sight grazing a rim leaves it half buried.
          if (Y < surfaceY(X, Z) + 0.08) return true;
        }
        return false;
      });
    const aspect = box.width / box.height;
    const chosen = ((): [number, number] => {
      if (Array.isArray(node.view)) return node.view as [number, number];
      // A named view keeps its direction, but rises until nothing marked is
      // hidden - "iso" means a standard angled look, not "hide the minimum".
      // Exact [azimuth, elevation] numbers are taken as given.
      const preset =
        typeof node.view === 'string' ? VIEWS[node.view] : undefined;
      const azimuths = preset ? [preset[0]] : [38, 128, 218, 308];
      const elevations = preset
        ? [preset[1], 44, 58, 72].filter(e => e >= preset[1])
        : [32, 44, 58, 72];
      for (const el of elevations) {
        for (const az of azimuths) {
          if (!hidden(eyeAt(az, el, fitCamera(az, el, aspect)))) {
            return [az, el];
          }
        }
      }
      return [...(preset ?? VIEWS.iso)] as [number, number];
    })();
    const [azimuth, elevation] = chosen;
    const distance = fitCamera(azimuth, elevation, aspect);
    const start = camera(azimuth, elevation, distance);
    const eye = start.eye;

    // ---- layers: a base world, then one full world per revealed part ----
    // Parts a beat shows get their own layer, stacked in the order the
    // beats first name them; everything else is in the base.
    const order = [...(context.referenced ?? new Set<string>())];
    const partNames = new Set(parts3d.map(p => p.name));
    const shown = order.filter(r => partNames.has(r) && context.shown?.has(r));
    const boxSpec = {
      min: [-1, -HY, -1],
      max: [1, HY, 1],
      divisions: 4,
      viewFrom: eye,
    };
    const worldOf = (
      included: readonly WorldPart[],
      highlight?: string,
    ): Value => {
      const spec: Record<string, Value[]> = {
        surfaces: [],
        curves: [],
        arrows: [],
        spheres: [],
      };
      for (const part of included) {
        const lit = part.name === highlight;
        if (part.kind === 'surface') {
          spec.surfaces.push(
            lit ? {...part.data, colormap: 'plasma'} : part.data,
          );
        } else if (part.kind === 'curve') {
          spec.curves.push(
            lit ? {...part.data, color: HIGHLIGHT, radius: 0.034} : part.data,
          );
        } else if (part.kind === 'point') {
          spec.spheres.push(
            lit ? {...part.data, color: HIGHLIGHT, radius: 0.07} : part.data,
          );
        } else {
          spec.arrows.push(
            lit ? {...part.data, color: HIGHLIGHT, radius: 0.022} : part.data,
          );
        }
      }
      return {
        $engine: 'buildWorld3D',
        args: [
          {
            box: boxSpec,
            ...Object.fromEntries(
              Object.entries(spec).filter(([, v]) => v.length),
            ),
          },
        ],
      };
    };

    const nodes: SceneNode[] = [];
    const touches: Touch[] = [];
    const parts = new Map<string, KitPart>();
    const layerIds: string[] = [];
    const layer = (layerId: string, world: Value, hidden: boolean) => {
      nodes.push({
        id: layerId,
        component: 'Scene3D',
        fixed: true,
        props: {
          size: [box.width, box.height],
          position: [box.x, box.y],
          world,
          camera: start.spec,
          ...(hidden ? {opacity: 0} : {}),
        },
      });
      touches.push({
        a: layerId,
        b: '*',
        reason: 'the 3D plot is the ground its labels sit on',
      });
      layerIds.push(layerId);
    };
    const shownSet = new Set(shown);
    const baseParts = parts3d.filter(p => !shownSet.has(p.name));
    layer(`${id}_base`, worldOf(baseParts), false);
    const cumulative: WorldPart[] = [...baseParts];
    shown.forEach((name, index) => {
      cumulative.push(parts3d.find(p => p.name === name)!);
      const layerId = `${id}_show${index}`;
      layer(layerId, worldOf([...cumulative]), false);
      parts.set(name, {nodes: [layerId]});
    });
    for (const name of context.highlighted) {
      if (!partNames.has(name)) continue;
      // What is on screen by then: the base, plus parts shown before it.
      const included = [
        ...baseParts,
        ...shown
          .filter(n => n !== name && order.indexOf(n) < order.indexOf(name))
          .map(n => parts3d.find(p => p.name === n)!),
        parts3d.find(p => p.name === name)!,
      ].filter((p, i, all) => all.findIndex(q => q.name === p.name) === i);
      const layerId = `${id}_hi${layerIds.length}`;
      layer(layerId, worldOf(included, name), true);
      const existing = parts.get(name);
      parts.set(name, {nodes: existing?.nodes ?? [], overlay: layerId});
    }

    // ---- labels: axis titles and ticks, on an empty top layer ----
    const labelsId = `${id}_labels`;
    layer(labelsId, {$engine: 'buildWorld3D', args: [{lights: 'flat'}]}, false);
    const sx = Math.sign(eye[0]) || 1;
    const sz = Math.sign(eye[2]) || 1;
    const titles = isObject(node.labels) ? node.labels : {};
    const label = (
      labelId: string,
      text: string,
      point: V3,
      size: number,
      weight = 500,
    ) => {
      nodes.push({
        id: labelId,
        component: 'Anchored3DLabel',
        parent: labelsId,
        halo: 2,
        props: {
          scene: {ref: labelsId},
          point,
          text,
          fontSize: size,
          fontWeight: weight,
          fill: '#2A3039',
          // A soft light glow keeps a name readable over a dark colour map
          // without widening the box the audit measures.
          shadowColor: '#FFFDFC',
          shadowBlur: 10,
        },
      });
      touches.push({
        a: labelId,
        b: '*',
        reason: 'a tick label on the plot frame',
      });
      return labelId;
    };
    const tickLabels: string[] = [];
    const ticks = (lo: number, hi: number) => {
      const step = niceStep(hi - lo);
      const out: number[] = [];
      for (
        let v = Math.ceil(lo / step) * step;
        v <= hi + step * 1e-6;
        v += step
      ) {
        out.push(v);
      }
      return out;
    };
    // x ticks run along the bottom edge nearest the viewer; y ticks along the
    // side edge; heights up the vertical edge between them. Ticks at the
    // shared corner are left out so two labels never land on one spot.
    const cornerX = sx > 0 ? x1 : x0;
    const cornerY = sz > 0 ? y0 : y1;
    ticks(x0, x1).forEach((v, k) => {
      if (Math.abs(v - cornerX) < (x1 - x0) * 0.12) return;
      const p = W(v, cornerY, z0);
      tickLabels.push(
        label(
          `${id}_tx${k}`,
          tickText(v),
          [p[0], -HY - 0.02, round(sz * 1.17)],
          19,
        ),
      );
    });
    ticks(y0, y1).forEach((v, k) => {
      if (Math.abs(v - cornerY) < (y1 - y0) * 0.12) return;
      const p = W(cornerX, v, z0);
      tickLabels.push(
        label(
          `${id}_ty${k}`,
          tickText(v),
          [round(sx * 1.17), -HY - 0.02, p[2]],
          19,
        ),
      );
    });
    ticks(z0, z1).forEach((v, k) => {
      // The lowest tick would sit on the end of the y ticks.
      if (v - z0 < (z1 - z0) * 0.1) return;
      const p = W(0, 0, v);
      tickLabels.push(
        label(
          `${id}_tz${k}`,
          tickText(v),
          [round(sx * 1.1), p[1], round(-sz * 1.1)],
          19,
        ),
      );
    });
    const titleNodes = [
      label(
        `${id}_ax`,
        typeof titles.x === 'string' ? titles.x : 'x',
        [0, -HY - 0.02, round(sz * 1.42)],
        24,
        700,
      ),
      label(
        `${id}_ay`,
        typeof titles.y === 'string' ? titles.y : 'y',
        [round(sx * 1.42), -HY - 0.02, 0],
        24,
        700,
      ),
      label(
        `${id}_az`,
        typeof titles.z === 'string' ? titles.z : 'z',
        [round(sx * 1.1), round(HY + 0.16), round(-sz * 1.1)],
        24,
        700,
      ),
    ];
    const nameNodes: string[] = [];
    for (const p of pointLabels) {
      const labelId = label(
        `${id}_p${nameNodes.length}`,
        p.name,
        p.at,
        22,
        700,
      );
      nameNodes.push(labelId);
      const part = parts.get(p.name);
      if (part) {
        parts.set(p.name, {...part, nodes: [...part.nodes, labelId]});
        const index = nodes.findIndex(n => n.id === labelId);
        if (shownSet.has(p.name)) {
          nodes[index] = {
            ...nodes[index],
            props: {...nodes[index].props, opacity: 0},
          };
        }
      } else {
        parts.set(p.name, {nodes: [labelId]});
      }
    }
    for (const part of parts3d) {
      if (!parts.has(part.name)) parts.set(part.name, {nodes: [layerIds[0]]});
    }

    // ---- play: one turn around, labels resting while the frame moves ----
    const seconds = num(node.seconds, 4);
    const segments = 24;
    const turn: Step[] = layerIds.map(layerId => ({
      kind: 'chain',
      steps: Array.from({length: segments}, (_, k) => ({
        kind: 'tween' as const,
        node: layerId,
        prop: 'camera',
        to: camera(azimuth + (360 * (k + 1)) / segments, elevation, distance)
          .spec,
        seconds: round(seconds / segments, 3),
        easing: 'linear',
      })),
    }));
    const frameLabels = [...tickLabels, ...titleNodes, ...nameNodes];
    const fade = (to: number): Step => ({
      kind: 'all',
      steps: frameLabels.map(n => ({
        kind: 'tween' as const,
        node: n,
        prop: 'opacity',
        to,
        seconds: 0.25,
      })),
    });
    parts.set('', {
      nodes: nodes.filter(n => n.props?.opacity !== 0).map(n => n.id),
      // One chain: a beat runs its changes together, and these must not.
      play: [
        {kind: 'chain', steps: [fade(0), {kind: 'all', steps: turn}, fade(1)]},
      ],
    });
    parts.set('labels', {nodes: frameLabels});
    return {nodes, touches, parts};
  },
};
