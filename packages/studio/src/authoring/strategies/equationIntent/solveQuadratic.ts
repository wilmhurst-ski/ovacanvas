import {
  extractEquation,
  type SolvedEquation,
  type SolvedStep,
} from './solveLinear';

/**
 * Solve a quadratic equation in one variable, with no model involved.
 *
 * @remarks
 * The same argument as `solveLinear`: a quadratic has a closed form, so asking
 * a language model to produce one is paying for arithmetic it can get wrong.
 * "solve x^2 - 5x + 6 = 0" is a well-defined string with a well-defined answer.
 *
 * ## The safety property, again
 *
 * **Returns `null` for anything it cannot solve exactly.** No real roots, a
 * second variable, a higher power, brackets, a coefficient it cannot read - all
 * bail, and the caller continues to the provider. A confident wrong answer on
 * screen is worse than a slower correct one.
 *
 * It also prefers **factoring to the formula when the roots are rational**,
 * because that is what a learner is usually being taught: `(x - 2)(x - 3) = 0`
 * says something the quadratic formula does not. The formula is the fallback,
 * not the default.
 */

/** A quadratic expression `a·x² + b·x + c`. */
interface Quadratic {
  readonly a: number;
  readonly b: number;
  readonly c: number;
}

function formatNumber(value: number): string {
  return String(value);
}

/** Exact rational formatting, so `5/2` never becomes `2.5`. */
function formatFraction(numerator: number, denominator: number): string {
  if (denominator === 0) return String(numerator);
  const sign = denominator < 0 ? -1 : 1;
  let n = sign * numerator;
  let d = Math.abs(denominator);
  const gcd = (x: number, y: number): number =>
    y === 0 ? Math.abs(x) : gcd(y, x % y);
  const divisor = gcd(n, d) || 1;
  n /= divisor;
  d /= divisor;
  if (d === 1) return String(n);
  return n < 0 ? `-\\frac{${-n}}{${d}}` : `\\frac{${n}}{${d}}`;
}

/** `x - 2`, `x + 3`, `x` - the factor for a given root. */
function formatFactor(root: number, variable: string): string {
  if (root === 0) return variable;
  return root > 0
    ? `(${variable} - ${formatNumber(root)})`
    : `(${variable} + ${formatNumber(-root)})`;
}

/** Render `a·x² + b·x + c` the way a person would write it. */
function formatQuadratic({a, b, c}: Quadratic, variable: string): string {
  const parts: string[] = [];

  if (a !== 0) {
    const magnitude = Math.abs(a);
    const body =
      magnitude === 1
        ? `${variable}^2`
        : `${formatNumber(magnitude)}${variable}^2`;
    parts.push(a < 0 ? `-${body}` : body);
  }
  if (b !== 0) {
    const magnitude = Math.abs(b);
    const body =
      magnitude === 1 ? variable : `${formatNumber(magnitude)}${variable}`;
    parts.push(
      parts.length === 0
        ? b < 0
          ? `-${body}`
          : body
        : b < 0
          ? `- ${body}`
          : `+ ${body}`,
    );
  }
  if (c !== 0 || parts.length === 0) {
    const magnitude = formatNumber(Math.abs(c));
    parts.push(
      parts.length === 0
        ? c < 0
          ? `-${magnitude}`
          : magnitude
        : c < 0
          ? `- ${magnitude}`
          : `+ ${magnitude}`,
    );
  }

  return parts.join(' ');
}

/**
 * Read one side as a quadratic in `variable`.
 *
 * @remarks
 * Recognises only `x^2`, `x` and a constant. Anything else - a higher power, a
 * division, a bracket - returns `null`, because a term that is silently
 * dropped becomes a wrong answer rather than a missing one.
 */
function parseQuadraticSide(side: string, variable: string): Quadratic | null {
  if (side === '') return null;
  if (/[\^]/.test(side.replace(new RegExp(`\\${variable}\\^2`, 'g'), '')))
    {return null;}
  if (/[()[\]{}/]/.test(side)) return null;

  const letters = side.replace(/[^a-z]/gi, '');
  if (letters.replace(new RegExp(variable, 'gi'), '') !== '') return null;

  const terms = side.match(/[+-]?[^+-]+/g);
  if (!terms) return null;

  let a = 0;
  let b = 0;
  let c = 0;

  for (const term of terms) {
    const squared = new RegExp(`\\^2`, 'i').test(term);
    const hasVariable = term.toLowerCase().includes(variable.toLowerCase());

    if (squared && hasVariable) {
      const raw = term
        .replace(/\^2/i, '')
        .replace(new RegExp(variable, 'gi'), '');
      if (raw === '' || raw === '+') a += 1;
      else if (raw === '-') a -= 1;
      else {
        const value = Number(raw);
        if (!Number.isFinite(value)) return null;
        a += value;
      }
    } else if (hasVariable) {
      const raw = term.replace(new RegExp(variable, 'gi'), '');
      if (raw === '' || raw === '+') b += 1;
      else if (raw === '-') b -= 1;
      else {
        const value = Number(raw);
        if (!Number.isFinite(value)) return null;
        b += value;
      }
    } else {
      const value = Number(term);
      if (!Number.isFinite(value)) return null;
      c += value;
    }
  }

  return {a, b, c};
}

