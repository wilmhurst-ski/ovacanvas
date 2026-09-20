import {describe, expect, it} from 'vitest';
import {StepByStepGenre} from './stepByStep';

describe('StepByStepGenre', () => {
  const genre = new StepByStepGenre();

  it('matches structural intent with a steps array', () => {
    expect(
      genre.matchesStructure({title: 'Test', steps: [{content: 'A'}]}),
    ).toBe(true);
    expect(genre.matchesStructure({steps: []})).toBe(false);
    expect(genre.matchesStructure({})).toBe(false);
    expect(genre.matchesStructure(null)).toBe(false);
  });

  it('validates and compiles a step-by-step chemical reaction', () => {
    const intent = {
      title: 'Combustion of Hydrogen',
      steps: [
        {content: '2H_2 + O_2', note: 'Reactants'},
        {
          content: '2H_2 + O_2 \\to 2H_2O',
          note: 'Exothermic reaction forms water',
        },
      ],
    };

    const validation = genre.validateIntent(intent);
    expect(validation.valid).toBe(true);
    if (!validation.valid) return;

    const source = genre.compileIntentToSource(validation.intent);
    expect(source).toContain('Combustion of Hydrogen');
    expect(source).toContain('2H_2 + O_2');
    expect(source).toContain('2H_2O');
    expect(source).toContain('export const choreographyPlan');
    expect(source).toContain('choreographyPlan');
    expect(source).toContain('buildAuditSpec');
  });

  it('validates and compiles a step-by-step mathematical derivation', () => {
    const intent = {
      title: 'Completing the Square',
      steps: [
        {tex: 'x^2 + 6x + 5 = 0'},
        {tex: '(x + 3)^2 - 4 = 0', note: 'add and subtract 9'},
        {tex: '(x + 3)^2 = 4', note: 'add 4 to both sides'},
        {tex: 'x + 3 = \\pm 2', note: 'take square root'},
      ],
    };

    const validation = genre.validateIntent(intent);
    expect(validation.valid).toBe(true);
    if (!validation.valid) return;

    const source = genre.compileIntentToSource(validation.intent);
    expect(source).toContain('Completing the Square');
    expect(source).toContain('(x + 3)^2');
    expect(source).toContain('step_1');
    expect(source).toContain('step_2');
    expect(source).toContain('step_3');
  });

  it('enforces step count maximum to prevent exceeding beat time budget', () => {
    const tooMany = {
      title: 'Excessive Steps',
      steps: [
        {content: '1'},
        {content: '2'},
        {content: '3'},
        {content: '4'},
        {content: '5'},
        {content: '6'},
      ],
    };
    const validation = genre.validateIntent(tooMany);
    expect(validation.valid).toBe(false);
    if (!validation.valid) {
      expect(validation.errors[0]).toContain('Too many steps');
    }
  });
});
