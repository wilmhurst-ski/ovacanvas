/**
 * Solve a linear equation in one variable, with no model involved.
 *
 * @remarks
 * The pipeline already turns an intent into a beat deterministically - the
 * template, the audit, the repair and the composition pass are all code. The
 * one step that needed a language model was reading the question, and for the
 * commonest question there is nothing to read: "solve 2x + 3 = 7" is a
 * well-defined string with a well-defined answer. Parsing it costs nothing,
 * cannot fail on a rate limit, and returns in microseconds instead of seconds.
 *
 * This follows the project's own rule - mechanical and deterministic first,
 * a model only for what genuinely needs judgement - applied one step earlier
 * than the retry loop. It also means the product works with **no API key at
 * all** for the equations a learner is most likely to type.
 *
 * ## The safety property that matters
 *
 * **It returns `null` for anything it cannot solve exactly.** A wrong answer
 * rendered confidently is far worse than falling through to a model, so every
 * unsupported construct - a second variable, an exponent, a division by the
 * variable, a coefficient it cannot read - bails out rather than guessing.
 * Callers treat `null` as "not my problem" and continue to the provider.
 */

export interface SolvedStep {
  readonly tex: string;
  readonly note?: string;
}

export interface SolvedEquation {
  readonly variable: string;
  readonly title: string;
  readonly steps: readonly SolvedStep[];
}

/** A linear expression `coefficient * variable + constant`. */
interface Linear {
  readonly coefficient: number;
  readonly constant: number;
}

/** Exact rational arithmetic, so `x = 4/3` never becomes `1.3333333`. */
interface Fraction {
  readonly numerator: number;
  readonly denominator: number;
}

function gcd(a: number, b: number): number {
  return b === 0 ? Math.abs(a) : gcd(b, a % b);
}

function fraction(numerator: number, denominator: number): Fraction | null {
  if (denominator === 0) return null;
  const sign = denominator < 0 ? -1 : 1;
  const divisor = gcd(numerator, denominator) || 1;
  return {
    numerator: (sign * numerator) / divisor,
    denominator: Math.abs(denominator) / divisor,
  };
}

/**
 * Strip the wrapper words a learner naturally types.
 *
 * @remarks
 * Exported because the quadratic solver needs exactly this and nothing more -
 * "solve 2x^2 + 3x - 5 = 0 step by step" wraps its equation the same way. The
 * two solvers differ in how they *solve*, not in how they read.
 */
export function extractEquation(question: string): string | null {
  let text = question
    // Unicode minus and friends, so a pasted equation parses like a typed one.
    .replace(/[\u2212\u2013\u2014]/g, '-')
    .replace(/[×✕]/g, '*')
    .replace(/\s+/g, '');

  // Strip the wrapper words a learner types around an equation, repeatedly,
  // until nothing more comes off. A single pass is not enough: "solve the
  // quadratic equation x^2 - 5x + 6 = 0" needs "solve", then "the", then
  // "quadratic", then "equation" removed before what is left is an equation -
  // and leaving any of them in makes the leftover letters look like a second
  // unknown, so the solver correctly but uselessly refuses its own question.
  // Best-effort, and deliberately so. This is a list rather than a general
  // "strip the English" rule because the two are genuinely hard to tell apart:
  // the variable in "solve the quadratic equation x^2" is the last letter of a
  // long letter-run, so any rule greedy enough to remove "equation" also eats
  // the `x`. An unrecognised phrasing therefore falls through to the provider
  // - which is the correct outcome, not a failure, and is why the list can
  // afford to be incomplete.
  const FILLER =
    /^(please|solve|find|calculate|workout|value|of|the|this|following|quadratic|linear|simultaneous|cubic|equation|expression|for|and|show|stepbystep|withsteps)/i;
  let previous = '';
  while (text !== previous) {
    previous = text;
    text = text.replace(FILLER, '');
    // A variable named before a colon: "x: 3x = 12".
    text = text.replace(/^[a-z]:/i, '');
  }

  // ...and a trailing instruction: "stepbystep", "withsteps".
  text = text.replace(/(stepbystep|withsteps|showsteps|andshowsteps)$/i, '');
  text = text.replace(/:$/, '');

  return text.includes('=') ? text : null;
}

/**
 * Read one side of the equation.
 *
 * @remarks
 * Splits on sign boundaries and classifies each term as variable-bearing or
 * constant. Anything it does not recognise - a `^`, a `(`, a `/`, a second
 * letter - returns `null` rather than being skipped, because silently dropping
 * a term would produce a confident wrong answer.
 */
