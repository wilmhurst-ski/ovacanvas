import {describe, expect, it} from 'vitest';
import {solveRationalEquation} from './solveRational';

function answer(question: string): string | null {
  const solved = solveRationalEquation(question);
  return solved ? solved.steps[solved.steps.length - 1].tex : null;
}

describe('solveRationalEquation', () => {
  it('clears a denominator and solves the linear equation behind it', () => {
    const solved = solveRationalEquation('solve for x: 3/(x - 1) = 2')!;
    expect(solved.steps[0].tex).toBe('\\frac{3}{x - 1} = 2');
    expect(solved.steps[1].tex).toBe('3 = 2x - 2');
    expect(solved.steps[1].note).toBe('Multiply both sides by x - 1');
    // The answer, reached by exact arithmetic rather than a model's.
    expect(solved.steps[solved.steps.length - 1].tex).toBe('x = \\frac{5}{2}');
  });

  it('handles the variable in the denominator alone', () => {
    expect(answer('solve 2/x = 4')).toBe('x = \\frac{1}{2}');
    expect(answer('solve 1/(x + 1) = 3')).toBe('x = -\\frac{2}{3}');
  });

  it('handles a fraction on each side', () => {
    expect(answer('solve 1/(x - 1) = 2/(x + 1)')).toBe('x = 3');
  });

  it('refuses two fractions that cross-multiply to a contradiction', () => {
    // 1/(x-1) = 1/(x+3) needs x-1 = x+3, i.e. -1 = 3. There is no solution,
    // and the honest answer is to hand it to the provider rather than invent
    // one. (My first version of this test asserted x = -1, which was simply
    // wrong.)
    expect(solveRationalEquation('solve 1/(x - 1) = 1/(x + 3)')).toBeNull();
  });

  it('refuses a root that would make a denominator zero', () => {
    // The failure this module exists to prevent. `x/(x - 2) = 2/(x - 2)`
    // cross-multiplies to `x = 2` - which is not a solution, because it zeroes
    // both denominators. Reporting it would be wrong in the worst way: the
    // arithmetic is right and the answer is not.
    expect(solveRationalEquation('solve x/(x - 2) = 2/(x - 2)')).toBeNull();
  });

  it('bails out rather than guessing at anything it cannot reduce exactly', () => {
    for (const unsupported of [
      'solve 1/x + 1/(x + 1) = 1', // two fractions summed on one side
      'solve 3/(x - 1) = 2/(x - 1)^2', // a squared denominator
      'solve 2x + 3 = 7', // no denominator: another solver owns it
      'solve x^2 + 1 = 0', // no denominator, and no real roots
      'solve 3/x - 1 = 2', // ambiguous denominator, deliberately refused
      'what is a derivative?', // not an equation
    ]) {
      expect(solveRationalEquation(unsupported), unsupported).toBeNull();
    }
  });

  it('refuses an equation whose only solution is excluded', () => {
    // Cross-multiplying gives `1 = 1` - every x, except the one that matters.
    expect(solveRationalEquation('solve 1/(x - 3) = 1/(x - 3)')).toBeNull();
  });

  it('names the beat in plain words, as the template requires', () => {
    expect(solveRationalEquation('solve 3/(x - 1) = 2')!.title).toBe(
      'Solving a Rational Equation',
    );
  });
});
