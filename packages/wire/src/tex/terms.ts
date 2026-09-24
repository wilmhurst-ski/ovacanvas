import {liteAdaptor} from 'mathjax-full/js/adaptors/liteAdaptor.js';
import {RegisterHTMLHandler} from 'mathjax-full/js/handlers/html.js';
import {TeX} from 'mathjax-full/js/input/tex.js';
import {AllPackages} from 'mathjax-full/js/input/tex/AllPackages.js';
import {mathjax} from 'mathjax-full/js/mathjax.js';
import {SVG} from 'mathjax-full/js/output/svg.js';

/**
 * Equations split into terms, so a changing equation moves its terms.
 *
 * @remarks
 * The engine's `Latex` morphs one equation into another by matching its
 * `tex` fragments: a fragment in both glides to its new place, the rest
 * fade. Given one fragment - a whole equation as a model writes it -
 * nothing matches and the equation just crossfades. Split into terms
 * (`x`, `^2`, `=`, `\frac{a}{b}`), the same symbols travel: `2x` moves
 * across the equals sign, `a` slides into a fraction. That is the
 * choreography of a worked derivation, with no tagging by the author.
 *
 * A split is only used when it is exactly what the engine will accept:
 * each term typeset alone must draw the same glyphs, in the same order,
 * as it does inside the whole equation - checked here with the engine's
 * own MathJax setup - or the equation stays in one piece.
 */

/**
 * Top-level terms of a LaTeX string - joined, they are the string again -
 * or null for input that should not be split (alignment, environments).
 */
export function splitTerms(tex: string): string[] | null {
  const terms: string[] = [];
  let pending = '';
  let i = 0;
  const push = (term: string) => {
    terms.push(pending + term);
    pending = '';
  };
  const attach = (text: string) => {
    if (terms.length) terms[terms.length - 1] += text;
    else pending += text;
  };
  /** The balanced group starting at `start` (at an opening brace). */
  const group = (start: number, open = '{', close = '}'): number => {
    let depth = 0;
    for (let k = start; k < tex.length; k++) {
      const c = tex[k];
      if (c === '\\') {
        k++;
        continue;
      }
      if (c === open) depth++;
      else if (c === close && --depth === 0) return k + 1;
    }
    return -1;
  };
  /** A script's argument: a group, a command, or one character. */
  const scriptArg = (start: number): number => {
    let k = start;
    while (tex[k] === ' ') k++;
    if (tex[k] === '{') return group(k);
    if (tex[k] === '\\') {
      k++;
      if (/[a-zA-Z]/.test(tex[k] ?? '')) {
        while (/[a-zA-Z]/.test(tex[k] ?? '')) k++;
        return k;
      }
      return k + 1;
    }
    return k < tex.length ? k + 1 : -1;
  };

  while (i < tex.length) {
    const c = tex[i];
    if (c === '&' || c === '%') return null;
    if (/\s/.test(c)) {
      attach(c);
      i++;
      continue;
    }
    if (c === '^' || c === '_' || c === "'") {
      const end = c === "'" ? i + 1 : scriptArg(i + 1);
      if (end < 0) return null;
      attach(tex.slice(i, end));
      i = end;
      continue;
    }
    if (c === '{') {
      const end = group(i);
      if (end < 0) return null;
      push(tex.slice(i, end));
      i = end;
      continue;
    }
    if (c === '\\') {
      const next = tex[i + 1] ?? '';
      if (next === '\\') return null;
      if (!/[a-zA-Z]/.test(next)) {
        push(tex.slice(i, i + 2));
        i += 2;
        continue;
      }
      let k = i + 1;
      while (/[a-zA-Z]/.test(tex[k] ?? '')) k++;
      const name = tex.slice(i + 1, k);
      if (name === 'begin' || name === 'end' || name === 'right') return null;
      if (name === 'left') {
        // Through the matching \right and its delimiter: sized delimiters
        // are only ever drawn as a pair.
        let depth = 1;
        let m = k;
        while (m < tex.length && depth > 0) {
          if (
            tex.startsWith('\\left', m) &&
            !/[a-zA-Z]/.test(tex[m + 5] ?? '')
          ) {
            depth++;
            m += 5;
          } else if (
            tex.startsWith('\\right', m) &&
            !/[a-zA-Z]/.test(tex[m + 6] ?? '')
          ) {
            depth--;
            m += 6;
          } else m += tex[m] === '\\' ? 2 : 1;
        }
        if (depth > 0) return null;
        const end = scriptArg(m);
        if (end < 0) return null;
        push(tex.slice(i, end));
        i = end;
        continue;
      }
      // The command with its arguments: an optional [..] and brace groups.
      if (tex[k] === '[' && (name === 'sqrt' || name === 'xrightarrow')) {
        const end = group(k, '[', ']');
        if (end < 0) return null;
        k = end;
      }
      while (tex[k] === '{') {
        const end = group(k);
        if (end < 0) return null;
        k = end;
      }
      push(tex.slice(i, k));
      i = k;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      let k = i;
      while (/[0-9.]/.test(tex[k] ?? '')) k++;
      push(tex.slice(i, k));
      i = k;
      continue;
    }
    push(c);
    i++;
  }
  if (!terms.length) return null;
  return terms.join('') === tex ? terms : null;
}