function parseSide(side: string, variable: string): Linear | null {
  if (side === '') return null;
  if (/[\^()[\]{}]/.test(side)) return null;
  if (side.includes('/')) return null;

  // Every letter in the equation must be the variable, or we cannot be sure
  // which one is unknown.
  const letters = side.replace(/[^a-z]/gi, '');
  if (letters.replace(new RegExp(variable, 'gi'), '') !== '') return null;

  const terms = side.match(/[+-]?[^+-]+/g);
  if (!terms) return null;

  let coefficient = 0;
  let constant = 0;

  for (const term of terms) {
    const hasVariable = term.toLowerCase().includes(variable.toLowerCase());
    if (hasVariable) {
      // `2x` -> 2, `-x` -> -1, `x` -> 1
      const raw = term.replace(new RegExp(variable, 'gi'), '');
      if (raw === '' || raw === '+') coefficient += 1;
      else if (raw === '-') coefficient -= 1;
      else {
        const value = Number(raw);
        if (!Number.isFinite(value)) return null;
        coefficient += value;
      }
    } else {
      const value = Number(term);
      if (!Number.isFinite(value)) return null;
      constant += value;
    }
  }

  return {coefficient, constant};
}

/** Render `a x + b` the way a person would write it: "2x + 3", "-x - 4", "5". */
function formatLinear(
  {coefficient, constant}: Linear,
  variable: string,
): string {
  const parts: string[] = [];

  if (coefficient !== 0) {
    const magnitude = Math.abs(coefficient);
    const body =
      magnitude === 1 ? variable : `${formatNumber(magnitude)}${variable}`;
    parts.push(coefficient < 0 ? `-${body}` : body);
  }
  if (constant !== 0 || parts.length === 0) {
    const magnitude = formatNumber(Math.abs(constant));
    if (parts.length === 0)
      {parts.push(constant < 0 ? `-${magnitude}` : magnitude);}
    else parts.push(constant < 0 ? `- ${magnitude}` : `+ ${magnitude}`);
  }

  return parts.join(' ');
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value);
}

/**
 * A constant as a TeX fragment: integers plainly, everything else as a fraction.
 *
 * @remarks
 * The sign is hoisted out of the fraction - `-\frac{2}{3}`, not
 * `\frac{-2}{3}` - because that is how it is written by hand. The quadratic
 * solver already did this, so leaving it here made the two disagree about the
 * same answer.
 */
function formatValue(value: Fraction): string {
  if (value.denominator === 1) return String(value.numerator);
  return value.numerator < 0
    ? `-\\frac{${-value.numerator}}{${value.denominator}}`
    : `\\frac{${value.numerator}}{${value.denominator}}`;
}

/** "Subtract 3 from both sides" / "Add 3 to both sides". */
function describeMove(amount: number): string {
  return amount > 0
    ? `Subtract ${formatNumber(amount)} from both sides`
    : `Add ${formatNumber(-amount)} to both sides`;
}

/**
 * Solve the equation in `question`, or return `null`.
 *
 * @remarks
 * Only one shape is handled - `a1·x + b1 = a2·x + b2` - because that is what
 * "solve this equation" almost always means, and because a narrow solver that
 * is always right beats a broad one that is usually right.
 */
export function solveLinearEquation(question: string): SolvedEquation | null {
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

  const left = parseSide(sides[0], variable);
  const right = parseSide(sides[1], variable);
  if (!left || !right) return null;

  const coefficient = left.coefficient - right.coefficient;
  const constant = right.constant - left.constant;

  // No variable left, or no solution: not this solver's business.
  if (coefficient === 0) return null;

  const solution = fraction(constant, coefficient);
  if (!solution) return null;

  const steps: SolvedStep[] = [
    {tex: `${formatLinear(left, variable)} = ${formatLinear(right, variable)}`},
  ];

  // Move the constants across, then any variable term on the right, collapsing
  // to a single step when the original is already in that shape.
  const movedConstants = left.constant !== 0;
  const movedVariables = right.coefficient !== 0;
  if (movedConstants || movedVariables) {
    const notes: string[] = [];
    if (movedConstants) notes.push(describeMove(left.constant));
    if (movedVariables) {
      notes.push(
        right.coefficient > 0
          ? `Subtract ${formatLinear({coefficient: right.coefficient, constant: 0}, variable)} from both sides`
          : `Add ${formatLinear({coefficient: -right.coefficient, constant: 0}, variable)} to both sides`,
      );
    }
    steps.push({
      tex: `${formatLinear({coefficient, constant: 0}, variable)} = ${formatNumber(constant)}`,
      note: notes.join(', and '),
    });
  }

  // Divide only when there is something to divide by.
  if (coefficient !== 1) {
    steps.push({
      tex: `${variable} = ${formatValue(solution)}`,
      note: `Divide both sides by ${formatNumber(coefficient)}`,
    });
  } else {
    steps.push({tex: `${variable} = ${formatValue(solution)}`});
  }

  return {
    variable,
    // Plain words only, as the strategy's own prompt requires: the title is
    // drawn as `Txt`, so an equation in it renders literally *and* trips the
    // audit's plain-text-maths check. The equation is already the first step.
    title: 'Solving a Linear Equation',
    steps,
  };
}
