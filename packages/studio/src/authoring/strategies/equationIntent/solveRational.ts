import {
  extractEquation,
  solveLinearEquation,
  type SolvedEquation,
} from './solveLinear';
import {solveQuadraticEquation} from './solveQuadratic';

/**
 * Solve a rational equation in one variable, with no model involved.
 *
 * @remarks
 * A rational equation is not a new kind of problem - it is a linear or
 * quadratic one wearing a denominator. Clearing the denominators turns
 * `3/(x - 1) = 2` into `2x - 5 = 0`, which the solvers this module already has
 * handle exactly. So this does the clearing, then delegates.
 *
 * That delegation is also the safety story. Every step here is polynomial
 * arithmetic with exact integer coefficients, and anything it cannot reduce to
 * a linear or quadratic it refuses - including the case that makes rational
 * equations genuinely dangerous, a root that makes a denominator zero.
 *
 * ## The domain restriction, which is the whole risk
 *
 * `x/(x - 2) = 2/(x - 2)` cross-multiplies to `x = 2` - which is not a
 * solution, because it makes both denominators zero. A solver that reported it
 * would be confidently wrong in the worst way: the arithmetic is right and the
 * answer is not. So every candidate root is checked against the original
 * denominators, and the whole equation is refused if any root is excluded.
 * Refusing is cheap; the model can try.
 */

/** Coefficients by power: `[c0, c1, c2]` is `c2·x² + c1·x + c0`. */
type Poly = readonly number[];

function degree(p: Poly): number {
  let d = p.length - 1;
  while (d > 0 && p[d] === 0) d--;
  return d;
}

function trim(p: number[]): Poly {
  const d = degree(p);
  return p.slice(0, d + 1);
}

function sub(a: Poly, b: Poly): Poly {
  const out = new Array(Math.max(a.length, b.length)).fill(0);
  for (let i = 0; i < out.length; i++) out[i] = (a[i] ?? 0) - (b[i] ?? 0);
  return trim(out);
}

function mul(a: Poly, b: Poly): Poly {
  const out = new Array(a.length + b.length - 1).fill(0);
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) out[i + j] += a[i] * b[j];
  }
  return trim(out);
}

/** Evaluate at a point - used only to test whether a root is excluded. */
function evaluate(p: Poly, x: number): number {
  return p.reduce(
    (total, coefficient, power) => total + coefficient * x ** power,
    0,
  );
}

/** `2x - 5`, `x^2 - 5x + 6`, `7` - the way a person would write it. */
function formatPoly(p: Poly, variable: string): string {
  const parts: string[] = [];
  for (let power = degree(p); power >= 0; power--) {
    const coefficient = p[power] ?? 0;
    if (coefficient === 0) continue;

    const magnitude = Math.abs(coefficient);
    const body =
      power === 0
        ? String(magnitude)
        : `${magnitude === 1 ? '' : magnitude}${variable}${power === 1 ? '' : `^${power}`}`;

    if (parts.length === 0) parts.push(coefficient < 0 ? `-${body}` : body);
    else parts.push(coefficient < 0 ? `- ${body}` : `+ ${body}`);
  }
  return parts.length === 0 ? '0' : parts.join(' ');
}

/**
 * Read one side as a polynomial, or a fraction of two.
 *
 * @remarks
 * Only `N/D` with a single slash, and only polynomials of degree ≤ 2 in either
 * part. Anything else - a nested fraction, a bracket, a higher power - returns
 * `null` rather than being approximated.
 */
function parseSide(side: string, variable: string): {n: Poly; d: Poly} | null {
  const parts = side.split('/');
  if (parts.length > 2) return null;

  const numerator = parsePoly(parts[0], variable);
  if (!numerator) return null;

  if (parts.length === 1) return {n: numerator, d: [1]};

  // A denominator may be bracketed, or a single term. "2/x" is unambiguous;
  // "3/x - 1" is not - it could mean 3/(x-1) or (3/x) - 1 - so a multi-term
  // denominator has to be bracketed or the equation is refused rather than
  // guessed at.
  const raw = parts[1];
  let denominatorText: string;
  if (raw.startsWith('(') && raw.endsWith(')')) {
    denominatorText = raw.slice(1, -1);
  } else if (!/[+-]/.test(raw.slice(1))) {
    denominatorText = raw;
  } else {
    return null;
  }

  const denominator = parsePoly(denominatorText, variable);
  if (!denominator) return null;
  if (degree(denominator) > 1) return null;

  return {n: numerator, d: denominator};
}

