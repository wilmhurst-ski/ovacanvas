import chroma from 'chroma-js';
import type {SceneNode, Touch, Value} from '../document/model.js';
import {isObject} from '../document/values.js';
import {ICON_HEX, hexColor} from '../icons/draw.js';
import {ExpressionError, derivative, type Expression} from './expression.js';
import {
  ACCENTS,
  FieldErrors,
  PLACEMENT_FIELDS,
  asRecord,
  checkPlacement,
  colorValue,
  isNumberPair,
  placementBox,
  texWidthEm,
  textBox,
} from './fields.js';
import {PARAMS_FIELD, parseWithParams, readParams} from './params.js';
import {parseData, type ParsedData} from './plotData.js';
import type {KitExpansion, KitNode, KitPart, KitSpec} from './types.js';

const FIELDS = [
  'x',
  'y',
  'functions',
  'points',
  'tangents',
  'areas',
  'grid',
  'axisLabels',
  'params',
  'bars',
  'lines',
  'dots',
  'values',
  ...PLACEMENT_FIELDS,
];
const RULES = ['left', 'right', 'mid'] as const;
type Rule = (typeof RULES)[number];
const NAME = /^[A-Za-z][A-Za-z0-9]{0,11}$/;
const SAMPLES = 240;
const TICK_SIZE = 20;

interface Fn {
  name: string;
  expr: Expression;
  label?: string;
  color?: Value;
}
interface Point {
  name: string;
  x: number;
  y: number;
  label: string;
}
interface Tangent {
  of: string;
  at: number;
}
interface Area {
  under: string;
  from: number;
  to: number;
  /** Riemann rectangles instead of a smooth shading. */
  rects?: number;
  rule: Rule;
  color?: string;
  /** Height and width marks for each rectangle, shown one at a time. */
  measure: boolean;
}
interface Parsed {
  x: [number, number];
  y?: [number, number];
  functions: Fn[];
  points: Point[];
  tangents: Tangent[];
  areas: Area[];
  data: ParsedData;
}

function parse(node: KitNode, errors?: FieldErrors): Parsed {
  const params = readParams(node.params, errors);
  const data = parseData(node, errors);
  if (node.values !== undefined && typeof node.values !== 'boolean') {
    errors?.error('values', 'values is true or false');
  }
  const givenX = isNumberPair(node.x) && node.x[0] < node.x[1];
  let x: [number, number] = givenX ? (node.x as [number, number]) : [-5, 5];
  if (data.categories) {
    // Categories stand at 0, 1, 2, ... with half a slot either side.
    x = [-0.6, data.categories.length - 0.4];
  } else if (!givenX && data.series.length) {
    const xs = data.series.flatMap(s => s.data.map(d => d.x));
    let lo = Math.min(...xs);
    let hi = Math.max(...xs);
    if (hi - lo < 1e-9) [lo, hi] = [lo - 1, hi + 1];
    const pad = (hi - lo) * 0.06;
    x = [lo - pad, hi + pad];
  } else if (!givenX && (node.x !== undefined || !data.series.length)) {
    errors?.error(
      'x',
      'x is the visible range [min, max], min < max',
      'e.g. "x": [-3, 3]',
    );
  }
  let y: [number, number] | undefined;
  if (node.y !== undefined) {
    if (isNumberPair(node.y) && node.y[0] < node.y[1]) y = node.y;
    else {
      errors?.error(
        'y',
        'y is the visible range [min, max], min < max (omit it to fit the curves)',
      );
    }
  }

  const functions: Fn[] = [];
  const addFn = (
    name: string,
    source: Value | undefined,
    label?: Value,
    color?: Value,
  ) => {
    if (!NAME.test(name)) {
      errors?.error(
        'functions',
        `function name "${name}" must be letters and digits`,
      );
      return;
    }
    if (typeof source !== 'string') {
      errors?.error(
        'functions',
        `function "${name}" needs an expression in x, e.g. "x^2 - 1"`,
      );
      return;
    }
    try {
      functions.push({
        name,
        expr: parseWithParams(source, params),
        ...(typeof label === 'string' ? {label} : {}),
        ...(color !== undefined ? {color} : {}),
      });
    } catch (error) {
      if (!(error instanceof ExpressionError)) throw error;
      errors?.error('functions', `function "${name}": ${error.message}`);
    }
  };
  if (Array.isArray(node.functions)) {
    node.functions.forEach((item, index) => {
      if (typeof item === 'string') addFn(`f${index}`, item);
      else if (isObject(item)) {
        addFn(
          typeof item.id === 'string' ? item.id : `f${index}`,
          item.expr,
          item.label,
          item.color,
        );
      } else {
        errors?.error(
          'functions',
          'each function is "expr" or {"id", "expr", "label"?, "color"?}',
        );
      }
    });
  } else if (isObject(node.functions)) {
    for (const [name, value] of Object.entries(node.functions)) {
      if (isObject(value)) addFn(name, value.expr, value.label, value.color);
      else addFn(name, value);
    }
  } else if (node.functions !== undefined) {
    errors?.error('functions', 'functions is {"f": "x^2"} or a list');
  }
  const byName = new Map(functions.map(f => [f.name, f]));

  const points: Point[] = [];
  const rawPoints = node.points === undefined ? {} : asRecord(node.points);
  if (!rawPoints) {
    errors?.error(
      'points',
      'points is {"P": [x, y]} or {"P": {"on": "f", "x": 1}}',
    );
  }
  for (const [name, value] of Object.entries(rawPoints ?? {})) {
    if (!NAME.test(name)) {
      errors?.error(
        'points',
        `point name "${name}" must be letters and digits`,
      );
    } else if (isNumberPair(value)) {
      points.push({name, x: value[0], y: value[1], label: name});
    } else if (
      isObject(value) &&
      typeof value.x === 'number' &&
      typeof value.on === 'string'
    ) {
      const f = byName.get(value.on);
      if (!f) {
        errors?.error(
          'points',
          `point "${name}" is on unknown function "${value.on}"`,
        );
      } else {
        points.push({
          name,
          x: value.x,
          y: f.expr.evaluate(value.x),
          label: typeof value.label === 'string' ? value.label : name,
        });
      }
    } else {
      errors?.error(
        'points',
        `point "${name}" must be [x, y] or {"on": "f", "x": number, "label"?}`,
      );
    }
  }

  const tangents: Tangent[] = [];
  for (const item of Array.isArray(node.tangents)
    ? node.tangents
    : node.tangents === undefined
      ? []
      : [null]) {
    if (
      isObject(item) &&
      typeof item.of === 'string' &&
      typeof item.at === 'number'
    ) {
      if (!byName.has(item.of)) {
        errors?.error('tangents', `tangent of unknown function "${item.of}"`);
      } else tangents.push({of: item.of, at: item.at});
    } else {
      errors?.error('tangents', 'tangents is a list of {"of": "f", "at": x}');
    }
  }

  const areas: Area[] = [];
  for (const item of Array.isArray(node.areas)
    ? node.areas
    : node.areas === undefined
      ? []
      : [null]) {
    if (
      isObject(item) &&
      typeof item.under === 'string' &&
      typeof item.from === 'number' &&
      typeof item.to === 'number' &&
      item.from < item.to
    ) {
      const extra = Object.keys(item).filter(
        k =>
          ![
            'under',
            'from',
            'to',
            'rects',
            'rule',
            'color',
            'measure',
          ].includes(k),
      );
      if (extra.length) {
        errors?.error(
          'areas',
          `an area has unknown key(s) ${extra.join(', ')}`,
          'an area is {"under", "from", "to", "rects"?, "rule"?, "color"?, "measure"?}',
        );
      }
      const rects =
        item.rects === undefined
          ? undefined
          : typeof item.rects === 'number' &&
              Number.isInteger(item.rects) &&
              item.rects >= 1 &&
              item.rects <= 60
            ? item.rects
            : null;
      if (rects === null) {
        errors?.error(
          'areas',
          'rects is a whole number of rectangles, 1 to 60',
        );
      }
      if (item.measure !== undefined && typeof item.measure !== 'boolean') {
        errors?.error('areas', 'measure is true or false');
      }
      const rule = item.rule === undefined ? 'left' : item.rule;
      if (!RULES.includes(rule as Rule)) {
        errors?.error('areas', 'rule is "left", "right" or "mid"');
      }
      if (!byName.has(item.under)) {
        errors?.error('areas', `area under unknown function "${item.under}"`);
      } else {
        areas.push({
          under: item.under,
          from: item.from,
          to: item.to,
          ...(typeof rects === 'number' ? {rects} : {}),
          rule: RULES.includes(rule as Rule) ? (rule as Rule) : 'left',
          ...(typeof item.color === 'string' ? {color: item.color} : {}),
          measure: item.measure === true,
        });
      }
    } else {
      errors?.error(
        'areas',
        'areas is a list of {"under": "f", "from": a, "to": b} with a < b',
      );
    }
  }
  return {x, ...(y ? {y} : {}), functions, points, tangents, areas, data};
}

