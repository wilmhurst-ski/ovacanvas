import {describe, expect, it} from 'vitest';
import {solveQuadraticEquation} from './solveQuadratic';

/** The final step's tex - the answer as it will be rendered. */
function answer(question: string): string | null {
  const solved = solveQuadraticEquation(question);
  return solved ? solved.steps[solved.steps.length - 1].tex : null;
}

describe('solveQuadraticEquation', () => {
  it('factors a monic quadratic with whole roots', () => {
    // The form a learner is actually taught, and the form the corpus uses.
    const solved = solveQuadraticEquation('solve x^2 - 5x + 6 = 0')!;
    expect(solved.steps).toEqual([
      {tex: 'x^2 - 5x + 6 = 0'},
      {tex: '(x - 2)(x - 3) = 0', note: 'Factor the left-hand side'},
      {
        tex: 'x = 2 or x = 3',
        note: 'A product is zero when either factor is',
      },
    ]);
  });

  it('handles negative and zero roots without mangling the signs', () => {
    expect(answer('x^2 + x - 6 = 0')).toBe('x = -3 or x = 2');
    expect(answer('x^2 - 3x = 0')).toBe('x = 0 or x = 3');
    expect(answer('x^2 + 4x + 4 = 0')).toBe('x = -2');
  });

  it('falls back to the formula when the leading coefficient is not 1', () => {
    // Factoring 2x² - 3x - 5 into (2x - 5)(x + 1) is a harder lesson than
    // this template is teaching, so the formula is the honest route.
    const solved = solveQuadraticEquation('solve 2x^2 - 3x - 5 = 0')!;
    expect(solved.steps.map(step => step.tex)).toEqual([
      '2x^2 - 3x - 5 = 0',
      'x = \\frac{3 \\pm \\sqrt{49}}{4}',
      // The discriminant under its own root, then simplified - showing the
      // work is the point of the extra step.
      'x = \\frac{3 \\pm 7}{4}',
      'x = -1 or x = \\frac{5}{2}',
    ]);
  });

  it('keeps an irrational root exact rather than rounding it', () => {
    // 1.5 or 4.123 would be wrong on screen forever.
    expect(answer('x^2 - 3x - 2 = 0')).toBe('x = \\frac{3 \\pm \\sqrt{17}}{2}');
  });

  it('moves a non-zero right-hand side across first', () => {
    expect(answer('x^2 - 5x = -6')).toBe('x = 2 or x = 3');
  });

  it('bails out rather than guessing at anything it cannot solve exactly', () => {
    // The same safety property the linear solver holds to.
    for (const unsupported of [
      'solve x^2 + 1 = 0', // no real roots
      'solve x^3 - 1 = 0', // higher power
      'solve 2x^2 + 3y = 7', // two unknowns
      'solve (x + 1)(x - 2) = 0', // brackets
      'solve x^2/2 = 8', // division
      'solve 2x + 3 = 7', // linear: the linear solver owns this
      'what is a derivative?', // not an equation
    ]) {
      expect(solveQuadraticEquation(unsupported), unsupported).toBeNull();
    }
  });

  it('names the beat after the equation it solved', () => {
    expect(solveQuadraticEquation('solve x^2 - 5x + 6 = 0')!.title).toBe(
      'Factoring a Quadratic',
    );
  });
});