/**
 * Rendered size per MathJax em. The engine sizes a Latex node from the
 * SVG's width in ex, converted by the browser; measured against rendered
 * equations (a label flown onto its term lands on the same pixels), one
 * MathJax em comes out as one font-size.
 */
export const TEX_EM = 1;

// ---- checking a split against the engine's own typesetting -----------------

/** MathJax, set up on first use exactly as the engine's `Latex` sets it up. */
const MATHJAX: {convert?: (tex: string) => string} = {};

function typeset(tex: string): string {
  if (!MATHJAX.convert) {
    const adaptor = liteAdaptor();
    RegisterHTMLHandler(adaptor);
    const document = mathjax.document('', {
      // eslint-disable-next-line @typescript-eslint/naming-convention
      InputJax: new TeX({packages: AllPackages}),
      // eslint-disable-next-line @typescript-eslint/naming-convention
      OutputJax: new SVG({fontCache: 'local'}),
    });
    MATHJAX.convert = t => adaptor.innerHTML(document.convert(t, {}) as never);
  }
  return MATHJAX.convert(tex);
}

// ---- where each glyph sits ---------------------------------------------------

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

function parseTransform(text: string | undefined): Matrix {
  let m = IDENTITY;
  if (!text) return m;
  for (const [, name, args] of text.matchAll(/(\w+)\(([^)]*)\)/g)) {
    const v = args
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);
    if (name === 'translate') {
      m = multiply(m, [1, 0, 0, 1, v[0] ?? 0, v[1] ?? 0]);
    } else if (name === 'scale') {
      m = multiply(m, [v[0] ?? 1, 0, 0, v[1] ?? v[0] ?? 1, 0, 0]);
    } else if (name === 'matrix' && v.length === 6) {
      m = multiply(m, v as Matrix);
    }
  }
  return m;
}

/** A path's extent from its coordinates (control points included). */
function pathBox(d: string): [number, number, number, number] | null {
  const numbers = (d.match(/-?\d*\.?\d+(?:e-?\d+)?/g) ?? []).map(Number);
  if (numbers.length < 2) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i + 1 < numbers.length; i += 2) {
    x0 = Math.min(x0, numbers[i]);
    x1 = Math.max(x1, numbers[i]);
    y0 = Math.min(y0, numbers[i + 1]);
    y1 = Math.max(y1, numbers[i + 1]);
  }
  return [x0, y0, x1, y1];
}

