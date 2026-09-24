import type {Value} from '../document/model.js';
import {isObject} from '../document/values.js';
import {textBox, texWidthEm} from '../kits/fields.js';
import {ExpressionError} from '../kits/expression.js';
import {parseWithParams, type Params} from '../kits/params.js';
import {arc, curve, smooth, trim, type End} from '../kits/connect.js';
import {texHeightEmExact} from '../tex/terms.js';
import {
  add,
  along,
  centerOf,
  centroid,
  dist,
  distanceToSegment,
  dot,
  emptyBounds,
  foot,
  fromDegrees,
  grow,
  isEmpty,
  len,
  lineParams,
  mul,
  pathLength,
  rotate,
  seeded,
  stageRotation,
  sub,
  unit,
  type Bounds,
  type Vec,
} from './geometry.js';

/**
 * Resolving a diagram: every part placed, in diagram units.
 *
 * @remarks
 * A part says what it is and where it is *in relation to other parts* - on
 * the slope, below cell 3, around the nucleus, the component of W down the
 * slope, where two rays meet. Parts are resolved on demand, each one
 * resolving what it refers to first, so they can be written in any order;
 * a loop of references is an error. Sizes set by text (a cell fitted to
 * its number, a dot, a label) are in pixels, so resolving takes the scale
 * (pixels per unit) the drawing will be fitted at.
 */

/** A part as written. */
export type RawPart = Readonly<Record<string, Value>>;

/** The one key saying what a part is. */
export const SHAPE_KEYS = [
  'box',
  'circle',
  'ring',
  'ellipse',
  'dot',
  'polygon',
  'line',
  'arrow',
  'ray',
  'icon',
  'row',
  'column',
  'grid',
  'items',
  'text',
  'tex',
] as const;
export type ShapeKey = (typeof SHAPE_KEYS)[number] | 'use';

export const PLACE_KEYS = [
  'at',
  'on',
  't',
  'angle',
  'side',
  'above',
  'below',
  'left',
  'right',
  'inside',
  'gap',
  'offset',
  'turn',
];
export const GROUP_KEYS = ['arrange', 'cols', 'radius', 'index', 'shape'];
export const STYLE_KEYS = [
  'color',
  'outline',
  'dashed',
  'width',
  'size',
  'fontSize',
  'label',
  'back',
  'use',
  'with',
  'scale',
];
/** An arrow's own keys, also accepted written on the part itself. */
export const VECTOR_KEYS = ['from', 'to', 'dir', 'length', 'component'];
/** How a line or arrow runs: bowed, smoothed through its points. */
export const PATH_KEYS = ['bend', 'smooth'];
export const PART_KEYS = [
  ...SHAPE_KEYS,
  ...VECTOR_KEYS,
  ...PATH_KEYS,
  ...PLACE_KEYS,
  ...GROUP_KEYS,
  ...STYLE_KEYS,
];
const ITEM_KEYS = ['text', 'tex', 'color', 'label', 'outline'];

export const ANCHORS = [
  'center',
  'top',
  'bottom',
  'left',
  'right',
  'topleft',
  'topright',
  'bottomleft',
  'bottomright',
  'start',
  'end',
  'mid',
];
const SIDES = ['above', 'below', 'left', 'right'] as const;
type Side = (typeof SIDES)[number];
const SIDE_DIR: Readonly<Record<Side, Vec>> = {
  above: [0, -1],
  below: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};
const WORD_DIR: Readonly<Record<string, Vec>> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};
const RELATIVE_DIRS = [
  'along',
  'against',
  'up',
  'down',
  'out',
  'into',
  'toward',
  'away',
];

/** Pixel sizes of the things text and marks set. */
export const PX = {
  text: 30,
  tex: 36,
  inside: 30,
  label: 30,
  index: 20,
  dot: 7,
  gap: 18,
  cellPad: 22,
  icon: 72,
  minInside: 14,
} as const;

export type Kind =
  | 'box'
  | 'circle'
  | 'ring'
  | 'ellipse'
  | 'dot'
  | 'polygon'
  | 'line'
  | 'arrow'
  | 'ray'
  | 'text'
  | 'tex'
  | 'icon'
  | 'group'
  | 'point';

/** A placed part (or item), for other parts to refer to. */
export interface Placed {
  readonly kind: Kind;
  center: Vec;
  /** Full width and height of the shape itself (unrotated). */
  w: number;
  h: number;
  /** Stage rotation in degrees. */
  rotation: number;
  /** Line points, or polygon corners, in units. */
  points?: Vec[];
  /** For a ray: its last segment goes on forever. */
  ray?: boolean;
  /** For an arrow drawn as a vector: where it starts and its vector. */
  vector?: {from: Vec; v: Vec};
  items?: Placed[];
  /** A placed template's own parts, by name. */
  children?: ReadonlyMap<string, Placed>;
  /** Everything it covers, index labels included. */
  bounds: Bounds;
}

/** One thing to draw, in units. */
export interface Mark {
  /** Stable identity within the diagram: becomes the node id. */
  readonly key: string;
  readonly kind: Exclude<Kind, 'group' | 'point'>;
  readonly center: Vec;
  readonly w: number;
  readonly h: number;
  readonly rotation: number;
  readonly points?: readonly Vec[];
  readonly arrow?: boolean;
  readonly dashed?: boolean;
  /** A ray's dashed backward extension. */
  readonly back?: boolean;
  readonly backPoints?: readonly Vec[];
  readonly color?: string;
  readonly outline?: boolean;
  readonly width?: number;
  readonly text?: string;
  /** Pixels, already scaled. */
  readonly fontSize?: number;
  /** The part (or "part.slot") this mark belongs to. */
  readonly part: string;
  readonly role: 'shape' | 'content' | 'index';
  /** For content: the shape mark it sits inside. */
  readonly host?: string;
  /** Parts this mark is attached to (an arrow from a block): they may touch. */
  readonly links?: readonly string[];
  /** Whether the text is on a solid fill (drawn in paper colour). */
  readonly onSolid?: boolean;
  /** An arrow standing for a quantity (a force): drawn a little bolder. */
  readonly vector?: boolean;
  /** A shape with words written inside it (drawn tinted, not solid). */
  readonly holdsText?: boolean;
}

/** A label to place around a mark once the drawing is on the stage. */
export interface LabelRequest {
  readonly key: string;
  readonly text: string;
  readonly host: string;
  readonly part: string;
  readonly color?: string;
  readonly fontSize: number;
  /** Where along a line the label prefers to sit. */
  readonly prefer: 'start' | 'end' | 'mid' | 'around';
}

export type Sink = (prop: string, message: string, hint?: string) => void;

/** A drawing defined once and placed many times ("use"). */
export interface Template {
  readonly parts: Readonly<Record<string, RawPart>>;
  readonly params: Params;
}

export interface ResolveInput {
  readonly parts: Readonly<Record<string, RawPart>>;
  readonly templates?: Readonly<Record<string, Template>>;
  /** How many templates deep this drawing is. */
  readonly depth?: number;
  readonly params: Params;
  /** Pixels per unit. */
  readonly scale: number;
  /** Text size factor (below 1 when text alone would overflow). */
  readonly font: number;
  /** Per group part, the identity of the item in each slot. */
  readonly identities?: ReadonlyMap<string, readonly number[]>;
  readonly report?: Sink;
}

export interface Resolved {
  readonly placed: ReadonlyMap<string, Placed>;
  readonly marks: readonly Mark[];
  readonly labels: readonly LabelRequest[];
}

export function shapeKeyOf(part: RawPart): ShapeKey | null {
  const keys = SHAPE_KEYS.filter(k => part[k] !== undefined);
  // A template is the part's shape, unless the part is a set of items -
  // then each item is one.
  if (part.use !== undefined && !keys.some(k => isGroupKey(k))) return 'use';
  const drawn = keys.filter(k => k !== 'text' && k !== 'tex');
  if (drawn.length) return drawn[0];
  return keys[0] ?? null;
}

function isGroupKey(key: ShapeKey | null): boolean {
  return key === 'row' || key === 'column' || key === 'grid' || key === 'items';
}