type Vec = [number, number];

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

/**
 * Where to put a label near `anchor`: the candidate around it whose box
 * stays farthest from every curve, tangent and axis, and from labels already
 * placed - a small search, so a label never lands on the line it names.
 */
function placeLabel(
  anchors: Vec | readonly Vec[],
  width: number,
  height: number,
  obstacles: readonly Vec[][],
  taken: readonly Vec[],
  bounds: {left: number; right: number; top: number; bottom: number},
  filled: readonly {x0: number; y0: number; x1: number; y1: number}[] = [],
): Vec {
  // Several anchors (spots along a curve, the end first): the first one
  // with room for the label wins.
  const list: readonly Vec[] =
    typeof anchors[0] === 'number' ? [anchors as Vec] : (anchors as Vec[]);
  let fallback: Vec | null = null;
  for (const anchor of list) {
    const found = placeAround(anchor, width, height, obstacles, taken, bounds, filled);
    if (found) return found;
    fallback ??= [Math.round(anchor[0] + 24), Math.round(anchor[1] - 26)];
  }
  return fallback ?? [0, 0];
}

function placeAround(
  anchor: Vec,
  width: number,
  height: number,
  obstacles: readonly Vec[][],
  taken: readonly Vec[],
  bounds: {left: number; right: number; top: number; bottom: number},
  filled: readonly {x0: number; y0: number; x1: number; y1: number}[],
): Vec | null {
  let best: Vec | null = null;
  let bestScore = -Infinity;
  for (const distance of [26, 40, 58]) {
    for (let k = 0; k < 8; k++) {
      const angle = (-Math.PI / 4) * k + Math.PI / 4;
      const dx = Math.cos(angle);
      const dy = -Math.sin(angle);
      const centre: Vec = [
        anchor[0] + dx * (distance + width / 2),
        anchor[1] + dy * (distance + height / 2),
      ];
      if (
        centre[0] - width / 2 < bounds.left ||
        centre[0] + width / 2 > bounds.right ||
        centre[1] - height / 2 < bounds.top ||
        centre[1] + height / 2 > bounds.bottom
      ) {
        continue;
      }
      // Never on a bar.
      if (
        filled.some(
          r =>
            centre[0] + width / 2 > r.x0 &&
            centre[0] - width / 2 < r.x1 &&
            centre[1] + height / 2 > r.y0 &&
            centre[1] - height / 2 < r.y1,
        )
      ) {
        continue;
      }
      const probes: Vec[] = [
        centre,
        [centre[0] - width / 2, centre[1] - height / 2],
        [centre[0] + width / 2, centre[1] - height / 2],
        [centre[0] - width / 2, centre[1] + height / 2],
        [centre[0] + width / 2, centre[1] + height / 2],
        [centre[0], centre[1] - height / 2],
        [centre[0], centre[1] + height / 2],
        [centre[0] - width / 2, centre[1]],
        [centre[0] + width / 2, centre[1]],
      ];
      let score = Infinity;
      for (const line of obstacles) {
        for (let i = 1; i < line.length; i++) {
          for (const probe of probes) {
            score = Math.min(
              score,
              distanceToSegment(probe, line[i - 1], line[i]),
            );
          }
        }
      }
      for (const other of taken) {
        score = Math.min(
          score,
          Math.hypot(centre[0] - other[0], centre[1] - other[1]) - 40,
        );
      }
      score -= distance * 0.05;
      if (score > bestScore) {
        bestScore = score;
        best = centre;
      }
    }
  }
  return best ? [Math.round(best[0]), Math.round(best[1])] : null;
}