/** Whether `value` is a whole number - the test for "the root is rational". */
function isWhole(value: number): boolean {
  return Number.isInteger(value);
}

function isPerfectSquare(value: number): boolean {
  return value >= 0 && isWhole(Math.sqrt(value));
}

/**
 * Solve the quadratic in `question`, or return `null`.
 *
 * @remarks
 * Handles `a·x² + b·x + c = d`, moving `d` across first. A zero `a` is not a
 * quadratic and bails - the linear solver owns that case, and it runs first.
 */
export function solveQuadraticEquation(
  question: string,
): SolvedEquation | null {
  const equation = extractEquation(question);
  if (!equation) return null;

  const sides = equation.split('=');
  if (sides.length !== 2) return null;

  const letters = equation
    .replace(/[^a-z]/gi, '')
    .toLowerCase()
    .split('');
  const distinct = [...new Set(letters)];
  if (distinct.length !== 1) return null;
  const variable = distinct[0];

  const left = parseQuadraticSide(sides[0], variable);
  const right = parseQuadraticSide(sides[1], variable);
  if (!left || !right) return null;

  const a = left.a - right.a;
  const b = left.b - right.b;
  const c = left.c - right.c;

  // Not a quadratic: the linear solver's job, and it is tried first.
  if (a === 0) return null;

  const discriminant = b * b - 4 * a * c;
  // No real roots. Showing complex ones is a different lesson than this
  // template teaches, so hand it to the provider rather than half-teach it.
  if (discriminant < 0) return null;

  const original = `${formatQuadratic(left, variable)} = ${formatQuadratic(right, variable)}`;
  const steps: SolvedStep[] = [{tex: original}];

  // Factoring, when the coefficients are the ones a learner is taught with:
  // a monic quadratic with whole roots. `(x - 2)(x - 3) = 0` says something
  // the quadratic formula does not, and it is what the textbook shows.
  if (a === 1 && isPerfectSquare(discriminant)) {
    const root = Math.sqrt(discriminant);
    // Ascending, because "x = 2 or x = 3" is how a person writes two answers
    // and "x = 3 or x = 2" reads like the order matters.
    const first = Math.min((-b + root) / 2, (-b - root) / 2);
    const second = Math.max((-b + root) / 2, (-b - root) / 2);

    if (isWhole(first) && isWhole(second)) {
      steps.push({
        tex: `${formatFactor(first, variable)}${formatFactor(second, variable)} = 0`,
        note: 'Factor the left-hand side',
      });
      steps.push({
        tex:
          first === second
            ? `${variable} = ${formatNumber(first)}`
            : `${variable} = ${formatNumber(first)} or ${variable} = ${formatNumber(second)}`,
        note: 'A product is zero when either factor is',
      });
      return {variable, title: 'Factoring a Quadratic', steps};
    }
  }

  // The formula, which always works when a real root exists. The discriminant
  // goes in under its own root first, even when it is a perfect square -
  // showing `\sqrt{49}` and then `7` is the step the working is for.
  const leading = formatNumber(-b);
  const denominator = 2 * a;

  steps.push({
    tex: `${variable} = \\frac{${leading} \\pm \\sqrt{${formatNumber(discriminant)}}}{${formatNumber(denominator)}}`,
    note: 'Substitute a, b and c into the quadratic formula',
  });

  if (isPerfectSquare(discriminant)) {
    const exactRoot = Math.sqrt(discriminant);
    steps.push({
      tex: `${variable} = \\frac{${leading} \\pm ${formatNumber(exactRoot)}}{${formatNumber(denominator)}}`,
      note: `The discriminant is ${formatNumber(discriminant)}, and its square root is ${formatNumber(exactRoot)}`,
    });

    const low = formatFraction(-b - exactRoot, denominator);
    const high = formatFraction(-b + exactRoot, denominator);
    steps.push({
      tex: `${variable} = ${low} or ${variable} = ${high}`,
      note: 'Evaluate both signs',
    });
  }

  // Plain words only, as the strategy's own prompt requires - see the note in
  // `solveLinear`. "Solving x^2 - 5x + 6 = 0" is a rendering bug in a `Txt`
  // title and the audit refuses it, correctly.
  return {variable, title: 'Solving a Quadratic Equation', steps};
}