/** A line of words or of maths: maths goes to LaTeX. */
export function looksLikeTex(text: string): boolean {
  return (
    /[\\^_{}]/.test(text) ||
    /^[A-Za-z](['′]|_?\d)?$/.test(text) ||
    // A few letters with no vowel are a symbol ("mg", "Fn", "kx"), not a word.
    /^[B-DF-HJ-NP-TV-Zb-df-hj-np-tv-z]{2,4}$/.test(text)
  );
}

function arrangeOf(raw: RawPart, key: ShapeKey): string {
  if (typeof raw.arrange === 'string') return raw.arrange;
  if (key === 'row' || key === 'column' || key === 'grid') return key;
  if (raw.on !== undefined) return 'on';
  if (raw.inside !== undefined) return 'scatter';
  return 'row';
}

export function resolveDiagram(input: ResolveInput): Resolved {
  const {parts, params, scale, font} = input;
  const report: Sink = input.report ?? (() => undefined);
  const px = (pixels: number) => pixels / scale;
  const placed = new Map<string, Placed>();
  const resolving = new Set<string>();
  const marks: Mark[] = [];
  const labels: LabelRequest[] = [];
  const names = Object.keys(parts);
  /** Part names that are rays: extended once everything else is placed. */
  const rays: string[] = [];

  // ---- references ---------------------------------------------------------
  const part = (name: string, prop: string): Placed | null => {
    const found = placed.get(name);
    if (found) return found;
    if (!(name in parts)) {
      const close = names.filter(
        n => n.toLowerCase() === name.toLowerCase() || n.startsWith(name),
      );
      report(
        prop,
        `no part "${name}"`,
        close.length
          ? `did you mean "${close[0]}"?`
          : `parts: ${names.join(', ')}`,
      );
      return null;
    }
    if (resolving.has(name)) {
      report(
        prop,
        `"${name}" is placed relative to itself (a loop of references)`,
        'place one of the parts in the loop by coordinates',
      );
      return null;
    }
    resolving.add(name);
    const result = resolvePart(name, parts[name]);
    resolving.delete(name);
    placed.set(name, result);
    return result;
  };

  /** "name", "name.3", "name.top", "name.3.bottom". */
  const target = (
    ref: string,
    prop: string,
  ): {placed: Placed; anchor: string | null; whole: boolean} | null => {
    const segs = ref.split('.');
    let found = part(segs[0], prop);
    if (!found) return null;
    let i = 1;
    if (i < segs.length && /^\d+$/.test(segs[i])) {
      const k = Number(segs[i]);
      if (!found.items || k >= found.items.length) {
        report(
          prop,
          `"${ref}": "${segs[0]}" has no item ${k}`,
          found.items
            ? `its items are 0 to ${found.items.length - 1}`
            : 'only a row, column, grid or items has numbered items',
        );
        return null;
      }
      found = found.items[k];
      i++;
    }
    // Into a placed template: "mol.O", "mols.3.O".
    while (i < segs.length && found.children?.has(segs[i])) {
      found = found.children.get(segs[i])!;
      i++;
      if (i < segs.length && /^\d+$/.test(segs[i]) && found.items) {
        const k = Number(segs[i]);
        if (k < found.items.length) {
          found = found.items[k];
          i++;
        }
      }
    }
    let anchor: string | null = null;
    if (i < segs.length) {
      if (!ANCHORS.includes(segs[i]) || i + 1 < segs.length) {
        report(
          prop,
          `"${ref}": "${segs.slice(i).join('.')}" is not a point of it`,
          `points of a part: ${ANCHORS.join(', ')}`,
        );
        return null;
      }
      anchor = segs[i];
    }
    return {placed: found, anchor, whole: anchor === null};
  };

  const pointOf = (ref: Value | undefined, prop: string): Vec | null => {
    if (typeof ref === 'string') {
      const t = target(ref, prop);
      return t ? anchorOf(t.placed, t.anchor ?? 'center') : null;
    }
    if (Array.isArray(ref) && ref.length === 2) {
      const x = number(ref[0], prop);
      const y = number(ref[1], prop);
      return x === null || y === null ? null : [x, y];
    }
    if (isObject(ref)) return construction(ref, prop);
    report(
      prop,
      `${JSON.stringify(ref)} is not a point`,
      'a point is [x, y], a part name ("F", "box.top", "cells.3"), or {"meet": ["ray1", "ray2"]}',
    );
    return null;
  };

  /** A number, or an expression in params and part coordinates ("T.y"). */
  const number = (value: Value | undefined, prop: string): number | null => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value !== 'string' || !value.trim()) {
      report(prop, `${JSON.stringify(value)} is not a number`);
      return null;
    }
    const refs: Record<string, number> = {};
    let failed = false;
    let n = 0;
    const source = value.replace(
      /\b([A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)*)\.([xy])\b/g,
      (_, ref: string, axis: string) => {
        const p = pointOf(ref, prop);
        if (!p) failed = true;
        const name = `qqref${String.fromCharCode(97 + (n % 26))}${'q'.repeat(Math.floor(n / 26))}`;
        n++;
        refs[name] = p ? (axis === 'x' ? p[0] : p[1]) : 0;
        return name;
      },
    );
    if (failed) return null;
    try {
      const result = parseWithParams(
        source,
        {...params, ...refs},
        [],
      ).evaluateWith({});
      if (Number.isFinite(result)) return result;
      report(prop, `"${value}" is not a finite number`);
    } catch (error) {
      if (!(error instanceof ExpressionError)) throw error;
      report(
        prop,
        `cannot read "${value}": ${error.message}`,
        'numbers, params, and coordinates of parts like "T.y" or "box.top.x"',
      );
    }
    return null;
  };

  /** The straight pieces of a line-like part, a ray's last one unbounded. */
  const segmentsOf = (
    ref: Value | undefined,
    prop: string,
  ): {a: Vec; b: Vec; infinite: boolean}[] | null => {
    if (typeof ref !== 'string') {
      report(prop, 'name a line, arrow, ray, polygon or box part');
      return null;
    }
    const t = target(ref, prop);
    if (!t) return null;
    const p = t.placed;
    const pts = outline(p);
    if (!pts || pts.length < 2) {
      report(prop, `"${ref}" is not a line or an outline`);
      return null;
    }
    const closed = p.kind === 'polygon' || p.kind === 'box';
    const out: {a: Vec; b: Vec; infinite: boolean}[] = [];
    const n = closed ? pts.length : pts.length - 1;
    for (let i = 0; i < n; i++) {
      out.push({
        a: pts[i],
        b: pts[(i + 1) % pts.length],
        infinite: p.ray === true && !closed && i === n - 1,
      });
    }
    return out;
  };

  const construction = (
    spec: Readonly<Record<string, Value>>,
    prop: string,
  ): Vec | null => {
    const keys = Object.keys(spec);
    const kind = keys[0];
    const args = spec[kind];
    if (keys.length !== 1 || !Array.isArray(args) || args.length !== 2) {
      report(
        prop,
        `${JSON.stringify(spec)} is not a construction`,
        'one of {"meet": [lineA, lineB]}, {"mid": [p, q]}, {"foot": [p, line]}, {"mirror": [p, line]}',
      );
      return null;
    }
    if (kind === 'mid') {
      const a = pointOf(args[0], prop);
      const b = pointOf(args[1], prop);
      return a && b ? mul(add(a, b), 0.5) : null;
    }
    if (kind === 'foot' || kind === 'mirror') {
      const p = pointOf(args[0], prop);
      const segs = segmentsOf(args[1], prop);
      if (!p || !segs) return null;
      let best = segs[0];
      for (const s of segs) {
        if (distanceToSegment(p, s.a, s.b) < distanceToSegment(p, best.a, best.b)) {
          best = s;
        }
      }
      const f = foot(p, best.a, best.b);
      return kind === 'foot' ? f : sub(mul(f, 2), p);
    }
    if (kind === 'meet') {
      const a = segmentsOf(args[0], prop);
      const b = segmentsOf(args[1], prop);
      if (!a || !b) return null;
      // Where the drawn lines (rays running on) cross; failing that, where
      // their last pieces cross when both run on backwards too - a virtual
      // image, behind a lens or mirror.
      // Two rays from the same point (an object's tip) meet there too;
      // that shared start is not the meeting a person means.
      const starts = [a[0].a, b[0].a];
      const shared = dist(starts[0], starts[1]) < 1e-6;
      for (const s of a) {
        for (const q of b) {
          const hit = lineParams(s.a, sub(s.b, s.a), q.a, sub(q.b, q.a));
          if (!hit) continue;
          const okT = hit.t >= -1e-9 && (s.infinite || hit.t <= 1 + 1e-9);
          const okU = hit.u >= -1e-9 && (q.infinite || hit.u <= 1 + 1e-9);
          const p = add(s.a, mul(sub(s.b, s.a), hit.t));
          if (shared && dist(p, starts[0]) < 1e-6) continue;
          if (okT && okU) return p;
        }
      }
      const s = a[a.length - 1];
      const q = b[b.length - 1];
      const hit = lineParams(s.a, sub(s.b, s.a), q.a, sub(q.b, q.a));
      if (hit) return add(s.a, mul(sub(s.b, s.a), hit.t));
      report(prop, `${String(args[0])} and ${String(args[1])} never meet (they are parallel)`);
      return null;
    }
    report(
      prop,
      `unknown construction "${kind}"`,
      'meet, mid, foot or mirror',
    );
    return null;
  };

  /** A direction: degrees, a word, or relative to a line ("down slope"). */
  const direction = (
    value: Value | undefined,
    origin: Vec,
    prop: string,
  ): Vec | null => {
    if (typeof value === 'number') return fromDegrees(value);
    if (typeof value !== 'string') {
      report(
        prop,
        'a direction is degrees (0 = right, 90 = up), "up"/"down"/"left"/"right", or "down <line>", "out <surface>" ...',
      );
      return null;
    }
    const words = value.trim().split(/\s+/);
    if (words.length === 1 && words[0] in WORD_DIR) return WORD_DIR[words[0]];
    const [word, ...rest] = words;
    const ref = rest.join(' ');
    if (words.length < 2 || !RELATIVE_DIRS.includes(word)) {
      report(
        prop,
        `cannot read direction "${value}"`,
        `degrees, up/down/left/right, or "<${RELATIVE_DIRS.join('|')}> <part>" e.g. "down slope", "out slope"`,
      );
      return null;
    }
    if (word === 'toward' || word === 'away') {
      const p = pointOf(ref, prop);
      if (!p) return null;
      const d = unit(sub(p, origin));
      return word === 'toward' ? d : mul(d, -1);
    }
    const segs = segmentsOf(ref, prop);
    if (!segs) return null;
    let best = segs[0];
    for (const s of segs) {
      if (
        distanceToSegment(origin, s.a, s.b) <
        distanceToSegment(origin, best.a, best.b) - 1e-9
      ) {
        best = s;
      }
    }
    const d = unit(sub(best.b, best.a));
    switch (word) {
      case 'along':
        return d;
      case 'against':
        return mul(d, -1);
      case 'up':
        return d[1] < 0 || (Math.abs(d[1]) < 1e-9 && d[0] > 0) ? d : mul(d, -1);
      case 'down':
        return d[1] > 0 || (Math.abs(d[1]) < 1e-9 && d[0] < 0) ? d : mul(d, -1);
      default: {
        // Out of the surface, on the side the origin is on (or upwards
        // when the origin is on the line itself).
        const n0: Vec = [-d[1], d[0]];
        const off = sub(origin, foot(origin, best.a, best.b));
        const n =
          len(off) > 1e-6
            ? dot(n0, off) >= 0
              ? n0
              : mul(n0, -1)
            : n0[1] <= 0
              ? n0
              : mul(n0, -1);
        return word === 'out' ? n : mul(n, -1);
      }
    }
  };

  // ---- text ---------------------------------------------------------------
  const textSize = (
    text: string,
    tex: boolean,
    size: number,
  ): {w: number; h: number} => {
    if (tex) {
      const h = (texHeightEmExact(text) ?? 1.1) * size;
      return {w: texWidthEm(text) * size + 4, h: h + 4};
    }
    const box = textBox(text, size);
    return {w: box.width, h: box.height};
  };

  // ---- parts --------------------------------------------------------------
  /** A template's drawing, in its own units about its own middle. */
  const templateDrawing = (
    use: Value | undefined,
    given: Value | undefined,
    prop: string,
  ): {resolved: Resolved; bounds: Bounds} | null => {
    const templates = input.templates ?? {};
    if (typeof use !== 'string' || !(use in templates)) {
      const names = Object.keys(templates);
      report(
        prop,
        `no template ${JSON.stringify(use)}`,
        names.length
          ? `templates: ${names.join(', ')}`
          : 'define it first: "define": {"<name>": {"parts": {...}}}',
      );
      return null;
    }
    if ((input.depth ?? 0) >= 4) {
      report(prop, `template "${use}" is nested too deeply (does it use itself?)`);
      return null;
    }
    const template = templates[use];
    const values: Record<string, number> = {...template.params};
    if (given !== undefined) {
      if (!isObject(given)) report(prop, '"with" is {"param": value, ...}');
      else {
        for (const [k, v] of Object.entries(given)) {
          if (!(k in template.params)) {
            report(prop, `template "${use}" has no param "${k}"`, `its params: ${Object.keys(template.params).join(', ') || 'none'}`);
            continue;
          }
          const n = number(v, prop);
          if (n !== null) values[k] = n;
        }
      }
    }
    const resolved = resolveDiagram({
      parts: template.parts,
      params: values,
      scale,
      font,
      templates,
      depth: (input.depth ?? 0) + 1,
      report: (_, message, hint) => report(prop, `in template "${use}": ${message}`, hint),
    });
    const bounds = marksBounds(resolved.marks);
    return {
      resolved,
      bounds: isEmpty(bounds) ? {minX: -0.5, minY: -0.5, maxX: 0.5, maxY: 0.5} : bounds,
    };
  };

  /** A template drawn with its middle at `center`, turned and scaled. */
  const emitInstance = (
    drawing: {resolved: Resolved; bounds: Bounds},
    center: Vec,
    rotation: number,
    k: number,
    partName: string,
    markKey: string,
  ): Placed => {
    const middle = centerOf(drawing.bounds);
    const to = (p: Vec): Vec => add(center, rotate(mul(sub(p, middle), k), rotation));
    const bounds = emptyBounds();
    for (const m of drawing.resolved.marks) {
      // Words stay upright and at their size; the drawing turns and scales.
      const words = m.kind === 'text' || m.kind === 'tex';
      const moved: Mark = {
        ...m,
        key: `${markKey}${m.key}`,
        center: to(m.center),
        w: words ? m.w : m.w * k,
        h: words ? m.h : m.h * k,
        rotation: words ? m.rotation : m.rotation + rotation,
        ...(m.points ? {points: m.points.map(to)} : {}),
        ...(m.backPoints ? {backPoints: m.backPoints.map(to)} : {}),
        part: `${partName}.${m.part}`,
        ...(m.host ? {host: `${markKey}${m.host}`} : {}),
        ...(m.links ? {links: m.links.map(l => `${partName}.${l}`)} : {}),
      };
      marks.push(moved);
      if (moved.kind === 'circle' || moved.kind === 'ring' || moved.kind === 'dot') {
        grow(bounds, moved.center, moved.w / 2);
      } else for (const c of markCorners(moved)) grow(bounds, c);
    }
    for (const l of drawing.resolved.labels) {
      labels.push({
        ...l,
        key: `${markKey}${l.key}`,
        host: `${markKey}${l.host}`,
        part: `${partName}.${l.part}`,
      });
    }
    const children = new Map<string, Placed>();
    const move = (p: Placed): Placed => {
      const q: Placed = {
        ...p,
        center: to(p.center),
        w: p.w * k,
        h: p.h * k,
        rotation: p.rotation + rotation,
        ...(p.points ? {points: p.points.map(to)} : {}),
        ...(p.vector
          ? {vector: {from: to(p.vector.from), v: rotate(mul(p.vector.v, k), rotation)}}
          : {}),
        ...(p.items ? {items: p.items.map(move)} : {}),
        ...(p.children
          ? {children: new Map([...p.children].map(([n, c]) => [n, move(c)]))}
          : {}),
        bounds: emptyBounds(),
      };
      const corners = [
        [p.bounds.minX, p.bounds.minY],
        [p.bounds.maxX, p.bounds.minY],
        [p.bounds.maxX, p.bounds.maxY],
        [p.bounds.minX, p.bounds.maxY],
      ] as Vec[];
      for (const c of corners) grow(q.bounds, to(c));
      return q;
    };
    for (const [n, p] of drawing.resolved.placed) children.set(n, move(p));
    return {
      kind: 'group',
      center,
      w: (drawing.bounds.maxX - drawing.bounds.minX) * k,
      h: (drawing.bounds.maxY - drawing.bounds.minY) * k,
      rotation,
      children,
      bounds: isEmpty(bounds) ? pointBounds(center) : bounds,
    };
  };

  const resolvePart = (name: string, raw: RawPart): Placed => {
    const where = (key: string) => `parts.${name}.${key}`;
    const key = shapeKeyOf(raw);
    if (key === null) {
      // No shape: an invisible point others can refer to.
      return pointPlaced(placeSolid(raw, 'point', 0, 0, where).center);
    }
    if (isGroupKey(key)) return resolveGroup(name, raw, key);
    if (key === 'use') {
      const drawing = templateDrawing(raw.use, raw.with, where('use'));
      if (!drawing) return pointPlaced([0, 0]);
      const k =
        raw.scale === undefined ? 1 : (number(raw.scale, where('scale')) ?? 1);
      const w = (drawing.bounds.maxX - drawing.bounds.minX) * k;
      const h = (drawing.bounds.maxY - drawing.bounds.minY) * k;
      const at = placeSolid(raw, 'group', w, h, where);
      const instance = emitInstance(drawing, at.center, at.rotation, k, name, name);
      if (typeof raw.label === 'string' || typeof raw.label === 'number') {
        labels.push({
          key: `${name}L`,
          text: String(raw.label),
          host: name,
          part: name,
          fontSize: PX.label * font,
          prefer: 'around',
        });
      }
      return instance;
    }
    if (key === 'line' || key === 'arrow' || key === 'ray') {
      return resolveLine(name, raw, key);
    }
    return resolveSolid(name, raw, key, name, name);
  };

  const pointPlaced = (c: Vec): Placed => ({
    kind: 'point',
    center: c,
    w: 0,
    h: 0,
    rotation: 0,
    bounds: {minX: c[0], minY: c[1], maxX: c[0], maxY: c[1]},
  });

  const offsetOf = (raw: RawPart, where: (k: string) => string): Vec => {
    if (raw.offset === undefined) return [0, 0];
    return pointOf(raw.offset, where('offset')) ?? [0, 0];
  };

  const insideText = (
    raw: RawPart,
  ): {text: string; tex: boolean} | null => {
    if (typeof raw.tex === 'string' && raw.tex.trim()) return {text: raw.tex, tex: true};
    if (typeof raw.text === 'string' && raw.text.trim()) return {text: raw.text, tex: false};
    if (typeof raw.text === 'number') return {text: String(raw.text), tex: false};
    return null;
  };

  /** Size of a solid shape: from its key's value, else fitted to its text. */
  const solidSize = (
    key: ShapeKey,
    raw: RawPart,
    content: {text: string; tex: boolean} | null,
    where: (k: string) => string,
  ): {kind: Kind; w: number; h: number; corners?: Vec[]} => {
    const fontPx = (typeof raw.fontSize === 'number' ? raw.fontSize : PX.inside) * font;
    const fitted = content
      ? textSize(content.text, content.tex, fontPx)
      : {w: px(60), h: px(40)};
    const value = raw[key];
    switch (key) {
      case 'box': {
        if (Array.isArray(value) && value.length === 2) {
          const w = number(value[0], where('box'));
          const h = number(value[1], where('box'));
          if (w !== null && h !== null) return {kind: 'box', w, h};
        } else if (typeof value === 'number' || typeof value === 'string') {
          const s = number(value, where('box'));
          if (s !== null) return {kind: 'box', w: s, h: s};
        } else if (value !== true) {
          report(where('box'), 'box is [width, height], a size, or true (fits its text)');
        }
        const w = px(fitted.w + PX.cellPad * 2);
        const h = px(fitted.h + PX.cellPad);
        return {kind: 'box', w: Math.max(w, h), h};
      }
      case 'circle':
      case 'ring': {
        if (value !== true) {
          const r = number(value, where(key));
          if (r !== null) return {kind: key, w: 2 * r, h: 2 * r};
        }
        const d = px(Math.max(fitted.w, fitted.h) + PX.cellPad);
        return {kind: key, w: d, h: d};
      }
      case 'ellipse': {
        if (Array.isArray(value) && value.length === 2) {
          const w = number(value[0], where('ellipse'));
          const h = number(value[1], where('ellipse'));
          if (w !== null && h !== null) return {kind: 'ellipse', w, h};
        }
        report(where('ellipse'), 'ellipse is [width, height]');
        return {kind: 'ellipse', w: 1, h: 1};
      }
      case 'dot':
        return {kind: 'dot', w: px(PX.dot * 2), h: px(PX.dot * 2)};
      case 'polygon': {
        if (typeof value === 'number') {
          const n = Math.round(value);
          const r =
            raw.size === undefined ? 1 : (number(raw.size, where('size')) ?? 1);
          if (n < 3 || n > 12) report(where('polygon'), 'a regular polygon has 3 to 12 sides');
          const corners: Vec[] = [];
          const count = Math.max(3, Math.min(12, n));
          for (let i = 0; i < count; i++) {
            corners.push(
              mul(fromDegrees(90 + (360 * i) / count), r),
            );
          }
          return {kind: 'polygon', w: 2 * r, h: 2 * r, corners};
        }
        return {kind: 'polygon', w: 0, h: 0};
      }
      case 'icon': {
        const s =
          raw.size === undefined ? px(PX.icon) : (number(raw.size, where('size')) ?? px(PX.icon));
        return {kind: 'icon', w: s, h: s};
      }
      case 'text':
      case 'tex': {
        const size =
          (typeof raw.fontSize === 'number'
            ? raw.fontSize
            : key === 'tex'
              ? PX.tex
              : PX.text) * font;
        const text = String(value);
        const box = textSize(text, key === 'tex', size);
        return {kind: key, w: px(box.w), h: px(box.h)};
      }
      default:
        return {kind: 'box', w: 1, h: 1};
    }
  };

  /** Where a solid part's centre goes, and its turn, from its relations. */
  const placeSolid = (
    raw: RawPart,
    kind: Kind,
    w: number,
    h: number,
    where: (k: string) => string,
  ): {center: Vec; rotation: number} => {
    let center: Vec = [0, 0];
    let rotation = 0;
    const gap =
      raw.gap === undefined ? px(PX.gap) : (number(raw.gap, where('gap')) ?? px(PX.gap));
    if (raw.at !== undefined) {
      center = pointOf(raw.at, where('at')) ?? center;
    } else if (raw.on !== undefined) {
      const rest = restOn(raw, kind, w, h, where);
      if (rest) ({center, rotation} = rest);
    } else if (raw.inside !== undefined) {
      const t = typeof raw.inside === 'string' ? target(raw.inside, where('inside')) : null;
      if (typeof raw.inside !== 'string') report(where('inside'), 'inside names a part');
      if (t) center = anchorOf(t.placed, 'center');
    } else {
      for (const side of SIDES) {
        if (raw[side] === undefined) continue;
        const ref = raw[side];
        if (typeof ref !== 'string') {
          report(where(side), `${side} names a part, e.g. "${side}": "cells.3"`);
          break;
        }
        const t = target(ref, where(side));
        if (!t) break;
        const b = t.anchor
          ? pointBounds(anchorOf(t.placed, t.anchor))
          : t.placed.bounds;
        const c = centerOf(b);
        const d = SIDE_DIR[side];
        center = [
          d[0] === 0 ? c[0] : d[0] < 0 ? b.minX - gap - w / 2 : b.maxX + gap + w / 2,
          d[1] === 0 ? c[1] : d[1] < 0 ? b.minY - gap - h / 2 : b.maxY + gap + h / 2,
        ];
        break;
      }
    }
    if (raw.turn !== undefined) {
      const turn = number(raw.turn, where('turn'));
      if (turn !== null) rotation -= turn;
    }
    return {center: add(center, offsetOf(raw, where)), rotation};
  };

  /** A part resting on a line or outline, or riding on a ring. */
  const restOn = (
    raw: RawPart,
    kind: Kind,
    w: number,
    h: number,
    where: (k: string) => string,
  ): {center: Vec; rotation: number} | null => {
    if (typeof raw.on !== 'string') {
      report(where('on'), 'on names a part: a line, ring, polygon or box');
      return null;
    }
    const t = target(raw.on, where('on'));
    if (!t) return null;
    const host = t.placed;
    if (host.kind === 'ring' || host.kind === 'circle' || host.kind === 'ellipse') {
      const angle =
        raw.angle === undefined ? 90 : (number(raw.angle, where('angle')) ?? 90);
      return {center: onCurve(host, angle), rotation: 0};
    }
    const edge = restingEdge(host);
    if (!edge) return {center: host.center, rotation: 0};
    const at =
      raw.t === undefined ? 0.5 : (number(raw.t, where('t')) ?? 0.5);
    const {point, tangent} = along(edge, at);
    let d = tangent;
    if (d[0] < -1e-9) d = mul(d, -1);
    let n: Vec = [d[1], -d[0]];
    if (n[1] > 0) n = mul(n, -1);
    if (raw.side === 'below') n = mul(n, -1);
    const half =
      kind === 'dot' || kind === 'point'
        ? 0
        : kind === 'circle' || kind === 'ring'
          ? w / 2
          : h / 2;
    return {center: add(point, mul(n, half)), rotation: stageRotation(d)};
  };

  const resolveSolid = (
    name: string,
    raw: RawPart,
    key: ShapeKey,
    partName: string,
    markKey: string,
  ): Placed => {
    const where = (k: string) => `parts.${name}.${k}`;
    const content = key === 'text' || key === 'tex' ? null : insideText(raw);
    const size = solidSize(key, raw, content, where);
    let placedAt: {center: Vec; rotation: number};
    let corners = size.corners;
    if (key === 'polygon' && Array.isArray(raw.polygon)) {
      // Corners given: the polygon is where they are.
      const pts: Vec[] = [];
      for (const [i, c] of (raw.polygon as Value[]).entries()) {
        const p = pointOf(c, `${where('polygon')}.${i}`);
        if (p) pts.push(p);
      }
      if (pts.length < 3) report(where('polygon'), 'a polygon needs at least three corners');
      const c = pts.length ? centroid(pts) : ([0, 0] as Vec);
      corners = pts.map(p => sub(p, c));
      const b = emptyBounds();
      pts.forEach(p => grow(b, p));
      placedAt = {center: add(c, offsetOf(raw, where)), rotation: 0};
      size.w = b.maxX - b.minX;
      size.h = b.maxY - b.minY;
    } else {
      placedAt = placeSolid(raw, size.kind, size.w, size.h, where);
    }
    const result: Placed = {
      kind: size.kind,
      center: placedAt.center,
      w: size.w,
      h: size.h,
      rotation: placedAt.rotation,
      ...(corners
        ? {points: corners.map(c => add(placedAt.center, rotate(c, placedAt.rotation)))}
        : {}),
      bounds: emptyBounds(),
    };
    result.bounds = boundsOf(result);
    const links = ['at', 'on', 'inside']
      .map(k => raw[k])
      .filter((v): v is string => typeof v === 'string')
      .map(ref => ref.split('.').filter(seg => !ANCHORS.includes(seg)).join('.'));
    emitSolid(result, raw, content, partName, markKey, false, links);
    return result;
  };

  const emitSolid = (
    p: Placed,
    raw: Readonly<Record<string, Value>>,
    content: {text: string; tex: boolean} | null,
    partName: string,
    markKey: string,
    item: boolean,
    links: readonly string[] = [],
  ) => {
    const color = typeof raw.color === 'string' ? raw.color : undefined;
    const kind = p.kind as Mark['kind'];
    const solidFill = false;
    marks.push({
      key: markKey,
      kind,
      center: p.center,
      w: p.w,
      h: p.h,
      rotation: p.rotation,
      ...(p.points && kind === 'polygon'
        ? {points: p.points}
        : {}),
      ...(color ? {color} : {}),
      ...(raw.outline === true ? {outline: true} : {}),
      ...(raw.dashed === true ? {dashed: true} : {}),
      ...(typeof raw.width === 'number' ? {width: raw.width} : {}),
      ...(kind === 'text' || kind === 'tex'
        ? {
            text: String(raw[kind]),
            fontSize:
              (typeof raw.fontSize === 'number'
                ? raw.fontSize
                : kind === 'tex'
                  ? PX.tex
                  : PX.text) * font,
          }
        : {}),
      ...(kind === 'icon' ? {text: String(raw.icon)} : {}),
      part: partName,
      role: 'shape',
      ...(links.length ? {links} : {}),
      ...(content ? {holdsText: true} : {}),
    });
    if (content) {
      const base = (typeof raw.fontSize === 'number' ? raw.fontSize : PX.inside) * font;
      // Text fits inside its shape: shrunk to the shape when it is too big.
      const natural = textSize(content.text, content.tex, base);
      const roomW = (p.w * scale * (kind === 'circle' || kind === 'ring' ? 0.72 : 0.86));
      const roomH = p.h * scale * 0.72;
      const k = Math.min(1, roomW / natural.w, roomH / natural.h);
      marks.push({
        key: `${markKey}T`,
        kind: content.tex ? 'tex' : 'text',
        center: p.center,
        w: (natural.w * k) / scale,
        h: (natural.h * k) / scale,
        rotation: p.rotation,
        text: content.text,
        fontSize: Math.max(PX.minInside, Math.round(base * k)),
        part: partName,
        role: 'content',
        host: markKey,
        ...(solidFill ? {onSolid: true} : {}),
      });
    }
    if (typeof raw.label === 'string' || typeof raw.label === 'number') {
      labels.push({
        key: `${markKey}L`,
        text: String(raw.label),
        host: markKey,
        part: partName,
        fontSize: (item ? PX.label * 0.85 : PX.label) * font,
        ...(color && (kind === 'dot' || kind === 'text') ? {color} : {}),
        prefer: 'around',
      });
    }
  };

  const resolveLine = (
    name: string,
    raw: RawPart,
    key: 'line' | 'arrow' | 'ray',
  ): Placed => {
    const where = (k: string) => `parts.${name}.${k}`;
    const flat = VECTOR_KEYS.filter(k => raw[k] !== undefined);
    const value: Value | undefined =
      flat.length && !Array.isArray(raw[key]) && !isObject(raw[key])
        ? Object.fromEntries(flat.map(k => [k, raw[k] as Value]))
        : raw[key];
    let points: Vec[] = [];
    let vector: {from: Vec; v: Vec} | undefined;
    let pointer = false;
    const links: string[] = [];
    const clipTo = (ref: Value, toward: Vec): Vec | null => {
      if (typeof ref !== 'string') return null;
      const t = target(ref, where(key));
      if (!t || t.anchor || t.placed.kind === 'point' || t.placed.kind === 'dot') {
        return null;
      }
      // Stop just short of the edge, so a head never presses into it.
      const edge = boundaryToward(t.placed, toward);
      const back = sub(toward, edge);
      return len(back) > px(12) ? add(edge, mul(unit(back), px(6))) : edge;
    };
    /** A part a path joins, as the shape it must stop short of. */
    const endOf = (ref: Value): End | null => {
      if (typeof ref !== 'string') return null;
      const t = target(ref, where(key));
      if (!t || t.anchor) return null;
      const p = t.placed;
      if (p.kind === 'point') return null;
      if (p.kind === 'circle' || p.kind === 'ring' || p.kind === 'dot') {
        return {kind: 'circle', c: p.center, r: p.w / 2};
      }
      const b = p.bounds;
      return {
        kind: 'box',
        c: centerOf(b),
        w: b.maxX - b.minX,
        h: b.maxY - b.minY,
      };
    };
    const linkOf = (ref: Value | undefined) => {
      if (typeof ref === 'string') links.push(ref.split('.').slice(0, 2).filter(s => !ANCHORS.includes(s)).join('.'));
    };
    if (Array.isArray(value)) {
      value.forEach((ref, i) => {
        const p = pointOf(ref, `${where(key)}.${i}`);
        if (p) points.push(p);
      });
      if (points.length < 2) {
        report(where(key), `a ${key} needs at least two points`);
        points = points.length ? [points[0], add(points[0], [1, 0])] : [[0, 0], [1, 0]];
      } else if (key !== 'ray') {
        const bend =
          raw.bend === undefined ? 0 : (number(raw.bend, where('bend')) ?? 0);
        const smoothed = raw.smooth === true;
        if (raw.smooth !== undefined && typeof raw.smooth !== 'boolean') {
          report(where('smooth'), 'smooth is true or false');
        }
        if (bend || (smoothed && points.length > 2)) {
          // A bowed or smoothed path, cut where it leaves and reaches the
          // parts it joins (a gap short of each).
          const pxLength = pathLength(points) * scale;
          const path =
            smoothed && points.length > 2
              ? smooth(
                  points,
                  Math.max(8, Math.ceil(pxLength / (points.length - 1) / 5)),
                )
              : curve(
                  points[0],
                  points[points.length - 1],
                  bend,
                  Math.max(16, Math.ceil((pxLength * (1 + Math.abs(bend))) / 5)),
                );
          points = trim(
            path,
            endOf(value[0]),
            endOf(value[value.length - 1]),
            px(8),
          );
        } else {
          // A connector between two parts runs edge to edge.
          const first = clipTo(value[0], points[1]);
          const last = clipTo(value[value.length - 1], points[points.length - 2]);
          if (first) points[0] = first;
          if (last) points[points.length - 1] = last;
        }
        linkOf(value[0]);
        linkOf(value[value.length - 1]);
      }
    } else if (typeof value === 'string' || isObject(value)) {
      if (key === 'ray') {
        report(where('ray'), 'a ray is a list of points it passes through, e.g. ["T", "lens", "F"]');
      }
      const spec: Readonly<Record<string, Value>> =
        typeof value === 'string' ? {to: value} : value;
      const extra = Object.keys(spec).filter(
        k =>
          !['from', 'to', 'dir', 'length', 'component', 'along', 'radius'].includes(k),
      );
      if (extra.length) {
        report(
          where(key),
          `unknown key(s) ${extra.join(', ')}`,
          'an arrow is {"from", "dir", "length"} (a vector), {"from", "to"}, {"to": part, "from": "below"} (a pointer) or {"from", "component": vector, "dir"}',
        );
      }
      if (spec.along !== undefined) {
        // Round a ring or circle, from one angle to another (degrees, 0 =
        // right, 90 = up): counter-clockwise when "to" is larger.
        const t = typeof spec.along === 'string' ? target(spec.along, where(key)) : null;
        if (typeof spec.along !== 'string') report(where(key), '"along" names a ring or circle part');
        const a0 = number(spec.from ?? 0, where(key));
        const a1 = number(spec.to ?? 90, where(key));
        if (t && a0 !== null && a1 !== null) {
          const host = t.placed;
          if (!['ring', 'circle', 'ellipse', 'dot'].includes(host.kind)) {
            report(where(key), `"${String(spec.along)}" is not a ring or circle`);
          }
          // On a ring; just outside anything filled.
          const r =
            spec.radius !== undefined
              ? (number(spec.radius, where('radius')) ?? host.w / 2)
              : host.kind === 'ring'
                ? host.w / 2
                : host.w / 2 + px(18);
          const toRad = (deg: number) => (-deg * Math.PI) / 180;
          points = arc(host.center, r, toRad(a0), toRad(a1), a1 < a0, scale);
          linkOf(spec.along);
        }
      } else {
      const sideFrom =
        typeof spec.from === 'string' && (SIDES as readonly string[]).includes(spec.from)
          ? (spec.from as Side)
          : null;
      if (spec.to !== undefined && (sideFrom || spec.from === undefined)) {
        // A pointer at a part, from one side.
        const t = typeof spec.to === 'string' ? target(spec.to, where(key)) : null;
        if (typeof spec.to !== 'string') report(where(key), '"to" names a part');
        if (t) {
          const side = sideFrom ?? 'below';
          const d = SIDE_DIR[side];
          const b = t.anchor ? pointBounds(anchorOf(t.placed, t.anchor)) : t.placed.bounds;
          const c = centerOf(b);
          const edge: Vec = [
            d[0] === 0 ? c[0] : d[0] < 0 ? b.minX : b.maxX,
            d[1] === 0 ? c[1] : d[1] < 0 ? b.minY : b.maxY,
          ];
          const size = Math.max(t.placed.h, t.placed.w * 0.5, px(40));
          const length =
            spec.length === undefined
              ? Math.max(size * 0.7, px(56))
              : (number(spec.length, where('length')) ?? size);
          const end = add(edge, mul(d, px(8)));
          points = [add(end, mul(d, length)), end];
          pointer = true;
        }
      } else {
        const from = spec.from === undefined ? null : pointOf(spec.from, where(key));
        linkOf(spec.from);
        const origin = from ?? [0, 0];
        if (spec.to !== undefined) {
          const to = pointOf(spec.to, where(key));
          if (to) {
            points = [origin, to];
            const first = clipTo(spec.from as Value, to);
            const last = clipTo(spec.to, origin);
            if (first) points[0] = first;
            if (last) points[1] = last;
            linkOf(spec.to);
          }
        } else {
          let d = spec.dir === undefined ? null : direction(spec.dir, origin, where('dir'));
          let length =
            spec.length === undefined ? null : number(spec.length, where('length'));
          if (spec.component !== undefined) {
            const of = typeof spec.component === 'string' ? part(spec.component, where('component')) : null;
            if (typeof spec.component !== 'string') report(where('component'), '"component" names an arrow part (a vector)');
            if (of && !of.vector) {
              report(where('component'), `"${String(spec.component)}" is not a vector (give it "from", "dir" and "length")`);
            }
            if (of?.vector) {
              if (!d) {
                report(where('dir'), 'a component needs "dir": the direction to take it along, e.g. "down slope"');
              } else {
                const k = dot(of.vector.v, d);
                length = Math.abs(k);
                if (k < 0) d = mul(d, -1);
              }
            }
          }
          if (!d) {
            if (spec.component === undefined) report(where('dir'), 'a vector needs "dir" (or "to")');
            d = [1, 0];
          }
          if (length === null) length = 1;
          vector = {from: origin, v: mul(d, length)};
          // From a shape with words in it, the arrow leaves from its edge so
          // it does not cross them.
          let start = origin;
          const fromName = typeof spec.from === 'string' ? spec.from.split('.') : [];
          const fromPart = fromName.length === 1 ? parts[fromName[0]] : undefined;
          if (fromPart && (fromPart.text !== undefined || fromPart.tex !== undefined)) {
            const host = placed.get(fromName[0]);
            if (host && host.kind !== 'text' && host.kind !== 'tex') {
              start = boundaryToward(host, add(origin, d));
            }
          }
          points = [start, add(start, mul(d, length))];
        }
      }
      }
    } else {
      report(where(key), `${key} is a list of points, or an object ({"from", "dir", "length"} ...)`);
      points = [[0, 0], [1, 0]];
    }
    const shift = offsetOf(raw, where);
    points = points.map(p => add(p, shift));
    if (vector) vector = {from: add(vector.from, shift), v: vector.v};
    const result: Placed = {
      kind: key,
      center: along(points, 0.5).point,
      w: 0,
      h: 0,
      rotation: 0,
      points,
      ...(key === 'ray' ? {ray: true} : {}),
      ...(vector ? {vector} : {}),
      bounds: emptyBounds(),
    };
    points.forEach(p => grow(result.bounds, p));
    const color = typeof raw.color === 'string' ? raw.color : undefined;
    marks.push({
      key: name,
      kind: key,
      center: result.center,
      w: 0,
      h: 0,
      rotation: 0,
      points,
      ...(key === 'arrow' ? {arrow: true} : {}),
      ...(vector ? {vector: true} : {}),
      ...(raw.dashed === true ? {dashed: true} : {}),
      ...(key === 'ray' && raw.back === true ? {back: true} : {}),
      ...(color ? {color} : {}),
      ...(typeof raw.width === 'number' ? {width: raw.width} : {}),
      part: name,
      role: 'shape',
      ...(links.length ? {links} : {}),
    });
    if (key === 'ray') rays.push(name);
    if (typeof raw.label === 'string' || typeof raw.label === 'number') {
      labels.push({
        key: `${name}L`,
        text: String(raw.label),
        host: name,
        part: name,
        fontSize: PX.label * font,
        ...(color ? {color} : {}),
        prefer: pointer ? 'start' : key === 'arrow' ? 'end' : 'mid',
      });
    }
    return result;
  };

  // ---- groups -------------------------------------------------------------
  const resolveGroup = (name: string, raw: RawPart, key: ShapeKey): Placed => {
    const where = (k: string) => `parts.${name}.${k}`;
    type Item = Readonly<Record<string, Value>>;
    const items: Item[] = [];
    let rowsOf: number | null = null;
    const toItem = (v: Value, prop: string): Item => {
      if (typeof v === 'number') return {text: String(v)};
      if (typeof v === 'string') return v === '' ? {} : {text: v};
      if (v === null) return {};
      if (isObject(v)) {
        const extra = Object.keys(v).filter(k => !ITEM_KEYS.includes(k));
        if (extra.length) {
          report(prop, `unknown item key(s) ${extra.join(', ')}`, `an item is a value or {${ITEM_KEYS.join(', ')}}`);
        }
        return v;
      }
      report(prop, 'an item is a number, a word, or {"text", "color", "label"}');
      return {};
    };
    const value = raw[key];
    if (key === 'grid') {
      if (!Array.isArray(value) || !value.every(Array.isArray)) {
        report(where('grid'), 'grid is a list of rows, e.g. [[1, 2], [3, 4]]');
      } else {
        rowsOf = (value[0] as Value[]).length;
        (value as Value[][]).forEach((row, r) => {
          if (row.length !== rowsOf) report(where('grid'), `row ${r} has ${row.length} cells, the first has ${rowsOf}`);
          row.forEach((v, c) => items.push(toItem(v, `${where('grid')}.${r}.${c}`)));
        });
      }
    } else if (typeof value === 'number' && key === 'items') {
      const n = Math.round(value);
      if (n < 1 || n > 200) report(where('items'), 'items is a count from 1 to 200, or a list');
      for (let i = 0; i < Math.max(0, Math.min(200, n)); i++) items.push({});
    } else if (Array.isArray(value)) {
      value.forEach((v, i) => items.push(toItem(v, `${where(key)}.${i}`)));
    } else {
      report(where(key), `${key} is a list of items${key === 'items' ? ' or a count' : ''}`);
    }

    // What each item is: a template, or a simple shape.
    const drawing =
      raw.use !== undefined ? templateDrawing(raw.use, raw.with, where('use')) : null;
    const scaleBy =
      raw.scale === undefined ? 1 : (number(raw.scale, where('scale')) ?? 1);
    const shapeWord =
      typeof raw.shape === 'string'
        ? raw.shape
        : key === 'items'
          ? 'dot'
          : 'box';
    const SHAPES = ['box', 'circle', 'ring', 'dot', 'none'];
    if (!SHAPES.includes(shapeWord)) {
      report(where('shape'), `item shape "${shapeWord}" is not one of ${SHAPES.join(', ')}`);
    }
    const kind: Kind =
      shapeWord === 'none' ? 'text' : (SHAPES.includes(shapeWord) ? shapeWord : 'box') as Kind;
    const fontPx = (typeof raw.fontSize === 'number' ? raw.fontSize : PX.inside) * font;
    const contents = items.map(item =>
      typeof item.tex === 'string' && item.tex.trim()
        ? {text: item.tex, tex: true}
        : typeof item.text === 'string' && item.text.trim()
          ? {text: item.text, tex: false}
          : null,
    );
    let natural = {w: 0, h: 0};
    for (const c of contents) {
      if (!c) continue;
      const s = textSize(c.text, c.tex, fontPx);
      natural = {w: Math.max(natural.w, s.w), h: Math.max(natural.h, s.h)};
    }
    let w: number;
    let h: number;
    const sizeValue = raw.size;
    if (sizeValue !== undefined) {
      if (Array.isArray(sizeValue) && sizeValue.length === 2) {
        w = number(sizeValue[0], where('size')) ?? 1;
        h = number(sizeValue[1], where('size')) ?? 1;
      } else {
        w = number(sizeValue, where('size')) ?? 1;
        h = w;
        if (kind === 'circle' || kind === 'ring') {
          w *= 2;
          h *= 2;
        }
      }
    } else if (drawing) {
      w = (drawing.bounds.maxX - drawing.bounds.minX) * scaleBy;
      h = (drawing.bounds.maxY - drawing.bounds.minY) * scaleBy;
    } else if (kind === 'dot') {
      w = px(PX.dot * 2);
      h = w;
    } else if (kind === 'text') {
      w = px(natural.w || 30);
      h = px(natural.h || 30);
    } else if (kind === 'circle' || kind === 'ring') {
      const d = px(Math.max(natural.w, natural.h, 30) + PX.cellPad * 0.8);
      w = d;
      h = d;
    } else {
      h = px(Math.max(natural.h, 30) + PX.cellPad);
      w = Math.max(px(natural.w + PX.cellPad * 1.4), h);
    }
    const indexFrom =
      raw.index === true ? 0 : typeof raw.index === 'number' ? raw.index : null;
    // Index numbers sit under their cells, clear of them.
    const indexH = indexFrom === null ? 0 : px(PX.index * 1.6 + 10);

    // Where each item goes: an arrangement about the group's centre, or
    // spread along the part it is on / scattered inside the part it is in.
    const n = items.length;
    const arrange = arrangeOf(raw, key);
    const ARRANGEMENTS = ['row', 'column', 'grid', 'around', 'scatter', 'on'];
    if (!ARRANGEMENTS.includes(arrange)) {
      report(where('arrange'), `arrange "${arrange}" is not one of row, column, grid, around, scatter`);
    }
    const defaultGap =
      kind === 'box' ? 0 : kind === 'text' ? px(PX.gap) : Math.min(w, h) * 0.6;
    // Items sized by their text have no size in units, so their gap counts
    // in item widths ("gap": 1 leaves one cell of space).
    const itemSpan = arrangeOf(raw, key) === 'column' ? h : w;
    const gap =
      raw.gap === undefined
        ? defaultGap
        : ((number(raw.gap, where('gap')) ?? 0) * (sizeValue === undefined ? itemSpan : 1));
    let local: Vec[] = [];
    let world: Vec[] | null = null;
    let rotations: number[] = items.map(() => 0);
    const cols =
      arrange === 'grid'
        ? (rowsOf ?? (typeof raw.cols === 'number' ? Math.max(1, Math.round(raw.cols)) : Math.ceil(Math.sqrt(n))))
        : 0;
    if (arrange === 'row' || (arrange === 'on' && raw.on === undefined)) {
      const step = w + gap;
      local = items.map((_, i) => [(i - (n - 1) / 2) * step, 0]);
    } else if (arrange === 'column') {
      const step = h + indexH + gap;
      local = items.map((_, i) => [0, (i - (n - 1) / 2) * step]);
    } else if (arrange === 'grid') {
      const rows = Math.ceil(n / cols);
      local = items.map((_, i) => [
        ((i % cols) - (cols - 1) / 2) * (w + gap),
        (Math.floor(i / cols) - (rows - 1) / 2) * (h + indexH + gap),
      ]);
    } else if (arrange === 'around') {
      const r =
        raw.radius !== undefined
          ? (number(raw.radius, where('radius')) ?? 1)
          : Math.max((n * Math.max(w, h) * 1.7) / (2 * Math.PI), Math.max(w, h) * 1.5);
      const start = raw.angle === undefined ? 90 : (number(raw.angle, where('angle')) ?? 90);
      local = items.map((_, i) => mul(fromDegrees(start - (360 * i) / n), r));
    } else if (arrange === 'on') {
      const t = typeof raw.on === 'string' ? target(raw.on, where('on')) : null;
      if (typeof raw.on !== 'string') report(where('on'), 'on names a part: a ring, line or polygon');
      if (t) {
        const host = t.placed;
        const start = raw.angle === undefined ? 90 : (number(raw.angle, where('angle')) ?? 90);
        if (host.kind === 'ring' || host.kind === 'circle' || host.kind === 'ellipse') {
          world = items.map((_, i) => onCurve(host, start - (360 * i) / n));
        } else {
          const edge = restingEdge(host) ?? [host.center, host.center];
          world = [];
          rotations = [];
          items.forEach((_, i) => {
            const {point, tangent} = along(edge, (i + 1) / (n + 1));
            let d = tangent;
            if (d[0] < -1e-9) d = mul(d, -1);
            let nrm: Vec = [d[1], -d[0]];
            if (nrm[1] > 0) nrm = mul(nrm, -1);
            if (raw.side === 'below') nrm = mul(nrm, -1);
            const half = kind === 'dot' ? 0 : h / 2;
            world!.push(add(point, mul(nrm, half)));
            rotations.push(stageRotation(d));
          });
        }
      }
    } else if (arrange === 'scatter') {
      // Scattered without overlapping: inside a part, or over an area.
      let area: Bounds;
      let disc: {c: Vec; r: number} | null = null;
      const t = typeof raw.inside === 'string' ? target(raw.inside, where('inside')) : null;
      if (t) {
        const host = t.placed;
        if (host.kind === 'ring' || host.kind === 'circle') {
          disc = {c: host.center, r: host.w / 2 - Math.max(w, h) * 0.7};
        }
        const m = Math.max(w, h) * 0.7;
        area = {
          minX: host.bounds.minX + m,
          minY: host.bounds.minY + m,
          maxX: host.bounds.maxX - m,
          maxY: host.bounds.maxY - m,
        };
      } else {
        const side = Math.sqrt(n) * Math.max(w, h) * 2.2;
        area = {minX: -side / 2, minY: -side / 2, maxX: side / 2, maxY: side / 2};
      }
      const random = seeded(`${name}:${n}`);
      const minGap = Math.max(w, h) * 1.15;
      const spots: Vec[] = [];
      for (let i = 0; i < n; i++) {
        let best: Vec = [0, 0];
        let bestRoom = -Infinity;
        for (let k = 0; k < 60; k++) {
          const q: Vec = [
            area.minX + random() * Math.max(0, area.maxX - area.minX),
            area.minY + random() * Math.max(0, area.maxY - area.minY),
          ];
          if (disc && dist(q, disc.c) > Math.max(0, disc.r)) continue;
          const room = Math.min(Infinity, ...spots.map(s => dist(s, q)));
          if (room >= minGap) {
            best = q;
            bestRoom = room;
            break;
          }
          if (room > bestRoom) {
            best = q;
            bestRoom = room;
          }
        }
        spots.push(best);
      }
      if (t) world = spots;
      else local = spots;
      // Molecules in a liquid or gas tumble: each is turned its own way.
      if (drawing) rotations = items.map(() => random() * 360);
    }

    // The group as a whole is placed by its relations, like any part.
    let origin: Vec = [0, 0];
    if (!world) {
      const b = emptyBounds();
      local.forEach((p, i) => {
        grow(b, [p[0] - w / 2, p[1] - h / 2]);
        grow(b, [p[0] + w / 2, p[1] + h / 2 + (i >= 0 ? indexH : 0)]);
      });
      const gw = isEmpty(b) ? 0 : b.maxX - b.minX;
      const gh = isEmpty(b) ? 0 : b.maxY - b.minY;
      const shift = isEmpty(b) ? ([0, 0] as Vec) : centerOf(b);
      const placedAt = placeSolid(
        {...raw, on: undefined as unknown as Value, turn: undefined as unknown as Value},
        'group',
        gw,
        gh,
        where,
      );
      origin = sub(placedAt.center, shift);
    }
    const identities = input.identities?.get(name);
    const children: Placed[] = [];
    const bounds = emptyBounds();
    items.forEach((item, i) => {
      const c = world ? world[i] : add(origin, local[i]);
      const identity = identities?.[i] ?? i;
      const markKey = `${name}${identity}`;
      const child: Placed = {
        kind,
        center: c,
        w,
        h,
        rotation: rotations[i] ?? 0,
        bounds: emptyBounds(),
      };
      child.bounds = boundsOf(child);
      if (indexFrom !== null) {
        child.bounds.maxY += indexH;
      }
      children.push(child);
      grow(bounds, [child.bounds.minX, child.bounds.minY]);
      grow(bounds, [child.bounds.maxX, child.bounds.maxY]);
      if (drawing) {
        const instance = emitInstance(
          drawing,
          c,
          rotations[i] ?? 0,
          scaleBy,
          `${name}.${i}`,
          markKey,
        );
        children[children.length - 1] = instance;
        return;
      }
      const itemRaw: Record<string, Value> = {
        ...(typeof raw.color === 'string' ? {color: raw.color} : {}),
        ...(raw.outline === true ? {outline: true} : {}),
        ...(typeof raw.fontSize === 'number' ? {fontSize: raw.fontSize} : {}),
        ...item,
      };
      if (kind === 'text') {
        const content = contents[i];
        if (content) {
          marks.push({
            key: markKey,
            kind: content.tex ? 'tex' : 'text',
            center: c,
            w,
            h,
            rotation: 0,
            text: content.text,
            fontSize: fontPx,
            ...(typeof itemRaw.color === 'string' ? {color: itemRaw.color} : {}),
            part: `${name}.${i}`,
            role: 'shape',
          });
        }
        if (typeof item.label === 'string') {
          labels.push({key: `${markKey}L`, text: item.label, host: markKey, part: `${name}.${i}`, fontSize: PX.label * 0.85 * font, prefer: 'around'});
        }
      } else {
        // A dot's value is its label; a box or circle holds it inside.
        const content = kind === 'dot' ? null : contents[i];
        const withLabel =
          kind === 'dot' && contents[i] && item.label === undefined
            ? {...itemRaw, label: contents[i]!.text}
            : itemRaw;
        emitSolid(child, withLabel, content, `${name}.${i}`, markKey, true);
      }
      if (indexFrom !== null) {
        marks.push({
          key: `${name}Ix${i}`,
          kind: 'text',
          center: [c[0], c[1] + h / 2 + px(8 + PX.index * 0.8)],
          w: px(PX.index * 2),
          h: px(PX.index * 1.6),
          rotation: 0,
          text: String(indexFrom + i),
          fontSize: Math.round(PX.index * font),
          color: 'secondaryInk',
          part: `${name}.${i}`,
          role: 'index',
        });
      }
    });
    if (typeof raw.label === 'string') {
      // The group's own label: around the first item's host is wrong - it
      // names the whole, so it goes by the group (host = the group key).
      labels.push({
        key: `${name}L`,
        text: raw.label,
        host: name,
        part: name,
        fontSize: PX.label * font,
        prefer: 'around',
      });
    }
    return {
      kind: 'group',
      center: isEmpty(bounds) ? origin : centerOf(bounds),
      w: isEmpty(bounds) ? 0 : bounds.maxX - bounds.minX,
      h: isEmpty(bounds) ? 0 : bounds.maxY - bounds.minY,
      rotation: 0,
      items: children,
      bounds: isEmpty(bounds) ? pointBounds(origin) : bounds,
    };
  };

  for (const name of names) {
    if (!placed.has(name)) part(name, `parts.${name}`);
  }

  // Rays run on to the edge of everything else in the drawing.
  if (rays.length) {
    const extent = emptyBounds();
    for (const m of marks) {
      if (m.kind === 'ray') continue;
      for (const p of markCorners(m)) grow(extent, p);
    }
    if (isEmpty(extent)) grow(extent, [0, 0], 1);
    const pad = Math.max(extent.maxX - extent.minX, extent.maxY - extent.minY) * 0.08;
    const box = {
      minX: extent.minX - pad,
      minY: extent.minY - pad,
      maxX: extent.maxX + pad,
      maxY: extent.maxY + pad,
    };
    for (let i = 0; i < marks.length; i++) {
      const m = marks[i];
      if (m.kind !== 'ray' || !m.points || m.points.length < 2) continue;
      const pts = [...m.points];
      const a = pts[pts.length - 2];
      const b = pts[pts.length - 1];
      const d = unit(sub(b, a));
      const onward = exitFrom(b, d, box);
      pts[pts.length - 1] = add(b, mul(d, onward));
      let back: Vec[] | undefined;
      if (m.back) {
        const behind = exitFrom(a, mul(d, -1), box);
        back = [a, add(a, mul(d, -behind))];
      }
      marks[i] = {...m, points: pts, ...(back ? {backPoints: back} : {})} as Mark;
      const p = placed.get(m.part);
      if (p) {
        p.points = pts;
        pts.forEach(q => grow(p.bounds, q));
      }
    }
  }
  return {placed, marks, labels};
}