export interface GlyphBox {
  readonly id: string;
  /** Extent in the SVG's units (1/1000 em), relative to the drawing's centre. */
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

const LAYOUTS = new Map<string, GlyphBox[] | null>();

/**
 * Every glyph of an equation, in the order the engine reads them, with
 * where it sits relative to the centre of the drawing - the engine centres
 * a Latex node on exactly that centre.
 */
export function glyphLayout(tex: string): GlyphBox[] | null {
  const known = LAYOUTS.get(tex);
  if (known !== undefined) return known;
  let out: GlyphBox[] | null = null;
  try {
    const svg = typeset(tex);
    const box = svg.match(
      /viewBox="([-\d.e]+) ([-\d.e]+) ([-\d.e]+) ([-\d.e]+)"/,
    );
    if (box) {
      const [vx, vy, vw, vh] = box.slice(1).map(Number);
      const cx = vx + vw / 2;
      const cy = vy + vh / 2;
      const defs = new Map<string, [number, number, number, number]>();
      for (const [, id, d] of svg.matchAll(/<path id="([^"]+)" d="([^"]*)"/g)) {
        const b = pathBox(d);
        if (b) defs.set(id, b);
      }
      const body = svg.replace(/<defs>[\s\S]*?<\/defs>/, '');
      const stack: Matrix[] = [IDENTITY];
      out = [];
      for (const [tag, closing, name, attrs, selfClose] of body.matchAll(
        /<(\/?)(\w+)([^>]*?)(\/?)>/g,
      )) {
        void tag;
        if (closing) {
          if (name !== 'use' && name !== 'rect' && name !== 'path') stack.pop();
          continue;
        }
        const attr = (key: string) =>
          attrs.match(new RegExp(`(?:^|\\s)${key}="([^"]*)"`))?.[1];
        const own = multiply(
          multiply(stack[stack.length - 1], parseTransform(attr('transform'))),
          [1, 0, 0, 1, Number(attr('x') ?? 0), Number(attr('y') ?? 0)],
        );
        let extent: [number, number, number, number] | null = null;
        let id = name;
        if (name === 'use') {
          const href = attr('xlink:href') ?? attr('href') ?? '';
          id = href.slice(href.lastIndexOf('-') + 1);
          extent = defs.get(href.slice(1)) ?? null;
        } else if (name === 'rect') {
          extent = [
            0,
            0,
            Number(attr('width') ?? 0),
            Number(attr('height') ?? 0),
          ];
          // x and y are already in the transform.
        } else if (name === 'path') {
          extent = pathBox(attr('d') ?? '');
          id = attr('id') ?? 'path';
        } else {
          // A group (or a nested svg, placed by its x and y).
          if (!selfClose) stack.push(own);
          continue;
        }
        if (!extent) continue;
        const corners = [
          [extent[0], extent[1]],
          [extent[2], extent[1]],
          [extent[0], extent[3]],
          [extent[2], extent[3]],
        ].map(([x, y]) => [
          own[0] * x + own[2] * y + own[4] - cx,
          own[1] * x + own[3] * y + own[5] - cy,
        ]);
        out.push({
          id,
          x0: Math.min(...corners.map(c => c[0])),
          y0: Math.min(...corners.map(c => c[1])),
          x1: Math.max(...corners.map(c => c[0])),
          y1: Math.max(...corners.map(c => c[1])),
        });
      }
    }
  } catch {
    out = null;
  }
  LAYOUTS.set(tex, out);
  return out;
}

export interface TermPlace {
  /** Where the term's glyphs sit, relative to the target's centre (1/1000 em). */
  readonly dx: number;
  readonly dy: number;
  /** Where the label's own glyphs sit relative to its centre, so it can land on them. */
  readonly ownDx: number;
  readonly ownDy: number;
}

/**
 * Where `label` appears inside `target`, as the same glyphs in a row - the
 * occurrence that is new since `previous` when there is one - or null.
 */
export function locateTerm(
  label: string,
  target: string,
  previous?: string,
): TermPlace | null {
  const own = glyphLayout(label);
  const whole = glyphLayout(target);
  if (!own?.length || !whole?.length) return null;
  const ids = own.map(g => g.id);
  const find = (glyphs: readonly GlyphBox[]) => {
    const at: number[] = [];
    for (let i = 0; i + ids.length <= glyphs.length; i++) {
      if (ids.every((id, k) => glyphs[i + k].id === id)) at.push(i);
    }
    return at;
  };
  const places = find(whole);
  if (!places.length) return null;
  const before = previous ? find(glyphLayout(previous) ?? []).length : 0;
  const start = places[Math.min(before, places.length - 1)];
  const run = whole.slice(start, start + ids.length);
  const centre = (glyphs: readonly GlyphBox[]) => [
    (Math.min(...glyphs.map(g => g.x0)) + Math.max(...glyphs.map(g => g.x1))) /
      2,
    (Math.min(...glyphs.map(g => g.y0)) + Math.max(...glyphs.map(g => g.y1))) /
      2,
  ];
  const [dx, dy] = centre(run);
  const [ownDx, ownDy] = centre(own);
  return {dx, dy, ownDx, ownDy};
}

/** The glyph ids the engine reads out of an SVG, in drawing order. */
function glyphs(svg: string): string[] {
  const body = svg.replace(/<defs>[\s\S]*?<\/defs>/g, '');
  const out: string[] = [];
  for (const match of body.matchAll(
    /<use\b[^>]*?(?:xlink:)?href="#([^"]+)"|<(rect|path|circle|ellipse)\b/g,
  )) {
    const id = match[1] ?? match[2];
    out.push(id.includes('-') ? id.slice(id.lastIndexOf('-') + 1) : id);
  }
  return out;
}

