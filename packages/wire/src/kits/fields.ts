import type {Issue} from '../document/issues.js';
import {
  SAFE_HALF_HEIGHT,
  SAFE_HALF_WIDTH,
  type Value,
} from '../document/model.js';
import {isObject} from '../document/values.js';
import {measureText} from '../measure/text.js';
import {TEX_EM, texWidthEmExact} from '../tex/terms.js';
import {REGIONS, type Box, type KitNode} from './types.js';

/** Collects located issues for one kit instance. */
export class FieldErrors {
  public readonly issues: Issue[] = [];
  public constructor(private readonly node: KitNode) {}

  public error(prop: string, message: string, hint?: string): void {
    this.issues.push({
      code: 'bad_value',
      severity: 'error',
      node: this.node.id,
      prop,
      message,
      ...(hint ? {hint} : {}),
    });
  }

  /** Unknown fields are errors, so a misspelt field is never silently dropped. */
  public onlyFields(allowed: readonly string[]): void {
    for (const key of Object.keys(this.node)) {
      if (key === 'id' || key === 'kit' || allowed.includes(key)) continue;
      this.issues.push({
        code: 'unknown_prop',
        severity: 'error',
        node: this.node.id,
        prop: key,
        message: `kit ${this.node.kit} has no field "${key}"`,
        hint: `its fields are ${allowed.join(', ')}`,
      });
    }
  }
}

export function isNumberPair(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    value.every(v => typeof v === 'number' && Number.isFinite(v))
  );
}

/** The fields every kit instance may use to say where it goes. */
export const PLACEMENT_FIELDS = ['region', 'box'];

export function checkPlacement(node: KitNode, errors: FieldErrors): void {
  if (
    node.region !== undefined &&
    (typeof node.region !== 'string' || !(node.region in REGIONS))
  ) {
    errors.error(
      'region',
      `unknown region ${JSON.stringify(node.region)}`,
      `one of ${Object.keys(REGIONS).join(', ')}`,
    );
  }
  if (node.box !== undefined) {
    const box = node.box;
    if (
      !Array.isArray(box) ||
      box.length !== 4 ||
      !box.every(v => typeof v === 'number' && Number.isFinite(v))
    ) {
      errors.error(
        'box',
        'box is [centreX, centreY, width, height] in stage coordinates',
      );
    }
  }
}

/** How far inside the safe area an explicit box is kept. */
const BOX_INSET = 16;

export function placementBox(node: KitNode): Box {
  if (Array.isArray(node.box) && node.box.length === 4) {
    // Kept inside the safe area, with room for strokes and frames that
    // reach a few pixels past a kit's box: authors put boxes right at the
    // edge, and a map frame 9px over it was refused as off-stage.
    const [x, y, width, height] = node.box as number[];
    const left = Math.max(x - width / 2, -SAFE_HALF_WIDTH + BOX_INSET);
    const right = Math.min(x + width / 2, SAFE_HALF_WIDTH - BOX_INSET);
    const top = Math.max(y - height / 2, -SAFE_HALF_HEIGHT + BOX_INSET);
    const bottom = Math.min(y + height / 2, SAFE_HALF_HEIGHT - BOX_INSET);
    if (right - left < 40 || bottom - top < 40) return {x, y, width, height};
    return {
      x: (left + right) / 2,
      y: (top + bottom) / 2,
      width: right - left,
      height: bottom - top,
    };
  }
  return REGIONS[
    typeof node.region === 'string' && node.region in REGIONS
      ? node.region
      : 'full'
  ];
}

/** A list field given either as an array or as a space-separated string. */
export function tokens(value: Value | undefined): string[] {
  if (value === undefined || value === null) return [];
  if (typeof value === 'string') return value.split(/[\s,]+/).filter(Boolean);
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === 'string');
  }
  return [];
}

export function asRecord(
  value: Value | undefined,
): Record<string, Value> | null {
  return isObject(value) ? value : null;
}

/**
 * A LaTeX string's rendered width in em: exactly as the engine will draw
 * it (MathJax, set up as the engine sets it up), or - for LaTeX MathJax
 * cannot lay out, which validation reports anyway - a rough estimate.
 */
export function texWidthEm(tex: string): number {
  const exact = texWidthEmExact(tex);
  return exact === null ? roughTexWidthEm(tex) : exact * TEX_EM;
}

function roughTexWidthEm(tex: string): number {
  const visible = tex
    .replace(/\\(text|mathrm|operatorname)\{([^}]*)\}/g, '$2')
    .replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, (_, a: string, b: string) =>
      a.length > b.length ? a : b,
    )
    .replace(/\\(quad|qquad)/g, '    ')
    .replace(/\\[a-zA-Z]+/g, 'x')
    .replace(/[{}^_\\]/g, '');
  return visible.length * 0.55;
}

