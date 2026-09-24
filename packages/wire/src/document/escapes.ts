import type {Issue} from './issues.js';
import {isObject} from './values.js';

/**
 * LaTeX commands whose first letter is also a JSON escape letter (t, b, f,
 * n, r). Written with a single backslash inside a JSON string, the backslash
 * and that letter become a control character - frac becomes a form feed
 * followed by "rac" - and the LaTeX silently breaks.
 */
const COMMANDS = new Set([
  // t
  'text',
  'textbf',
  'textit',
  'textrm',
  'textsf',
  'texttt',
  'times',
  'theta',
  'tau',
  'tan',
  'tanh',
  'to',
  'top',
  'triangle',
  'triangleq',
  'tilde',
  'therefore',
  'tfrac',
  'textstyle',
  'thinspace',
  // b
  'beta',
  'bar',
  'bf',
  'binom',
  'big',
  'bigl',
  'bigr',
  'Big',
  'bigg',
  'blacksquare',
  'bot',
  'because',
  'bullet',
  'boxed',
  'bmod',
  'bigcup',
  'bigcap',
  'begin',
  'backslash',
  'breve',
  // f
  'frac',
  'forall',
  'flat',
  'frown',
  'fbox',
  // n
  'nu',
  'nabla',
  'neq',
  'ne',
  'not',
  'neg',
  'nearrow',
  'newline',
  'ni',
  'notin',
  'nless',
  'ngtr',
  // r
  'rho',
  'right',
  'rightarrow',
  'rightleftharpoons',
  'rangle',
  'rfloor',
  'rceil',
  'rbrace',
  'rm',
  'rightharpoonup',
  'rVert',
  'rvert',
]);

const ESCAPE_LETTER = new Map<string, string>([
  ['\t', 't'],
  ['\b', 'b'],
  ['\f', 'f'],
  ['\n', 'n'],
  ['\r', 'r'],
]);

/**
 * Restore LaTeX commands that a JSON escape swallowed, anywhere in a
 * document, reporting each repair as a located warning.
 *
 * @remarks
 * Only an exact command name is restored - a control character followed by
 * letters that spell `frac` exactly (then a non-letter) - so ordinary text
 * with a real line break in it is never touched. The intent is
 * unambiguous and the repair is exact, so it is fixed here rather than sent
 * back to the model as an error to retry.
 */
export function repairJsonEscapes(input: unknown): {
  value: unknown;
  issues: Issue[];
} {
  const issues: Issue[] = [];
  const fixString = (
    text: string,
    where: {node?: string; prop?: string},
  ): string => {
    if (!/[\t\b\f\n\r]/.test(text)) return text;
    let changed = false;
    const fixed = text.replace(
      /([\t\b\f\n\r])([A-Za-z]*)/g,
      (match, control: string, rest: string) => {
        const word = ESCAPE_LETTER.get(control) + rest;
        if (!COMMANDS.has(word)) return match;
        changed = true;
        return `\\${word}`;
      },
    );
    if (changed) {
      issues.push({
        code: 'json_escape',
        severity: 'warning',
        ...where,
        message: `a JSON escape swallowed LaTeX backslashes and was repaired: ${JSON.stringify(fixed)}`,
        hint: 'inside a JSON string write two backslashes, e.g. "\\\\frac{a}{b}"',
      });
    }
    return fixed;
  };
  const walk = (
    value: unknown,
    where: {node?: string; prop?: string},
  ): unknown => {
    if (typeof value === 'string') return fixString(value, where);
    if (Array.isArray(value)) return value.map(v => walk(v, where));
    if (isObject(value)) {
      const out: Record<string, unknown> = {};
      for (const [key, v] of Object.entries(value)) {
        out[key] = walk(v, {
          ...where,
          ...(where.node !== undefined &&
          where.prop === undefined &&
          key !== 'id'
            ? {prop: key}
            : {}),
        });
      }
      return out;
    }
    return value;
  };
  if (!isObject(input)) return {value: input, issues};
  const value: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(input)) {
    if (key === 'nodes' && Array.isArray(v)) {
      value.nodes = v.map(node => {
        if (!isObject(node)) return node;
        const id = typeof node.id === 'string' ? node.id : undefined;
        const out: Record<string, unknown> = {};
        for (const [field, fv] of Object.entries(node)) {
          if (field === 'props' && isObject(fv)) {
            out.props = Object.fromEntries(
              Object.entries(fv).map(([prop, pv]) => [
                prop,
                walk(pv, {...(id ? {node: id} : {}), prop}),
              ]),
            );
          } else {
            out[field] = walk(fv, {...(id ? {node: id} : {}), prop: field});
          }
        }
        return out;
      });
    } else value[key] = walk(v, {});
  }
  return {value: issues.length ? value : input, issues};
}