function exitFrom(from: Vec, d: Vec, b: Bounds): number {
  const inside =
    from[0] >= b.minX && from[0] <= b.maxX && from[1] >= b.minY && from[1] <= b.maxY;
  if (!inside) return 0;
  let best = Infinity;
  if (Math.abs(d[0]) > 1e-12) {
    for (const x of [b.minX, b.maxX]) {
      const t = (x - from[0]) / d[0];
      if (t > 1e-9) best = Math.min(best, t);
    }
  }
  if (Math.abs(d[1]) > 1e-12) {
    for (const y of [b.minY, b.maxY]) {
      const t = (y - from[1]) / d[1];
      if (t > 1e-9) best = Math.min(best, t);
    }
  }
  return Number.isFinite(best) ? best : 0;
}

function pointBounds(p: Vec): Bounds {
  return {minX: p[0], minY: p[1], maxX: p[0], maxY: p[1]};
}

/** Everything a set of marks covers, in units. */
export function marksBounds(marks: readonly Mark[]): Bounds {
  const b = emptyBounds();
  for (const m of marks) {
    if (m.kind === 'circle' || m.kind === 'ring' || m.kind === 'dot') {
      grow(b, m.center, m.w / 2);
      continue;
    }
    for (const p of markCorners(m)) grow(b, p);
    for (const p of m.backPoints ?? []) grow(b, p);
  }
  return b;
}