/** A "nice" tick step giving about five to eight ticks across a range. */
function niceStep(span: number): number {
  const raw = span / 6;
  const power = Math.pow(10, Math.floor(Math.log10(raw)));
  const unit = [1, 2, 5, 10].find(u => u * power >= raw) ?? 10;
  return unit * power;
}

function formatTick(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  return String(rounded).replace('-', '−');
}

export const plot: KitSpec = {
  name: 'plot',
  summary:
    'Anything plotted against axes: curves from expressions in x, points, tangent lines and shaded areas - and data: bar charts, line charts and scatter plots. Axes, ticks, category names, scaling and a key are handled for you.',
  fields: {
    x: {
      type: '[min, max]',
      doc: 'The visible x range (needed for functions; data sets it for you).',
    },
    y: {
      type: '[min, max]',
      doc: 'The visible y range; omit to fit the curves.',
    },
    functions: {
      type: '{"f": "x^2 - 1", "g": {"expr": "sin(x)", "label": "g(x) = \\\\sin x", "color"?: "coral"}}',
      doc: 'Expressions in x: + - * / ^, 2x, sin cos tan exp ln log sqrt abs, pi, e.',
    },
    points: {
      type: '{"P": [1, 0], "Q": {"on": "f", "x": 2, "label"?: "Q"}}',
      doc: 'Marked points, fixed or on a curve.',
    },
    tangents: {
      type: '[{"of": "f", "at": 1}]',
      doc: 'Tangent lines, with the slope computed for you.',
    },
    areas: {
      type: '[{"under": "f", "from": 0, "to": 2, "rects"?: 8, "rule"?: "left" | "right" | "mid"}]',
      doc: 'Shaded area between the curve and the x-axis; with "rects", Riemann rectangles instead ("trace" grows them up from the axis; set "rects" to refine). "measure": true gives each rectangle hidden height and width marks labelled f(0.5) and \\Delta x - show "<id>.area0.measure0", and "from" it to fly those labels into a sum.',
    },
    params: PARAMS_FIELD,
    grid: {
      type: 'boolean',
      doc: 'Faint grid lines at the ticks (default true).',
    },
    axisLabels: {
      type: '{"x": "t", "y": "v"}',
      doc: 'Axis names (LaTeX); default x and y.',
    },
    bars: {
      type: '{"Jan": 55, "Feb": 41, ...} | {"<series>": {...}, ...}',
      doc: 'A bar chart: the names become the x axis, each value a bar standing on zero. Several named series stand side by side, with a key. "trace" on a series grows its bars from the axis; {"set": {"<id>.bars.Jan": 70}} changes one.',
    },
    lines: {
      type: '{"2000": 6.1, "2010": 6.9} | [[x, y], ...] | {"<series>": ...}',
      doc: 'A line chart through the values, marked at each point (numbers as keys stand on a number line, names on categories). "trace" draws the line.',
    },
    dots: {
      type: '[[x, y], ...] | {"<series>": [[x, y], ...]}',
      doc: 'A scatter plot. Add a function for a trend line through it.',
    },
    values: {
      type: 'boolean',
      doc: 'Write each data value by its bar or point.',
    },
    region: {
      type: 'full | left | right | center | top | bottom',
      doc: 'Where the plot goes (default full).',
    },
    box: {
      type: '[centreX, centreY, width, height]',
      doc: 'An explicit stage box instead of a region.',
    },
  },
  parts:
    '"<id>.<function>" a curve (trace draws it), "<id>.<point>" a point, "<id>.tangent0", "<id>.area0" (its rectangles "<id>.area0.0", "<id>.area0.1", ..., and with measure their marks "<id>.area0.measure0", ...), "<id>.axes"; data: "<id>.bars" (a single series; named series go by their names), one bar "<id>.bars.3" or "<id>.bars.Jan", a run "<id>.bars.0-5", "<id>.line", "<id>.dots", "<id>.legend"',
  // Point names are capital letters by convention.
  /* eslint-disable @typescript-eslint/naming-convention */
  example: {
    id: 'graph',
    kit: 'plot',
    region: 'left',
    x: [-3, 3],
    functions: {f: {expr: 'x^2', label: 'f(x) = x^2'}},
    points: {P: {on: 'f', x: 1}},
    tangents: [{of: 'f', at: 1}],
  },
  /* eslint-enable @typescript-eslint/naming-convention */

  validate(node) {
    const errors = new FieldErrors(node);
    errors.onlyFields(FIELDS);
    checkPlacement(node, errors);
    if (node.grid !== undefined && typeof node.grid !== 'boolean') {
      errors.error('grid', 'grid is true or false');
    }
    if (node.axisLabels !== undefined) {
      const labels = asRecord(node.axisLabels);
      if (
        !labels ||
        Object.entries(labels).some(
          ([k, v]) => !['x', 'y'].includes(k) || typeof v !== 'string',
        )
      ) {
        errors.error('axisLabels', 'axisLabels is {"x": "...", "y": "..."}');
      }
    }
    const parsed = parse(node, errors);
    if (
      !parsed.functions.length &&
      !parsed.points.length &&
      !parsed.data.series.length
    ) {
      errors.error(
        'functions',
        'a plot needs at least one function, point, or data series (bars, lines, dots)',
      );
    }
    return errors.issues;
  },

  expand(node, context): KitExpansion {
    const {x, y: yRange, functions, points, tangents, areas, data} = parse(node);
    const categories = data.categories;
    const box = placementBox(node);
    const id = node.id;

    // Sample every curve once; fit y to them when no range was given.
    const samples = functions.map(f =>
      Array.from({length: SAMPLES + 1}, (_, i) => {
        const vx = x[0] + ((x[1] - x[0]) * i) / SAMPLES;
        return [vx, f.expr.evaluate(vx)] as [number, number];
      }),
    );
    let y = yRange;
    if (!y) {
      const values = [0];
      for (const variant of context?.variants ?? [node]) {
        const other = variant === node ? null : parse(variant);
        const fns = other ? other.functions : functions;
        const range = other ? other.x : x;
        for (const f of fns) {
          for (let i = 0; i <= SAMPLES; i++) {
            values.push(
              f.expr.evaluate(range[0] + ((range[1] - range[0]) * i) / SAMPLES),
            );
          }
        }
        values.push(...(other ? other.points : points).map(p => p.y));
        for (const series of (other ? other.data : data).series) {
          values.push(...series.data.map(d => d.y));
        }
      }
      values.splice(0, values.length, ...values.filter(Number.isFinite));
      let lo = Math.min(...values);
      let hi = Math.max(...values);
      if (hi - lo < 1e-6) [lo, hi] = [lo - 1, hi + 1];
      const pad = (hi - lo) * 0.08;
      // Bars stand on zero: the axis starts there, not a little below.
      const onZero = data.series.some(se => se.kind === 'bars') && lo >= 0;
      y = [onZero ? 0 : lo - pad, hi + pad];
    }

    // Plot area inside the box, leaving room for tick and axis labels.
    const left = box.x - box.width / 2 + 70;
    const right = box.x + box.width / 2 - 40;
    const top = box.y - box.height / 2 + 40;
    const bottom = box.y + box.height / 2 - 60;
    const sx = (right - left) / (x[1] - x[0]);
    const sy = (bottom - top) / (y[1] - y[0]);
    const X = (v: number) => Math.round((left + (v - x[0]) * sx) * 10) / 10;
    const Y = (v: number) => Math.round((bottom - (v - y![0]) * sy) * 10) / 10;
    const inY = (v: number) => Number.isFinite(v) && v >= y![0] && v <= y![1];

    const nodes: SceneNode[] = [];
    const touches: Touch[] = [];
    const parts = new Map<string, KitPart>();
    const background = (nodeId: string, reason: string) =>
      touches.push({a: nodeId, b: '*', reason});
    /** Data lines, which curve labels must keep clear of too. */
    const obstacles0: Vec[][] = [];
    /** Bars, which no label may sit on. */
    const filledBars: {x0: number; y0: number; x1: number; y1: number}[] = [];
    /** Highlight overlays, drawn over the data. */
    const overlays: SceneNode[] = [];

    // Grid and axes: the background everything else is drawn on.
    const axisY = y[0] <= 0 && y[1] >= 0 ? 0 : y[0];
    // A chart of data keeps its y axis at the left edge (the data may start
    // at zero, and its first point would sit on the axis numbers).
    const fitted = data.series.length > 0 && !isNumberPair(node.x);
    const axisX =
      categories || fitted ? x[0] : x[0] <= 0 && x[1] >= 0 ? 0 : x[0];
    const stepX = niceStep(x[1] - x[0]);
    const stepY = niceStep(y[1] - y[0]);
    const ticksX: number[] = [];
    for (
      let v = Math.ceil(x[0] / stepX) * stepX;
      !categories && v <= x[1] + 1e-9;
      v += stepX
    ) {
      ticksX.push(v);
    }
    const ticksY: number[] = [];
    for (
      let v = Math.ceil(y[0] / stepY) * stepY;
      v <= y[1] + 1e-9;
      v += stepY
    ) {
      ticksY.push(v);
    }
    const axesNodes: string[] = [];
    if (node.grid !== false) {
      [
        ...ticksX.map(v => ['v', v] as const),
        ...ticksY.map(v => ['h', v] as const),
      ].forEach(([dir, v], i) => {
        const gid = `${id}_g${i}`;
        nodes.push({
          id: gid,
          component: 'Line',
          halo: 0,
          props: {
            points:
              dir === 'v'
                ? [
                    [X(v), top],
                    [X(v), bottom],
                  ]
                : [
                    [left, Y(v)],
                    [right, Y(v)],
                  ],
            stroke: {theme: 'hairline'},
            lineWidth: 1.25,
          },
        });
        background(gid, 'grid lines are the background of the plot');
        axesNodes.push(gid);
      });
    }
    const xAxisId = `${id}_ax`;
    const yAxisId = `${id}_ay`;
    nodes.push(
      {
        id: xAxisId,
        component: 'Line',
        halo: 0,
        props: {
          points: [
            [left, Y(axisY)],
            [right + 18, Y(axisY)],
          ],
          stroke: {theme: 'ink'},
          lineWidth: 2.5,
          endArrow: true,
          arrowSize: 14,
        },
      },
      {
        id: yAxisId,
        component: 'Line',
        halo: 0,
        props: {
          points: [
            [X(axisX), bottom],
            [X(axisX), top - 18],
          ],
          stroke: {theme: 'ink'},
          lineWidth: 2.5,
          endArrow: true,
          arrowSize: 14,
        },
      },
    );
    background(xAxisId, 'the axes are the frame the plot is drawn on');
    background(yAxisId, 'the axes are the frame the plot is drawn on');
    axesNodes.push(xAxisId, yAxisId);
    if (categories) {
      // Category names under their slots, as large as the slots allow.
      const slot = sx * 0.94;
      const widest = Math.max(
        ...categories.map(c => textBox(c, TICK_SIZE + 4).width),
      );
      const size = Math.max(
        13,
        Math.min(TICK_SIZE + 4, Math.floor(((TICK_SIZE + 4) * slot) / widest)),
      );
      categories.forEach((name, i) => {
        const tid = `${id}_tc${i}`;
        nodes.push({
          id: tid,
          component: 'Txt',
          halo: 2,
          props: {
            text: name,
            fontSize: size,
            fill: {theme: 'secondaryInk'},
            position: [X(i), Y(axisY) + 24],
          },
        });
        axesNodes.push(tid);
      });
    }
    ticksX.forEach((v, i) => {
      if (Math.abs(v - axisX) < 1e-9) return;
      const tid = `${id}_tx${i}`;
      nodes.push({
        id: tid,
        component: 'Txt',
        halo: 2,
        props: {
          text: formatTick(v),
          fontSize: TICK_SIZE,
          fill: {theme: 'secondaryInk'},
          position: [X(v), Y(axisY) + 22],
        },
      });
      axesNodes.push(tid);
    });
    ticksY.forEach((v, i) => {
      if (Math.abs(v - axisY) < 1e-9) return;
      const tid = `${id}_ty${i}`;
      nodes.push({
        id: tid,
        component: 'Txt',
        halo: 2,
        props: {
          text: formatTick(v),
          fontSize: TICK_SIZE,
          fill: {theme: 'secondaryInk'},
          position: [X(axisX) - 26, Y(v)],
        },
      });
      axesNodes.push(tid);
    });
    const labels = asRecord(node.axisLabels) ?? {};
    // A word ("Quantity") is set as text; maths ("v", "t^2") as maths.
    const axisTex = (value: Value | undefined, fallback: string) =>
      typeof value !== 'string'
        ? fallback
        : /^[A-Za-z][A-Za-z ()'-]+$/.test(value.trim())
          ? `\\text{${value.trim()}}`
          : value;
    const xl = `${id}_lx`;
    const yl = `${id}_ly`;
    const xLabel: SceneNode = {
      id: xl,
      component: 'Latex',
      props: {
        tex: axisTex(labels.x, 'x'),
        fontSize: 30,
        position: [right + 30, Y(axisY) - 28],
      },
    };
    const yLabel: SceneNode = {
      id: yl,
      component: 'Latex',
      props: {
        tex: axisTex(labels.y, 'y'),
        fontSize: 30,
        position: [X(axisX) + 30, top - 14],
      },
    };
    // A chart of data names its axes only when told to ("x" and "y" mean
    // nothing under a row of months).
    const showX = labels.x !== undefined || !data.series.length;
    const showY = labels.y !== undefined || !data.series.length;
    if (showX) {
      nodes.push(xLabel);
      axesNodes.push(xl);
    }
    if (showY) {
      nodes.push(yLabel);
      axesNodes.push(yl);
    }
    parts.set('axes', {nodes: axesNodes});

    // Data: bars under everything else, lines and dots over them.
    const dataIds: string[] = [];
    const valueSpots: Vec[] = [];
    const showValues = node.values === true;
    const legend: {name: string; color: string}[] = [];
    const barSeries = data.series.filter(se => se.kind === 'bars');
    data.series.forEach((series, index) => {
      const color = ACCENTS[index % ACCENTS.length];
      const hex = hexColor(color, ICON_HEX.blue);
      legend.push({name: series.name, color});
      const seriesNodes: string[] = [];
      const itemParts: (KitPart | undefined)[] = [];
      const valueLabel = (i: number, vx: number, vy: number, above: boolean) => {
        const vid = `${id}_d${series.name}v${i}`;
        const text = formatTick(vy);
        // Over a bar, just above it; by a point on a line, wherever the line
        // (and the values already placed) leave room.
        const spot: Vec =
          series.kind === 'bars'
            ? [X(vx), Math.round(Y(vy) + (above ? -20 : 20))]
            : (placeAround(
                [X(vx), Y(vy)],
                textBox(text, 22).width,
                28,
                obstacles0,
                valueSpots,
                {left: left - 30, right: right + 30, top: top - 30, bottom},
                [],
              ) ?? [X(vx), Math.round(Y(vy) - 20)]);
        valueSpots.push(spot);
        nodes.push({
          id: vid,
          component: 'Txt',
          halo: 2,
          props: {
            text,
            fontSize: 22,
            fill: {theme: 'ink'},
            position: spot,
          },
        });
        return vid;
      };
      if (series.kind === 'bars') {
        const k = barSeries.length;
        const j = barSeries.indexOf(series);
        const group = 0.76;
        const width = group / k;
        const grow: {node: string; from: Record<string, Value>}[] = [];
        series.data.forEach((d, i) => {
          const x0 = d.x - group / 2 + j * width;
          const top = Math.max(y![0], Math.min(y![1], d.y));
          const corners: [number, number][] = [
            [X(x0), Y(axisY)],
            [X(x0 + width), Y(axisY)],
            [X(x0 + width), Y(top)],
            [X(x0), Y(top)],
          ];
          const bid = `${id}_d${series.name}${i}`;
          nodes.push({
            id: bid,
            component: 'Line',
            halo: 0,
            props: {
              points: corners,
              closed: true,
              fill: chroma.mix(hex, '#FFFFFF', 0.25, 'rgb').hex(),
              stroke: hex,
              lineWidth: 2,
            },
          });
          background(bid, 'a bar stands on the axis');
          obstacles0.push([...corners, corners[0]]);
          filledBars.push({
            x0: Math.min(corners[0][0], corners[1][0]),
            x1: Math.max(corners[0][0], corners[1][0]),
            y0: Math.min(corners[0][1], corners[2][1]),
            y1: Math.max(corners[0][1], corners[2][1]),
          });
          // A bar a beat highlights gets its own overlay: recolouring a bar
          // already in the highlight colour would show nothing.
          const lit =
            context.highlighted.has(`${series.name}.${i}`) ||
            (d.category !== undefined &&
              context.highlighted.has(`${series.name}.${d.category}`));
          if (lit) {
            overlays.push({
              id: `${bid}h`,
              component: 'Line',
              halo: 0,
              props: {
                points: corners,
                closed: true,
                fill: chroma.mix(ICON_HEX.coral, '#FFFFFF', 0.2, 'rgb').hex(),
                stroke: ICON_HEX.coral,
                lineWidth: 3,
                opacity: 0,
              },
            });
            background(`${bid}h`, 'the highlight lies over its bar');
          }
          const g = {
            node: bid,
            from: {points: corners.map(([px]) => [px, Y(axisY)])},
          };
          grow.push(g);
          const item = [bid];
          if (showValues) {
            item.push(valueLabel(i, x0 + width / 2, d.y, d.y >= 0));
          }
          seriesNodes.push(...item);
          itemParts[i] = {
            nodes: item,
            grow: [g],
            ...(lit ? {overlay: `${bid}h`} : {}),
          };
          dataIds.push(bid);
        });
        parts.set(series.name, {nodes: seriesNodes, grow});
      } else {
        const shown = series.data.map(
          d => inY(d.y) && d.x >= x[0] && d.x <= x[1],
        );
        const pts = series.data.filter((_, i) => shown[i]);
        let lineId: string | null = null;
        if (series.kind === 'lines' && pts.length >= 2) {
          lineId = `${id}_d${series.name}`;
          const line = pts.map(d => [X(d.x), Y(d.y)] as Vec);
          nodes.push({
            id: lineId,
            component: 'Line',
            halo: 2,
            props: {
              points: line,
              stroke: hex,
              lineWidth: 4,
              lineJoin: 'round',
            },
          });
          seriesNodes.push(lineId);
          dataIds.push(lineId);
          obstacles0.push(line);
        }
        series.data.forEach((d, i) => {
          if (!shown[i]) return;
          const did = `${id}_d${series.name}p${i}`;
          nodes.push({
            id: did,
            component: 'Circle',
            halo: 2,
            props: {
              size: series.kind === 'dots' ? 16 : 12,
              fill: hex,
              position: [X(d.x), Y(d.y)],
            },
          });
          const item = [did];
          if (showValues) item.push(valueLabel(i, d.x, d.y, true));
          seriesNodes.push(...item);
          itemParts[i] = {nodes: item};
          dataIds.push(did);
        });
        parts.set(series.name, {
          nodes: seriesNodes,
          ...(lineId ? {traceable: [lineId]} : {}),
        });
      }
      series.data.forEach((d, i) => {
        const item = itemParts[i];
        if (!item) return;
        parts.set(`${series.name}.${i}`, item);
        if (d.category && /^[A-Za-z0-9]+$/.test(d.category)) {
          parts.set(`${series.name}.${d.category}`, item);
        }
      });
    });
    for (let i = 0; i < dataIds.length; i++) {
      for (let j = i + 1; j < dataIds.length; j++) {
        touches.push({
          a: dataIds[i],
          b: dataIds[j],
          reason: 'bars, lines and data points of one chart meet and cross',
        });
      }
    }
    nodes.push(...overlays);
    if (legend.length > 1) {
      // A key along the top, right to left from the plot's corner.
      const legendIds: string[] = [];
      let cursor = right;
      [...legend].reverse().forEach(entry => {
        const w = textBox(entry.name, 22).width;
        const tid = `${id}_k${entry.name}`;
        const sid = `${id}_ks${entry.name}`;
        nodes.push(
          {
            id: tid,
            component: 'Txt',
            props: {
              text: entry.name,
              fontSize: 22,
              position: [Math.round(cursor - w / 2), top - 16],
            },
          },
          {
            id: sid,
            component: 'Rect',
            halo: 2,
            props: {
              size: [18, 18],
              radius: 4,
              fill: hexColor(entry.color, ICON_HEX.blue),
              position: [Math.round(cursor - w - 16), top - 16],
            },
          },
        );
        legendIds.push(tid, sid);
        cursor -= w + 44;
      });
      parts.set('legend', {nodes: legendIds});
    }

    const measures: SceneNode[] = [];
    // Shaded areas, under the curves.
    areas.forEach((area, index) => {
      const f = functions.find(fn => fn.name === area.under)!;
      const a = Math.max(area.from, x[0]);
      const b = Math.min(area.to, x[1]);
      if (area.rects) {
        // Rectangles, lighter to darker along the run, each rising from the
        // axis when traced.
        const hex = hexColor(area.color, ICON_HEX.green);
        const width = (b - a) / area.rects;
        const rectIds: string[] = [];
        const grow: {node: string; from: Record<string, Value>}[] = [];
        for (let i = 0; i < area.rects; i++) {
          const x0 = a + width * i;
          const sample =
            area.rule === 'left'
              ? x0
              : area.rule === 'right'
                ? x0 + width
                : x0 + width / 2;
          const raw = f.expr.evaluate(sample);
          const height = Math.max(
            y![0],
            Math.min(y![1], Number.isFinite(raw) ? raw : axisY),
          );
          const rid = `${id}_ar${index}r${i}`;
          const corners: [number, number][] = [
            [X(x0), Y(axisY)],
            [X(x0 + width), Y(axisY)],
            [X(x0 + width), Y(height)],
            [X(x0), Y(height)],
          ];
          const shade = 0.72 - (0.45 * i) / Math.max(1, area.rects - 1);
          nodes.push({
            id: rid,
            component: 'Line',
            halo: 0,
            props: {
              points: corners,
              closed: true,
              fill: chroma.mix(hex, '#FFFFFF', shade, 'rgb').hex(),
              stroke: chroma.mix(hex, '#FFFFFF', 0.15, 'rgb').hex(),
              lineWidth: 1.5,
            },
          });
          background(rid, 'the rectangles stand on the axis under the curve');
          grow.push({
            node: rid,
            from: {
              points: corners.map(([px]) => [px, Y(axisY)]),
            },
          });
          rectIds.push(rid);
          parts.set(`area${index}.${i}`, {
            nodes: [rid],
            grow: [grow[grow.length - 1]],
          });
          if (area.measure) {
            // A bracket up the left side labelled with the height the bar
            // stands for, f(x_i), and one under the axis labelled \Delta x.
            const left = X(x0);
            const right = X(x0 + width);
            const top = Y(height);
            const base = Y(axisY);
            const below = base + 44;
            const heightTex = `${area.under}(${Math.round(sample * 1000) / 1000})`;
            const mid = `${id}_ar${index}m${i}`;
            const marks: SceneNode[] = [
              {
                id: `${mid}h`,
                component: 'Line',
                halo: 0,
                props: {
                  points: [
                    [left - 6, top],
                    [left - 16, top],
                    [left - 16, base],
                    [left - 6, base],
                  ],
                  stroke: {theme: 'ink'},
                  lineWidth: 2,
                  opacity: 0,
                },
              },
              {
                id: `${mid}hl`,
                component: 'Latex',
                props: {
                  tex: heightTex,
                  fontSize: 26,
                  position: [
                    Math.round(left - 24 - (texWidthEm(heightTex) * 26) / 2),
                    Math.round((top + base) / 2),
                  ],
                  opacity: 0,
                },
              },
              {
                id: `${mid}w`,
                component: 'Line',
                halo: 0,
                props: {
                  points: [
                    [left, below - 8],
                    [left, below],
                    [right, below],
                    [right, below - 8],
                  ],
                  stroke: {theme: 'ink'},
                  lineWidth: 2,
                  opacity: 0,
                },
              },
              {
                id: `${mid}wl`,
                component: 'Latex',
                props: {
                  tex: '\\Delta x',
                  fontSize: 26,
                  position: [Math.round((left + right) / 2), below + 22],
                  opacity: 0,
                },
              },
            ];
            measures.push(...marks);
            for (const mark of marks) {
              touches.push({
                a: mark.id,
                b: '*',
                reason: 'a dimension mark is drawn over the plot it measures',
              });
            }
            parts.set(`area${index}.measure${i}`, {
              nodes: marks.map(m => m.id),
            });
          }
        }
        for (let i = 0; i < rectIds.length; i++) {
          for (let j = i + 1; j < rectIds.length; j++) {
            touches.push({
              a: rectIds[i],
              b: rectIds[j],
              reason: 'neighbouring rectangles share a side',
            });
          }
        }
        parts.set(`area${index}`, {nodes: rectIds, grow});
        return;
      }
      const steps = 80;
      const outline: [number, number][] = [[X(a), Y(axisY)]];
      for (let i = 0; i <= steps; i++) {
        const vx = a + ((b - a) * i) / steps;
        const vy = Math.max(y![0], Math.min(y![1], f.expr.evaluate(vx)));
        outline.push([X(vx), Y(Number.isFinite(vy) ? vy : axisY)]);
      }
      outline.push([X(b), Y(axisY)]);
      const aid = `${id}_ar${index}`;
      nodes.push({
        id: aid,
        component: 'Line',
        halo: 0,
        props: {
          points: outline,
          closed: true,
          fill: 'rgba(47, 102, 208, 0.18)',
          lineWidth: 0,
        },
      });
      background(aid, 'the shaded area lies under the curve');
      parts.set(`area${index}`, {nodes: [aid]});
    });

    // Everything a label must keep clear of, and labels waiting for placement.
    const obstacles: Vec[][] = [
      [
        [left, Y(axisY)],
        [right, Y(axisY)],
      ],
      [
        [X(axisX), bottom],
        [X(axisX), top],
      ],
      ...obstacles0,
    ];
    const taken: Vec[] = [...valueSpots];
    const pendingLabels: {
      id: string;
      tex: string;
      color: Value;
      anchor: [number, number][];
      curves: string[];
    }[] = [];
    const bounds = {
      left: left + 4,
      right: right + 10,
      top: top - 10,
      bottom: bottom - 4,
    };

    // Curves: split wherever they leave the view or blow up.
    const curveIds = new Map<string, string[]>();
    functions.forEach((f, index) => {
      // Colours carry on after the data's, so an average or a trend line
      // stands apart from the bars or dots it describes.
      const color = colorValue(
        f.color,
        ACCENTS[(index + data.series.length) % ACCENTS.length],
      );
      const runs: [number, number][][] = [];
      let run: [number, number][] = [];
      for (const [vx, vy] of samples[index]) {
        if (inY(vy)) run.push([X(vx), Y(vy)]);
        else if (run.length) {
          runs.push(run);
          run = [];
        }
      }
      if (run.length) runs.push(run);
      const ids = runs
        .filter(r => r.length >= 2)
        .map((r, k) => {
          const cid = `${id}_c${f.name}${k}`;
          nodes.push({
            id: cid,
            component: 'Line',
            halo: 2,
            props: {points: r, stroke: color, lineWidth: 4},
          });
          return cid;
        });
      curveIds.set(f.name, ids);
      const partNodes = [...ids];
      obstacles.push(...runs.filter(r => r.length >= 2));
      if (f.label && runs.length) {
        const lastRun = runs[runs.length - 1];
        // Anchor near the end of the curve, a little inside the plot.
        const anchor = [7, 6, 5, 4, 3, 2, 1].map(
          k => lastRun[Math.min(lastRun.length - 1, Math.floor((lastRun.length * k) / 8))],
        );
        const lid = `${id}_cl${f.name}`;
        pendingLabels.push({id: lid, tex: f.label, color, anchor, curves: ids});
        partNodes.push(lid);
      }
      parts.set(f.name, {nodes: partNodes, traceable: ids});
    });
    const allCurves = [...curveIds.values()].flat();
    // A trend line runs through its data; an average crosses the bars.
    for (const did of dataIds) {
      for (const cid of allCurves) {
        touches.push({a: did, b: cid, reason: 'a curve drawn through the data'});
      }
    }
    // A curve may pass over the axis numbers, as on any graph - most of all
    // one whose shape a beat changes.
    const ticks = nodes
      .filter(n => n.id.startsWith(`${id}_tx`) || n.id.startsWith(`${id}_ty`))
      .map(n => n.id);
    for (const tick of ticks) {
      for (const cid of allCurves) {
        touches.push({
          a: tick,
          b: cid,
          reason: 'a curve may cross the axis numbers',
        });
      }
    }
    for (let i = 0; i < allCurves.length; i++) {
      for (let j = i + 1; j < allCurves.length; j++) {
        touches.push({
          a: allCurves[i],
          b: allCurves[j],
          reason: 'curves on one plot meet where they intersect',
        });
      }
    }

    // Tangent lines.
    tangents.forEach((t, index) => {
      const f = functions.find(fn => fn.name === t.of)!;
      const m = derivative(f.expr, t.at);
      const y0 = f.expr.evaluate(t.at);
      const half = (x[1] - x[0]) * 0.22;
      const ends: [number, number][] = [t.at - half, t.at + half].map(vx => {
        const vy = Math.max(y![0], Math.min(y![1], y0 + m * (vx - t.at)));
        // Pull the end back along the line if it was clipped vertically.
        const cx = Math.abs(m) > 1e-9 ? t.at + (vy - y0) / m : vx;
        return [X(cx), Y(vy)];
      });
      const tid = `${id}_tg${index}`;
      nodes.push({
        id: tid,
        component: 'Line',
        halo: 2,
        props: {
          points: ends,
          stroke: {theme: 'secondaryInk'},
          lineWidth: 3,
          lineDash: [12, 8],
        },
      });
      obstacles.push(ends);
      for (const cid of curveIds.get(t.of) ?? []) {
        touches.push({a: tid, b: cid, reason: 'a tangent touches its curve'});
      }
      touches.push({a: tid, b: '*', reason: 'a tangent line crosses the plot'});
      parts.set(`tangent${index}`, {nodes: [tid], traceable: [tid]});
    });

    // Axis names by the arrow tips, on whichever side the curves leave clear
    // (a demand curve meets the x-axis right where its name would go).
    const clearance = (centre: Vec, width: number, height: number) => {
      let least = Infinity;
      const probes: Vec[] = [];
      for (const fx of [-0.5, 0, 0.5]) {
        for (const fy of [-0.5, 0, 0.5]) {
          probes.push([centre[0] + fx * width, centre[1] + fy * height]);
        }
      }
      for (const line of obstacles.slice(2)) {
        for (let i = 1; i < line.length; i++) {
          for (const p of probes) {
            least = Math.min(least, distanceToSegment(p, line[i - 1], line[i]));
          }
        }
      }
      return least;
    };
    const placeAxisLabel = (label: SceneNode, candidates: Vec[]) => {
      const tex = String(label.props!.tex);
      const width = texWidthEm(tex) * 30 + 8;
      const height = 40;
      const inside = candidates.filter(
        c =>
          c[0] - width / 2 >= box.x - box.width / 2 &&
          c[0] + width / 2 <= box.x + box.width / 2,
      );
      const best = (inside.length ? inside : candidates).reduce((a, b) =>
        clearance(a, width, height) >= 14
          ? a
          : clearance(b, width, height) > clearance(a, width, height)
            ? b
            : a,
      );
      (label.props as Record<string, Value>).position = [
        Math.round(best[0]),
        Math.round(best[1]),
      ];
    };
    {
      const xTex = String(xLabel.props!.tex);
      const xw = texWidthEm(xTex) * 30;
      placeAxisLabel(xLabel, [
        [right + 18 + xw / 2 + 8, Y(axisY) - 28],
        [right + 18 + xw / 2 + 8, Y(axisY) + 28],
        [right - xw / 2, Y(axisY) + 62],
        [right - xw / 2, Y(axisY) - 34],
      ]);
      const yTex = String(yLabel.props!.tex);
      const yw = texWidthEm(yTex) * 30;
      placeAxisLabel(yLabel, [
        [X(axisX) + yw / 2 + 20, top - 14],
        [X(axisX) - yw / 2 - 20, top - 14],
        [X(axisX) + yw / 2 + 20, top + 22],
      ]);
    }

    // Curve labels, now that the tangents are known too.
    for (const label of pendingLabels) {
      const width = Math.max(40, texWidthEm(label.tex) * 28);
      const position = placeLabel(
        label.anchor,
        width,
        40,
        obstacles,
        taken,
        bounds,
        filledBars,
      );
      taken.push(position);
      nodes.push({
        id: label.id,
        component: 'Latex',
        props: {tex: label.tex, fontSize: 28, fill: label.color, position},
      });
      for (const cid of label.curves) {
        touches.push({
          a: label.id,
          b: cid,
          reason: 'the label names its curve',
        });
      }
    }

    // Points, on top.
    points.forEach(p => {
      if (!inY(p.y) || p.x < x[0] || p.x > x[1]) return;
      const did = `${id}_p${p.name}`;
      const lid = `${id}_pl${p.name}`;
      nodes.push({
        id: did,
        component: 'Circle',
        fixed: true,
        props: {size: 14, fill: {theme: 'ink'}, position: [X(p.x), Y(p.y)]},
      });
      const position = placeLabel(
        [X(p.x), Y(p.y)],
        Math.max(24, texWidthEm(p.label) * 28),
        36,
        obstacles,
        taken,
        bounds,
        filledBars,
      );
      taken.push(position);
      nodes.push({
        id: lid,
        component: 'Latex',
        props: {tex: p.label, fontSize: 28, position},
      });
      for (const cid of allCurves) {
        touches.push({
          a: did,
          b: cid,
          reason: 'the point is marked on the plot',
        });
      }
      touches.push({a: lid, b: did, reason: 'the label names its point'});
      // Placed clear of the curves; when a beat moves the point along its
      // curve, the label travels with it and may pass over one.
      for (const cid of allCurves) {
        touches.push({
          a: lid,
          b: cid,
          reason: 'a point label moves with its point along the curves',
        });
      }
      parts.set(p.name, {nodes: [did, lid]});
    });
    nodes.push(...measures);
    return {nodes, touches, parts};
  },
};
