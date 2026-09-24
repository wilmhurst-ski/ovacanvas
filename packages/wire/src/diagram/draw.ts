import chroma from 'chroma-js';
import type {SceneNode, Touch, Value} from '../document/model.js';
import {drawIcon, hexColor} from '../icons/draw.js';
import {resolveIcon} from '../icons/library.js';
import {colorValue, textBox, texWidthEm} from '../kits/fields.js';
import type {Params} from '../kits/params.js';
import type {Box, KitExpansion, KitPart} from '../kits/types.js';
import {texHeightEmExact} from '../tex/terms.js';
import {
  add,
  centerOf,
  emptyBounds,
  fromDegrees,
  grow,
  isEmpty,
  mul,
  sub,
  union,
  type Bounds,
  type Vec,
} from './geometry.js';
import {
  looksLikeTex,
  markCorners,
  resolveDiagram,
  type LabelRequest,
  type Mark,
  type RawPart,
  type Resolved,
  type Template,
} from './resolve.js';

/**
 * Drawing a diagram: fitting it to its box, placing its labels, and
 * turning it into scene nodes, touches and beat parts.
 *
 * @remarks
 * Every version of the diagram the beats will `set` it to is fitted at one
 * scale and centred on one point, so the frame holds still while things
 * move. Labels are placed last, on the stage, clear of every shape, line
 * and label already there. Shapes of one diagram may overlap by design (a
 * block on its slope, an arrow from its centre, electrons on a shell);
 * words may not, so only text is left to the audit.
 */

export interface DiagramSpec {
  readonly parts: Readonly<Record<string, RawPart>>;
  readonly params: Params;
  readonly templates: Readonly<Record<string, Template>>;
}

/** Fill of the box the drawing (labels included) is fitted into. */
const FILL = 0.94;
const LINE_WIDTH = 4;
const ARROW_WIDTH = 5;
const RING_WIDTH = 3;
const SHAPE_STROKE = 3;
const LABEL_GAP = 10;
/** Audit breathing room the diagram asks for (tighter than the defaults). */
const LABEL_HALO = 6;
const SHAPE_HALO = 2;
const ROUTE_HALO = 4;

interface Staged {
  readonly resolved: Resolved;
  readonly toStage: (u: Vec) => Vec;
  readonly scale: number;
  readonly font: number;
}

interface Frame {
  readonly scale: number;
  readonly font: number;
  readonly mid: Vec;
}

interface PlacedLabel {
  readonly request: LabelRequest;
  readonly at: Vec;
  readonly w: number;
  readonly h: number;
  readonly tex: boolean;
  /** What it had to cross (it sits on a paper patch). */
  readonly crosses?: readonly string[];
}

function labelSize(text: string, size: number): {w: number; h: number; tex: boolean} {
  const tex = looksLikeTex(text);
  if (tex) {
    return {
      w: texWidthEm(text) * size + 6,
      h: (texHeightEmExact(text) ?? 1.1) * size + 6,
      tex,
    };
  }
  const box = textBox(text, size);
  return {w: box.width, h: box.height, tex};
}