/** The engine's patch-ups for a fragment typeset on its own. */
function fragmentTex(sub: string): string {
  let tex = sub.trim();
  if (
    ['\\overline', '\\sqrt', '\\sqrt{'].includes(tex) ||
    tex.endsWith('_') ||
    tex.endsWith('^') ||
    tex.endsWith('dot')
  ) {
    tex += '{\\quad}';
  }
  return tex;
}

const CHECKED = new Map<string, boolean>();

/** Whether the engine will accept these fragments of `whole` and match them. */
export function engineAccepts(terms: readonly string[]): boolean {
  const key = JSON.stringify(terms);
  const known = CHECKED.get(key);
  if (known !== undefined) return known;
  let ok = false;
  try {
    // The engine splits every fragment on {{...}} again, and drops blanks.
    if (terms.some(t => /{{.*?}}/.test(t))) throw new Error('nested marker');
    const subs = terms.map(t => t.trim()).filter(t => t.length > 0);
    const remaining = glyphs(typeset(terms.join('')));
    ok = true;
    for (const sub of subs) {
      const own = glyphs(typeset(fragmentTex(sub)));
      if (!own.length) continue;
      const at = remaining.findIndex(g => g === own[0]);
      // The engine takes the first match; anything but the front means a
      // fragment would claim another's glyphs.
      if (at !== 0 || remaining.length < own.length) {
        ok = false;
        break;
      }
      for (let k = 0; k < own.length; k++) {
        if (remaining[k] !== own[k]) ok = false;
      }
      if (!ok) break;
      remaining.splice(0, own.length);
    }
    if (ok && remaining.length) ok = false;
  } catch {
    ok = false;
  }
  CHECKED.set(key, ok);
  return ok;
}

/**
 * An equation's width in em, as the engine will draw it (MathJax's own
 * layout; the engine sizes a Latex node from the same SVG).
 */
export function texWidthEmExact(tex: string): number | null {
  try {
    const svg = typeset(tex);
    const box = svg.match(
      /viewBox="([-\d.e]+) ([-\d.e]+) ([-\d.e]+) ([-\d.e]+)"/,
    );
    return box ? Number(box[3]) / 1000 : null;
  } catch {
    return null;
  }
}