/** Read a bracket-free polynomial of degree ≤ 2. */
function parsePoly(text: string, variable: string): Poly | null {
  if (text === '') return null;
  if (/[\^()[\]{}*]/.test(text.replace(/\^2/g, ''))) return null;
  if (text.includes('/')) return null;

  const letters = text.replace(/[^a-z]/gi, '');
  if (letters.replace(new RegExp(variable, 'gi'), '') !== '') return null;

  const terms = text.match(/[+-]?[^+-]+/g);
  if (!terms) return null;

  const coefficients = [0, 0, 0];
  for (const term of terms) {
    const squared = /\^2/.test(term);
    const hasVariable = term.toLowerCase().includes(variable.toLowerCase());

    if (squared) {
      if (!hasVariable) return null;
      const raw = term
        .replace(/\^2/, '')
        .replace(new RegExp(variable, 'gi'), '');
      const value =
        raw === '' || raw === '+' ? 1 : raw === '-' ? -1 : Number(raw);
      if (!Number.isFinite(value)) return null;
      coefficients[2] += value;
    } else if (hasVariable) {
      const raw = term.replace(new RegExp(variable, 'gi'), '');
      const value =
        raw === '' || raw === '+' ? 1 : raw === '-' ? -1 : Number(raw);
      if (!Number.isFinite(value)) return null;
      coefficients[1] += value;
    } else {
      const value = Number(term);
      if (!Number.isFinite(value)) return null;
      coefficients[0] += value;
    }
  }

  return trim(coefficients);
}

/**
 * Solve the rational equation in `question`, or return `null`.
 *
 * @remarks
 * Handles `N1/D1 = N2/D2` where each part is a polynomial of degree ≤ 2 and
 * each denominator is at most linear - which is what a learner's "solve
 * 3/(x - 1) = 2" actually is.
 */
export function solveRationalEquation(question: string): SolvedEquation | null {
  const equation = extractEquation(question);
  if (!equation) return null;
  if (!equation.includes('/')) return null;

  const sides = equation.split('=');
  if (sides.length !== 2) return null;

  const letters = equation
    .replace(/[^a-z]/gi, '')
    .toLowerCase()
    .split('');
  const distinct = [...new Set(letters)];
  if (distinct.length !== 1) return null;
  const variable = distinct[0];

  const left = parseSide(sides[0], variable);
  const right = parseSide(sides[1], variable);
  if (!left || !right) return null;

  // At least one side must actually be a fraction, or another solver owns it.
  if (degree(left.d) === 0 && degree(right.d) === 0) return null;

  // Cross-multiply: N1·D2 = N2·D1.
  const leftProduct = mul(left.n, right.d);
  const rightProduct = mul(right.n, left.d);
  const combined = sub(leftProduct, rightProduct);
  const order = degree(combined);

  // Higher than quadratic is not something the delegated solvers can answer.
  if (order > 2 || order === 0) return null;

  const normalised = `${formatPoly(combined, variable)} = 0`;
  const solved =
    order === 1
      ? solveLinearEquation(`solve ${normalised}`)
      : solveQuadraticEquation(`solve ${normalised}`);
  if (!solved) return null;

  // The domain check. A root that zeroes a denominator is not a solution, and
  // reporting it would be wrong in the worst way - arithmetically correct.
  const roots = rootsOf(solved);
  if (roots.length === 0) return null;
  for (const root of roots) {
    if (evaluate(left.d, root) === 0 || evaluate(right.d, root) === 0) {
      return null;
    }
  }

  const cleared = `${formatPoly(leftProduct, variable)} = ${formatPoly(rightProduct, variable)}`;
  return {
    variable,
    title: 'Solving a Rational Equation',
    steps: [
      {
        tex: `\\frac{${formatPoly(left.n, variable)}}{${formatPoly(left.d, variable)}} = ${
          degree(right.d) === 0
            ? formatPoly(right.n, variable)
            : `\\frac{${formatPoly(right.n, variable)}}{${formatPoly(right.d, variable)}}`
        }`,
      },
      {
        tex: cleared,
        note:
          degree(left.d) === 0
            ? `Multiply both sides by ${formatPoly(right.d, variable)}`
            : `Multiply both sides by ${formatPoly(left.d, variable)}${
                degree(right.d) === 0
                  ? ''
                  : ` and ${formatPoly(right.d, variable)}`
              }`,
      },
      ...solved.steps.slice(1),
    ],
  };
}

/**
 * The numeric roots a solved equation ends with.
 *
 * @remarks
 * Read back off the final step rather than recomputed, so the domain check
 * tests exactly the values that will be shown. Deliberately conservative: a
 * root it cannot parse as a plain number - a surd, say - yields no roots and
 * the whole equation is refused, because an unchecked root is the failure this
 * function exists to prevent.
 */
function rootsOf(solved: SolvedEquation): number[] {
  const last = solved.steps[solved.steps.length - 1].tex;
  const right = last.split('=').slice(1).join('=');
  const values = right.split(/\s+or\s+/);

  const roots: number[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    const fraction = trimmed.match(/^(-?\\frac\{(-?\d+)\}\{(\d+)\}|(-?\d+))$/);
    if (!fraction) return [];
    if (fraction[2] !== undefined) {
      roots.push(Number(fraction[2]) / Number(fraction[3]));
    } else {
      roots.push(Number(fraction[4]));
    }
  }
  return roots;
}