function boundsOfMarks(marks: readonly Mark[]): Bounds {
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

/**
 * The scale (pixels per unit), text factor and centre that fit every
 * variant - shapes and the labels placed around them - into the box.
 */
function fit(
  variants: readonly DiagramSpec[],
  box: Box,
  identities: readonly ReadonlyMap<string, readonly number[]>[],
): Frame {
  const origin: Box = {x: 0, y: 0, width: box.width, height: box.height};
  /** Everything drawn, in pixels about the shapes' centre. */
  const measure = (scale: number, font: number): {px: Bounds; mid: Vec} => {
    const resolved = variants.map((v, i) =>
      resolveDiagram({
        parts: v.parts,
        params: v.params,
        templates: v.templates,
        scale,
        font,
        identities: identities[i],
      }),
    );
    let shapes = emptyBounds();
    for (const r of resolved) shapes = union(shapes, boundsOfMarks(r.marks));
    const mid = isEmpty(shapes) ? ([0, 0] as Vec) : centerOf(shapes);
    const px = emptyBounds();
    if (!isEmpty(shapes)) {
      grow(px, [(shapes.minX - mid[0]) * scale, (shapes.minY - mid[1]) * scale]);
      grow(px, [(shapes.maxX - mid[0]) * scale, (shapes.maxY - mid[1]) * scale]);
    }
    for (const r of resolved) {
      if (!r.labels.length) continue;
      const staged: Staged = {
        resolved: r,
        scale,
        font,
        toStage: (u: Vec): Vec => [(u[0] - mid[0]) * scale, (u[1] - mid[1]) * scale],
      };
      for (const l of placeLabels(staged, origin)) {
        grow(px, [l.at[0] - l.w / 2, l.at[1] - l.h / 2]);
        grow(px, [l.at[0] + l.w / 2, l.at[1] + l.h / 2]);
      }
    }
    return {px, mid};
  };
  const roomW = box.width * FILL;
  const roomH = box.height * FILL;
  const fits = (b: Bounds) =>
    isEmpty(b) || (b.maxX - b.minX <= roomW && b.maxY - b.minY <= roomH);
  let font = 1;
  // Text alone too big for the box (a long row of cells): shrink the text.
  for (let k = 0; k < 4; k++) {
    const {px} = measure(1e-3, font);
    if (fits(px)) break;
    const ratio = Math.min(
      roomW / Math.max(1e-9, px.maxX - px.minX),
      roomH / Math.max(1e-9, px.maxY - px.minY),
    );
    font = Math.max(0.5, font * ratio * 0.98);
    if (font === 0.5) break;
  }
  // The largest scale that fits: bracket, then bisect on a log scale. A
  // drawing whose size is set by its words (cells, stacks) has no size in
  // units of its own: a unit is then about a cell (64px), so gaps and
  // offsets written in units mean what they look like.
  let lo = 1e-3;
  let hi = 4000;
  const span = (b: Bounds) => (isEmpty(b) ? 0 : b.maxX - b.minX + (b.maxY - b.minY));
  if (span(measure(128, font).px) < 1.25 * span(measure(64, font).px)) hi = 64;
  if (fits(measure(hi, font).px)) lo = hi;
  else {
    for (let k = 0; k < 40; k++) {
      const mid = Math.sqrt(lo * hi);
      if (fits(measure(mid, font).px)) lo = mid;
      else hi = mid;
      if (hi / lo < 1.02) break;
    }
  }
  const {px, mid} = measure(lo, font);
  // Centre everything drawn, labels included.
  const shift = isEmpty(px) ? ([0, 0] as Vec) : centerOf(px);
  return {scale: lo, font, mid: [mid[0] + shift[0] / lo, mid[1] + shift[1] / lo]};
}

function stage(
  spec: DiagramSpec,
  identity: ReadonlyMap<string, readonly number[]>,
  box: Box,
  scale: number,
  font: number,
  mid: Vec,
): Staged {
  const resolved = resolveDiagram({
    parts: spec.parts,
    params: spec.params,
    templates: spec.templates,
    scale,
    font,
    identities: identity,
  });
  return {
    resolved,
    scale,
    font,
    toStage: (u: Vec): Vec => [
      box.x + (u[0] - mid[0]) * scale,
      box.y + (u[1] - mid[1]) * scale,
    ],
  };
}

// ---- obstacles and labels ---------------------------------------------------

interface Obstacle {
  readonly key: string;
  /** A filled outline: a polygon, a turned box, an ellipse. */
  readonly poly?: readonly Vec[];
  readonly box?: Bounds;
  readonly segments?: readonly [Vec, Vec][];
  readonly circle?: {c: Vec; r: number; ring: boolean};
}

function obstaclesOf(s: Staged): Obstacle[] {
  const out: Obstacle[] = [];
  for (const m of s.resolved.marks) {
    if (m.kind === 'line' || m.kind === 'arrow' || m.kind === 'ray') {
      const pts = (m.points ?? []).map(s.toStage);
      const segments: [Vec, Vec][] = [];
      for (let i = 1; i < pts.length; i++) segments.push([pts[i - 1], pts[i]]);
      const back = (m.backPoints ?? []).map(s.toStage);
      if (back.length === 2) segments.push([back[0], back[1]]);
      out.push({key: m.key, segments});
    } else if (m.kind === 'circle' || m.kind === 'ring' || m.kind === 'dot') {
      out.push({
        key: m.key,
        circle: {
          c: s.toStage(m.center),
          r: (m.w / 2) * s.scale,
          ring: m.kind === 'ring',
        },
      });
    } else if (m.kind === 'ellipse') {
      const poly: Vec[] = [];
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * 2 * Math.PI;
        const local: Vec = [(Math.cos(a) * m.w) / 2, (Math.sin(a) * m.h) / 2];
        const r = (m.rotation * Math.PI) / 180;
        poly.push(
          s.toStage([
            m.center[0] + local[0] * Math.cos(r) - local[1] * Math.sin(r),
            m.center[1] + local[0] * Math.sin(r) + local[1] * Math.cos(r),
          ]),
        );
      }
      out.push({key: m.key, poly});
    } else {
      out.push({key: m.key, poly: markCorners(m).map(s.toStage)});
    }
  }
  return out;
}