/**
 * A line of plain text's width in pixels, measured with the font the
 * engine draws it in (weight 500 unless the node sets another).
 */
export function textWidth(text: string, size: number, weight = 500): number {
  return measureText(text, size, weight);
}

/**
 * The box the audit sees around a text node: its lines, plus the tenth of
 * an em each side it allows for overhanging glyphs, and a pixel of
 * rounding. Place text by this, and what is placed is what is checked.
 */
export function textBox(
  text: string,
  size: number,
  weight = 500,
): {width: number; height: number} {
  return {
    width: measureText(text, size, weight) + size * 0.2 + 2,
    height: size * 1.2 + 2,
  };
}

/** Split words into lines no wider than `width` pixels at `size`. */
export function wrapText(text: string, size: number, width: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && textWidth(next, size) > width) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

const THEME_TOKENS = new Set([
  'paper',
  'clearField',
  'ink',
  'secondaryInk',
  'hairline',
  'blue',
  'cyan',
  'coral',
  'yellow',
  'green',
  'magenta',
]);

/**
 * A kit colour field: a theme token name ("blue", "coral") or any CSS colour.
 * Theme names become theme references; anything else is checked by the core
 * validator after expansion, and reported on the kit.
 */
export function colorValue(value: Value | undefined, fallback: string): Value {
  const color = typeof value === 'string' && value ? value : fallback;
  return THEME_TOKENS.has(color) ? {theme: color} : color;
}

/** The accent colours kits cycle through, in order. */
export const ACCENTS = ['blue', 'coral', 'green', 'magenta', 'cyan', 'yellow'];

// Maths in words: the patterns the engine refuses in plain text.
const MATH_IN_TEXT =
  /[a-zA-Z0-9]\^[a-zA-Z0-9-]|[a-zA-Z0-9]\s*(<=|>=|!=)\s*[a-zA-Z0-9]|\b[a-zA-Z]\w{0,3}\s*=\s*[a-zA-Z0-9]/;
const STRONG = /[=^<>]/;
const WEAK =
  /^[-+*/]$|^[a-zA-Z]$|^[-+]?\d+(\.\d+)?$|^[a-zA-Z]{1,3}\(.*\)$|^\(.*\)$|^[a-zA-Z0-9()+\-*/^.,]+$/;

function texText(words: string): string {
  return `\\text{${words.replace(/[\\{}$&#%_]/g, c => `\\${c}`)}}`;
}

function texMath(expression: string): string {
  return expression
    .replace(/<=/g, '\\le ')
    .replace(/>=/g, '\\ge ')
    .replace(/!=/g, '\\ne ')
    .replace(/\*/g, '\\cdot ')
    .replace(/\^\(([^()]+)\)/g, '^{$1}')
    .replace(/\^(-?[a-zA-Z0-9.]+)/g, '^{$1}');
}

/**
 * A line of words with maths in it ("The surface z = x^2 + y^2") as LaTeX -
 * the words in `\text{}`, the maths typeset - or null when it is all words.
 *
 * @remarks
 * Models write maths into titles and list items the way people type it,
 * and the engine rightly refuses caret notation in plain text. Rather than
 * bounce the whole document back for it, a text kit sets that line as a
 * Latex node instead, which is what the rule asks for.
 */
export function mixedTextToTex(text: string): string | null {
  if (!MATH_IN_TEXT.test(text)) return null;
  const words = text.split(/\s+/).filter(Boolean);
  // Mark maths words; a run of them containing an operator is one formula.
  const marks = words.map(w => {
    const core = w.replace(/[,.;:!?]+$/, '');
    if (STRONG.test(core)) return 'strong';
    return WEAK.test(core) && !/^[a-zA-Z]{2,}$/.test(core) ? 'weak' : 'word';
  });
  const out: string[] = [];
  let i = 0;
  while (i < words.length) {
    let j = i;
    while (j < words.length && marks[j] !== 'word') j++;
    const run = words.slice(i, j);
    if (j > i && marks.slice(i, j).includes('strong')) {
      // Trailing punctuation belongs to the sentence, not the formula.
      const last = run[run.length - 1];
      const punctuation = last.match(/[,.;:!?]+$/)?.[0] ?? '';
      run[run.length - 1] = last.slice(0, last.length - punctuation.length);
      out.push(
        texMath(run.join(' ')) + (punctuation ? texText(punctuation) : ''),
      );
      i = j;
    } else {
      // Plain words (and any lone letters or numbers among them).
      let k = Math.max(j, i + 1);
      while (k < words.length && marks[k] === 'word') k++;
      out.push(texText(`${words.slice(i, k).join(' ')}`));
      i = k;
    }
  }
  // Keep the spaces between words and formulas.
  return out.join('\\ ');
}