/** The corners (or points) a mark covers, in units. */
export function markCorners(m: {
  kind: string;
  center: Vec;
  w: number;
  h: number;
  rotation: number;
  points?: readonly Vec[];
}): Vec[] {
  if (m.points && m.points.length) return [...m.points];
  const hw = m.w / 2;
  const hh = m.h / 2;
  return (
    [
      [-hw, -hh],
      [hw, -hh],
      [hw, hh],
      [-hw, hh],
    ] as Vec[]
  ).map(c => add(m.center, rotate(c, m.rotation)));
}

function boundsOf(p: Placed): Bounds {
  const b = emptyBounds();
  if (p.kind === 'circle' || p.kind === 'ring' || p.kind === 'dot') {
    grow(b, p.center, p.w / 2);
    return b;
  }
  for (const c of markCorners(p)) grow(b, c);
  if (isEmpty(b)) grow(b, p.center);
  return b;
}

/** The outline of a part as points: a line's points, a shape's corners. */
function outline(p: Placed): Vec[] | null {
  if (p.points && p.points.length >= 2) return p.points;
  if (p.kind === 'box') return markCorners(p);
  return null;
}

/** A point of a part: its centre, a side, a corner, a line's end. */
export function anchorOf(p: Placed, anchor: string): Vec {
  if (anchor === 'center') return p.center;
  if (p.points && (p.kind === 'line' || p.kind === 'arrow' || p.kind === 'ray')) {
    if (anchor === 'start') return p.points[0];
    if (anchor === 'end') return p.points[p.points.length - 1];
    if (anchor === 'mid') return along(p.points, 0.5).point;
  }
  if (anchor === 'start' || anchor === 'end' || anchor === 'mid') return p.center;
  const hw = p.w / 2;
  const hh = p.h / 2;
  const local: Readonly<Record<string, Vec>> = {
    top: [0, -hh],
    bottom: [0, hh],
    left: [-hw, 0],
    right: [hw, 0],
    topleft: [-hw, -hh],
    topright: [hw, -hh],
    bottomleft: [-hw, hh],
    bottomright: [hw, hh],
  };
  if (p.kind === 'group' || p.kind === 'polygon' || (p.points && p.kind !== 'box')) {
    const b = p.bounds;
    const c = centerOf(b);
    const bw = (b.maxX - b.minX) / 2;
    const bh = (b.maxY - b.minY) / 2;
    const scaled = local[anchor] ?? [0, 0];
    return [c[0] + Math.sign(scaled[0]) * bw, c[1] + Math.sign(scaled[1]) * bh];
  }
  return add(p.center, rotate(local[anchor] ?? [0, 0], p.rotation));
}