/** Whether a point is inside a polygon (even-odd). */
function insidePolygon(p: Vec, poly: readonly Vec[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** Whether a box and a filled polygon overlap. */
function polygonHitsBox(poly: readonly Vec[], box: Bounds): boolean {
  if (insidePolygon(centerOf(box), poly)) return true;
  for (let i = 0; i < poly.length; i++) {
    if (segmentHitsBox(poly[i], poly[(i + 1) % poly.length], box)) return true;
  }
  return false;
}

function boxHits(a: Bounds, b: Bounds): number {
  const w = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
  const h = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);
  return w > 0 && h > 0 ? w * h : 0;
}

function expand(b: Bounds, by: number): Bounds {
  return {minX: b.minX - by, minY: b.minY - by, maxX: b.maxX + by, maxY: b.maxY + by};
}

/** Whether a segment crosses a box (Liang-Barsky clipping). */
function segmentHitsBox(a: Vec, b: Vec, box: Bounds): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const clip = (p: number, q: number): boolean => {
    if (Math.abs(p) < 1e-12) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  return (
    clip(-dx, a[0] - box.minX) &&
    clip(dx, box.maxX - a[0]) &&
    clip(-dy, a[1] - box.minY) &&
    clip(dy, box.maxY - a[1])
  );
}

/**
 * Clearance a label keeps (beyond its own box) from each kind of thing:
 * the audit's halos around a label and a shape or line, and a little more.
 */
const CLEAR = {
  line: LABEL_HALO + ROUTE_HALO + 3,
  shape: LABEL_HALO + SHAPE_HALO + 3,
  label: 2 * LABEL_HALO + 3,
};

interface Candidate {
  readonly at: Vec;
  /** Order of preference among candidates at the same distance. */
  readonly rank: number;
  /** Pixels further out than the closest spot. */
  readonly extra: number;
}

function candidatesFor(
  s: Staged,
  request: LabelRequest,
  size: {w: number; h: number},
): Candidate[] {
  const host = s.resolved.marks.find(m => m.key === request.host);
  const hostPlaced = s.resolved.placed.get(request.part);
  const out: Candidate[] = [];
  let rank = 0;
  const around = (b: Bounds) => {
    const c = centerOf(b);
    const hw = (b.maxX - b.minX) / 2;
    const hh = (b.maxY - b.minY) / 2;
    for (const extra of [0, 14, 30, 50, 75, 105, 140]) {
      for (const deg of [
        90, 0, 180, 270, 45, 135, 315, 225, 67, 112, 22, 158, 338, 202, 292, 248,
      ]) {
        const d = fromDegrees(deg);
        const reach =
          Math.min(
            Math.abs(d[0]) > 1e-9 ? (hw + size.w / 2) / Math.abs(d[0]) : Infinity,
            Math.abs(d[1]) > 1e-9 ? (hh + size.h / 2) / Math.abs(d[1]) : Infinity,
          ) +
          LABEL_GAP +
          extra;
        out.push({at: add(c, mul(d, reach)), rank: rank++ % 16, extra});
      }
    }
  };
  if (
    host &&
    host.points &&
    host.points.length >= 2 &&
    request.prefer !== 'around'
  ) {
    const pts = host.points.map(s.toStage);
    const beyond = (from: Vec, to: Vec, extra: number) => {
      rank = 0;
      const l = Math.max(1e-9, Math.hypot(to[0] - from[0], to[1] - from[1]));
      const d: Vec = [(to[0] - from[0]) / l, (to[1] - from[1]) / l];
      const reach =
        Math.abs(d[0]) * (size.w / 2) +
        Math.abs(d[1]) * (size.h / 2) +
        LABEL_GAP +
        extra;
      out.push({at: add(to, mul(d, reach)), rank: rank++, extra});
    };
    const spots =
      request.prefer === 'end'
        ? [0.85, 0.7, 0.55, 0.95, 0.4]
        : request.prefer === 'start'
          ? [0.1, 0.25]
          : [0.5, 0.38, 0.62, 0.25, 0.75];
    const total = pts.reduce(
      (sum, p, i) =>
        i ? sum + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0,
      0,
    );
    for (const extra of [0, 12, 26, 44, 66]) {
      // A pointer is named at its tail, a force at its tip.
      if (request.prefer === 'start') beyond(pts[1], pts[0], extra);
      if (request.prefer === 'end') {
        beyond(pts[pts.length - 2], pts[pts.length - 1], extra);
      }
      for (const t of spots) {
        let remaining = t * total;
        let point = pts[0];
        let dir: Vec = [1, 0];
        for (let i = 1; i < pts.length; i++) {
          const l = Math.hypot(
            pts[i][0] - pts[i - 1][0],
            pts[i][1] - pts[i - 1][1],
          );
          if (remaining <= l || i === pts.length - 1) {
            const k = l < 1e-9 ? 0 : Math.min(1, remaining / l);
            point = add(pts[i - 1], mul(sub(pts[i], pts[i - 1]), k));
            dir =
              l < 1e-9
                ? [1, 0]
                : [(pts[i][0] - pts[i - 1][0]) / l, (pts[i][1] - pts[i - 1][1]) / l];
            break;
          }
          remaining -= l;
        }
        const n: Vec = [-dir[1], dir[0]];
        const reach =
          Math.abs(n[0]) * (size.w / 2) +
          Math.abs(n[1]) * (size.h / 2) +
          LABEL_GAP +
          extra;
        out.push({at: add(point, mul(n, reach)), rank: rank++, extra});
        out.push({at: add(point, mul(n, -reach)), rank: rank++, extra});
      }
    }
  } else if (host) {
    const b = emptyBounds();
    if (host.kind === 'circle' || host.kind === 'ring' || host.kind === 'dot') {
      grow(b, s.toStage(host.center), (host.w / 2) * s.scale);
    } else for (const p of markCorners(host)) grow(b, s.toStage(p));
    around(b);
  } else if (hostPlaced) {
    const b = emptyBounds();
    grow(b, s.toStage([hostPlaced.bounds.minX, hostPlaced.bounds.minY]));
    grow(b, s.toStage([hostPlaced.bounds.maxX, hostPlaced.bounds.maxY]));
    around(b);
  }
  return out;
}

function placeLabels(s: Staged, frame: Box): PlacedLabel[] {
  const obstacles = obstaclesOf(s);
  const placedLabels: PlacedLabel[] = [];
  const frameBox: Bounds = {
    minX: frame.x - frame.width / 2,
    minY: frame.y - frame.height / 2,
    maxX: frame.x + frame.width / 2,
    maxY: frame.y + frame.height / 2,
  };
  /** What a label box at `lb` runs into. */
  const conflicts = (
    lb: Bounds,
  ): {things: string[]; lines: number; shapes: number; labels: number} => {
    const things: string[] = [];
    let lines = 0;
    let shapes = 0;
    for (const o of obstacles) {
      if (o.poly) {
        if (polygonHitsBox(o.poly, expand(lb, CLEAR.shape))) {
          things.push(o.key);
          shapes++;
        }
      } else if (o.box) {
        if (boxHits(expand(lb, CLEAR.shape), o.box) > 0) {
          things.push(o.key);
          shapes++;
        }
      } else if (o.segments) {
        const p = expand(lb, CLEAR.line);
        if (o.segments.some(([a, b]) => segmentHitsBox(a, b, p))) {
          things.push(o.key);
          lines++;
        }
      } else if (o.circle) {
        const {c, r, ring} = o.circle;
        const p = expand(lb, ring ? CLEAR.line : CLEAR.shape);
        const nx = Math.max(p.minX, Math.min(c[0], p.maxX));
        const ny = Math.max(p.minY, Math.min(c[1], p.maxY));
        const near = Math.hypot(nx - c[0], ny - c[1]);
        if (ring) {
          // Only the drawn line of a ring is in the way.
          const far = Math.max(
            ...[
              [p.minX, p.minY],
              [p.maxX, p.minY],
              [p.minX, p.maxY],
              [p.maxX, p.maxY],
            ].map(([x, y]) => Math.hypot(x - c[0], y - c[1])),
          );
          if (near <= r && far >= r) {
            things.push(o.key);
            lines++;
          }
        } else if (near < r) {
          things.push(o.key);
          shapes++;
        }
      }
    }
    let labels = 0;
    for (const other of placedLabels) {
      const ob: Bounds = {
        minX: other.at[0] - other.w / 2,
        minY: other.at[1] - other.h / 2,
        maxX: other.at[0] + other.w / 2,
        maxY: other.at[1] + other.h / 2,
      };
      if (boxHits(expand(lb, CLEAR.label), ob) > 0) labels++;
    }
    return {things, lines, shapes, labels};
  };
  for (const request of s.resolved.labels) {
    let chosen: {label: PlacedLabel; score: number} | null = null;
    // Close and clear is best. A smaller label that fits beats a far one;
    // crossing a thin line (an orbit, a ray) on a paper patch, as printed
    // diagrams do, beats wandering off from what it names; covering a
    // shape or another label never happens while anything else is left.
    for (const [factor, cost] of [
      [1, 0],
      [0.85, 30],
      [0.72, 60],
    ] as const) {
      const fontSize = Math.round(request.fontSize * factor);
      const size = labelSize(request.text, fontSize);
      let best: {at: Vec; score: number; things: string[]} | null = null;
      for (const c of candidatesFor(s, request, size)) {
        const lb: Bounds = {
          minX: c.at[0] - size.w / 2,
          minY: c.at[1] - size.h / 2,
          maxX: c.at[0] + size.w / 2,
          maxY: c.at[1] + size.h / 2,
        };
        const hit = conflicts(lb);
        const outside =
          lb.minX < frameBox.minX ||
          lb.maxX > frameBox.maxX ||
          lb.minY < frameBox.minY ||
          lb.maxY > frameBox.maxY;
        const score =
          cost +
          c.extra +
          c.rank * 0.3 +
          hit.lines * 120 +
          hit.shapes * 1000 +
          hit.labels * 5000 +
          (outside ? 300 : 0);
        if (!best || score < best.score) {
          best = {at: c.at, score, things: hit.things};
        }
      }
      if (!best) break;
      if (!chosen || best.score < chosen.score) {
        chosen = {
          label: {
            request: {...request, fontSize},
            at: best.at,
            w: size.w,
            h: size.h,
            tex: size.tex,
            ...(best.things.length ? {crosses: best.things} : {}),
          },
          score: best.score,
        };
      }
      if (!best.things.length && best.score < 40) break;
    }
    if (chosen) placedLabels.push(chosen.label);
  }
  return placedLabels;
}

// ---- nodes ----------------------------------------------------------------

function tint(color: string): string {
  return chroma.mix(hexColor(color, '#59616D'), '#FFFFFF', 0.72, 'rgb').hex();
}

function round(v: number): number {
  return Math.round(v * 10) / 10;
}

function roundVec(v: Vec): Value {
  return [round(v[0]), round(v[1])];
}

export interface DrawOptions {
  readonly id: string;
  readonly box: Box;
  /** Every version the beats will set the diagram to: one frame fits all. */
  readonly variants: readonly DiagramSpec[];
  readonly identities: readonly ReadonlyMap<string, readonly number[]>[];
  /** The version to draw (one of the variants, or a frame between two). */
  readonly current: DiagramSpec;
  readonly identity: ReadonlyMap<string, readonly number[]>;
  /** Identifies the variants, so every version shares one fitted frame. */
  readonly cacheKey?: object;
  /** Whether a beat highlights any part (the highlight is one more colour). */
  readonly highlights?: boolean;
}

const FRAMES = new WeakMap<object, Map<string, Frame>>();

/** One frame - scale, text size, centre - for every version, labels included. */
function frameFor(options: DrawOptions): Frame {
  const {box, variants, identities} = options;
  const boxKey = `${box.x},${box.y},${box.width},${box.height}`;
  const cached = options.cacheKey
    ? FRAMES.get(options.cacheKey)?.get(boxKey)
    : undefined;
  if (cached) return cached;
  const frame = fit(variants, box, identities);
  if (options.cacheKey) {
    const map = FRAMES.get(options.cacheKey) ?? new Map<string, Frame>();
    map.set(boxKey, frame);
    FRAMES.set(options.cacheKey, map);
  }
  return frame;
}

export function drawDiagram(options: DrawOptions): KitExpansion {
  const {id, box} = options;
  const {scale, font, mid} = frameFor(options);
  const s = stage(options.current, options.identity, box, scale, font, mid);
  const labels = placeLabels(s, box);

  const nodes: SceneNode[] = [];
  const touches: Touch[] = [];
  const nodeIds = new Map<string, string[]>();
  const shapeNodes: string[] = [];
  const traceable = new Map<string, string[]>();
  const byPart = new Map<string, string[]>();
  const addTo = (part: string, nodeId: string) => {
    const list = byPart.get(part) ?? [];
    list.push(nodeId);
    byPart.set(part, list);
  };
  // Node ids are at most 40 characters: a long key (a template inside a
  // set of items) is shortened with a hash of the rest.
  const nid = (key: string) => {
    const full = `${id}_${key}`;
    if (full.length <= 40) return full;
    let h = 0;
    for (let i = 0; i < full.length; i++) h = (Math.imul(h, 31) + full.charCodeAt(i)) | 0;
    return `${full.slice(0, 32)}${(h >>> 0).toString(36).slice(0, 7)}`;
  };
  const {toStage} = s;

  // Words (labels and text parts) keep their colour only while that stays
  // one or two deliberate accents; more than that and they are all ink.
  const accents = new Set(
    [
      ...labels.map(l => l.request.color),
      ...s.resolved.marks
        .filter(m => (m.kind === 'text' || m.kind === 'tex') && m.role === 'shape')
        .map(m => m.color),
    ].filter(Boolean),
  );
  // A highlight recolours words in its own colour: that counts too.
  if (options.highlights) accents.add('blue');
  const colored = accents.size <= 2;
  // Words go on top: every shape first, then the text written inside them,
  // so a neighbouring shape (an atom of the same molecule) never covers it.
  const ordered = [
    ...s.resolved.marks.filter(m => m.role === 'shape'),
    ...s.resolved.marks.filter(m => m.role !== 'shape'),
  ];
  for (const m of ordered) {
    const nodeId = nid(m.key);
    const ids: string[] = [];
    const color = m.color;
    const stroke = color ? colorValue(color, 'ink') : null;
    const center = roundVec(toStage(m.center));
    const w = round(m.w * s.scale);
    const h = round(m.h * s.scale);
    switch (m.kind) {
      case 'box':
      case 'ellipse':
      case 'polygon': {
        const fill = m.outline ? undefined : color ? tint(color) : {theme: 'clearField'};
        const common: Record<string, Value> = {
          ...(fill ? {fill} : {}),
          stroke: stroke ?? {theme: 'secondaryInk'},
          lineWidth: m.width ?? SHAPE_STROKE,
          ...(m.dashed ? {lineDash: [10, 8]} : {}),
        };
        if (m.kind === 'polygon' && m.points) {
          nodes.push({
            id: nodeId,
            component: 'Line',
            props: {
              points: m.points.map(p => roundVec(toStage(p))),
              closed: true,
              lineJoin: 'round',
              ...common,
            },
          });
        } else if (m.kind === 'box') {
          nodes.push({
            id: nodeId,
            component: 'Rect',
            props: {
              size: [w, h],
              position: center,
              rotation: round(m.rotation),
              radius: Math.round(Math.min(8, Math.min(w, h) * 0.15)),
              ...common,
            },
          });
        } else {
          nodes.push({
            id: nodeId,
            component: 'Circle',
            props: {size: [w, h], position: center, rotation: round(m.rotation), ...common},
          });
        }
        ids.push(nodeId);
        break;
      }
      case 'circle':
      case 'dot': {
        const solid =
          m.kind === 'dot' || (color !== undefined && !m.outline && !m.holdsText);
        nodes.push({
          id: nodeId,
          component: 'Circle',
          props: {
            size: m.kind === 'dot' ? 14 : w,
            position: center,
            ...(solid
              ? {fill: stroke ?? {theme: 'ink'}}
              : m.holdsText && color
                ? {fill: tint(color), stroke: stroke!, lineWidth: m.width ?? SHAPE_STROKE}
                : m.outline
                ? {stroke: stroke ?? {theme: 'secondaryInk'}, lineWidth: m.width ?? SHAPE_STROKE}
                : {
                    fill: {theme: 'clearField'},
                    stroke: {theme: 'secondaryInk'},
                    lineWidth: m.width ?? SHAPE_STROKE,
                  }),
          },
        });
        ids.push(nodeId);
        break;
      }
      case 'ring':
        nodes.push({
          id: nodeId,
          component: 'Circle',
          props: {
            size: w,
            position: center,
            stroke: stroke ?? {theme: 'secondaryInk'},
            lineWidth: m.width ?? RING_WIDTH,
            ...(m.dashed ? {lineDash: [10, 8]} : {}),
          },
        });
        ids.push(nodeId);
        break;
      case 'line':
      case 'arrow':
      case 'ray': {
        nodes.push({
          id: nodeId,
          component: 'Line',
          props: {
            points: (m.points ?? []).map(p => roundVec(toStage(p))),
            stroke: stroke ?? {theme: 'ink'},
            lineWidth: m.width ?? (m.kind === 'arrow' ? ARROW_WIDTH : m.kind === 'ray' ? 3 : LINE_WIDTH),
            lineCap: 'round',
            lineJoin: 'round',
            ...(m.arrow ? {endArrow: true, arrowSize: 18} : {}),
            ...(m.dashed ? {lineDash: [12, 10]} : {}),
          },
        });
        ids.push(nodeId);
        if (m.backPoints) {
          nodes.push({
            id: `${nodeId}B`,
            component: 'Line',
            props: {
              points: m.backPoints.map(p => roundVec(toStage(p))),
              stroke: stroke ?? {theme: 'ink'},
              lineWidth: 2,
              lineDash: [8, 8],
            },
          });
          ids.push(`${nodeId}B`);
        }
        traceable.set(m.part, [...(traceable.get(m.part) ?? []), ...ids]);
        break;
      }
      case 'text':
      case 'tex': {
        const fill = m.onSolid
          ? {theme: 'paper'}
          : m.role === 'index'
            ? {theme: 'secondaryInk'}
            : color && (colored || m.role !== 'shape')
              ? colorValue(color, 'ink')
              : {theme: 'ink'};
        const fontSize = Math.round(m.fontSize ?? 30);
        nodes.push(
          m.kind === 'tex'
            ? {
                id: nodeId,
                component: 'Latex',
                props: {
                  tex: m.text ?? '',
                  fontSize,
                  position: center,
                  fill,
                  ...(m.rotation ? {rotation: round(m.rotation)} : {}),
                },
              }
            : {
                id: nodeId,
                component: 'Txt',
                props: {
                  text: m.text ?? '',
                  fontSize,
                  position: center,
                  fill,
                  ...(m.rotation ? {rotation: round(m.rotation)} : {}),
                },
              },
        );
        ids.push(nodeId);
        break;
      }
      case 'icon': {
        const def = resolveIcon(m.text ?? '');
        if (def) {
          const drawn = drawIcon(nodeId, def, toStage(m.center), {
            size: Math.max(16, w),
            ...(color ? {color} : {}),
          });
          nodes.push(...drawn.nodes);
          touches.push(...drawn.touches);
          ids.push(...drawn.ids);
        }
        break;
      }
    }
    const halo =
      m.kind === 'text' || m.kind === 'tex'
        ? LABEL_HALO
        : m.kind === 'line' || m.kind === 'arrow' || m.kind === 'ray'
          ? ROUTE_HALO
          : SHAPE_HALO;
    for (let k = nodes.length - 1; k >= 0 && ids.includes(nodes[k].id); k--) {
      nodes[k] = {...nodes[k], halo};
    }
    nodeIds.set(m.key, ids);
    ids.forEach(n => addTo(m.part, n));
    if (m.role === 'shape' && m.kind !== 'text' && m.kind !== 'tex') {
      shapeNodes.push(...ids);
    }
    if (m.kind === 'polygon' || m.kind === 'ring' || m.kind === 'circle') {
      if (m.kind !== 'circle' || m.outline) {
        traceable.set(m.part, [...(traceable.get(m.part) ?? []), ...ids]);
      }
    }
  }

  for (const l of labels) {
    const nodeId = nid(l.request.key);
    if (l.crosses) {
      // Where a label must cross a line, it sits on a patch of paper.
      const patch = `${nodeId}bg`;
      nodes.push({
        id: patch,
        component: 'Rect',
        halo: 0,
        props: {
          size: [Math.round(l.w + 6), Math.round(l.h)],
          radius: 6,
          fill: {theme: 'paper'},
          position: roundVec(l.at),
        },
      });
      addTo(l.request.part, patch);
      touches.push({a: nodeId, b: patch, reason: 'the label sits on its paper patch'});
      for (const key of l.crosses) {
        for (const n of nodeIds.get(key) ?? []) {
          touches.push({a: patch, b: n, reason: 'a paper patch keeps the label readable where it crosses a line'});
          touches.push({a: nodeId, b: n, reason: 'the label crosses this line on a paper patch'});
        }
      }
    }
    const fill =
      colored && l.request.color
        ? colorValue(l.request.color, 'ink')
        : {theme: 'ink'};
    const fontSize = Math.round(l.request.fontSize);
    nodes.push(
      l.tex
        ? {
            id: nodeId,
            component: 'Latex',
            halo: LABEL_HALO,
            props: {tex: l.request.text, fontSize, position: roundVec(l.at), fill},
          }
        : {
            id: nodeId,
            component: 'Txt',
            halo: LABEL_HALO,
            props: {text: l.request.text, fontSize, position: roundVec(l.at), fill},
          },
    );
    addTo(l.request.part, nodeId);
    // A label hugs what it names.
    for (const h of nodeIds.get(l.request.host) ?? []) {
      touches.push({a: nodeId, b: h, reason: 'a label sits right beside what it names'});
    }
  }

  // Words placed as a part (a caption "below" a shape) that end up across a
  // thin line - a shell, an orbit, a ray - sit on a paper patch, as labels do.
  const obstacles = obstaclesOf(s);
  const standalone = s.resolved.marks.filter(
    m => m.role === 'shape' && (m.kind === 'text' || m.kind === 'tex'),
  );
  const standaloneIds: string[] = [];
  for (const m of standalone) {
    const own = nid(m.key);
    standaloneIds.push(own);
    const box = emptyBounds();
    for (const p of markCorners(m)) grow(box, toStage(p));
    const padded = expand(box, CLEAR.line);
    const crossed = obstacles.filter(o => {
      if (o.key === m.key) return false;
      if (o.segments) return o.segments.some(([a, b]) => segmentHitsBox(a, b, padded));
      if (o.circle?.ring) {
        const {c, r} = o.circle;
        const nx = Math.max(padded.minX, Math.min(c[0], padded.maxX));
        const ny = Math.max(padded.minY, Math.min(c[1], padded.maxY));
        const far = Math.max(
          ...[
            [padded.minX, padded.minY],
            [padded.maxX, padded.minY],
            [padded.minX, padded.maxY],
            [padded.maxX, padded.maxY],
          ].map(([x, y]) => Math.hypot(x - c[0], y - c[1])),
        );
        return Math.hypot(nx - c[0], ny - c[1]) <= r && far >= r;
      }
      return false;
    });
    if (!crossed.length) continue;
    const patchId = `${own}bg`;
    const at = centerOf(box);
    // Just under the words, over everything else.
    const index = nodes.findIndex(n => n.id === own);
    nodes.splice(index, 0, {
      id: patchId,
      component: 'Rect',
      halo: 0,
      props: {
        size: [Math.round(box.maxX - box.minX + 6), Math.round(box.maxY - box.minY)],
        radius: 6,
        fill: {theme: 'paper'},
        position: roundVec(at),
      },
    });
    addTo(m.part, patchId);
    standaloneIds.push(patchId);
    touches.push({a: own, b: patchId, reason: 'the words sit on their paper patch'});
    for (const o of crossed) {
      for (const n of nodeIds.get(o.key) ?? []) {
        touches.push({a: patchId, b: n, reason: 'a paper patch keeps the words readable over a line'});
        touches.push({a: own, b: n, reason: 'the words cross this line on a paper patch'});
      }
    }
  }
  // Items of a list whose order the beats change pass each other on the way
  // (a swap, an insertion): they may overlap while they move.
  const reordered = new Set<string>();
  for (const [name, ids] of options.identity) {
    for (const other of options.identities) {
      const theirs = other.get(name);
      if (theirs && JSON.stringify(theirs) !== JSON.stringify(ids)) reordered.add(name);
    }
  }
  for (const name of reordered) {
    const members = s.resolved.marks
      .filter(m => m.part.startsWith(`${name}.`) && m.role !== 'index')
      .flatMap(m => nodeIds.get(m.key) ?? []);
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        touches.push({
          a: members[i],
          b: members[j],
          reason: 'items pass each other as they move to their new places',
        });
      }
    }
  }
  // In a diagram the beats move, a label travels with its part and passes
  // over the drawing's other lines and shapes on the way (it is placed
  // clear of them wherever it comes to rest).
  if (options.variants.length > 1) {
    const moving = [
      ...labels.flatMap(l => {
        const id = nid(l.request.key);
        return l.crosses ? [id, `${id}bg`] : [id];
      }),
      ...standaloneIds,
    ];
    for (const a of moving) {
      for (const b of shapeNodes) {
        touches.push({a, b, reason: 'the label moves with its part across the drawing'});
      }
    }
  }
  // Shapes of one diagram are drawn against each other on purpose.
  for (let i = 0; i < shapeNodes.length; i++) {
    for (let j = i + 1; j < shapeNodes.length; j++) {
      touches.push({
        a: shapeNodes[i],
        b: shapeNodes[j],
        reason: 'parts of one diagram are drawn against and across each other',
      });
    }
  }
  // Text inside a shape, and whatever is attached to that shape (an arrow
  // drawn from a block's centre crosses the block's own label).
  const partOfKey = new Map(s.resolved.marks.map(m => [m.key, m.part]));
  for (const m of s.resolved.marks) {
    if (m.role !== 'content' || !m.host) continue;
    const own = nid(m.key);
    for (const h of nodeIds.get(m.host) ?? []) {
      touches.push({a: own, b: h, reason: 'the text is written inside its shape'});
    }
    // Shapes drawn against its own (the atoms of one molecule) may reach
    // under the words, which are drawn over them.
    const host = s.resolved.marks.find(h => h.key === m.host);
    if (host) {
      const hb = emptyBounds();
      for (const p of markCorners(host)) grow(hb, p);
      for (const other of s.resolved.marks) {
        if (other.role !== 'shape' || other.key === host.key) continue;
        if (other.kind === 'text' || other.kind === 'tex') continue;
        const ob = emptyBounds();
        for (const p of markCorners(other)) grow(ob, p);
        if (
          ob.minX < hb.maxX &&
          ob.maxX > hb.minX &&
          ob.minY < hb.maxY &&
          ob.maxY > hb.minY
        ) {
          for (const n of nodeIds.get(other.key) ?? []) {
            touches.push({a: own, b: n, reason: 'the words are drawn over a shape that meets their own'});
          }
        }
      }
    }
    const hostPart = partOfKey.get(m.host) ?? '';
    for (const other of s.resolved.marks) {
      if (!other.links?.some(l => l === hostPart || hostPart.startsWith(`${l}.`) || l.startsWith(`${hostPart}.`))) continue;
      for (const n of nodeIds.get(other.key) ?? []) {
        touches.push({a: own, b: n, reason: 'the arrow is drawn from the shape this text is in'});
      }
    }
  }
  // A connector or vector touches what it is attached to, words included.
  for (const m of s.resolved.marks) {
    if (m.kind !== 'line' && m.kind !== 'arrow' && m.kind !== 'ray') continue;
    for (const link of m.links ?? []) {
      for (const other of s.resolved.marks) {
        if (other.part !== link && !other.part.startsWith(`${link}.`)) continue;
        if (other.role === 'index' || other.key === m.key) continue;
        for (const a of nodeIds.get(m.key) ?? []) {
          for (const b of nodeIds.get(other.key) ?? []) {
            touches.push({a, b, reason: 'the line is attached to this part'});
          }
        }
      }
    }
  }
  // Standalone text placed on or inside another part sits on it by design.
  for (const m of s.resolved.marks) {
    if (m.role !== 'shape' || (m.kind !== 'text' && m.kind !== 'tex')) continue;
    for (const link of m.links ?? []) {
      for (const other of s.resolved.marks) {
        if (other.part !== link && !other.part.startsWith(`${link}.`)) continue;
        if (other.kind === 'text' || other.kind === 'tex') continue;
        for (const n of nodeIds.get(other.key) ?? []) {
          touches.push({a: nid(m.key), b: n, reason: 'the words are placed on this part'});
        }
      }
    }
  }

  const parts = new Map<string, KitPart>();
  const every: string[] = [];
  // A mark of "mols.3.O" belongs to "mols", "mols.3" and "mols.3.O".
  for (const [part, ids] of byPart) {
    every.push(...ids);
    const trace = traceable.get(part) ?? [];
    const segs = part.split('.');
    for (let i = 1; i <= segs.length; i++) {
      const name = segs.slice(0, i).join('.');
      const had = parts.get(name);
      const allTrace = [...(had?.traceable ?? []), ...trace];
      parts.set(name, {
        nodes: [...(had?.nodes ?? []), ...ids],
        ...(allTrace.length ? {traceable: allTrace} : {}),
      });
    }
  }
  parts.set('', {nodes: every});
  return {nodes, touches, parts};
}
