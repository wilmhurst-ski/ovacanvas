import {describe, expect, it} from 'vitest';
import {solveLinearEquation} from './solveLinear';

/** The final step's tex, which is the answer as it will be rendered. */
function answer(question: string): string | null {
  const solved = solveLinearEquation(question);
  return solved ? solved.steps[solved.steps.length - 1].tex : null;
}

describe('solveLinearEquation', () => {
  it('solves the shape a learner actually types', () => {
    expect(answer('solve 2x + 3 = 7')).toBe('x = 2');
    expect(answer('Solve 2x + 3 = 7 step by step')).toBe('x = 2');
    expect(answer('solve for y: 4y - 7 = 2y + 9')).toBe('y = 8');
  });

  it('handles the shapes that need no rearrangement', () => {
    expect(answer('3x = 12')).toBe('x = 4');
    expect(answer('x - 5 = 3')).toBe('x = 8');
    expect(answer('2x = x + 4')).toBe('x = 4');
    expect(answer('-x + 4 = 1')).toBe('x = 3');
  });

  it('gives an exact answer rather than a rounded one', () => {
    // A decimal here would be wrong on screen forever; the template renders
    // TeX, so a fraction is both exact and correct-looking.
    expect(answer('2x = 3')).toBe('x = \\frac{3}{2}');
    expect(answer('4x + 1 = 2')).toBe('x = \\frac{1}{4}');
  });

  it('shows the reasoning, not just the answer', () => {
    const solved = solveLinearEquation('solve 2x + 3 = 7')!;
    expect(solved.steps).toEqual([
      {tex: '2x + 3 = 7'},
      {tex: '2x = 4', note: 'Subtract 3 from both sides'},
      {tex: 'x = 2', note: 'Divide both sides by 2'},
    ]);
  });

  it('explains a negative move in the direction a person would say it', () => {
    const solved = solveLinearEquation('x - 5 = 3')!;
    expect(solved.steps[1].note).toBe('Add 5 to both sides');
  });

  it('says nothing about dividing by one', () => {
    const solved = solveLinearEquation('2x = x + 4')!;
    expect(solved.steps[solved.steps.length - 1].note).toBeUndefined();
  });

  it('bails out rather than guessing at anything it cannot solve exactly', () => {
    // The property this whole module rests on. Each of these has a real
    // answer; none of them is this solver's, and a confident wrong answer
    // rendered on screen is far worse than handing the question to a model.
    for (const unsupported of [
      'solve x^2 - 5x + 6 = 0', // quadratic
      'solve 3/(x - 1) = 2', // division by the variable
      'solve 2x + 3y = 7', // two unknowns
      'solve x/2 = 3', // coefficient written as a division
      'solve 2(x + 1) = 8', // brackets
      'solve 3x + 1 = 3x + 2', // no solution
      'solve 2x + 3 = 3 + 2x', // every value is a solution
      'what is a derivative?', // not an equation at all
      'solve = 4', // malformed
    ]) {
      expect(solveLinearEquation(unsupported), unsupported).toBeNull();
    }
  });

  it('does not mistake a word for a variable', () => {
    // "solve for x" has three letters in it; if the leading instruction were
    // not stripped, the letter count would be the thing that bailed - which
    // would be right by accident. This checks it is stripped.
    const solved = solveLinearEquation('solve for x: 3x = 12');
    expect(solved).not.toBeNull();
    expect(solved!.variable).toBe('x');
  });

  it('reads through the words a learner wraps around the equation', () => {
    // Each of these was a real phrasing that failed: leaving "quadratic" or
    // "equation" in the string makes those letters look like a second
    // unknown, so the solver refused its own question.
    expect(answer('solve the quadratic equation x^2 - 5x + 6 = 0')).toBeNull(); // quadratic, not linear
    expect(answer('solve the equation 2x + 3 = 7')).toBe('x = 2');
    expect(answer('can you solve this equation 2x + 3 = 7')).toBeNull(); // leading chatter
    expect(answer('solve for x: 2x + 3 = 7')).toBe('x = 2');
    expect(answer('Solve 2x + 3 = 7 and show steps')).toBe('x = 2');
    expect(answer('find the value of x: 2x + 3 = 7')).toBe('x = 2');
  });

  it('accepts a pasted unicode minus', () => {
    expect(answer('2x \u2212 3 = 7')).toBe('x = 5');
  });

  it('names the beat after the equation it solved', () => {
    // Plain words, per the strategy's own prompt: a `Txt` title containing
    // "x^2" renders literally and the audit refuses it.
    expect(solveLinearEquation('solve 2x + 3 = 7')!.title).toBe(
      'Solving a Linear Equation',
    );
  });
});