/** The point on a ring, circle or ellipse at an angle (90 = top). */
function onCurve(p: Placed, degrees: number): Vec {
  const d = fromDegrees(degrees);
  return add(p.center, rotate([d[0] * (p.w / 2), d[1] * (p.h / 2)], p.rotation));
}

/**
 * The edge a thing rests on: a line itself, or the upward-facing edge of
 * an outline (a ramp's slope, a table's top).
 */
function restingEdge(p: Placed): Vec[] | null {
  if (p.kind === 'line' || p.kind === 'arrow' || p.kind === 'ray') {
    return p.points ?? null;
  }
  const corners = outline(p);
  if (!corners || corners.length < 3) return null;
  const c = centroid(corners);
  let best: Vec[] | null = null;
  let bestScore = Infinity;
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % corners.length];
    const d = unit(sub(b, a));
    let n: Vec = [d[1], -d[0]];
    // Outward: away from the middle.
    if (dot(n, sub(a, c)) < 0) n = mul(n, -1);
    const score = n[1] - dist(a, b) * 1e-3;
    if (score < bestScore - 1e-9) {
      bestScore = score;
      best = [a, b];
    }
  }
  if (!best) return null;
  // Left to right, so t runs the way a reader reads.
  return best[0][0] <= best[1][0] ? best : [best[1], best[0]];
}