/** An equation's height in em, as the engine will draw it. */
export function texHeightEmExact(tex: string): number | null {
  try {
    const box = typeset(tex).match(
      /viewBox="([-\d.e]+) ([-\d.e]+) ([-\d.e]+) ([-\d.e]+)"/,
    );
    return box ? Number(box[4]) / 1000 : null;
  } catch {
    return null;
  }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Give symbols a colour wherever they appear: `{"x": "#2F66D0"}` turns
 * every standalone `x` into `\textcolor{#2F66D0}{x}` - a letter inside a word
 * or a command name is left alone. A role keeps its colour through every
 * step, and since the coloured term is written the same way in each step,
 * it still travels from one to the next.
 */
export function colorize(
  tex: string,
  colors: Readonly<Record<string, string>>,
): string {
  // One pass over the original text, every symbol at once (longest first,
  // so "x^2", if named, wins over "x") - text already coloured is never
  // scanned again, so a colour code can never be coloured itself.
  const symbols = Object.keys(colors)
    .filter(s => s.length > 0)
    .sort((a, b) => b.length - a.length);
  if (!symbols.length) return tex;
  const alternatives = symbols.map(symbol => {
    // In maths, letters side by side are separate symbols (2xy is 2, x,
    // y), so a one-letter symbol is found anywhere outside words and
    // command names; a longer one must stand on its own.
    const single = /^[a-zA-Z]$/.test(symbol);
    const edge = !single && /^[a-zA-Z]/.test(symbol) ? '(?<![a-zA-Z])' : '';
    const tail = !single && /[a-zA-Z]$/.test(symbol) ? '(?![a-zA-Z])' : '';
    return `${edge}${escapeRegExp(symbol)}${tail}`;
  });
  const pattern = new RegExp(alternatives.join('|'), 'g');
  // \textcolor, not {\color ...}: two opening braces in a row are the
  // engine's own fragment marker, and would be stripped.
  const wrap = (m: string) => `\\textcolor{${colors[m]}}{${m}}`;
  // Words (\text, \mathrm, \operatorname) are left alone; a command is
  // coloured only when it is itself a symbol (\theta).
  return tex.replace(
    /(\\(?:text|mathrm|operatorname|textbf|textit)\{[^}]*\})|(\\[a-zA-Z]+)|([^\\]+|\\.)/g,
    (whole, word?: string, command?: string) => {
      if (word) return whole;
      if (command) return command in colors ? wrap(command) : whole;
      return whole.replace(pattern, m => (m in colors ? wrap(m) : m));
    },
  );
}

const PROBLEMS = new Map<string, string | null>();

/**
 * What MathJax - set up as the engine sets it up - says is wrong with a
 * LaTeX string, or null when it typesets. The engine throws on the same
 * error at render time; asked here, the problem is reported on the node
 * that has it, before anything is generated.
 */
export function texProblem(tex: string | readonly string[]): string | null {
  // Exactly what the engine typesets: every part split on {{...}}, the
  // markers dropped, blanks removed, joined.
  const whole = (typeof tex === 'string' ? [tex] : [...tex])
    .flatMap(part => part.split(/{{(.*?)}}/))
    .filter(part => part.trim().length > 0)
    .join('');
  const known = PROBLEMS.get(whole);
  if (known !== undefined) return known;
  let problem: string | null = null;
  try {
    const svg = typeset(whole);
    const error = svg.match(/data-mjx-error="([^"]*)"/);
    if (error) problem = error[1] || 'invalid LaTeX';
  } catch (error) {
    problem = error instanceof Error ? error.message : String(error);
  }
  PROBLEMS.set(whole, problem);
  return problem;
}

/**
 * The equation as terms the engine can morph term by term, or as it was
 * when it cannot be split safely.
 */
export function asTerms(tex: string): string | string[] {
  const terms = splitTerms(tex);
  if (!terms || terms.length < 2) return tex;
  return engineAccepts(terms) ? terms : tex;
}