/** Where a line from a part's middle toward `toward` crosses its edge. */
function boundaryToward(p: Placed, toward: Vec): Vec {
  const d = sub(toward, p.center);
  if (len(d) < 1e-12) return p.center;
  const u = unit(d);
  if (p.kind === 'circle' || p.kind === 'ring' || p.kind === 'dot') {
    return add(p.center, mul(u, p.w / 2));
  }
  if (p.kind === 'ellipse') {
    const l = rotate(u, -p.rotation);
    const k = 1 / Math.hypot(l[0] / (p.w / 2), l[1] / (p.h / 2));
    return add(p.center, mul(u, k));
  }
  if (p.kind === 'polygon' && p.points) {
    let best = 0;
    for (let i = 0; i < p.points.length; i++) {
      const a = p.points[i];
      const b = p.points[(i + 1) % p.points.length];
      const hit = lineParams(p.center, u, a, sub(b, a));
      if (hit && hit.t > 0 && hit.u >= 0 && hit.u <= 1) best = Math.max(best, hit.t);
    }
    return add(p.center, mul(u, best));
  }
  const b = p.kind === 'group' ? p.bounds : null;
  const hw = b ? (b.maxX - b.minX) / 2 : p.w / 2;
  const hh = b ? (b.maxY - b.minY) / 2 : p.h / 2;
  const center = b ? centerOf(b) : p.center;
  const l = rotate(u, -p.rotation);
  const t = Math.min(
    Math.abs(l[0]) > 1e-12 ? hw / Math.abs(l[0]) : Infinity,
    Math.abs(l[1]) > 1e-12 ? hh / Math.abs(l[1]) : Infinity,
  );
  return add(center, mul(u, t));
}
